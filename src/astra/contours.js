/**
 * Marching squares：从 alpha 蒙版里抠出闭合等值线。
 * 原站是直接手写 SVG 路径喂给 THREE.Curve；我们要支持任意数字和图标，
 * 所以得先把形状变回「一条条可以按弧长参数化的曲线」——
 * orbitProgress 这个一维参数是整套动画（拖尾照亮 / 生长 / 汇聚）的地基。
 */

// 每个 case 连接哪两条边。0=上 1=右 2=下 3=左
const CASE_EDGES = [
  [], [[3, 2]], [[2, 1]], [[3, 1]],
  [[0, 1]], null, [[0, 2]], [[3, 0]],
  [[0, 3]], [[0, 2]], null, [[0, 1]],
  [[1, 3]], [[1, 2]], [[2, 3]], [],
]

function edgePoint(edge, x, y, tl, tr, br, bl, threshold) {
  const t = (a, b) => {
    const d = b - a
    return Math.abs(d) < 1e-9 ? 0.5 : (threshold - a) / d
  }
  switch (edge) {
    case 0: return [x + t(tl, tr), y]
    case 1: return [x + 1, y + t(tr, br)]
    case 2: return [x + t(bl, br), y + 1]
    default: return [x, y + t(tl, bl)]
  }
}

const QUANT = 1000
const key = (p) => `${Math.round(p[0] * QUANT)},${Math.round(p[1] * QUANT)}`

/**
 * @returns {Array<Array<[number, number]>>} 若干条闭合环，坐标是蒙版像素坐标
 */
export function extractContours(mask, width, height, { threshold = 0.5, minPoints = 12 } = {}) {
  const at = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : mask[y * width + x])
  const segments = []

  for (let y = -1; y < height; y += 1) {
    for (let x = -1; x < width; x += 1) {
      const tl = at(x, y)
      const tr = at(x + 1, y)
      const br = at(x + 1, y + 1)
      const bl = at(x, y + 1)
      let code = 0
      if (tl >= threshold) code |= 8
      if (tr >= threshold) code |= 4
      if (br >= threshold) code |= 2
      if (bl >= threshold) code |= 1

      let pairs = CASE_EDGES[code]
      if (pairs === null) {
        // 鞍点：用中心值决定两条线怎么连，避免把相邻笔画错误地缝在一起。
        const center = (tl + tr + br + bl) * 0.25
        if (code === 5) pairs = center >= threshold ? [[3, 0], [1, 2]] : [[0, 1], [2, 3]]
        else pairs = center >= threshold ? [[0, 1], [2, 3]] : [[3, 0], [1, 2]]
      }
      for (const [a, b] of pairs) {
        segments.push([
          edgePoint(a, x, y, tl, tr, br, bl, threshold),
          edgePoint(b, x, y, tl, tr, br, bl, threshold),
        ])
      }
    }
  }

  // 端点共享关系把线段串成环。marching squares 的输出保证每个点最多被两段共用。
  const adjacency = new Map()
  segments.forEach((segment, index) => {
    for (const point of segment) {
      const k = key(point)
      const list = adjacency.get(k)
      if (list) list.push(index)
      else adjacency.set(k, [index])
    }
  })

  const used = new Uint8Array(segments.length)
  const contours = []

  for (let start = 0; start < segments.length; start += 1) {
    if (used[start]) continue
    used[start] = 1
    const points = [segments[start][0], segments[start][1]]
    let cursor = segments[start][1]

    for (;;) {
      const candidates = adjacency.get(key(cursor))
      if (!candidates) break
      let next = -1
      for (const index of candidates) {
        if (!used[index]) {
          next = index
          break
        }
      }
      if (next < 0) break
      used[next] = 1
      const [a, b] = segments[next]
      cursor = key(a) === key(cursor) ? b : a
      points.push(cursor)
    }

    if (points.length >= minPoints) contours.push(points)
  }

  return contours
}

/** Chaikin 切角：把像素级台阶磨成平滑曲线，否则星星会沿锯齿排列。 */
export function smoothClosed(points, iterations = 2) {
  let current = points
  for (let pass = 0; pass < iterations; pass += 1) {
    const next = []
    const n = current.length
    for (let i = 0; i < n; i += 1) {
      const a = current[i]
      const b = current[(i + 1) % n]
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25])
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75])
    }
    current = next
  }
  return current
}

/**
 * 按弧长等距重采样，并返回总周长。
 * 等距是必须的：不然拐角处点会挤成一坨，直线段却空荡荡。
 */
export function resampleClosed(points, spacing) {
  const n = points.length
  const lengths = new Float32Array(n + 1)
  for (let i = 0; i < n; i += 1) {
    const a = points[i]
    const b = points[(i + 1) % n]
    lengths[i + 1] = lengths[i] + Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  const perimeter = lengths[n]
  if (perimeter <= 0) return { points: [], perimeter: 0 }

  const count = Math.max(3, Math.round(perimeter / spacing))
  const resampled = new Array(count)
  let cursor = 0
  for (let i = 0; i < count; i += 1) {
    const target = (i / count) * perimeter
    while (cursor < n - 1 && lengths[cursor + 1] < target) cursor += 1
    const span = lengths[cursor + 1] - lengths[cursor]
    const t = span > 1e-9 ? (target - lengths[cursor]) / span : 0
    const a = points[cursor]
    const b = points[(cursor + 1) % n]
    resampled[i] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  }
  return { points: resampled, perimeter }
}

/** 有向面积：用来判断环的绕向，也用来剔除面积过小的噪声环。 */
export function signedArea(points) {
  let area = 0
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    area += a[0] * b[1] - b[0] * a[1]
  }
  return area * 0.5
}
