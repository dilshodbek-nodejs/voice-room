import http from 'node:http';
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { logger } from './logger.js';
import { buildApp } from './modules/app.js';
import { metrics } from './modules/observability/metrics.js';

const { app, hub, close } = buildApp();
const server = http.createServer(app);

const wss = new WebSocketServer({ server, path: '/ws', perMessageDeflate: false, maxPayload: 64 * 1024 });
wss.on('connection', (ws, req) => {
  metrics.wsConnections.inc();
  hub.attach(ws, req.socket.remoteAddress ?? 'unknown');
  ws.on('close', () => metrics.wsConnections.dec());
});

// WS heartbeat: drop dead sockets.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    const s = ws as unknown as { isAlive?: boolean };
    if (s.isAlive === false) {
      ws.terminate();
      continue;
    }
    s.isAlive = false;
    ws.ping();
    ws.once('pong', () => {
      s.isAlive = true;
    });
  }
}, 30_000);
heartbeat.unref();

function shutdown(signal: string): void {
  logger.info('shutdown', { signal });
  clearInterval(heartbeat);
  server.close(() => void close().finally(() => process.exit(0)));
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

server.listen(config.port, () => {
  logger.info('voice-room backend listening', { port: config.port });
});
