import { resolve } from 'node:path'

export default {
  // GitHub Pages 部署在 /starflow/ 下，构建时用 STARFLOW_BASE=/starflow/
  base: process.env.STARFLOW_BASE || '/',
  server: { port: 5173, host: '127.0.0.1' },
  build: {
    target: 'es2022',
    // 三个入口页都要打进 dist
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        lab: resolve(__dirname, 'lab.html'),
        embed: resolve(__dirname, 'embed.html'),
      },
    },
  },
}
