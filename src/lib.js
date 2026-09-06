/**
 * 星流 Starflow 库入口。
 *
 * 两种打包产物（见 vite.lib.config.js）：
 *   lib/starflow.js        自带 three + postprocessing，一个文件直接 <script type="module"> 用
 *   lib/starflow.iife.js   同上，但挂成全局 window.Starflow，给不用模块的页面
 *   lib/starflow.slim.js   不带依赖，给 npm 用户（three / postprocessing 走 peer 依赖）
 */
export {
  createAstraScene,
  DEFAULT_CONFIG,
  createAstraField,
  generateStarField,
  DEFAULT_FIELD_OPTIONS,
  detectWebGL,
  prefersReducedMotion,
  renderStaticFallback,
  AstraLensFlare,
  DEFAULT_FLARE,
  AstraBloomEffect,
  PALETTES,
  GALAXY_PATHS,
  GALAXY_LAYERS,
  createGalaxyLayers,
  rasterize,
  extractContours,
} from './astra/index.js'

export {
  createShapeSamples,
  createPathLayers,
  parseSvgPath,
  SHAPE_SAMPLE_COUNT,
} from './astra/paths.js'

export { PATH_PRESETS, DEFAULT_SHAPE_SETTINGS, ICON_PRESETS, TEXT_PRESETS } from './presets.js'

export const VERSION = '0.2.3'
