// Клиент реального времени — готовая обвязка WS по спеке BACKEND_INTEGRATION.md.
// Подключение: import { createRealtime } from './realtime.js'
// В App.jsx заменить моки на колбэки. НЕ подключено автоматически (QA-фаза).

export function createRealtime({ name, room, onMessage, onOpen, onClose }) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/ws`);

  const api = {
    ws,
    send: (obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); },
    join: () => api.send({ t: 'join', name, room }),
    chat: (text) => api.send({ t: 'chat', text }),
    react: (emoji) => api.send({ t: 'react', emoji }),
    state: (muted) => api.send({ t: 'state', muted }),
    speaking: (speaking) => api.send({ t: 'speaking', speaking }),
    leave: () => api.send({ t: 'leave' }),
    ping: () => { const ts = Date.now(); api.send({ t: 'ping', ts }); return ts; },
    close: () => {
      // не дёргаем close() на CONNECTING — иначе "closed before the connection is established"
      if (ws.readyState === WebSocket.CONNECTING) {
        ws.onopen = () => ws.close();
        ws.onmessage = null;
      } else {
        ws.close();
      }
    },
  };

  ws.onopen = () => { onOpen?.(api); api.join(); };
  ws.onmessage = (e) => {
    try { onMessage?.(JSON.parse(e.data), api); } catch (_) { /* ignore */ }
  };
  ws.onclose = () => onClose?.();
  return api;
}
