/**
 * 星系体数字：把 0–9 写成原站那个「6」的样子。
 *
 * 原站的 6 不是字形，是 5 条手绘的对数螺旋臂绕着一个核心：每条臂都从外圈一路卷到核心附近
 * （半径缩到起点的 1/10 上下），扫过 230–275°，全部逆时针向内流；臂的起点集中在核心的上方和右侧，
 * 半径各不相同，所以看上去是一层套一层的星系，而不是「一个圈 + 几笔」。
 *
 * 这里把这套臂谱（半径比例、起始角、扫角）抽成 GRAMMAR，其它数字的圈都用它生成；
 * 6 直接用原站的路径数据，9 是 6 转 180°；直笔画（1 4 7 的竖、2 的斜、5 的横）作为径向流向核心的臂。
 *
 * 坐标：每个数字一个 100 × 140 的格子，y 向下；角度 0 = 右、90 = 下（屏幕上顺时针递增）。
 */
import { GALAXY_CENTER, GALAXY_HEIGHT, GALAXY_LAYERS, GALAXY_PATHS, PolylineCurve, parseSvgPath } from './paths.js'

const DIGIT_ADVANCE = 100
const DIGIT_HEIGHT = 140

const rad = (deg) => (deg * Math.PI) / 180

/** 对数螺旋弧：半径从 r0 指数过渡到 r1，角度从 a0 扫到 a1；ry 把圆压成椭圆。 */
function S(cx, cy, r0, r1, a0, a1, ry = 1) {
  const n = Math.max(4, Math.ceil(Math.abs(a1 - a0) / 5))
  const points = []
  for (let i = 0; i <= n; i += 1) {
    const t = i / n
    const r = r0 * (r1 / r0) ** t
    const a = rad(a0 + (a1 - a0) * t)
    points.push([cx + r * Math.cos(a), cy + r * ry * Math.sin(a)])
  }
  return points
}

/** Chaikin 细分：把折线的拐角磨圆，端点不动。 */
function chaikin(points, iterations) {
  let current = points
  for (let it = 0; it < iterations; it += 1) {
    const next = [current[0]]
    for (let i = 0; i < current.length - 1; i += 1) {
      const a = current[i]
      const b = current[i + 1]
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25])
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75])
    }
    next.push(current[current.length - 1])
    current = next
  }
  return current
}

