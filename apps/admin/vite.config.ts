import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = 'http://127.0.0.1:4331';

export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    proxy: { '/api': api, '/cms-api': api },
  },
});
