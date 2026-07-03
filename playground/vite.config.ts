import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      { find: '@loykin/resourcekit/adapters/designkit', replacement: resolve(__dirname, '../src/adapters/designkit/index.ts') },
      { find: '@loykin/resourcekit/adapters/gridkit', replacement: resolve(__dirname, '../src/adapters/gridkit/index.ts') },
      { find: '@loykin/resourcekit/adapters/chartkit', replacement: resolve(__dirname, '../src/adapters/chartkit/index.ts') },
      { find: '@loykin/resourcekit/adapters/basekit', replacement: resolve(__dirname, '../src/adapters/basekit/index.ts') },
      { find: '@loykin/resourcekit/adapters', replacement: resolve(__dirname, '../src/adapters/index.ts') },
      { find: '@loykin/resourcekit/react', replacement: resolve(__dirname, '../src/react/index.ts') },
      { find: '@loykin/resourcekit', replacement: resolve(__dirname, '../src/index.ts') },
    ],
    dedupe: ['react', 'react-dom'],
  },
})
