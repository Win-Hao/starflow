import { detectWebGL, renderStaticFallback } from './astra/fallback.js'
import { createAstraScene } from './astra/scene.js'
import { rasterize } from './astra/rasterize.js'
import { extractStrokes } from './astra/skeleton.js'
import { extractContours, resampleClosed, signedArea, smoothClosed } from './astra/contours.js'
import { createShapeSamples, createShapeSamplesFromPolylines } from './astra/paths.js'
import { DEFAULT_SHAPE_SETTINGS, ICON_PRESETS, PATH_PRESETS, TEXT_PRESETS, TEXT_SHAPE_SETTINGS, PATH_SHAPE_SETTINGS } from './presets.js'
import { applyLocale, detectLocale, getLocale, t } from './i18n.js'

applyLocale(detectLocale())

const $ = (id) => document.getElementById(id)
const canvas = $('astra')

// 拿不到 WebGL 就退到 Canvas 2D 静态星图：构图和配色保住，只是不会动。
let astra = null
try {
  if (!detectWebGL()) throw new Error('当前浏览器不支持 WebGL')
  astra = createAstraScene(canvas)
} catch (error) {
  console.warn('[astra] 已回退到静态渲染：', error)
}

// 形状相关的参数一改就要重建几何；渲染相关的参数只更新 uniform。
const fieldOptions = {
  starCount: 4000,
  fillRatio: 0,
  backgroundRatio: 0.14,
  scatter: 0.041,
  rotationDepth: 1.4,
  // 形状体积：只对文字 / 图标 / 路径生效，星系模式传 0 保持原站的逐星序列
  depth: 0.1,
  stroke: 'auto',
  strokeSpread: 1.3,
  // 图标 / SVG / 图片：'converge' = 原站 icon 效果（星系的星汇聚成形状，发布页那条管线），'paths' = 路径形状撒星，'plain' = 普通轮廓
  rasterStyle: 'converge',
  pathShape: false,
  size: 2.05,
  palette: 'astra',
}

let source = { type: 'galaxy' }
let rebuildTimer = 0
let lastStats = null

// ── 原站 icon 效果：星场保持星系，用发布页的滚动形状管线把星汇聚成图标 ──
let converged = false
let shapeId = 0
let lastShape = null

/** 光栅图标抠成折线：文字和细描边走中线，实心图标走轮廓（和引擎里 stroke:'auto' 的规则一致） */
function traceIcon(iconSource) {
  const { mask, width, height } = rasterize(iconSource)
  const result = extractStrokes(mask, width, height, { threshold: 0.5 })
  const thin = result.maxHalfWidth / height < 0.15
  const useStrokes = result.strokes.length > 0 && (fieldOptions.stroke === 'center' || (fieldOptions.stroke !== 'outline' && (iconSource.type === 'text' || thin)))
  if (useStrokes) return result.strokes.map((s) => ({ points: s.points, closed: s.closed }))
  return extractContours(mask, width, height, { threshold: 0.5 })
    .map((points) => smoothClosed(points, 2))
    .filter((points) => Math.abs(signedArea(points)) >= 24)
    .map((points) => resampleClosed(points, 1.6))
    .filter((entry) => entry.points.length >= 8)
    .map((entry) => {
      // 从最低点起算：形状两端渐隐、Z 向起伏归零的地方落在尖端，和原站的心形一致
      let best = 0
      for (let i = 1; i < entry.points.length; i += 1) if (entry.points[i][1] > entry.points[best][1]) best = i
      return { points: entry.points.slice(best).concat(entry.points.slice(0, best)), closed: true }
    })
}

function shapeAspect(polylines) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const { points } of polylines) {
    for (const [x, y] of points) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  return Math.max(maxX - minX, 1e-6) / Math.max(maxY - minY, 1e-6)
}

/** 形状框：像发布页的 cue 一样占视口高度的 64%，宽度按形状比例，最多占 70% 宽 */
function shapeBox(aspect) {
  const vw = canvas.clientWidth || 1
  const vh = canvas.clientHeight || 1
  let heightNdc = 1.28
  let widthNdc = heightNdc * aspect * (vh / vw)
  if (widthNdc > 1.4) {
    widthNdc = 1.4
    heightNdc = widthNdc / (aspect * (vh / vw))
  }
  return [widthNdc, heightNdc]
}

function showShape(samples, aspect) {
  if (!astra) return
  lastShape = { samples, aspect }
  astra.setConfig({ scrollEffects: true })
  astra.setScroll({ progress: 1.25, shape: { id: ++shapeId, samples, strength: 1, centerNdc: [0, 0], sizeNdc: shapeBox(aspect) } })
  converged = true
  renderStats()
}

