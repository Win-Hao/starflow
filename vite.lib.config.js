import { resolve } from 'node:path'

/**
 * 库构建。默认打成自带依赖的单文件（ES + IIFE）；
 * STARFLOW_SLIM=1 时只打 ES 且把 three / postprocessing 留给外部（npm 用户）。
 *
 *   npm run build:lib        → lib/starflow.js  lib/starflow.iife.js
 *   npm run build:lib:slim   → lib/starflow.slim.js
 */
const slim = process.env.STARFLOW_SLIM === '1'

export default {
  build: {
    target: 'es2022',
    outDir: 'lib',
    // 两次构建写进同一个目录，不能互相清空
    emptyOutDir: false,
    minify: 'terser',
    sourcemap: false,
    lib: {
      entry: resolve(__dirname, 'src/lib.js'),
      name: 'Starflow',
      formats: slim ? ['es'] : ['es', 'iife'],
      fileName: (format) => (slim ? 'starflow.slim.js' : format === 'es' ? 'starflow.js' : 'starflow.iife.js'),
    },
    rollupOptions: slim
      ? { external: ['three', 'postprocessing', /^three\//] }
      : {},
  },
}
