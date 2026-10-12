import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath, URL } from 'node:url'
export default defineConfig(({ command }) => ({ base: './', plugins: [react(), tailwindcss(), { name: 'development-csp', transformIndexHtml(html) { return command === 'serve' ? html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'").replace("connect-src 'none'", "connect-src 'self' ws://127.0.0.1:5173") : html } }], esbuild: { include: /\.(ts|tsx|cts)$/ }, resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } }, server: { port: 5173, strictPort: true } }))
