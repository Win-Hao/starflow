import { resolve } from 'node:path'

export default {
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
