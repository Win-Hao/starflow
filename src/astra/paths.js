import { CubicBezierCurve, Curve, CurvePath, LineCurve, MathUtils, Vector2, Vector3 } from 'three'

/**
 * 原站的形状来源：5 条手绘的开放曲线，viewBox 231×325，拼成一个「螺旋星系状的 6」。
 * 路径数据和分层参数（深度 / 相位 / 流速 / 强弱）都来自抓包的 chunk 861045。
 */
export const GALAXY_PATHS = [
  'M128.472 2.36011C65.4727 24.3601 10.7725 93.1601 9.97246 162.36C8.97246 248.86 79.4138 262.86 87.9725 262.86C116.973 262.86 135.973 244.36 135.973 221.36C135.973 189.86 102.973 193.86 102.973 209.36',
  'M224.973 31.8602C132.473 3.86011 29.9727 75.8601 29.9727 159.86C29.9727 247.86 98.4726 259.86 126.473 247.86',
  'M126.473 215.359C124.639 222.692 117.073 237.159 101.473 236.359C89.1905 235.729 76.0585 219.995 76.4724 195.859C76.4724 165.859 100.473 142.859 132.473 142.859C171.973 142.859 213.473 171.36 213.473 231.36C213.473 276.36 170.473 328.36 85.9727 316.86',
  'M106.973 237.36C81.9727 240.36 61.4727 222.86 61.4727 184.86C61.4727 153.36 91.9727 123.36 132.473 123.36C172.973 123.36 227.973 149.86 227.973 225.36C227.973 287.36 168.473 322.36 121.473 322.36C53.4727 322.36 10.9727 264.86 2.47266 208.36',
  'M114.973 211.36C114.973 225.86 92.4727 226.86 92.4727 205.36C92.4727 183.86 109.938 175.36 127.973 175.36C146.008 175.36 174.473 195.86 174.473 230.86C174.473 264.36 148.473 281.86 133.973 287.36C119.473 292.86 81.6727 296.56 54.4727 269.36',
]

/**
 * 每条曲线的分层参数（原站同款）。
 * depth：Z 向起伏幅度；phase：初始相位；speed：沿曲线的流速（每秒走过的弧长比例）；
 * strong：强层拿更多星、更高的亮星比例和更大的主星。
 */
export const GALAXY_LAYERS = [
  { depth: 0.62, phase: 0.16, speed: 0.025, strong: true },
  { depth: -0.46, phase: 0.72, speed: -0.018, strong: false },
  { depth: 0.78, phase: 0.38, speed: 0.021, strong: true },
  { depth: -0.7, phase: 0.58, speed: -0.016, strong: false },
  { depth: 0.42, phase: 0.08, speed: 0.03, strong: true },
]

/** 原站世界坐标：以最内圈螺旋的起点（星系核）为原点，整幅高 9.7 单位。 */
export const GALAXY_CENTER = [114.973, 211.36]
export const GALAXY_HEIGHT = 9.7
const GALAXY_UNIT = GALAXY_HEIGHT / 325

/** 只处理绝对命令 M / L / H / V / C / Z，原站的几组路径只用到这些。 */
export function parseSvgPath(d) {
  const path = new CurvePath()
  let cursor = new Vector2()
  let start = new Vector2()
  // 零长度的线段会让 CurvePath 的弧长映射除以零，跳过
  const lineTo = (end) => {
    if (cursor.distanceToSquared(end) > 1e-9) path.add(new LineCurve(cursor.clone(), end.clone()))
    cursor = end.clone()
  }
  for (const token of d.match(/[A-Za-z][^A-Za-z]*/g) ?? []) {
    const command = token[0]
    const values = (token.slice(1).match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number)
    switch (command) {
      case 'M':
        cursor = new Vector2(values[0], values[1])
        start = cursor.clone()
        for (let i = 2; i + 1 < values.length; i += 2) lineTo(new Vector2(values[i], values[i + 1]))
        break
      case 'L':
        for (let i = 0; i + 1 < values.length; i += 2) lineTo(new Vector2(values[i], values[i + 1]))
        break
      case 'H':
        for (const x of values) lineTo(new Vector2(x, cursor.y))
        break
      case 'V':
        for (const y of values) lineTo(new Vector2(cursor.x, y))
        break
      case 'C':
        for (let i = 0; i + 5 < values.length; i += 6) {
          const end = new Vector2(values[i + 4], values[i + 5])
          path.add(
            new CubicBezierCurve(
              cursor.clone(),
              new Vector2(values[i], values[i + 1]),
              new Vector2(values[i + 2], values[i + 3]),
              end,
            ),
          )
          cursor = end
        }
        break
      case 'Z':
      case 'z':
        lineTo(start)
        break
      default:
        break
    }
  }
  return path
}

