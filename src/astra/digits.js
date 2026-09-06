/**
 * 星系体数字：把 0–9 写成原站那个「6」的样子。
 *
 * 原站的 6 不是字形，是 5 条手绘的开放螺旋臂：一条主臂（钩 + 竖笔 + 卷进圈里的一段）、
 * 一条贴着主臂走的伴臂、圈本身作为绕核心的一圈、再加两条从核心旋出来的内臂，核心放在圈心。
 * 这里每个数字都按同一套写法手排：主臂走字形笔画，伴臂平行短跑，有圈的数字核心放圈心、
 * 内臂往圈心旋进，没圈的数字（1 4 7）核心放在交叉 / 转折处。
 *
 * 坐标：每个数字一个 100 × 140 的格子，y 向下；角度 0 = 右、90 = 下（屏幕上顺时针递增）。
 */
import { GALAXY_HEIGHT, GALAXY_LAYERS, PolylineCurve } from './paths.js'

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

/** 把几段折线接成一条，去掉接缝处的重复点。 */
function J(...segments) {
  const out = []
  for (const segment of segments) {
    for (const p of segment) {
      const last = out[out.length - 1]
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.5) out.push(p)
    }
  }
  return out
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

/**
 * 每个数字：核心位置、旋向、几条臂。
 * spin：星星向核心流动时在屏幕上的转向，+1 顺时针、-1 逆时针（原站的 6 是逆时针）。
 * 同一个数字里所有弧都按这个旋向卷进核心，直笔画径向流向核心，整体才是一个漩涡而不是几股乱流。
 * 臂的顺序对应原站分层：强、弱、强、弱、强……
 */
export const GALAXY_DIGITS = {
  0: {
    core: [50, 70],
    spin: -1,
    arms: () => [
      S(50, 70, 34, 30, 270, -130, 1.6),
      S(50, 70, 38, 36, 120, -80, 1.6),
      S(50, 70, 24, 7, 200, -100, 1.5),
      S(50, 70, 18, 5, 20, -260, 1.4),
      S(50, 70, 37, 34, 330, 170, 1.6),
    ],
  },
  1: {
    core: [46, 36],
    spin: -1,
    arms: () => [
      [[50, 132], [51, 120], [52, 90], [52, 60], [50, 44], [47, 37]],
      [[14, 58], [24, 48], [34, 41], [45, 37]],
      S(46, 36, 14, 5, 300, -20),
      S(46, 36, 10, 3, 120, -180),
      [[58, 126], [59, 100], [59, 72], [57, 52]],
    ],
  },
  2: {
    core: [50, 42],
    spin: 1,
    arms: () => [
      S(50, 42, 34, 26, 200, 520),
      [[68, 67], [56, 86], [38, 106], [18, 124], [16, 128], [30, 129], [60, 129], [88, 128]],
      S(50, 42, 18, 6, 100, 400),
      S(50, 42, 13, 4, 280, 560),
      S(50, 42, 25, 22, 230, 430),
      [[82, 121], [56, 120], [32, 121]],
    ],
  },
  3: {
    core: [52, 92],
    spin: 1,
    arms: () => [
      J(S(50, 40, 30, 30, 195, 420), [[60, 64]], S(52, 92, 34, 33, 285, 535)),
      S(50, 40, 36, 34, 205, 355),
      S(52, 92, 24, 7, 300, 600),
      S(52, 92, 17, 4, 120, 400),
      S(52, 92, 39, 37, 300, 480),
    ],
  },
  4: {
    core: [64, 96],
    spin: 1,
    arms: () => [
      [[66, 8], [50, 34], [30, 64], [12, 92], [10, 96]],
      [[10, 96], [30, 97], [62, 97]],
      S(64, 96, 20, 6, 200, 510),
      S(64, 96, 14, 4, 30, 310),
      [[66, 132], [66, 116], [66, 98]],
      [[92, 96], [80, 97], [66, 97]],
      [[66, 26], [66, 60], [66, 94]],
    ],
  },
  5: {
    core: [52, 90],
    spin: 1,
    arms: () => [
      J([[84, 12], [60, 12], [28, 13], [24, 20], [23, 44], [22, 60], [21, 68]], S(52, 90, 35, 33, 205, 515)),
      [[78, 21], [56, 21], [34, 22]],
      S(52, 90, 24, 7, 60, 360),
      S(52, 90, 17, 4, 250, 530),
      S(52, 90, 40, 38, 300, 470),
    ],
  },
  6: {
    core: [54, 92],
    spin: -1,
    arms: () => [
      J([[80, 10], [62, 16], [44, 30], [30, 50], [22, 72], [19, 90]], S(54, 92, 36, 31, 180, -150, 0.95)),
      [[72, 22], [56, 30], [40, 46], [30, 66], [26, 84]],
      S(54, 92, 26, 9, 250, -50),
      S(54, 92, 20, 5, 60, -220),
      S(54, 92, 40, 38, 90, -110),
    ],
  },
  7: {
    core: [78, 22],
    spin: 1,
    arms: () => [
      [[12, 14], [40, 13], [70, 13], [84, 16]],
      [[36, 130], [40, 116], [52, 90], [66, 60], [80, 32]],
      S(78, 22, 18, 6, 150, 470),
      S(78, 22, 12, 4, 330, 610),
      [[46, 98], [58, 70], [70, 44]],
      [[20, 22], [44, 21], [66, 22]],
    ],
  },
  8: {
    core: [50, 96],
    spin: 1,
    arms: () => [
      S(50, 96, 33, 30, 250, 590),
      S(50, 42, 28, 24, -60, 260),
      S(50, 96, 23, 7, 300, 600),
      S(50, 96, 16, 4, 100, 380),
      S(50, 42, 32, 30, -20, 160),
      S(50, 42, 18, 6, 200, 480),
    ],
  },
  9: {
    core: [50, 48],
    spin: -1,
    arms: () => [
      S(50, 48, 36, 30, 30, -310),
      [[24, 132], [52, 126], [70, 108], [80, 86], [82, 66]],
      S(50, 48, 24, 7, -60, -360),
      S(50, 48, 17, 4, 120, -160),
      S(50, 48, 40, 38, -30, -210),
      [[50, 118], [64, 100], [72, 80]],
    ],
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
 * 返回星臂层（和星系臂同一套 depth / phase / 流速档位）和每一位的核心位置（世界单位）。
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
    const core = toWorld(digit.core[0], digit.core[1], offset)
    cores.push({ position: core, layer: layers.length })
    digit.arms().forEach((arm, armIndex) => {
      const preset = GALAXY_LAYERS[armIndex % GALAXY_LAYERS.length]
      const { points, length } = resample(chaikin(arm, 3), 2)
      const world = points.map(([x, y]) => toWorld(x, y, offset))
      const flowSign = flowSignFor(points, digit.core, digit.spin)
      layers.push({
        curve: new PolylineCurve(world, { closed: false, depth: preset.depth, rotationDepth, depthPhase: 0.82 * armIndex }),
        closed: false,
        depth: preset.depth,
        strong: preset.strong,
        speed: preset.speed,
        phase: preset.phase,
        weight: length * unit * (preset.strong ? 1 : 0.77),
        flowCenter: core,
        flowSign,
      })
    })
  })
  return { layers, cores }
}