function clearShape() {
  if (!converged || !astra) return
  astra.setScroll({ progress: 0, shape: { strength: 0 } })
  converged = false
  lastShape = null
}

window.addEventListener('resize', () => {
  if (converged && lastShape) astra?.setScroll({ shape: { sizeNdc: shapeBox(lastShape.aspect) } })
})

/** 汇聚模式：星场必须是星系；不是就切过去（沿用星系参数） */
function ensureGalaxy() {
  if (source.type === 'galaxy') return
  source = { type: 'galaxy' }
  applyShapeSettings({})
  scheduleRebuild()
}

function renderStats() {
  if (!lastStats) return
  const iconMode = ['icon', 'svg', 'file'].includes(modeSelect.value)
  const rasterField = ['text', 'svg', 'image'].includes(source.type)
  for (const block of document.querySelectorAll('[data-icon-only]')) block.hidden = !iconMode
  for (const block of document.querySelectorAll('[data-trace]')) block.hidden = !(rasterField || (iconMode && converged))
  if (converged) {
    for (const block of document.querySelectorAll('[data-raster-only]')) block.hidden = true
    for (const block of document.querySelectorAll('[data-stroke-center], [data-shape-only]')) block.hidden = true
    for (const block of document.querySelectorAll('[data-stroke-outline]')) block.hidden = false
    $('stats').textContent = t('lab.statsConverge', lastStats.count)
    return
  }
  const kind = t(source.type === 'galaxy' ? 'lab.kind.galaxy' : source.type === 'galaxy-text' ? 'lab.kind.galaxyText' : source.type === 'paths' ? 'lab.kind.paths' : lastStats.strokes ? 'lab.kind.strokes' : 'lab.kind.contours')
  // 只有光栅形状才有填充 / 星带这些选项
  for (const block of document.querySelectorAll('[data-raster-only]')) block.hidden = !rasterField
  // 中线模式下星带宽度由笔画宽度决定，只剩散布倍率可调
  const center = source.type !== 'galaxy' && source.type !== 'paths' && !!lastStats.strokes
  for (const block of document.querySelectorAll('[data-stroke-center]')) block.hidden = !center
  for (const block of document.querySelectorAll('[data-stroke-outline]')) block.hidden = center
  const units = source.type === 'galaxy-text' ? String(source.value).length : lastStats.layers
  $('stats').textContent = t('lab.stats', lastStats.count, units, kind)
}

/**
 * 路径形状（光标 / OpenAI 结）和星系用的是两套参数：星带宽度、暗星尺寸、亮星压暗、
 * 占屏比例、氛围色。切换形状时把对应的值写进滑块，再由滑块的 sync 落到 fieldOptions / config。
 */
function applyShapeSettings(settings) {
  const merged = { ...DEFAULT_SHAPE_SETTINGS, ...settings }
  for (const [id, value] of [['scatter', merged.scatter], ['starCount', merged.starCount], ['flowSpeed', merged.flowSpeed], ['depth', merged.depth]]) {
    const input = $(id)
    input.value = value
    input.dispatchEvent(new Event('input'))
  }
  fieldOptions.brightRetention = merged.brightRetention
  astra?.setConfig({ dimSizeScale: merged.dimSizeScale, fillX: merged.fillX, fillY: merged.fillY, ambientOpacity: merged.ambient })
}

const shapeOptions = () => ({
  ...fieldOptions,
  rasterStyle: undefined,
  depth: source.type === 'galaxy' || source.type === 'galaxy-text' ? 0 : fieldOptions.depth,
  pathShape: fieldOptions.pathShape && (source.type === 'svg' || source.type === 'image'),
})

function rebuild() {
  try {
    if (!astra) {
      renderStaticFallback(canvas, source, shapeOptions())
      $('stats').textContent = t('lab.fallback')
      return
    }
    lastStats = astra.setSource(source, shapeOptions())
    renderStats()
  } catch (error) {
    $('stats').textContent = `⚠︎ ${error.message}`
    console.error(error)
  }
}

/** 拖滑块时会连续触发，攒一帧再重建，避免每个像素都重算一次轮廓。 */
function scheduleRebuild() {
  clearTimeout(rebuildTimer)
  rebuildTimer = setTimeout(rebuild, 90)
}

