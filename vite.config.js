import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// On GitHub Pages the site is served from /<repo>/, so the asset base must match
// the repository name in production. Locally (dev) the base stays "/".
const REPO = 'tribunal-moderation';

export default defineConfig(({ command }) => ({
  plugins: [react()],
  base: command === 'build' ? `/${REPO}/` : '/',
  server: {
    port: 5173,
  },
}));
