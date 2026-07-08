import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base so the built index.html works when opened via file://
  // (Electron) or capacitor:// (Capacitor WebView), not just from a server root.
  base: './',
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5173,
  },
});
