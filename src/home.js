import { createAstraScene, detectWebGL, renderStaticFallback } from './astra/index.js'
import { createShapeSamples } from './astra/paths.js'
import { PATH_PRESETS } from './presets.js'
import { applyLocale, detectLocale, getLocale, t } from './i18n.js'

// 文案先落到位，再建场
applyLocale(detectLocale())

/**
 * 原站首页的滚动编排：
 *   首屏星系 → 第一段文案滚到视口中央时，星系绕 X 轴翻转并散成两侧星轨
 *   → 形状 cue 进入视口时星星聚成光标 / 结，离开时散回星轨
 *   → 最后一个 cue 常驻
 * 页面只负责量 DOM、算进度；阻尼、混合、光晕追踪都在引擎里。
 */
const canvas = document.getElementById('astra')
const page = document.getElementById('page')
const intro = document.querySelector('[data-astra-intro]')
const copyBlocks = Array.from(document.querySelectorAll('.copy'))

// 原站默认：800px 滚动距离对应进度 1（散开的进度还会继续到 1.1875）
const DISPERSE_DISTANCE = 800

if (!detectWebGL()) {
  renderStaticFallback(canvas, { type: 'galaxy' })
  throw new Error('当前浏览器不支持 WebGL，已回退到静态星图')
}

const astra = createAstraScene(canvas)
window.__astra = astra

// 面板里"会重建星场"的那组参数
const FIELD_DEFAULTS = { starCount: 4000, size: 2.05, scatter: 0.041, backgroundRatio: 0.14, rotationDepth: 1.4, palette: 'astra' }
const fieldOptions = { ...FIELD_DEFAULTS }
// 首屏的氛围强度；滚动散开后会退到 0.12
let ambientBase = 0.55

let lastStats = null
function renderStats() {
  const readout = document.getElementById('stats')
  if (readout && lastStats) readout.textContent = t('tuner.stats', lastStats.count, lastStats.layers)
}
function rebuild() {
  lastStats = astra.setSource({ type: 'galaxy' }, fieldOptions)
  renderStats()
  schedule()
}

// 每个 cue 预先把路径采样好，滚动时只换贴图数据
const cues = Array.from(document.querySelectorAll('[data-astra-shape]')).map((element, index, all) => {
  const preset = PATH_PRESETS[element.dataset.astraShape]
  const viewBox = preset.viewBox
  const svg = element.querySelector('svg')
  // 顺手把路径画进 svg（透明），只为了让它撑出正确的宽高比
  if (svg) svg.innerHTML = preset.paths.map((d) => `<path d="${d}" stroke="currentColor" stroke-width="${viewBox[3] / 24}"/>`).join('')
  return {
    id: element.dataset.astraShape,
    element,
    target: element.querySelector('.cue-target') ?? element,
    samples: createShapeSamples(preset.paths, viewBox),
    aspectRatio: viewBox[2] / viewBox[3],
    holdAtRangeEnd: index === all.length - 1,
  }
})

const smoothstep = (x, a, b) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

let scheduled = false
let lastViewportHeight = 0

function update() {
  scheduled = false
  const viewportHeight = window.innerHeight
  const viewportWidth = window.innerWidth
  const scrollTop = window.scrollY
  // 只在真的变了才写样式，免得每次滚动都触发一轮样式重算
  if (viewportHeight !== lastViewportHeight) {
    lastViewportHeight = viewportHeight
    document.documentElement.style.setProperty('--astra-viewport-height', `${viewportHeight}px`)
  }

  // 首屏进度（原站 getAstraScrollState）
  const progress = Math.max(scrollTop / DISPERSE_DISTANCE, 0)

  // 散开 / 翻转跟着第一段文案走（原站 introContent）：
  // 文案顶部到视口 66% 处开始，文案中线到视口中线时完成
  let scatterProgress = null
  let tiltProgress = null
  if (intro) {
    const rect = intro.getBoundingClientRect()
    const top = rect.top + scrollTop
    const start = top - 0.66 * viewportHeight
    const end = top + 0.5 * rect.height - 0.5 * viewportHeight
    scatterProgress = Math.min(1, Math.max(0, (scrollTop - start) / Math.max(end - start, 1)))
    tiltProgress = Math.min(1, scrollTop / Math.max(1, end))
  }

  // 文案栏边界 → 星轨给它让位
  let contentBounds = null
  const copy = copyBlocks[0]
  if (copy) {
    const rect = copy.getBoundingClientRect()
    contentBounds = { left: rect.left / viewportWidth, right: rect.right / viewportWidth }
  }

  // 形状 cue：进入视口 0..36% 处成形，50%..86% 处消散；最后一个常驻
  let active = null
  let strength = 0
  for (const cue of cues) {
    const rect = cue.element.getBoundingClientRect()
    const entered = (viewportHeight - rect.top) / Math.max(viewportHeight + rect.height, 1)
    const leaving = cue.holdAtRangeEnd ? 1 : 1 - smoothstep(entered, 0.5, 0.86)
    const value = smoothstep(entered, 0, 0.36) * leaving
    if (value > strength) {
      strength = value
      active = cue
    }
  }

  const shape = { strength }
  if (active) {
    const rect = active.target.getBoundingClientRect()
    // 形状在框里等比居中：宽高比来自 viewBox
    const width = rect.width / Math.max(rect.height, 1) > active.aspectRatio ? rect.height * active.aspectRatio : rect.width
    const height = width / active.aspectRatio
    shape.id = active.id
    shape.samples = active.samples
    shape.centerNdc = [
      ((rect.left + rect.width / 2) / viewportWidth) * 2 - 1,
      1 - ((rect.top + rect.height / 2) / viewportHeight) * 2,
    ]
    shape.sizeNdc = [(width / viewportWidth) * 2, (height / viewportHeight) * 2]
  }

  // 星系翻身散开后氛围色也退掉，形状出现时不需要它
  astra.config.ambientOpacity = 0.12 + Math.max(ambientBase - 0.12, 0) * (1 - Math.min(1, progress))
  astra.setScroll({ progress, tiltProgress, scatterProgress, contentBounds, shape })
}

