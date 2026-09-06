/**
 * 星系体数字：把 0–9 写成原站那个「6」的样子。
 *
 * 原站的 6 不是字形，是 5 条手绘的对数螺旋臂绕着一个核心：每条臂都从外圈一路卷到核心附近
 * （半径缩到起点的 1/10 上下），扫过 230–275°，全部逆时针向内流；臂的起点集中在核心的上方和右侧，
 * 半径各不相同，所以看上去是一层套一层的星系，而不是「一个圈 + 几笔」。
 *
 * 6 直接用原站的路径数据，9 是 6 转 180°；其它数字的核心都放原站 6 的三条内臂（缩放 / 镜像），
 * 圈是两条贴着圈走的外臂，笔画是主臂加一条平行伴臂，微微带弧，全部径向或按旋向流向核心。
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

/** 直笔画：作为一条臂，preset 按强弱交替给。 */
const stroke = (points, preset, core = null) => ({ points, core, preset })

/**
 * 原站 6 的三条内臂（第 3、4、5 条：从核心旋出去的那三条），以核心为原点缩放 / 旋转后搬到 (cx, cy)。
 * 顺时针的数字做水平镜像。每个数字的核心都用这三条手绘臂，星系味才和 6 一样。
 */
function originalInner(cx, cy, scale, spin = -1, rotate = 0, sy = 1) {
  const c = Math.cos(rad(rotate))
  const n = Math.sin(rad(rotate))
  return originalSix()
    .filter((arm) => arm.preset >= 2)
    .map((arm) => ({
      ...arm,
      core: [cx, cy],
      points: arm.points.map(([x, y]) => {
        let dx = (x - ORIGINAL_CORE[0]) * scale
        let dy = (y - ORIGINAL_CORE[1]) * scale * sy
        if (spin > 0) dx = -dx
        return [cx + dx * c - dy * n, cy + dx * n + dy * c]
      }),
    }))
}

/**
 * 每个数字：核心（可以多个，第一个是主核心）、旋向、臂。
 * spin：星星向核心流动时在屏幕上的转向，+1 顺时针、-1 逆时针（原站的 6 是逆时针）；
 * 同一个数字里所有弧都按这个旋向卷进核心，直笔画径向流向核心，整体才是一个漩涡。
 * 写法和 6 一致：圈 = 两条贴着圈走的外臂 + 原站的三条内臂；笔画 = 主臂 + 一条平行伴臂，微微带弧。
 */
export const GALAXY_DIGITS = {
  0: {
    cores: [[50, 70]],
    spin: -1,
    arms: () => [
      { points: S(50, 70, 36, 31, 270, -130, 1.62), core: [50, 70], preset: 0 },
      { points: S(50, 70, 39, 35, 60, -260, 1.62), core: [50, 70], preset: 1 },
      ...originalInner(50, 70, 0.6, -1, 0, 1.3),
    ],
  },
  1: {
    cores: [[46, 38]],
    spin: -1,
    arms: () => [
      stroke([[52, 134], [53, 118], [53, 96], [52, 72], [50, 52], [47, 40]], 0),
      stroke([[44, 132], [45, 116], [45, 94], [44, 72], [43, 54]], 1),
      stroke([[10, 62], [20, 52], [32, 44], [44, 39]], 0),
      ...originalInner(46, 38, 0.36, -1, 30),
      stroke([[60, 128], [61, 108], [61, 84], [59, 62]], 1),
    ],
  },
  2: {
    cores: [[50, 44]],
    spin: 1,
    arms: () => [
      { points: S(50, 44, 33, 27, 200, 440), core: [50, 44], preset: 0 },
      { points: S(50, 44, 37, 31, 215, 425), core: [50, 44], preset: 1 },
      ...originalInner(50, 44, 0.42, 1),
      stroke([[74, 66], [64, 82], [48, 100], [30, 116], [16, 127], [22, 131], [48, 131], [90, 130]], 0, [50, 44]),
      stroke([[80, 74], [68, 92], [52, 110], [38, 124]], 1, [50, 44]),
      stroke([[34, 123], [60, 123], [86, 123]], 1, [50, 44]),
    ],
  },
  3: {
    cores: [[52, 92], [50, 40]],
    spin: 1,
    arms: () => [
      // 3 的两个圈都开口向左：外臂只扫到底部，内臂缩小、少一条，左边才留得出空
      { points: S(52, 92, 35, 30, 205, 440), core: [52, 92], preset: 0 },
      { points: S(52, 92, 39, 34, 220, 435), core: [52, 92], preset: 1 },
      ...originalInner(52, 92, 0.34, 1).filter((arm) => arm.preset !== 3),
      { points: S(50, 40, 27, 23, 205, 430), core: [50, 40], preset: 0 },
      { points: S(50, 40, 31, 27, 220, 425), core: [50, 40], preset: 1 },
      ...originalInner(50, 40, 0.26, 1).filter((arm) => arm.preset !== 3),
    ],
  },
  4: {
    cores: [[64, 96]],
    spin: 1,
    arms: () => [
      stroke([[66, 6], [52, 32], [34, 60], [16, 88], [10, 98]], 0),
      stroke([[74, 14], [60, 40], [42, 68], [26, 92]], 1),
      stroke([[6, 99], [30, 99], [60, 99]], 0),
      stroke([[94, 97], [80, 98], [68, 98]], 1),
      stroke([[66, 134], [66, 116], [66, 100]], 0),
      stroke([[66, 24], [66, 58], [66, 94]], 1),
      ...originalInner(64, 96, 0.34, 1),
    ],
  },
  5: {
    cores: [[52, 90]],
    spin: 1,
    arms: () => [
      { points: S(52, 90, 35, 30, 205, 460), core: [52, 90], preset: 0 },
      { points: S(52, 90, 39, 34, 220, 455), core: [52, 90], preset: 1 },
      ...originalInner(52, 90, 0.46, 1),
      stroke([[86, 12], [62, 11], [34, 12], [26, 18], [24, 36], [22, 60]], 0, [52, 90]),
      stroke([[82, 21], [58, 20], [36, 22]], 1, [52, 90]),
      stroke([[32, 26], [31, 44], [30, 62]], 1, [52, 90]),
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
      stroke([[10, 14], [40, 12], [70, 12], [84, 17]], 0),
      stroke([[16, 22], [44, 21], [70, 22]], 1),
      stroke([[34, 132], [38, 114], [50, 88], [64, 60], [78, 34]], 0),
      stroke([[46, 124], [50, 104], [60, 80], [72, 54]], 1),
      ...originalInner(78, 22, 0.3, 1, 150),
    ],
  },
  8: {
    cores: [[50, 96], [50, 42]],
    spin: -1,
    arms: () => [
      { points: S(50, 96, 31, 27, 250, -85), core: [50, 96], preset: 0 },
      { points: S(50, 96, 34, 30, 40, -260), core: [50, 96], preset: 1 },
      ...originalInner(50, 96, 0.44, -1),
      { points: S(50, 42, 25, 21, 250, -85), core: [50, 42], preset: 0 },
      { points: S(50, 42, 28, 24, 40, -260), core: [50, 42], preset: 1 },
      ...originalInner(50, 42, 0.34, -1),
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
