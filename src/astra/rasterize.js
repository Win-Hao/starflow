/**
 * 把「任意数字 / 文字 / SVG 图标 / 图片」统一光栅化成一张 alpha 蒙版。
 * 这是整条管线的入口：形状从此以后只是一张 0..1 的灰度图，
 * 后面的轮廓提取和撒点都不再关心它原本是字还是图标。
 */

const MAX_SIDE = 560

function createCanvas(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.ceil(width))
  canvas.height = Math.max(1, Math.ceil(height))
  return canvas
}

/** 取 alpha 通道，顺手把内容包围盒裁出来，避免形状在画面里偏一边。 */
function toMask(canvas, padding) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  const { width, height } = canvas
  const pixels = ctx.getImageData(0, 0, width, height).data

  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (pixels[(y * width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < minX || maxY < minY) return null

  const padX = Math.round((maxX - minX + 1) * padding) + 2
  const padY = Math.round((maxY - minY + 1) * padding) + 2
  const x0 = Math.max(0, minX - padX)
  const y0 = Math.max(0, minY - padY)
  const x1 = Math.min(width - 1, maxX + padX)
  const y1 = Math.min(height - 1, maxY + padY)
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1

  const mask = new Float32Array(w * h)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      mask[y * w + x] = pixels[((y + y0) * width + (x + x0)) * 4 + 3] / 255
    }
  }
  return { mask, width: w, height: h }
}

/** 目标最长边不超过 MAX_SIDE，等值线提取的成本和这个直接挂钩。 */
function fitScale(width, height) {
  return Math.min(1, MAX_SIDE / Math.max(width, height))
}

function rasterizeText(source) {
  const {
    value = '6',
    fontFamily = 'Inter, "Helvetica Neue", Helvetica, Arial, sans-serif',
    fontWeight = 700,
    letterSpacing = 0,
  } = source

  const fontSize = 400
  const probe = createCanvas(16, 16).getContext('2d')
  probe.font = `${fontWeight} ${fontSize}px ${fontFamily}`
  probe.textBaseline = 'alphabetic'

  const text = String(value)
  const metrics = probe.measureText(text)
  const ascent = metrics.actualBoundingBoxAscent || fontSize * 0.8
  const descent = metrics.actualBoundingBoxDescent || fontSize * 0.2
  const spacing = letterSpacing * fontSize
  const textWidth = metrics.width + spacing * Math.max(0, text.length - 1)

  const margin = fontSize * 0.3
  const canvas = createCanvas(textWidth + margin * 2, ascent + descent + margin * 2)
  const ctx = canvas.getContext('2d')
  ctx.font = `${fontWeight} ${fontSize}px ${fontFamily}`
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#fff'
  if (spacing === 0) {
    ctx.fillText(text, margin, margin + ascent)
  } else {
    let cursor = margin
    for (const char of text) {
      ctx.fillText(char, cursor, margin + ascent)
      cursor += ctx.measureText(char).width + spacing
    }
  }
  return canvas
}

/**
 * 解析整段 SVG 源码：读 viewBox，逐条 path 按它自己的 fill / stroke 画。
 * 这样描边类图标（lucide 那种 fill="none"）和实心图标都能直接粘进来用。
 */
