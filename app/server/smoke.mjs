// Smoke-тест протокола: два клиента, join/roster/peer-joined/chat/react+лимит/leave.
import WebSocket from 'ws';

const URL = 'ws://localhost:2021/ws';
const results = [];
const ok = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);
const t0 = Date.now();
const timeout = setTimeout(() => { console.table(results); process.exit(1); }, 8000);

function client(name) {
  const ws = new WebSocket(URL);
  const c = { ws, name, msgs: [], send: (o) => ws.send(JSON.stringify(o)) };
  ws.on('message', (raw) => c.msgs.push(JSON.parse(raw)));
  return new Promise((res) => ws.on('open', () => res(c)));
}
const got = (c, t, extra) => c.msgs.find((m) => m.t === t && (!extra || extra(m)));

const alice = await client('alice');
alice.send({ t: 'join', name: 'Алиса', room: 'test-01' });

const bob = await client('bob');
bob.send({ t: 'join', name: '', room: 'test-01' });

await new Promise((r) => setTimeout(r, 400));

// 1. roster
const roster = got(alice, 'roster');
ok('roster: alice получила', !!roster);
ok('roster: iceServers[] есть', Array.isArray(roster?.iceServers) && roster.iceServers.length > 0);
ok('roster: you.name = Алиса', roster?.you?.name === 'Алиса' && roster?.you?.you === true);

// 2. peer-joined у alice, roster.bob — гость
ok('peer-joined: alice увидела боба', !!got(alice, 'peer-joined'));
const rosterB = got(bob, 'roster');
ok('roster bob: выдался Гость-XXXX', /^Гость-\d{4}$/.test(rosterB?.you?.name || '') && rosterB?.you?.guest === true);

// 3. chat: bob шлёт → alice получает, bob получает me:true
bob.send({ t: 'chat', text: 'привет' });
await new Promise((r) => setTimeout(r, 200));
const chatA = got(alice, 'chat');
ok('chat: доставлен alice c fromName', chatA?.text === 'привет' && chatA?.fromName === 'Гость-' + rosterB.you.name.slice(6));
const chatB = got(bob, 'chat', (m) => m.me);
ok('chat: эхо me:true', !!chatB);

// 4. react: bob ок → alice видит; второй в течение 10с → RATE_LIMIT
bob.send({ t: 'react', emoji: '🔥' });
await new Promise((r) => setTimeout(r, 150));
ok('react: relay к alice', got(alice, 'react')?.emoji === '🔥');
bob.send({ t: 'react', emoji: '😂' });
await new Promise((r) => setTimeout(r, 150));
const err = got(bob, 'error');
ok('react: серверный лимит 10с → error RATE_LIMIT', err?.code === 'RATE_LIMIT' && typeof err.waitMs === 'number');

// 5. state (мут) → alice видит peer-state
bob.send({ t: 'state', muted: true });
await new Promise((r) => setTimeout(r, 150));
ok('state: peer-state muted relay', got(alice, 'peer-state')?.muted === true);

// 6. leave → peer-left у alice
bob.send({ t: 'leave' });
await new Promise((r) => setTimeout(r, 200));
ok('leave: peer-left у alice', got(alice, 'peer-left')?.peerId === rosterB.you.id);

// 7. ping/pong
alice.send({ t: 'ping', ts: 123 });
await new Promise((r) => setTimeout(r, 150));
ok('ping → pong c ts', got(alice, 'pong')?.ts === 123);

// 8. перф отдельно: node server/perf.mjs (ping→pong RTT)

alice.ws.close();
clearTimeout(timeout);
console.table(results);
const fails = results.filter((r) => r[0] === 'FAIL').length;
console.log(fails ? `✗ ${fails} FAIL` : '✓ ВСЕ ТЕСТЫ ПРОШЛИ · ' + (Date.now() - t0) + 'ms');
process.exit(fails ? 1 : 0);
