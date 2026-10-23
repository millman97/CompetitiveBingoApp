// The SPA build.
//
// Output goes to dist/client, which is the directory the Worker's static-assets binding serves.
// There is no separate Pages project: one Worker serves the API and the app.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    // `npm run dev:web` talks to a wrangler dev on 8787 for anything under /api.
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
