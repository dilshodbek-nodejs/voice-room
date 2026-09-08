import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 2020,
    proxy: {
      // dev: WS бэка на :2021 проксируется на тот же origin (клиент ходит на /ws)
      '/ws': { target: 'ws://localhost:2021', ws: true },
    },
  },
});
