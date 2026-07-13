import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'
import { demoUsersMiddleware } from './server/demo-users-api'

function demoUsersApiPlugin(): Plugin {
  return {
    name: 'demo-users-api',
    configureServer(server) {
      server.middlewares.use('/api/demo-users', demoUsersMiddleware)
    },
  }
}

export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: [react(), tailwindcss(), demoUsersApiPlugin()],
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