/**
 * 原站的曲线包装：把 SVG 坐标换到世界坐标，并给曲线加上 Z 向起伏。
 * 起伏用 sin(πt) 做包络，两端归零——旋转时星臂有体积，但端点不会翘起来。
 */
export class PathCurve extends Curve {
  constructor(source, { center, unit, depth = 0, rotationDepth = 1, depthPhase = 0 }) {
    super()
    this.source = source
    this.center = center
    this.unit = unit
    this.depth = depth
    this.rotationDepth = rotationDepth
    this.depthPhase = depthPhase
    this.arcLengthDivisions = 640
  }

  getPoint(t, target = new Vector3()) {
    const r = MathUtils.clamp(t, 0, 1)
    const point = this.source.getPointAt(r)
    const envelope = Math.sin(r * Math.PI)
    const z = Math.sin(r * Math.PI * 1.35 + this.depthPhase) * this.depth * this.rotationDepth * envelope
    return target.set((point.x - this.center[0]) * this.unit, (this.center[1] - point.y) * this.unit, z)
  }
}

/** 星系星臂：原站的坐标换算（原点在星系核，整幅高 9.7）。 */
export class GalaxyArm extends PathCurve {
  constructor(source, depth, rotationDepth, depthPhase) {
    super(source, { center: GALAXY_CENTER, unit: GALAXY_UNIT, depth, rotationDepth, depthPhase })
  }
}

/**
 * 等距折线曲线：给「文字 / SVG 轮廓」这类由 marching squares 抠出来的环用。
 * 点已经按弧长等距重采样过，所以 t 直接线性映射到下标就是弧长参数化，
 * 不需要 three 默认的 200 段近似。
 */
export class PolylineCurve extends Curve {
  constructor(points, { closed = true, depth = 0, rotationDepth = 1, depthPhase = 0 } = {}) {
    super()
    this.points = points
    this.closed = closed
    this.depth = depth
    this.rotationDepth = rotationDepth
    this.depthPhase = depthPhase
  }

  getPoint(t, target = new Vector3()) {
    const points = this.points
    const n = points.length
    let f
    let i0
    let i1
    if (this.closed) {
      f = MathUtils.euclideanModulo(t, 1) * n
      i0 = Math.floor(f) % n
      i1 = (i0 + 1) % n
    } else {
      f = MathUtils.clamp(t, 0, 1) * (n - 1)
      i0 = Math.min(Math.floor(f), n - 1)
      i1 = Math.min(i0 + 1, n - 1)
    }
    const blend = f - Math.floor(f)
    const a = points[i0]
    const b = points[i1]
    const r = MathUtils.clamp(t, 0, 1)
    const envelope = Math.sin(r * Math.PI)
    const z = Math.sin(r * Math.PI * 1.35 + this.depthPhase) * this.depth * this.rotationDepth * envelope
    return target.set(a[0] + (b[0] - a[0]) * blend, a[1] + (b[1] - a[1]) * blend, z)
  }

  getPointAt(u, target) {
    return this.getPoint(u, target)
  }

  getTangentAt(u, target) {
    return this.getTangent(u, target)
  }
}

/**
 * 构建原站的 5 条星臂。
 * @param {number} rotationDepth 原站默认 1.4，越大旋转时星臂的前后层次越明显
 */
