import { detectWebGL, renderStaticFallback } from './astra/fallback.js'
import { createAstraScene } from './astra/scene.js'
import { DEFAULT_SHAPE_SETTINGS, ICON_PRESETS, PATH_PRESETS, TEXT_PRESETS, TEXT_SHAPE_SETTINGS } from './presets.js'
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
  size: 2.05,
  palette: 'astra',
}

let source = { type: 'galaxy' }
let rebuildTimer = 0
let lastStats = null

function renderStats() {
  if (!lastStats) return
  const kind = t(source.type === 'galaxy' ? 'lab.kind.galaxy' : source.type === 'paths' ? 'lab.kind.paths' : lastStats.strokes ? 'lab.kind.strokes' : 'lab.kind.contours')
  // 中线模式下星带宽度由笔画宽度决定，只剩散布倍率可调
  const center = source.type !== 'galaxy' && source.type !== 'paths' && !!lastStats.strokes
  for (const block of document.querySelectorAll('[data-stroke-center]')) block.hidden = !center
  for (const block of document.querySelectorAll('[data-stroke-outline]')) block.hidden = center
  $('stats').textContent = t('lab.stats', lastStats.count, lastStats.layers, kind)
}

/**
 * 路径形状（光标 / OpenAI 结）和星系用的是两套参数：星带宽度、暗星尺寸、亮星压暗、
 * 占屏比例、氛围色。切换形状时把对应的值写进滑块，再由滑块的 sync 落到 fieldOptions / config。
 */
function applyShapeSettings(settings) {
  const merged = { ...DEFAULT_SHAPE_SETTINGS, ...settings }
  for (const [id, value] of [['scatter', merged.scatter], ['starCount', merged.starCount], ['flowSpeed', merged.flowSpeed]]) {
    const input = $(id)
    input.value = value
    input.dispatchEvent(new Event('input'))
  }
  fieldOptions.brightRetention = merged.brightRetention
  astra?.setConfig({ dimSizeScale: merged.dimSizeScale, fillX: merged.fillX, fillY: merged.fillY, ambientOpacity: merged.ambient })
}

const shapeOptions = () => ({ ...fieldOptions, depth: source.type === 'galaxy' ? 0 : fieldOptions.depth })

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
  if (modeSelect.value === 'galaxy') {
    source = { type: 'galaxy' }
    applyShapeSettings({})
    scheduleRebuild()
  }
  if (modeSelect.value === 'text') {
    applyShapeSettings(TEXT_SHAPE_SETTINGS)
    applyText()
  }
  if (modeSelect.value === 'icon') applyIcon()
})

function applyText() {
  source = {
    type: 'text',
    value: $('text').value || '6',
    fontWeight: Number($('weight').value),
  }
  scheduleRebuild()
}
$('text').addEventListener('input', applyText)
$('weight').addEventListener('change', applyText)

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
function applyIcon() {
  const pathPreset = PATH_PRESETS[iconSelect.value]
  if (pathPreset) {
    source = { type: 'paths', paths: pathPreset.paths, viewBox: pathPreset.viewBox }
    applyShapeSettings(pathPreset.settings)
  } else {
    source = { type: 'svg', markup: ICON_PRESETS[iconSelect.value].markup }
    applyShapeSettings({})
  }
  scheduleRebuild()
}
iconSelect.addEventListener('change', applyIcon)

$('applySvg').addEventListener('click', () => {
  const markup = $('svg').value.trim()
  if (!markup) return
  source = { type: 'svg', markup }
  rebuild()
})

$('file').addEventListener('change', async (event) => {
  const file = event.target.files?.[0]
  if (!file) return
  if (file.type.includes('svg')) {
    source = { type: 'svg', markup: await file.text() }
    rebuild()
    return
  }
  const image = new Image()
  image.src = URL.createObjectURL(file)
  await image.decode()
  source = { type: 'image', image, useLuminance: true }
  rebuild()
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
  scheduleRebuild()
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
