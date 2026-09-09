import client from 'prom-client';

client.collectDefaultMetrics({ prefix: 'voiceroom_' });

export const metrics = {
  wsConnections: new client.Gauge({ name: 'voiceroom_ws_connections', help: 'Active WebSocket sessions' }),
  joinsTotal: new client.Counter({ name: 'voiceroom_joins_total', help: 'Room joins' }),
  chatsTotal: new client.Counter({ name: 'voiceroom_chats_total', help: 'Chat messages relayed' }),
  reactsTotal: new client.Counter({ name: 'voiceroom_reacts_total', help: 'Reactions relayed' }),
  httpRequests: new client.Counter({
    name: 'voiceroom_http_requests_total',
    help: 'HTTP requests',
    labelNames: ['method', 'route', 'status'],
  }),
};

export async function metricsBody(): Promise<{ body: string; contentType: string }> {
  return { body: await client.register.metrics(), contentType: client.register.contentType };
}