export function createGalaxyLayers(rotationDepth = 1.4) {
  const clampedDepth = MathUtils.clamp(rotationDepth, 0, 2)
  return GALAXY_PATHS.map((d, index) => {
    const layer = GALAXY_LAYERS[index]
    return {
      curve: new GalaxyArm(parseSvgPath(d), layer.depth, clampedDepth, 0.82 * index),
      closed: false,
      depth: layer.depth,
      strong: layer.strong,
      speed: layer.speed,
      phase: layer.phase,
      // 原站按「强 220 / 弱 170」分配星数，与弧长无关
      weight: layer.strong ? 220 : 170,
    }
  })
}

/**
 * 任意一组 SVG 路径 → 路径层（原站滚动中段的「路径形状」：光标、OpenAI 结）。
 * 每条子路径都当作开放曲线：两端渐隐、中段最宽，和原站 samplePathShapeRange 的分段一致；
 * 闭合的光标也是如此，所以它的起点（箭头尖）会有一处收细。
 * 星数按弧长分配，深度 / 相位 / 流速沿用星系的五档轮换。
 */
export function createPathLayers(paths, viewBox = [0, 0, 100, 100], rotationDepth = 1.4) {
  const [vx, vy, vw, vh] = viewBox
  const unit = GALAXY_HEIGHT / Math.max(vh, 1e-6)
  const center = [vx + vw / 2, vy + vh / 2]
  const clampedDepth = MathUtils.clamp(rotationDepth, 0, 2)
  return paths.map((d, index) => {
    const preset = GALAXY_LAYERS[index % GALAXY_LAYERS.length]
    const curve = new PathCurve(parseSvgPath(d), {
      center,
      unit,
      depth: preset.depth,
      rotationDepth: clampedDepth,
      depthPhase: 0.82 * index,
    })
    return {
      curve,
      closed: false,
      depth: preset.depth,
      strong: preset.strong,
      speed: preset.speed,
      phase: preset.phase,
      weight: curve.getLength(),
    }
  })
}

/**
 * 原站 F()：决定流动方向。flowInward 时让星星朝离原点更近的那一端走，
 * 于是每条星臂都是「往星系核汇入」的观感。
 */
export function flowDirection(curve, speed, inward) {
  const startDistance = curve.getPointAt(0).lengthSq()
  const endCloser = curve.getPointAt(1).lengthSq() < startDistance
  return Math.abs(speed) * ((inward ? endCloser : !endCloser) ? 1 : -1)
}

/**
 * 原站的形状贴图：把一组 SVG 路径按总长等距采样 1024 个点。
 * 每个点存 (x, y, 所在子路径的范围起点, 范围终点)，xy 相对 viewBox 归一到 [-0.5, 0.5]、y 朝上。
 * 范围按弧长占比划分——星星的种子落在哪个范围，就去哪条子路径。
 */
export const SHAPE_SAMPLE_COUNT = 1024

export function createShapeSamples(paths, viewBox = [0, 0, 100, 100]) {
  const [vx, vy, vw, vh] = viewBox
  const curves = paths.map((d) => parseSvgPath(d)).map((curve) => ({ curve, length: curve.getLength() }))
  const total = curves.reduce((sum, entry) => sum + entry.length, 0)
  const samples = new Float32Array(SHAPE_SAMPLE_COUNT * 4)
  if (total <= 0) return samples
  let cursor = 0
  let consumed = 0
  for (let i = 0; i < SHAPE_SAMPLE_COUNT; i += 1) {
    const distance = ((i + 0.5) / SHAPE_SAMPLE_COUNT) * total
    while (cursor < curves.length - 1 && distance > consumed + curves[cursor].length) {
      consumed += curves[cursor].length
      cursor += 1
    }
    const { curve, length } = curves[cursor]
    const point = curve.getPointAt(MathUtils.clamp((distance - consumed) / Math.max(length, 1e-9), 0, 1))
    samples[i * 4] = (point.x - vx) / vw - 0.5
    samples[i * 4 + 1] = 0.5 - (point.y - vy) / vh
    samples[i * 4 + 2] = consumed / total
    samples[i * 4 + 3] = (consumed + length) / total
  }
  return samples
}
