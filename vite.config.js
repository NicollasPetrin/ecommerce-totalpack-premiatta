import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    proxy: {
      // O front chama /api/... na própria origem e o Vite encaminha para o
      // Express. Sem isto, o cookie de sessão cruzaria portas diferentes e
      // dependeria de CORS com credenciais.
      '/api': {
        target: 'http://127.0.0.1:3333',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
})
