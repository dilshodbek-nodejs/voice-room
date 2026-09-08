// Перф-тест: 100 последовательных ping→pong, средний RTT и p95.
import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:2021/ws');
await new Promise((r) => ws.on('open', r));

const rtts = [];
const N = 100;
for (let i = 0; i < N; i++) {
  const t0 = performance.now();
  const pong = new Promise((res) => {
    const h = (raw) => { const m = JSON.parse(raw); if (m.t === 'pong') { ws.off('message', h); res(); } };
    ws.on('message', h);
  });
  ws.send(JSON.stringify({ t: 'ping', ts: Date.now() }));
  await pong;
  rtts.push(performance.now() - t0);
}
ws.close();

rtts.sort((a, b) => a - b);
const avg = rtts.reduce((s, v) => s + v, 0) / N;
const p50 = rtts[Math.floor(N * 0.5)];
const p95 = rtts[Math.floor(N * 0.95)];
console.log(`ping→pong ×${N}: avg ${avg.toFixed(2)}ms · p50 ${p50.toFixed(2)}ms · p95 ${p95.toFixed(2)}ms · max ${rtts[N-1].toFixed(2)}ms`);
console.log(avg < 5 ? '✓ ПЕРФ ОК (<5ms avg локально)' : '✗ МЕДЛЕННО');