// --- 形状来源 ---
const modeSelect = $('mode')
modeSelect.addEventListener('change', () => {
  for (const block of document.querySelectorAll('[data-mode]')) {
    block.hidden = block.dataset.mode !== modeSelect.value
  }
  // 填充星尘只对"有内部"的光栅形状有意义
  for (const block of document.querySelectorAll('[data-raster-only], [data-shape-only]')) {
    block.hidden = modeSelect.value === 'galaxy'
  }
  if (modeSelect.value === 'galaxy' || modeSelect.value === 'text') clearShape()
  if (modeSelect.value === 'galaxy') {
    source = { type: 'galaxy' }
    textKind = ''
    applyShapeSettings({})
    scheduleRebuild()
  }
  if (modeSelect.value === 'text') {
    textKind = ''
    applyText()
  }
  if (modeSelect.value === 'icon') applyIcon()
})

let textKind = ''
function applyText() {
  const value = $('text').value || '6'
  const galaxy = $('textStyle').value === 'galaxy' && /^[0-9]+$/.test(value)
  if (galaxy) {
    source = { type: 'galaxy-text', value }
    // 每位数字自己就是一个星系：星数按位数加，其余沿用星系模式的参数
    const kind = `galaxy${value.length}`
    if (textKind !== kind) applyShapeSettings({ starCount: Math.min(16000, 4000 * value.length) })
    textKind = kind
  } else {
    source = { type: 'text', value, fontWeight: Number($('weight').value) }
    if (textKind !== 'stroke') applyShapeSettings(TEXT_SHAPE_SETTINGS)
    textKind = 'stroke'
  }
  scheduleRebuild()
}
$('text').addEventListener('input', applyText)
$('weight').addEventListener('change', applyText)
$('textStyle').addEventListener('change', applyText)

const chips = $('textChips')
for (const preset of TEXT_PRESETS) {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = preset
  button.addEventListener('click', () => {
    $('text').value = preset
    applyText()
  })
  chips.append(button)
}

const iconSelect = $('icon')
for (const [id, preset] of Object.entries({ ...PATH_PRESETS, ...ICON_PRESETS })) {
  const option = document.createElement('option')
  option.value = id
  option.dataset.i18n = `lab.preset.${id}`
  option.textContent = t(`lab.preset.${id}`) === `lab.preset.${id}` ? preset.label : t(`lab.preset.${id}`)
  iconSelect.append(option)
}
$('lang').textContent = getLocale() === 'zh' ? 'EN' : '中文'
$('lang').addEventListener('click', () => {
  applyLocale(getLocale() === 'zh' ? 'en' : 'zh')
  $('lang').textContent = getLocale() === 'zh' ? 'EN' : '中文'
  renderStats()
})
let pendingIcon = null
function applyIcon() {
  pendingIcon = null
  const pathPreset = PATH_PRESETS[iconSelect.value]
  if (fieldOptions.rasterStyle === 'converge') {
    ensureGalaxy()
    if (pathPreset) {
      const [, , vw, vh] = pathPreset.viewBox
      showShape(createShapeSamples(pathPreset.paths, pathPreset.viewBox), vw / vh)
    } else {
      const polylines = traceIcon({ type: 'svg', markup: ICON_PRESETS[iconSelect.value].markup })
      showShape(createShapeSamplesFromPolylines(polylines), shapeAspect(polylines))
    }
    return
  }
  clearShape()
  if (pathPreset) {
    source = { type: 'paths', paths: pathPreset.paths, viewBox: pathPreset.viewBox }
    applyShapeSettings(pathPreset.settings)
  } else {
    source = { type: 'svg', markup: ICON_PRESETS[iconSelect.value].markup }
    applyShapeSettings(fieldOptions.pathShape ? PATH_SHAPE_SETTINGS : {})
  }
  scheduleRebuild()
}

/** 粘贴的 SVG / 上传的文件：汇聚模式走原站管线，否则建星场 */
function applyRaster(rasterSource) {
  pendingIcon = rasterSource
  if (fieldOptions.rasterStyle === 'converge') {
    ensureGalaxy()
    const polylines = traceIcon(rasterSource)
    showShape(createShapeSamplesFromPolylines(polylines), shapeAspect(polylines))
    return
  }
  clearShape()
  source = rasterSource
  applyShapeSettings(fieldOptions.pathShape ? PATH_SHAPE_SETTINGS : {})
  rebuild()
}
iconSelect.addEventListener('change', applyIcon)

$('applySvg').addEventListener('click', () => {
  const markup = $('svg').value.trim()
  if (!markup) return
  applyRaster({ type: 'svg', markup })
})

$('file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0]
  if (!file) return
  if (file.type.includes('svg')) {
    applyRaster({ type: 'svg', markup: await file.text() })
    return
  }
  const image = new Image()
  image.src = URL.createObjectURL(file)
  await image.decode()
  applyRaster({ type: 'image', image, useLuminance: true })
})

