// PM2: v2 backend (Node+TS, dist). Stateless; state in Postgres/Redis.
// Запуск: npm run backend:build && pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'voice-room',
      script: 'backend/dist/server.js',
      instances: 1,          // 1 на инстанс; горизонталь — за балансером + Redis PubSub (см. BACKEND_INTEGRATION.md §11)
      autorestart: true,
      max_memory_restart: '300M',
      kill_timeout: 5000,
      env: {
        NODE_ENV: 'production',
        PORT: 2021,
      },
    },
  ],
};