function resample(points, spacing) {
  const n = points.length
  const lengths = new Float32Array(n)
  for (let i = 1; i < n; i += 1) lengths[i] = lengths[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  const total = lengths[n - 1]
  const count = Math.max(2, Math.round(total / spacing) + 1)
  const out = new Array(count)
  let cursor = 0
  for (let i = 0; i < count; i += 1) {
    const target = (i / (count - 1)) * total
    while (cursor < n - 2 && lengths[cursor + 1] < target) cursor += 1
    const span = lengths[cursor + 1] - lengths[cursor]
    const t = span > 1e-9 ? (target - lengths[cursor]) / span : 0
    out[i] = [points[cursor][0] + (points[cursor + 1][0] - points[cursor][0]) * t, points[cursor][1] + (points[cursor + 1][1] - points[cursor][1]) * t]
  }
  return { points: out, length: total }
}

// ── 原站的 6：5 条臂从 231 × 325 的 viewBox 换到 100 × 140 的格子 ──
const ORIGINAL_SCALE = DIGIT_HEIGHT / 325
const ORIGINAL_OFFSET_X = (DIGIT_ADVANCE - 231 * ORIGINAL_SCALE) / 2
const ORIGINAL_CORE = [GALAXY_CENTER[0] * ORIGINAL_SCALE + ORIGINAL_OFFSET_X, GALAXY_CENTER[1] * ORIGINAL_SCALE]

function originalSix() {
  return GALAXY_PATHS.map((d, index) => {
    const curve = parseSvgPath(d)
    const points = []
    for (let i = 0; i <= 160; i += 1) {
      const p = curve.getPointAt(i / 160)
      points.push([p.x * ORIGINAL_SCALE + ORIGINAL_OFFSET_X, p.y * ORIGINAL_SCALE])
    }
    return { points, core: ORIGINAL_CORE, preset: index, raw: true }
  })
}

const flip = ([x, y]) => [DIGIT_ADVANCE - x, DIGIT_HEIGHT - y]

/**
 * 原站 6 的臂谱：半径相对最外圈（原站 210px）、向内流动方向上的起始角（核心为原点，y 向下）、扫角。
 * 五条臂逆时针向内，起点都在核心的上方 / 右侧，半径从 1.0 一直缩到 0.01。
 */
const GRAMMAR = [
  { r0: 1.0, r1: 0.11, start: -86, sweep: 250 },
  { r0: 1.0, r1: 0.19, start: -58, sweep: 230 },
  { r0: 0.33, r1: 0.06, start: -76, sweep: 265 },
  { r0: 0.55, r1: 0.13, start: 7, sweep: 260 },
  { r0: 0.3, r1: 0.012, start: 19, sweep: 275 },
]

/**
 * 按臂谱生成一个星系。spin −1 = 逆时针（原站），+1 = 顺时针（起始角做水平镜像）；
 * rotate 整体转向，ry 压椭圆，pick 选用哪几条臂，sweeps 按臂号覆盖扫角（圈要闭合时用），
 * radii 按臂号覆盖 [起始半径, 终止半径] 比例：数字的圈要读得出来，外面两条臂得贴着圈走、不能一头扎进核心。
 */
function galaxy(cx, cy, R, { spin = -1, rotate = 0, ry = 1, pick = [0, 1, 2, 3, 4], sweeps = [], radii = [] } = {}) {
  return pick.map((index) => {
    const arm = GRAMMAR[index]
    const start = (spin < 0 ? arm.start : 180 - arm.start) + rotate
    const sweep = sweeps[index] ?? arm.sweep
    const [r0, r1] = radii[index] ?? [arm.r0, arm.r1]
    return { points: S(cx, cy, R * r0, Math.max(R * r1, 0.6), start, start + spin * sweep, ry), core: [cx, cy], preset: index }
  })
}

/** 直笔画：作为一条臂，preset 按强弱交替给。 */
const stroke = (points, preset, core = null) => ({ points, core, preset })

/**
 * 每个数字：核心（可以多个，第一个是主核心）、旋向、臂。
 * spin：星星向核心流动时在屏幕上的转向，+1 顺时针、-1 逆时针（原站的 6 是逆时针）；
 * 同一个数字里所有弧都按这个旋向卷进核心，直笔画径向流向核心，整体才是一个漩涡。
 */
export const GALAXY_DIGITS = {
  0: {
    cores: [[50, 70]],
    spin: -1,
    arms: () => galaxy(50, 70, 36, { ry: 1.62, sweeps: [400, 340, 300, 320, 290], radii: [[1.0, 0.74], [1.06, 0.82], [0.55, 0.06], [0.75, 0.13]] }),
  },
  1: {
    cores: [[46, 38]],
    spin: -1,
    arms: () => [
      stroke([[50, 134], [51, 118], [52, 90], [52, 62], [50, 46], [47, 39]], 0),
      stroke([[12, 60], [22, 50], [33, 43], [45, 39]], 1),
      ...galaxy(46, 38, 32, { pick: [2, 3, 4], rotate: 20 }),
      stroke([[58, 128], [59, 104], [59, 76], [57, 56]], 1),
    ],
  },
  2: {
    cores: [[50, 42]],
    spin: 1,
    arms: () => [
      ...galaxy(50, 42, 32, { spin: 1, radii: [[1.0, 0.5], [1.06, 0.58]] }),
      stroke([[73, 64], [60, 84], [40, 105], [18, 124], [15, 129], [30, 130], [60, 130], [90, 129]], 0, [50, 42]),
      stroke([[84, 122], [58, 121], [34, 122]], 1, [50, 42]),
    ],
  },
  3: {
    cores: [[52, 92], [50, 40]],
    spin: 1,
    arms: () => [
      ...galaxy(52, 92, 34, { spin: 1, rotate: -66, radii: [[1.0, 0.5], [1.06, 0.58]] }),
      ...galaxy(50, 40, 27, { spin: 1, rotate: -66, pick: [0, 2, 4], radii: [[1.0, 0.5]] }),
    ],
  },
  4: {
    cores: [[64, 96]],
    spin: 1,
    arms: () => [
      stroke([[66, 6], [50, 34], [30, 64], [12, 92], [10, 97]], 0),
      stroke([[8, 98], [30, 98], [62, 98]], 1),
      ...galaxy(64, 96, 30, { spin: 1, pick: [2, 3, 4] }),
      stroke([[66, 134], [66, 116], [66, 99]], 1),
      stroke([[94, 96], [82, 97], [66, 97]], 0),
      stroke([[66, 26], [66, 60], [66, 94]], 1),
    ],
  },
  5: {
    cores: [[52, 90]],
    spin: 1,
    arms: () => [
      ...galaxy(52, 90, 34, { spin: 1, rotate: -60, radii: [[1.0, 0.5], [1.06, 0.58]] }),
      stroke([[86, 12], [60, 12], [30, 13], [24, 18]], 0, [52, 90]),
      stroke([[24, 20], [23, 40], [22, 62]], 1, [52, 90]),
      stroke([[80, 21], [56, 21], [34, 22]], 1, [52, 90]),
    ],
  },
  6: {
    cores: [ORIGINAL_CORE],
    spin: -1,
    arms: () => originalSix(),
  },
  7: {
    cores: [[78, 22]],
    spin: 1,
    arms: () => [
      stroke([[10, 14], [40, 13], [70, 13], [84, 17]], 0),
      stroke([[34, 132], [40, 116], [52, 90], [66, 60], [80, 32]], 0),
      ...galaxy(78, 22, 28, { spin: 1, pick: [2, 3, 4], rotate: 140 }),
      stroke([[46, 100], [58, 72], [70, 46]], 1),
      stroke([[18, 22], [44, 21], [66, 22]], 1),
    ],
  },
  8: {
    cores: [[50, 96], [50, 42]],
    spin: -1,
    arms: () => [
      ...galaxy(50, 96, 31, { sweeps: [335, 300, 265, 285, 275], radii: [[1.0, 0.72], [1.06, 0.8]] }),
      ...galaxy(50, 42, 25, { pick: [0, 1, 2, 4], sweeps: [335, 300, 265, 285, 275], radii: [[1.0, 0.72], [1.06, 0.8]] }),
    ],
  },
  9: {
    cores: [flip(ORIGINAL_CORE)],
    spin: -1,
    arms: () => originalSix().map((arm) => ({ ...arm, points: arm.points.map(flip), core: flip(ORIGINAL_CORE) })),
  },
}

export const GALAXY_DIGIT_CHARS = Object.keys(GALAXY_DIGITS)

/**
 * 臂的流向：绕核心转过的角度够大就按数字的旋向走（+1 = 起点到终点），
 * 近乎径向的直笔画则朝核心流。这样每条臂都在同一个漩涡里。
 */
function flowSignFor(points, core, spin) {
  let sweep = 0
  let previous = Math.atan2(points[0][1] - core[1], points[0][0] - core[0])
  for (let i = 1; i < points.length; i += 1) {
    const angle = Math.atan2(points[i][1] - core[1], points[i][0] - core[0])
    let delta = angle - previous
    if (delta > Math.PI) delta -= Math.PI * 2
    if (delta < -Math.PI) delta += Math.PI * 2
    sweep += delta
    previous = angle
  }
  if (Math.abs(sweep) >= rad(40)) return Math.sign(sweep) === spin ? 1 : -1
  const first = points[0]
  const last = points[points.length - 1]
  const inward = Math.hypot(last[0] - core[0], last[1] - core[1]) < Math.hypot(first[0] - core[0], first[1] - core[1])
  return inward ? 1 : -1
}

/**
 * 把一串数字排成星系体：每位一个格子横向排开，整串居中在原点，y 向上；
 * 返回星臂层（和星系臂同一套 depth / phase / 流速档位）和每个核心的位置（世界单位）。
 */
export function createGalaxyTextLayers(value, rotationDepth = 1.4) {
  const chars = Array.from(String(value ?? '')).filter((c) => GALAXY_DIGITS[c])
  if (chars.length === 0) throw new Error('星系体目前只支持数字 0–9')
  const totalWidth = chars.length * DIGIT_ADVANCE
  const unit = GALAXY_HEIGHT / DIGIT_HEIGHT
  const toWorld = (x, y, offset) => [(x + offset - totalWidth / 2) * unit, (DIGIT_HEIGHT / 2 - y) * unit]

  const layers = []
  const cores = []
  chars.forEach((char, digitIndex) => {
    const digit = GALAXY_DIGITS[char]
    const offset = digitIndex * DIGIT_ADVANCE
    const firstLayer = layers.length
    for (const core of digit.cores) cores.push({ position: toWorld(core[0], core[1], offset), layer: firstLayer })
    digit.arms().forEach((arm, armIndex) => {
      const gridCore = arm.core ?? digit.cores[0]
      const preset = GALAXY_LAYERS[(arm.preset ?? armIndex) % GALAXY_LAYERS.length]
      // 原站的路径已经是平滑曲线，不再磨角
      const { points, length } = resample(arm.raw ? arm.points : chaikin(arm.points, 3), 2)
      const world = points.map(([x, y]) => toWorld(x, y, offset))
      layers.push({
        curve: new PolylineCurve(world, { closed: false, depth: preset.depth, rotationDepth, depthPhase: 0.82 * armIndex }),
        closed: false,
        depth: preset.depth,
        strong: preset.strong,
        speed: preset.speed,
        phase: preset.phase,
        weight: length * unit * (preset.strong ? 1 : 0.77),
        flowCenter: toWorld(gridCore[0], gridCore[1], offset),
        flowSign: flowSignFor(points, gridCore, digit.spin),
      })
    })
  })
  return { layers, cores }
}
