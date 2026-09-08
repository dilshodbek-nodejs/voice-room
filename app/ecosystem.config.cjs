// PM2: авто-рестарт, лимит памяти, прод-ENV. Запуск: pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'voice-room',
      script: 'server/server.js',
      instances: 1,          // WS + in-memory state → строго 1 инстанс (скейл: Redis PubSub, см. док §11)
      autorestart: true,
      max_memory_restart: '300M',
      kill_timeout: 3000,
      env: {
        NODE_ENV: 'production',
        PORT: 2021,
      },
    },
  ],
};
