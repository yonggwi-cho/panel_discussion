const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// パネルディスカッション「今の時代を、君たちはどう生きるか」 向けアンケート
const POLLS = [
  {
    id: 1,
    question: '10年後の自分がどこで何をしているか、イメージできますか？',
    options: ['はっきりイメージできる', 'なんとなくイメージできる', 'あまりイメージできない', '全くイメージできない'],
    section: '第1部：導入',
  },
  {
    id: 2,
    question: '今の自分にとって「進路」を考えるうえで一番大事なことは？',
    options: ['安定した収入・職業', 'やりがい・好きなこと', '家族や周囲の期待', '社会への貢献'],
    section: '第2部：自己紹介',
  },
  {
    id: 3,
    question: '「安定」と「挑戦」、どちらを選びたい？',
    options: ['安定を選ぶ', '挑戦を選ぶ', 'バランスを取りたい', 'まだわからない'],
    section: '第3部：軸① 変化の時代',
  },
  {
    id: 4,
    question: '自分のアイデンティティ（ルーツ・文化など）は進路に影響すると思いますか？',
    options: ['大きく影響すると思う', '少し影響すると思う', 'あまり影響しないと思う', 'わからない'],
    section: '第3部：軸② アイデンティティ',
  },
  {
    id: 5,
    question: '「好きなことで生きていく」は現実的だと思いますか？',
    options: ['十分現実的', '努力次第で可能', 'かなり難しい', 'ほぼ無理だと思う'],
    section: '第3部：軸③ 進路選択のリアル',
  },
  {
    id: 6,
    question: '今日のパネルディスカッションを聞いて、あなたの進路観は変わりましたか？',
    options: ['大きく変わった', '少し変わった', 'あまり変わらなかった', 'もともと近い考えだった'],
    section: '第5部：クロージング',
  },
];

// 投票状態
const state = {
  currentPollId: null,
  isOpen: false,
  votes: {}, // pollId -> { optionIndex -> count }
  voterIds: {}, // pollId -> Set of voter IDs
};

// 各ポールの票を初期化
POLLS.forEach(p => {
  state.votes[p.id] = p.options.map(() => 0);
  state.voterIds[p.id] = new Set();
});

function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

function buildStateSnapshot() {
  const poll = POLLS.find(p => p.id === state.currentPollId) || null;
  const votes = poll ? state.votes[poll.id] : [];
  const total = votes.reduce((s, v) => s + v, 0);
  return {
    type: 'state',
    poll,
    votes,
    total,
    isOpen: state.isOpen,
    polls: POLLS.map(p => ({ id: p.id, question: p.question, section: p.section })),
  };
}

wss.on('connection', ws => {
  ws.send(JSON.stringify(buildStateSnapshot()));

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'vote') {
      const { pollId, optionIndex, voterId } = msg;
      if (
        state.isOpen &&
        state.currentPollId === pollId &&
        typeof optionIndex === 'number' &&
        optionIndex >= 0 &&
        optionIndex < state.votes[pollId].length &&
        !state.voterIds[pollId].has(voterId)
      ) {
        state.votes[pollId][optionIndex]++;
        state.voterIds[pollId].add(voterId);
        broadcast(buildStateSnapshot());
        ws.send(JSON.stringify({ type: 'voted', optionIndex }));
      } else if (state.voterIds[pollId]?.has(voterId)) {
        ws.send(JSON.stringify({ type: 'already_voted' }));
      }
    }
  });
});

// 管理API
app.post('/api/poll/open', (req, res) => {
  const { pollId } = req.body;
  const poll = POLLS.find(p => p.id === pollId);
  if (!poll) return res.status(404).json({ error: 'poll not found' });
  state.currentPollId = pollId;
  state.isOpen = true;
  broadcast(buildStateSnapshot());
  res.json({ ok: true });
});

app.post('/api/poll/close', (req, res) => {
  state.isOpen = false;
  broadcast(buildStateSnapshot());
  res.json({ ok: true });
});

app.post('/api/poll/reset', (req, res) => {
  const { pollId } = req.body;
  if (state.votes[pollId]) {
    const poll = POLLS.find(p => p.id === pollId);
    state.votes[pollId] = poll.options.map(() => 0);
    state.voterIds[pollId] = new Set();
    broadcast(buildStateSnapshot());
  }
  res.json({ ok: true });
});

app.get('/api/qrcode', async (req, res) => {
  const { url } = req.query;
  try {
    const dataUrl = await QRCode.toDataURL(url, { width: 300, margin: 2 });
    res.json({ qr: dataUrl });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/polls', (req, res) => {
  res.json(POLLS);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ サーバー起動: http://localhost:${PORT}`);
  console.log(`   投票画面:  http://localhost:${PORT}/vote.html`);
  console.log(`   表示画面:  http://localhost:${PORT}/display.html`);
  console.log(`   管理画面:  http://localhost:${PORT}/admin.html`);
});
