// Protocol smoke test against a RUNNING backend (default ws://localhost:2021/ws).
// Usage: npm run smoke  (backend must be up: npm run build && npm start)
import WebSocket from 'ws';

const URL = process.env.SMOKE_URL ?? 'ws://localhost:2021/ws';
const results = [];
const ok = (name, cond) => results.push([cond ? 'PASS' : 'FAIL', name]);
const timeout = setTimeout(() => {
  console.table(results);
  process.exit(1);
}, 8000);

function client() {
  const ws = new WebSocket(URL);
  const c = { ws, msgs: [], send: (o) => ws.send(JSON.stringify(o)) };
  ws.on('message', (raw) => c.msgs.push(JSON.parse(raw)));
  return new Promise((res) => ws.on('open', () => res(c)));
}
const got = (c, t, extra) => c.msgs.find((m) => m.t === t && (!extra || extra(m)));

const alice = await client();
alice.send({ t: 'join', name: 'Алиса', room: 'test-01' });
const bob = await client();
bob.send({ t: 'join', name: '', room: 'test-01' });
await new Promise((r) => setTimeout(r, 500));

const roster = got(alice, 'roster');
ok('roster received', !!roster);
ok('roster you.name', roster?.you?.name === 'Алиса');
ok('peer-joined seen', !!got(alice, 'peer-joined'));
const rosterB = got(bob, 'roster');
ok('guest provisioned', /^Гость-\d{4}$/.test(rosterB?.you?.name ?? ''));
ok('sfu creds delivered', typeof got(bob, 'sfu')?.token === 'string');

bob.send({ t: 'chat', text: 'привет' });
await new Promise((r) => setTimeout(r, 200));
ok('chat relay', got(alice, 'chat')?.text === 'привет');
ok('chat echo me:true', got(bob, 'chat', (m) => m.me)?.text === 'привет');

bob.send({ t: 'react', emoji: '🔥' });
await new Promise((r) => setTimeout(r, 150));
ok('react relay', got(alice, 'react')?.emoji === '🔥');
bob.send({ t: 'react', emoji: '😂' });
await new Promise((r) => setTimeout(r, 150));
ok('react cooldown enforced', got(bob, 'error')?.code === 'RATE_LIMIT');

bob.send({ t: 'state', muted: true });
await new Promise((r) => setTimeout(r, 150));
ok('peer-state relay', got(alice, 'peer-state')?.muted === true);

bob.send({ t: 'leave' });
await new Promise((r) => setTimeout(r, 200));
ok('peer-left', got(alice, 'peer-left')?.peerId === rosterB.you.id);

alice.send({ t: 'ping', ts: 123 });
await new Promise((r) => setTimeout(r, 150));
ok('ping/pong', got(alice, 'pong')?.ts === 123);

alice.ws.close();
bob.ws.close();
clearTimeout(timeout);
console.table(results);
const fails = results.filter((r) => r[0] === 'FAIL').length;
console.log(fails ? `✗ ${fails} FAIL` : '✓ ALL SMOKE TESTS PASSED');
process.exit(fails ? 1 : 0);