// --- 滑块绑定 ---
/** @param {'field'|'config'} target 决定改动是重建几何还是只推 uniform */
function bindRange(id, target, key, format = (v) => v.toFixed(2)) {
  const input = $(id)
  const readout = $(`v-${id}`)
  const sync = () => {
    const value = Number(input.value)
    if (readout) readout.textContent = format(value)
    if (target === 'field') {
      fieldOptions[key] = value
      scheduleRebuild()
    } else {
      astra?.setConfig({ [key]: value })
    }
  }
  input.addEventListener('input', sync)
  sync()
}

bindRange('starCount', 'field', 'starCount', (v) => v.toLocaleString())
bindRange('fillRatio', 'field', 'fillRatio')
bindRange('backgroundRatio', 'field', 'backgroundRatio')
bindRange('scatter', 'field', 'scatter', (v) => v.toFixed(3))
bindRange('rotationDepth', 'field', 'rotationDepth')
bindRange('strokeSpread', 'field', 'strokeSpread')
$('stroke').addEventListener('change', () => {
  fieldOptions.stroke = $('stroke').value
  if (converged) {
    if (modeSelect.value === 'icon') applyIcon()
    else if (pendingIcon) applyRaster(pendingIcon)
    return
  }
  scheduleRebuild()
})
$('rasterStyle').addEventListener('change', () => {
  fieldOptions.rasterStyle = $('rasterStyle').value
  fieldOptions.pathShape = fieldOptions.rasterStyle === 'paths'
  if (fieldOptions.rasterStyle !== 'converge') clearShape()
  if (modeSelect.value === 'icon') applyIcon()
  else if (pendingIcon) applyRaster(pendingIcon)
})
bindRange('depth', 'field', 'depth', (v) => v.toFixed(3))
bindRange('size', 'field', 'size')
bindRange('sizeFalloff', 'config', 'sizeFalloff')
bindRange('bloomIntensity', 'config', 'bloomIntensity')
bindRange('bloomThreshold', 'config', 'bloomThreshold')
bindRange('intensity', 'config', 'intensity')
bindRange('flowSpeed', 'config', 'flowSpeed')
bindRange('twinkleSpeed', 'config', 'twinkleSpeed')
bindRange('trailLength', 'config', 'trailLength')
bindRange('trailSpeed', 'config', 'trailSpeed')

const flareInput = $('flare')
const flareReadout = $('v-flare')
const syncFlare = () => {
  const value = Number(flareInput.value)
  flareReadout.textContent = value.toFixed(2)
  astra?.setConfig({ lensFlare: { enabled: value > 0, intensity: value } })
}
flareInput.addEventListener('input', syncFlare)
syncFlare()

$('palette').addEventListener('change', (event) => {
  fieldOptions.palette = event.target.value
  scheduleRebuild()
})

$('ambientColor').addEventListener('input', (event) => {
  astra?.setConfig({ ambientColor: event.target.value })
})

for (const [id, key] of [
  ['pointerRepel', 'pointerRepel'],
  ['lensMode', 'lensMode'],
  ['coreSpin', 'coreSpin'],
  ['autoRotate', 'autoRotate'],
]) {
  const input = $(id)
  input.addEventListener('change', () => {
    astra?.setConfig({ [key]: input.checked })
    // 推斥是在建场时挂上 GPGPU 的，开关它需要重建。
    if (key === 'pointerRepel') scheduleRebuild()
  })
}

// --- 动作 ---
$('replay').addEventListener('click', () => astra?.replay())

let dispersed = false
$('disperse').addEventListener('click', () => {
  dispersed = !dispersed
  astra?.setDisperse(dispersed ? 1 : 0)
})

/** 面板展开时把形状往左推，别让侧栏压住图形。 */
function syncCenter() {
  const panel = $('panel')
  const covered = !panel.classList.contains('collapsed') && window.innerWidth > 720
  const shift = covered ? -(panel.offsetWidth + 32) / window.innerWidth : 0
  astra?.setConfig({ center: [shift, 0] })
}

$('toggle').addEventListener('click', () => {
  const panel = $('panel')
  panel.classList.toggle('collapsed')
  $('toggle').textContent = panel.classList.contains('collapsed') ? '＋' : '－'
  syncCenter()
})
window.addEventListener('resize', syncCenter, { passive: true })
syncCenter()

// 字体没加载完就量文字，宽度会是回退字体的，形状会跑偏。
if (document.fonts?.ready) document.fonts.ready.then(() => source.type === 'text' && rebuild())
rebuild()