function rasterizeSvg(source) {
  const markup = source.markup ?? ''
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml')
  const svg = doc.querySelector('svg')
  if (!svg || doc.querySelector('parsererror')) {
    throw new Error('SVG 解析失败，请检查是否是完整的 <svg> 源码')
  }

  const viewBox = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
  const [vbX, vbY, vbW, vbH] =
    viewBox.length === 4 && viewBox.every(Number.isFinite)
      ? viewBox
      : [0, 0, Number(svg.getAttribute('width')) || 100, Number(svg.getAttribute('height')) || 100]

  const fit = MAX_SIDE / Math.max(vbW, vbH)
  const margin = Math.max(vbW, vbH) * fit * 0.12

  const canvas = createCanvas(vbW * fit + margin * 2, vbH * fit + margin * 2)
  const ctx = canvas.getContext('2d')
  ctx.translate(margin, margin)
  ctx.scale(fit, fit)
  ctx.translate(-vbX, -vbY)
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'

  const svgFill = svg.getAttribute('fill')
  const svgStroke = svg.getAttribute('stroke')
  const svgStrokeWidth = svg.getAttribute('stroke-width')

  const shapes = doc.querySelectorAll('path, circle, rect, ellipse, line, polyline, polygon')
  if (shapes.length === 0) throw new Error('SVG 里没有找到可绘制的图形')

  for (const node of shapes) {
    const path = shapeToPath2D(node)
    if (!path) continue

    const fill = node.getAttribute('fill') ?? svgFill
    const stroke = node.getAttribute('stroke') ?? svgStroke
    const width = Number(node.getAttribute('stroke-width') ?? svgStrokeWidth ?? 1)
    // fill 未声明时 SVG 默认是黑色实心，所以只有显式 none 才算描边图标。
    const hasFill = fill !== 'none' && !(fill == null && stroke && stroke !== 'none')
    const hasStroke = stroke && stroke !== 'none'

    ctx.fillStyle = '#fff'
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = Number.isFinite(width) && width > 0 ? width : 1
    if (hasFill) ctx.fill(path, node.getAttribute('fill-rule') === 'evenodd' ? 'evenodd' : 'nonzero')
    if (hasStroke) ctx.stroke(path)
  }
  return canvas
}

function shapeToPath2D(node) {
  const attr = (name, fallback = 0) => {
    const value = Number(node.getAttribute(name))
    return Number.isFinite(value) ? value : fallback
  }
  switch (node.tagName.toLowerCase()) {
    case 'path': {
      const d = node.getAttribute('d')
      return d ? new Path2D(d) : null
    }
    case 'circle': {
      const path = new Path2D()
      path.arc(attr('cx'), attr('cy'), attr('r'), 0, Math.PI * 2)
      return path
    }
    case 'ellipse': {
      const path = new Path2D()
      path.ellipse(attr('cx'), attr('cy'), attr('rx'), attr('ry'), 0, 0, Math.PI * 2)
      return path
    }
    case 'rect': {
      const path = new Path2D()
      const rx = attr('rx')
      if (rx > 0 && path.roundRect) path.roundRect(attr('x'), attr('y'), attr('width'), attr('height'), rx)
      else path.rect(attr('x'), attr('y'), attr('width'), attr('height'))
      return path
    }
    case 'line': {
      const path = new Path2D()
      path.moveTo(attr('x1'), attr('y1'))
      path.lineTo(attr('x2'), attr('y2'))
      return path
    }
    case 'polyline':
    case 'polygon': {
      const points = (node.getAttribute('points') ?? '').trim().split(/[\s,]+/).map(Number)
      if (points.length < 4) return null
      const path = new Path2D()
      path.moveTo(points[0], points[1])
      for (let i = 2; i + 1 < points.length; i += 2) path.lineTo(points[i], points[i + 1])
      if (node.tagName.toLowerCase() === 'polygon') path.closePath()
      return path
    }
    default:
      return null
  }
}

function rasterizeImage(source) {
  const image = source.image
  if (!image) throw new Error('缺少图片对象')
  const scale = fitScale(image.naturalWidth || image.width, image.naturalHeight || image.height)
  const w = (image.naturalWidth || image.width) * scale
  const h = (image.naturalHeight || image.height) * scale
  const margin = Math.max(w, h) * 0.1
  const canvas = createCanvas(w + margin * 2, h + margin * 2)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, margin, margin, w, h)
  // 深色底的 PNG 常常没有 alpha，用亮度当蒙版更稳。
  if (source.useLuminance) {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const p = data.data
    for (let i = 0; i < p.length; i += 4) {
      p[i + 3] = Math.round(0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2])
    }
    ctx.putImageData(data, 0, 0)
  }
  return canvas
}

/**
 * @param {{type:'text'|'svg'|'image'} & Record<string, any>} source
 * @returns {{mask: Float32Array, width: number, height: number}}
 */
export function rasterize(source, { padding = 0.06 } = {}) {
  let canvas
  if (source.type === 'text') canvas = rasterizeText(source)
  else if (source.type === 'svg') canvas = rasterizeSvg(source)
  else if (source.type === 'image') canvas = rasterizeImage(source)
  else throw new Error(`不支持的 source.type: ${source.type}`)

  const result = toMask(canvas, padding)
  if (!result) throw new Error('光栅化结果是空的（形状没有任何可见像素）')
  return result
}
