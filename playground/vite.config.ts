import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: '@loykin/resourcekit/react', replacement: resolve(__dirname, '../src/react/index.ts') },
      { find: '@loykin/resourcekit', replacement: resolve(__dirname, '../src/index.ts') },
    ],
    dedupe: ['react', 'react-dom'],
  },
})