function schedule() {
  if (scheduled) return
  scheduled = true
  requestAnimationFrame(update)
}

window.addEventListener('scroll', schedule, { passive: true })
window.addEventListener('resize', schedule, { passive: true })
// schedule 定义完之后才能建场（rebuild 里会调它）
rebuild()

// ---------- 语言切换 ----------
document.getElementById('langToggle').addEventListener('click', () => {
  applyLocale(getLocale() === 'zh' ? 'en' : 'zh')
  renderStats()
  // 文案长度变了，cue 和文案栏的位置也会变，重新量一遍
  schedule()
})

// ---------- 调节面板 ----------
const $ = (id) => document.getElementById(id)
const tuner = $('tuner')
const tunerToggle = $('tunerToggle')

function setTunerOpen(open) {
  tuner.hidden = !open
  tunerToggle.setAttribute('aria-expanded', String(open))
}
tunerToggle.addEventListener('click', () => setTunerOpen(tuner.hidden))
$('tunerClose').addEventListener('click', () => setTunerOpen(false))
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !tuner.hidden) setTunerOpen(false)
})

let rebuildTimer = 0
/** 拖滑块时会连续触发，攒一下再重建，避免每个像素都重算一次星场。 */
function scheduleRebuild() {
  clearTimeout(rebuildTimer)
  rebuildTimer = setTimeout(rebuild, 120)
}

/**
 * @param {'field'|'config'} target field = 改动重建星场；config = 只更新 uniform
 */
function bindRange(id, target, key, format = (v) => v.toFixed(2)) {
  const input = $(id)
  const readout = $(`v-${id}`)
  const sync = () => {
    const value = Number(input.value)
    if (readout) readout.textContent = format(value)
    if (target === 'field') {
      fieldOptions[key] = value
      scheduleRebuild()
    } else if (typeof key === 'function') {
      key(value)
    } else {
      astra.setConfig({ [key]: value })
    }
  }
  input.addEventListener('input', sync)
  return sync
}

const syncers = [
  bindRange('starCount', 'field', 'starCount', (v) => v.toLocaleString()),
  bindRange('size', 'field', 'size'),
  bindRange('scatter', 'field', 'scatter', (v) => v.toFixed(3)),
  bindRange('backgroundRatio', 'field', 'backgroundRatio'),
  bindRange('rotationDepth', 'field', 'rotationDepth'),
  bindRange('bloomIntensity', 'config', 'bloomIntensity'),
  bindRange('bloomThreshold', 'config', 'bloomThreshold'),
  bindRange('intensity', 'config', 'intensity'),
  bindRange('flare', 'config', (value) => astra.setConfig({ lensFlare: { enabled: value > 0, intensity: value } })),
  bindRange('ambient', 'config', (value) => { ambientBase = value; schedule() }),
  bindRange('vignette', 'config', 'vignette'),
  bindRange('flowSpeed', 'config', 'flowSpeed'),
  bindRange('twinkleSpeed', 'config', 'twinkleSpeed'),
  bindRange('shapeScatter', 'config', 'shapeScatter'),
]

$('palette').addEventListener('change', (event) => {
  fieldOptions.palette = event.target.value
  scheduleRebuild()
})
$('ambientColor').addEventListener('input', (event) => astra.setConfig({ ambientColor: event.target.value }))
$('quality').addEventListener('change', (event) => astra.setConfig({ quality: event.target.value }))
for (const key of ['pointerRepel', 'coreSpin', 'shapeAutoRotate', 'adaptiveQuality']) {
  $(key).addEventListener('change', (event) => {
    astra.setConfig({ [key]: event.target.checked })
    // 推斥是在建场时挂上 GPGPU 的，开关它需要重建
    if (key === 'pointerRepel') scheduleRebuild()
  })
}
$('replay').addEventListener('click', () => astra.replay())
$('reset').addEventListener('click', () => {
  const defaults = {
    starCount: 4000, size: 2.05, scatter: 0.041, backgroundRatio: 0.14, rotationDepth: 1.4,
    bloomIntensity: 0.7, bloomThreshold: 0.08, intensity: 1.35, flare: 0.28, ambient: 0.55, vignette: 1,
    flowSpeed: 0.8, twinkleSpeed: 0.62, shapeScatter: 1,
  }
  for (const [id, value] of Object.entries(defaults)) $(id).value = value
  $('palette').value = 'astra'
  $('ambientColor').value = '#23435f'
  $('quality').value = 'full'
  for (const key of ['pointerRepel', 'coreSpin', 'shapeAutoRotate', 'adaptiveQuality']) $(key).checked = true
  Object.assign(fieldOptions, FIELD_DEFAULTS)
  astra.setConfig({
    ambientColor: '#23435f', quality: 'full', pointerRepel: true, coreSpin: true, shapeAutoRotate: true, adaptiveQuality: true,
    pixelBudget: 2.4e6,
  })
  for (const sync of syncers) sync()
  scheduleRebuild()
})
// 把初始值写进读数，不触发重建
for (const sync of syncers) {
  // bindRange 的 sync 会写 fieldOptions / config；初始值与默认一致，只是刷新读数
  sync()
}
clearTimeout(rebuildTimer)
