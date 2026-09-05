import { Color, MathUtils } from 'three'
import { densityProgress, generateStarField, sizeFalloff, tipFade } from './field.js'
import { makeRandom } from './random.js'

/**
 * 没有 WebGL 时的静态回退。
 * 用 Canvas 2D 把同一份星场数据画成星点 + 径向光晕，构图和配色与 WebGL 版完全一致，
 * 只是没有 bloom、没有交互。原站的降级思路一样：宁可静止，也不要空白。
 */
export function renderStaticFallback(canvas, source, options = {}) {
  const { fillX = 0.8, fillY = 0.89, sizeFalloff: sizeFalloffAmount = 0.45, dimSizeScale = 1, ...fieldOptions } = options

  const ctx = canvas.getContext('2d')
  if (!ctx) return false

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const rect = canvas.getBoundingClientRect()
  const width = Math.max(1, Math.floor(rect.width))
  const height = Math.max(1, Math.floor(rect.height))
  canvas.width = Math.floor(width * dpr)
  canvas.height = Math.floor(height * dpr)
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)

  const data = generateStarField(source, fieldOptions)
  const { positions, colors, scales, brightness, opacity, flags, orbitProgress, path } = data.arrays
  const scale = Math.min((width * fillX) / data.size[0], (height * fillY) / data.size[1])
  const originX = width / 2 - data.origin[0] * scale
  const originY = height / 2 + data.origin[1] * scale
  const random = makeRandom(0x5eed)
  const color = new Color()

  ctx.globalCompositeOperation = 'lighter'
  for (let i = 0; i < data.count; i += 1) {
    const isBackground = flags[i * 4 + 2] > 0.5
    let x
    let y
    if (isBackground) {
      x = random() * width
      y = random() * height
    } else {
      x = originX + positions[i * 3] * scale
      y = originY - positions[i * 3 + 1] * scale
    }

    // 开放曲线：端点渐隐 + 尺寸衰减，和着色器里同一套包络。
    let envelope = 1
    let visibility = 1
    if (path[i * 3 + 2] > 0.5) {
      const progress = densityProgress(orbitProgress[i], data.options.densityFalloff)
      visibility = tipFade(progress)
      envelope = sizeFalloff(progress, sizeFalloffAmount)
    }
    if (visibility <= 0.01) continue

    const brightWeight = MathUtils.smoothstep(brightness[i], 1.35, 1.65)
    const diameter = (0.35 + scales[i] * envelope * visibility * 3.8)
      * (isBackground ? 0.45 : 1)
      * MathUtils.lerp(dimSizeScale, 1, brightWeight)
    const radius = Math.max(diameter / 2, 0.35)
    const alpha = MathUtils.clamp(opacity[i] * visibility * Math.min(1, brightness[i] / 1.6), 0, 1)
    // 属性里存的是线性色，画布要 sRGB。
    color.setRGB(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2])
    const style = color.getStyle()

    if (brightness[i] > 1.45 && !isBackground) {
      const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 6)
      glow.addColorStop(0, style.replace('rgb(', 'rgba(').replace(')', ',0.7)'))
      glow.addColorStop(1, style.replace('rgb(', 'rgba(').replace(')', ',0)'))
      ctx.globalAlpha = alpha
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(x, y, radius * 6, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = alpha
    ctx.fillStyle = style
    ctx.beginPath()
    ctx.arc(x, y, radius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
  ctx.globalCompositeOperation = 'source-over'
  return true
}

/** 便宜的能力检测，避免为了探测而真的去建一个完整渲染器。 */
export function detectWebGL() {
  try {
    const probe = document.createElement('canvas')
    return Boolean(probe.getContext('webgl2') || probe.getContext('webgl'))
  } catch {
    return false
  }
}

export function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}
