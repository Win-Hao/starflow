import {
  AddEquation,
  BufferGeometry,
  ClampToEdgeWrapping,
  CustomBlending,
  DataTexture,
  Float32BufferAttribute,
  FloatType,
  Group,
  MathUtils,
  Matrix4,
  NearestFilter,
  Object3D,
  OneFactor,
  OneMinusSrcAlphaFactor,
  Points,
  RGBAFormat,
  ShaderMaterial,
  SrcAlphaFactor,
  Vector2,
  Vector3,
  Vector4,
} from 'three'
import { createGalaxyTextLayers } from './digits.js'
import { extractStrokes } from './skeleton.js'
import { extractContours, resampleClosed, signedArea, smoothClosed } from './contours.js'
import { HERO_COLOR_SEEDS, writeStarColor } from './palette.js'
import { createGalaxyLayers, createPathLayers, flowDirection, GALAXY_HEIGHT, GALAXY_LAYERS, PolylineCurve } from './paths.js'
import { makeRandom } from './random.js'
import { rasterize } from './rasterize.js'
import { MAX_HEROES, MAX_SPIN_LAYERS, SHAPE_SAMPLE_COUNT, STAR_FRAGMENT_SHADER, STAR_VERTEX_SHADER } from './shaders.js'

/** 每条路径在路径贴图里的采样点数（原站同款）。 */
export const PATH_SAMPLE_COUNT = 512
const TAU = Math.PI * 2

/** 原站：质量随视觉大小增长，大星被推得慢、回位也慢。 */
export function particleMotionMass(scale) {
  return MathUtils.lerp(0.65, 2.4, MathUtils.smoothstep(scale, 1, 14))
}

// 原站的加性混合配置：颜色直接叠加，alpha 走常规合成。
const BLENDING = {
  blending: CustomBlending,
  blendEquation: AddEquation,
  blendSrc: SrcAlphaFactor,
  blendDst: OneFactor,
  blendEquationAlpha: AddEquation,
  blendSrcAlpha: OneFactor,
  blendDstAlpha: OneMinusSrcAlphaFactor,
}

/** 光栅形状（文字 / 图标 / 图片）默认的体积半宽，原站的数字在拖动时就是这么厚的一根管子 */
export const RASTER_DEPTH = 0.1

export const DEFAULT_FIELD_OPTIONS = {
  // 原站：5 层 × (强 220 / 弱 170) × density 4 = 4000
  starCount: 4000,
  // 光栅形状内部的星尘占比。星系模式没有"内部"，忽略
  fillRatio: 0,
  // 留在天上的背景星，相对路径星的比例。原站每层 12/88
  backgroundRatio: 0.14,
  // 星带半宽，相对形状高度。原站 0.4 / 9.7；太小星星会串成一条线
  scatter: 0.041,
  // 沿路径的疏密调制：端点稀、中段密
  densityFalloff: 0.22,
  // 曲线的 Z 向起伏幅度，旋转时星臂才有前后层次
  rotationDepth: 1.4,
  // 形状的体积：每颗星再沿 Z 向撒开的半宽（相对形状高度，三角分布），旋转时形状是一根管子而不是一张纸。
  // null = 自动：文字 / 图标 / 图片取 RASTER_DEPTH，星系与路径形状取 0（与原站逐星一致）
  depth: null,
  // 星星沿星臂朝星系核流动（false 则向外）
  flowInward: true,
  // 星星整体大小。原站 2.05——这是"大而软的亮星"观感的来源
  size: 2.05,
  palette: 'astra',
  colorMode: true,
  // 星系核：一小团致密的亮星，也是主镜头光晕的光源
  centerCluster: true,
  clusterCount: 96,
  // 路径形状模式：亮星里保留多少比例不被压暗（原站 pathShapeBrightRetention 0.5），1 = 不压
  brightRetention: 1,
  // 0 = 与原站逐星一致的随机序列
  seed: 0,
  contourThreshold: 0.5,
  minContourArea: 24,
  // 光栅形状的星线：'center' 沿笔画中线撒成管子（原站数字的做法），'outline' 沿轮廓，
  // 'auto' = 文字和细描边图标走中线，实心图标 / 图片走轮廓
  stroke: 'auto',
  // 中线模式的散布：相对当前位置半笔宽的倍率，>1 让星星略微溢出笔画边缘
  strokeSpread: 1.3,
}

/** auto 模式下，最大半笔宽超过形状高度的这个比例就当实心图形，走轮廓 */
const STROKE_AUTO_LIMIT = 0.15
const strokeCache = new WeakMap()

/** 原站 densityProgress：把均匀种子沿弧长挤一挤。着色器里有同一份。 */
export function densityProgress(seed, falloff) {
  const r = MathUtils.euclideanModulo(seed, 1)
  return r + (MathUtils.clamp(falloff, 0, 0.98) * Math.sin(r * TAU)) / TAU
}

/** 原站 tipFade：开放曲线两端渐隐。 */
export function tipFade(progress) {
  return MathUtils.smoothstep(progress, 0, 0.055) * (1 - MathUtils.smoothstep(progress, 0.945, 1))
}

/** 原站 sizeFalloff：两端的星更小。 */
export function sizeFalloff(progress, amount) {
  const middle = Math.sin(MathUtils.clamp(progress, 0, 1) * Math.PI)
  return MathUtils.lerp(1, 0.14 + 0.86 * Math.max(middle, 0) ** 0.68, MathUtils.clamp(amount, 0, 1))
}

/** 在一条路径的采样数组里按弧长参数插值。 */
export function samplePath(samples, progress, target) {
  const count = samples.length / 4
  const scaled = MathUtils.clamp(progress, 0, 1) * (count - 1)
  const lower = Math.floor(scaled)
  const upper = Math.min(lower + 1, count - 1)
  const blend = scaled - lower
  return target.set(
    MathUtils.lerp(samples[lower * 4], samples[upper * 4], blend),
    MathUtils.lerp(samples[lower * 4 + 1], samples[upper * 4 + 1], blend),
    MathUtils.lerp(samples[lower * 4 + 2], samples[upper * 4 + 2], blend),
  )
}

/** 按权重把总星数分配给各层，短层至少也要有一点星。 */
function allocate(weights, total) {
  const sum = weights.reduce((a, b) => a + b, 0)
  if (sum <= 0) return weights.map(() => 0)
  const raw = weights.map((w) => (w / sum) * total)
  const counts = raw.map((v) => Math.max(6, Math.floor(v)))
  let excess = counts.reduce((a, b) => a + b, 0) - total
  const order = counts.map((c, i) => i).sort((a, b) => counts[b] - counts[a])
  for (const index of order) {
    if (excess <= 0) break
    const take = Math.min(excess, counts[index] - 6)
    counts[index] -= take
    excess -= take
  }
  return counts
}

/**
 * 把形状变成一组可以按弧长参数化的曲线。
 * 星系模式直接用原站的 5 条手绘曲线；其余来源先光栅化再抠轮廓。
 */
function buildLayers(source, options) {
  if (source.type === 'galaxy') {
    return { layers: createGalaxyLayers(options.rotationDepth), raster: null }
  }
  if (source.type === 'paths') {
    return { layers: createPathLayers(source.paths, source.viewBox, options.rotationDepth), raster: null }
  }
  if (source.type === 'galaxy-text') {
    // 星系体数字：每位 5 条螺旋臂 + 一个核心，写法同原站的 6
    const { layers, cores } = createGalaxyTextLayers(source.value, options.rotationDepth)
    return { layers, raster: null, cores }
  }

  const { mask, width: maskWidth, height: maskHeight } = rasterize(source)
  // 光栅形状按"高 9.7 / 宽不超过 19.4"归一到与星系相同的世界单位，
  // 这样 scatter、星密度这些参数在两种模式下含义一致。
  const scale = Math.min((GALAXY_HEIGHT * 2) / maskWidth, GALAXY_HEIGHT / maskHeight)
  const toWorld = (x, y) => [(x - maskWidth / 2) * scale, (maskHeight / 2 - y) * scale]

  const raster = { mask, width: maskWidth, height: maskHeight, toWorld, scale }
  const rotationDepth = MathUtils.clamp(options.rotationDepth, 0, 2)

  // 笔画中线：文字 / 描边图标像原站的数字一样，星星沿中线撒成一根管子
  if (options.stroke !== 'outline') {
    const cached = strokeCache.get(source)
    const result = cached && cached.threshold === options.contourThreshold
      ? cached.result
      : extractStrokes(mask, maskWidth, maskHeight, { threshold: options.contourThreshold })
    strokeCache.set(source, { threshold: options.contourThreshold, result })
    const thin = result.maxHalfWidth / maskHeight < STROKE_AUTO_LIMIT
    const useStrokes = result.strokes.length > 0 && (options.stroke === 'center' || source.type === 'text' || thin)
    if (useStrokes) {
      const layers = result.strokes.map((stroke, index) => {
        const preset = GALAXY_LAYERS[index % GALAXY_LAYERS.length]
        const points = stroke.points.map(([x, y]) => toWorld(x, y))
        return {
          curve: new PolylineCurve(points, { closed: stroke.closed, depth: preset.depth, rotationDepth, depthPhase: 0.82 * index }),
          closed: stroke.closed,
          widths: stroke.widths.map((half) => half * scale),
          depth: preset.depth,
          strong: preset.strong,
          speed: preset.speed,
          phase: preset.phase,
          weight: stroke.length * scale * (preset.strong ? 1 : 0.77),
        }
      })
      return { layers, raster, strokes: true }
    }
  }

  const contours = extractContours(mask, maskWidth, maskHeight, { threshold: options.contourThreshold })
    .map((points) => smoothClosed(points, 2))
    .filter((points) => Math.abs(signedArea(points)) >= options.minContourArea)
    .map((points) => resampleClosed(points, 1.6))
    .filter((entry) => entry.points.length >= 8)
    .sort((a, b) => b.perimeter - a.perimeter)
  if (contours.length === 0) throw new Error('没能从这个形状里提取到轮廓')

  const layers = contours.map((contour, index) => {
    const preset = GALAXY_LAYERS[index % GALAXY_LAYERS.length]
    const points = contour.points.map(([x, y]) => toWorld(x, y))
    return {
      curve: new PolylineCurve(points, {
        closed: true,
        depth: preset.depth,
        rotationDepth,
        depthPhase: 0.82 * index,
      }),
      closed: true,
      depth: preset.depth,
      strong: preset.strong,
      speed: preset.speed,
      phase: preset.phase,
      weight: contour.perimeter * (preset.strong ? 1 : 0.77),
    }
  })

  return { layers, raster, strokes: false }
}

/** 中线层：t 处的半笔宽（世界单位），和 PolylineCurve.getPoint 用同一套参数映射 */
function strokeWidthAt(layer, t) {
  const widths = layer.widths
  const n = widths.length
  if (layer.closed) {
    const f = MathUtils.euclideanModulo(t, 1) * n
    const i0 = Math.floor(f) % n
    return MathUtils.lerp(widths[i0], widths[(i0 + 1) % n], f - Math.floor(f))
  }
  const f = MathUtils.clamp(t, 0, 1) * (n - 1)
  const i0 = Math.min(Math.floor(f), n - 1)
  return MathUtils.lerp(widths[i0], widths[Math.min(i0 + 1, n - 1)], f - i0)
}

/**
 * 纯 CPU 的星场生成：算出所有顶点属性、路径采样和主星信息，不碰 WebGL。
 * WebGL 版和 Canvas 2D 回退版共用这一份，两者的构图完全一致。
 */
export function generateStarField(source, userOptions = {}) {
  const options = { ...DEFAULT_FIELD_OPTIONS, ...userOptions }
  const { layers, raster, strokes: isStrokes, cores: textCores = [] } = buildLayers(source, options)
  const layerCount = layers.length
  const isGalaxy = source.type === 'galaxy'
  const isPaths = source.type === 'paths'
  // 原站的路径形状里，5 颗主星散落在各段路径上；层数不够 5 就每层多选几颗。笔画中线同样处理
  const heroesPerLayer = isPaths || isStrokes ? Math.max(1, Math.ceil(5 / layerCount)) : 1
  const brightRetention = MathUtils.clamp(options.brightRetention, 0, 1)
  // 原站路径形状：星星带着自己在星系里那一层的流速过来，5 档速度混在同一条路径上，
  // 相位又按「这段子路径占总长的比例」放大——结的 6 段弧每段只占 1/6，流速就是 6 倍。
  const pathSpeeds = GALAXY_LAYERS.map((layer) => Math.abs(layer.speed))
  const flowSign = options.flowInward ? 1 : -1

  // --- 路径采样 + 包围盒 ---
  const samples = new Float32Array(PATH_SAMPLE_COUNT * layerCount * 4)
  const point = new Vector3()
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  layers.forEach((layer, layerIndex) => {
    layer.samples = samples.subarray(layerIndex * PATH_SAMPLE_COUNT * 4, (layerIndex + 1) * PATH_SAMPLE_COUNT * 4)
    for (let i = 0; i < PATH_SAMPLE_COUNT; i += 1) {
      layer.curve.getPointAt(i / (PATH_SAMPLE_COUNT - 1), point)
      layer.samples[i * 4] = point.x
      layer.samples[i * 4 + 1] = point.y
      layer.samples[i * 4 + 2] = point.z
      layer.samples[i * 4 + 3] = 1
      if (point.x < minX) minX = point.x
      if (point.x > maxX) maxX = point.x
      if (point.y < minY) minY = point.y
      if (point.y > maxY) maxY = point.y
    }
    layer.flowSpeed = layer.closed ? layer.speed : flowDirection(layer.curve, layer.speed, options.flowInward, layer.flowCenter ?? null)
  })
  const shapeWidth = Math.max(maxX - minX, 1e-3)
  const shapeHeight = Math.max(maxY - minY, 1e-3)
  if (isPaths) {
    const totalLength = layers.reduce((sum, layer) => sum + layer.weight, 0)
    for (const layer of layers) layer.rangeSpan = Math.max(layer.weight / Math.max(totalLength, 1e-6), 1e-3)
  }

  // --- 数量分配 ---
  const fillRatio = raster ? MathUtils.clamp(options.fillRatio, 0, 0.9) : 0
  const outlineTotal = Math.max(layerCount, Math.round(options.starCount * (1 - fillRatio)))
  const counts = allocate(layers.map((layer) => layer.weight), outlineTotal)
  const backgroundCounts = counts.map((n) => Math.round(n * Math.max(options.backgroundRatio, 0)))
  const fillTotal = raster ? Math.max(0, options.starCount - outlineTotal) : 0
  const clusterEach = options.centerCluster ? Math.max(0, Math.round(options.clusterCount)) : 0
  // 星系核：星系一个，星系体数字每位一个
  const clusterTotal = isGalaxy ? clusterEach : clusterEach * textCores.length
  // 给每个数字核心留一个主星位，剩下的才给星臂
  const reservedHeroes = Math.min(textCores.length, 4)
  const total =
    counts.reduce((a, b) => a + b, 0) + backgroundCounts.reduce((a, b) => a + b, 0) + fillTotal + clusterTotal

  const positions = new Float32Array(total * 3)
  const colors = new Float32Array(total * 3)
  const orbitProgress = new Float32Array(total)
  const offsets = new Float32Array(total * 2)
  const brightness = new Float32Array(total)
  const opacity = new Float32Array(total)
  const scales = new Float32Array(total)
  const flags = new Float32Array(total * 4)
  const path = new Float32Array(total * 3)
  const twinkle = new Float32Array(total * 2)

  const sizeFactor = MathUtils.clamp(options.size, 0.25, 3)
  const scatterWorld = MathUtils.clamp(options.scatter, 0, 0.14) * shapeHeight
  // 中线管子本身就是圆的，额外体积默认只给轮廓模式
  const depthWorld = MathUtils.clamp(options.depth ?? (raster && !isStrokes ? RASTER_DEPTH : 0), 0, 0.5) * shapeHeight
  const strokeSpread = MathUtils.clamp(options.strokeSpread, 0, 3)
  const falloff = MathUtils.clamp(options.densityFalloff, 0, 1)
  const seedMix = options.seed >>> 0
  const tangent = new Vector3()
  const normal = new Vector3()
  const heroes = []
  let cursor = 0

  // --- 路径星（原站 generateAstraField 的逐星公式） ---
  layers.forEach((layer, layerIndex) => {
    const n = counts[layerIndex]
    const m = n + backgroundCounts[layerIndex]
    if (n <= 0) return
    const random = makeRandom((0x243f6a88 ^ ((layerIndex + 1) * 0x9e3779b9)) ^ seedMix)
    const colorRandom = makeRandom((0xa4093822 ^ ((layerIndex + 1) * 0x299f31d0)) ^ seedMix)
    const brightRatio = layer.strong ? 0.085 : 0.055
    const open = layer.closed ? 0 : 1
    // 本层按 scale 排名前几的星，之后提拔为主星
    const top = []

    for (let i = 0; i < m; i += 1) {
      const seed = random()
      const t = densityProgress(seed, falloff)
      const middle = Math.sin(t * Math.PI)
      layer.curve.getPointAt(t, point)
      layer.curve.getTangentAt(t, tangent).normalize()
      normal.set(-tangent.y, tangent.x, 0).normalize()

      // 星带在中段最宽、两端收窄；三角分布的尾巴比高斯长，边缘不会像被裁刀切过。
      // 路径形状：横向偏移是从星系里带过来的，与它在这条路径上的位置无关，再加一层均匀抖动
      let across
      let depth
      if (layer.widths) {
        // 中线模式：散布跟着当前位置的半笔宽走，横向和 Z 向一样宽——旋转到任何角度都是一根圆管
        const spread = strokeWidthAt(layer, t) * strokeSpread * MathUtils.lerp(0.55, 1, middle) * (0.3 + 0.7 * random())
        across = (random() + random() - 1) * spread
        depth = (random() + random() - 1) * spread
      } else {
        const envelope = isPaths ? Math.sin(random() * Math.PI) : middle
        const spread = scatterWorld * MathUtils.lerp(0.3, 1, envelope) * (0.22 + 0.78 * random())
        across = (random() + random() - 1) * spread
        if (isPaths) across += (random() + random() - 1) * scatterWorld * 0.27
        depth = (random() + random() - 1) * spread * 0.65
      }
      // 体积厚度：只在开了 depth 时才多消耗随机数，星系的逐星序列保持与原站一致
      if (depthWorld > 0) depth += (random() + random() - 1) * depthWorld
      point.addScaledVector(normal, across)
      point.z += depth
      const starSpeed = isPaths
        ? (pathSpeeds[Math.floor(random() * pathSpeeds.length)] * flowSign) / layer.rangeSpan
        : layer.flowSpeed

      // 亮星比例：强层 8.5%、弱层 5.5%，端点处再打两折。
      const brightChance = MathUtils.lerp(brightRatio * 0.22, brightRatio, middle)
      const isBright = random() < brightChance
      const scale = (isBright ? 0.85 + 1.25 * random() : 0.12 + random() ** 2.4 * 0.68) * sizeFactor
      let bright = (isBright ? 2 + 1.5 * random() : 0.56 + 0.78 * random()) * (layer.strong ? 1 : 0.82)
      // 原站路径形状：一半亮星压到 42%，形状才不会满是光斑。retention = 1 时不动随机序列
      if (isBright && brightRetention < 1 && random() >= brightRetention) bright *= 0.42

      const index = cursor
      positions[index * 3] = point.x
      positions[index * 3 + 1] = point.y
      positions[index * 3 + 2] = point.z
      offsets[index * 2] = across
      offsets[index * 2 + 1] = depth
      brightness[index] = bright
      writeStarColor(colors, index * 3, colorRandom(), options.palette, options.colorMode)
      opacity[index] = 0.82 + 0.16 * random()
      orbitProgress[index] = seed
      scales[index] = scale
      twinkle[index * 2] = random() * TAU
      twinkle[index * 2 + 1] = 0.65 + 0.7 * random()
      flags[index * 4 + 2] = i >= n ? 1 : 0
      path[index * 3] = layerIndex
      path[index * 3 + 1] = starSpeed
      path[index * 3 + 2] = open

      if (i < n && (top.length < heroesPerLayer || scale > top[top.length - 1].scale)) {
        top.push({ scale, index })
        top.sort((a, b) => b.scale - a.scale)
        if (top.length > heroesPerLayer) top.pop()
      }
      cursor += 1
    }

    // 每层提拔主星：放大、增亮、换成专属颜色，作为镜头光晕的追踪源。
    for (const { index: bestIndex } of top) {
      if (heroes.length >= MAX_HEROES - 1 - reservedHeroes) break
      scales[bestIndex] = Math.max(scales[bestIndex], (layer.strong ? 2.2 : 2.05) * sizeFactor)
      brightness[bestIndex] = Math.max(brightness[bestIndex], layer.strong ? 3.35 : 2.85)
      flags[bestIndex * 4] = heroes.length + 1
      writeStarColor(
        colors,
        bestIndex * 3,
        HERO_COLOR_SEEDS[(isPaths || isStrokes ? heroes.length : layerIndex) % HERO_COLOR_SEEDS.length],
        options.palette,
        options.colorMode,
      )
      heroes.push({
        slot: heroes.length,
        layer: layerIndex,
        index: bestIndex,
        isCore: false,
        seed: orbitProgress[bestIndex],
        speed: path[bestIndex * 3 + 1],
        across: offsets[bestIndex * 2],
        depth: offsets[bestIndex * 2 + 1],
      })
    }
  })

  // --- 填充星：光栅形状内部的暗星尘，让实心的字有体积而不只是一圈轮廓 ---
  if (fillTotal > 0 && raster) {
    const random = makeRandom(0x1f83d9ab ^ seedMix)
    const inside = []
    for (let y = 0; y < raster.height; y += 1) {
      for (let x = 0; x < raster.width; x += 1) {
        if (raster.mask[y * raster.width + x] >= options.contourThreshold) inside.push(y * raster.width + x)
      }
    }
    // 每层每 8 个采样点取一个做最近层查找，精度足够且快得多。
    const anchors = []
    layers.forEach((layer, layerIndex) => {
      for (let i = 0; i < PATH_SAMPLE_COUNT; i += 8) {
        anchors.push([layer.samples[i * 4], layer.samples[i * 4 + 1], layerIndex])
      }
    })
    for (let i = 0; i < fillTotal && inside.length > 0; i += 1) {
      const pick = inside[Math.floor(random() * inside.length)]
      const [wx, wy] = raster.toWorld((pick % raster.width) + random() - 0.5, Math.floor(pick / raster.width) + random() - 0.5)
      let nearestLayer = 0
      let nearestDistance = Infinity
      for (const [ax, ay, layerIndex] of anchors) {
        const d = (ax - wx) * (ax - wx) + (ay - wy) * (ay - wy)
        if (d < nearestDistance) {
          nearestDistance = d
          nearestLayer = layerIndex
        }
      }
      const index = cursor
      positions[index * 3] = wx
      positions[index * 3 + 1] = wy
      positions[index * 3 + 2] = (random() + random() + random() - 1.5) * 0.3 + (depthWorld > 0 ? (random() + random() - 1) * depthWorld : 0)
      orbitProgress[index] = random()
      const isBright = random() < 0.03
      brightness[index] = isBright ? 1.5 + 1.1 * random() : 0.5 + 0.8 * random()
      opacity[index] = 0.4 + 0.45 * random()
      scales[index] = (isBright ? 0.55 + 0.7 * random() : 0.08 + random() ** 2.2 * 0.5) * sizeFactor
      flags[index * 4 + 1] = 1
      path[index * 3] = nearestLayer
      twinkle[index * 2] = random() * TAU
      twinkle[index * 2 + 1] = 0.5 + 0.8 * random()
      writeStarColor(colors, index * 3, random(), options.palette, options.colorMode)
      cursor += 1
    }
  }

  // --- 数字核心：和星系核同一种星团，但不挂 isCore（那会绕原点自转），当静止星随所属层一起拖转；每个核心提拔一颗静止主星给光晕 ---
  if (textCores.length > 0 && clusterEach > 0) {
    const random = makeRandom(0xb7e15162 ^ seedMix)
    const colorRandom = makeRandom(0xc0ac29b7 ^ seedMix)
    for (const core of textCores) {
      let best = -Infinity
      let bestIndex = cursor
      for (let i = 0; i < clusterEach; i += 1) {
        const radius = random() ** 2.4 * 0.42
        const angle = random() * TAU
        const index = cursor
        positions[index * 3] = core.position[0] + Math.cos(angle) * radius
        positions[index * 3 + 1] = core.position[1] + Math.sin(angle) * radius * 0.72
        positions[index * 3 + 2] = (random() - 0.5) * 0.16
        const inner = 1 - radius / 0.42
        const bright = 1.2 + 2.8 * inner + 0.6 * random()
        brightness[index] = bright * 1.22
        writeStarColor(colors, index * 3, inner > 0.74 ? 0.99 : colorRandom(), options.palette, options.colorMode)
        opacity[index] = 0.62 + 0.38 * inner
        const scale = (0.28 + 1.45 * inner + 0.45 * random()) * sizeFactor * 0.8
        scales[index] = scale
        if (bright * scale > best) {
          best = bright * scale
          bestIndex = index
        }
        twinkle[index * 2] = random() * TAU
        twinkle[index * 2 + 1] = 0.55 + 0.45 * random()
        flags[index * 4 + 1] = 1
        path[index * 3] = Math.min(core.layer, MAX_SPIN_LAYERS - 1)
        cursor += 1
      }
      if (heroes.length < MAX_HEROES - 1) {
        flags[bestIndex * 4] = heroes.length + 1
        heroes.push({
          slot: heroes.length,
          layer: Math.min(core.layer, MAX_SPIN_LAYERS - 1),
          index: bestIndex,
          isCore: false,
          isStatic: true,
          seed: 0,
          speed: 0,
          across: 0,
          depth: 0,
          position: [positions[bestIndex * 3], positions[bestIndex * 3 + 1], positions[bestIndex * 3 + 2]],
        })
      }
    }
  }

  // --- 星系核（原站 center cluster）：致密的椭圆亮星团，越靠中心越亮越白 ---
  let coreHero = null
  if (isGalaxy && clusterTotal > 0) {
    const random = makeRandom(0xb7e15162 ^ seedMix)
    const colorRandom = makeRandom(0xc0ac29b7 ^ seedMix)
    let best = -Infinity
    let bestIndex = cursor
    for (let i = 0; i < clusterTotal; i += 1) {
      const radius = random() ** 2.4 * 0.42
      const angle = random() * TAU
      const index = cursor
      positions[index * 3] = Math.cos(angle) * radius
      positions[index * 3 + 1] = Math.sin(angle) * radius * 0.72
      positions[index * 3 + 2] = (random() - 0.5) * 0.16
      const inner = 1 - radius / 0.42
      const bright = 1.2 + 2.8 * inner + 0.6 * random()
      // 原站给星系核材质单独乘了 1.22 的亮度
      brightness[index] = bright * 1.22
      writeStarColor(colors, index * 3, inner > 0.74 ? 0.99 : colorRandom(), options.palette, options.colorMode)
      opacity[index] = 0.62 + 0.38 * inner
      const scale = (0.28 + 1.45 * inner + 0.45 * random()) * sizeFactor * 0.8
      scales[index] = scale
      if (bright * scale > best) {
        best = bright * scale
        bestIndex = index
      }
      twinkle[index * 2] = random() * TAU
      twinkle[index * 2 + 1] = 0.55 + 0.45 * random()
      flags[index * 4 + 3] = 1
      // 原站给星系核层的流速是 0.022：变成路径形状后它们也要跟着流，不然最亮的一批星会定在原地
      path[index * 3 + 1] = 0.022
      cursor += 1
    }
    flags[bestIndex * 4] = heroes.length + 1
    coreHero = {
      slot: heroes.length,
      layer: -1,
      index: bestIndex,
      isCore: true,
      seed: 0,
      speed: 0.022,
      across: 0,
      depth: 0,
      position: [positions[bestIndex * 3], positions[bestIndex * 3 + 1], positions[bestIndex * 3 + 2]],
    }
    heroes.push(coreHero)
  }

  // 主星的随机量在 JS 里算好，以 uniform 下发给着色器，两边用同一组值：
  // 光晕在 JS 里算出的位置才能和 GPU 上那颗星严丝合缝。
  const hash = (ax, ay, kx, ky) => {
    const v = Math.sin(ax * kx + ay * ky) * 43758.5453
    return v - Math.floor(v)
  }
  for (const hero of heroes) {
    const i = hero.index
    const orbit = orbitProgress[i]
    const phase = twinkle[i * 2]
    hero.scatter = [
      hash(orbit, phase, 127.1, 311.7),
      hash(phase, scales[i], 269.5, 183.3),
      hash(orbit, brightness[i], 419.2, 371.9),
      hash(opacity[i], twinkle[i * 2 + 1], 157.3, 283.9),
    ]
    const seedRaw = orbit * 0.754877666 + phase * 0.159154943 + scales[i] * 0.117
    hero.shapeSeed = seedRaw - Math.floor(seedRaw)
  }

  const count = cursor
  const columns = 128
  const rows = Math.max(1, Math.ceil(count / columns))
  const motionUv = new Float32Array(count * 3)
  for (let i = 0; i < count; i += 1) {
    motionUv[i * 3] = ((i % columns) + 0.5) / columns
    motionUv[i * 3 + 1] = (Math.floor(i / columns) + 0.5) / rows
    motionUv[i * 3 + 2] = particleMotionMass(0.35 + 3.8 * scales[i])
  }

  return {
    options,
    count,
    layerCount,
    isGalaxy,
    isPaths,
    isStrokes: !!isStrokes,
    layers: layers.map((layer) => ({
      samples: layer.samples,
      speed: layer.flowSpeed,
      closed: layer.closed,
      strong: layer.strong,
      depth: (layer.depth ?? 0) * MathUtils.clamp(options.rotationDepth, 0, 2),
    })),
    heroes,
    coreHero,
    samples,
    size: [shapeWidth, shapeHeight],
    origin: [(minX + maxX) / 2, (minY + maxY) / 2],
    motionTextureSize: [columns, rows],
    arrays: { positions, colors, orbitProgress, offsets, brightness, opacity, scales, flags, path, twinkle, motionUv },
  }
}

/**
 * 把一个形状变成一片可渲染的星场。
 * @returns 包含 group / material / 光晕追踪源的对象
 */
export function createAstraField(source, userOptions = {}) {
  const data = generateStarField(source, userOptions)
  const { arrays, count } = data

  const geometry = new BufferGeometry()
  const add = (name, array, itemSize) =>
    geometry.setAttribute(name, new Float32BufferAttribute(array.subarray(0, count * itemSize), itemSize))
  add('position', arrays.positions, 3)
  add('starColor', arrays.colors, 3)
  add('particleMotionUv', arrays.motionUv, 3)
  add('orbitProgress', arrays.orbitProgress, 1)
  add('starOffsets', arrays.offsets, 2)
  add('starBrightness', arrays.brightness, 1)
  add('starOpacity', arrays.opacity, 1)
  add('starScale', arrays.scales, 1)
  add('starFlags', arrays.flags, 4)
  add('starPath', arrays.path, 3)
  add('starTwinkle', arrays.twinkle, 2)

  const pathTexture = new DataTexture(data.samples, PATH_SAMPLE_COUNT, data.layerCount, RGBAFormat, FloatType)
  pathTexture.magFilter = NearestFilter
  pathTexture.minFilter = NearestFilter
  pathTexture.generateMipmaps = false
  pathTexture.wrapS = ClampToEdgeWrapping
  pathTexture.wrapT = ClampToEdgeWrapping
  pathTexture.needsUpdate = true

  const material = new ShaderMaterial({
    ...BLENDING,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
    vertexShader: STAR_VERTEX_SHADER,
    fragmentShader: STAR_FRAGMENT_SHADER,
    uniforms: {
      uBackgroundModelMatrix: { value: new Matrix4() },
      uCoreRotation: { value: new Vector3() },
      uDensityFalloff: { value: MathUtils.clamp(data.options.densityFalloff, 0, 0.98) },
      uDimSizeScale: { value: 1 },
      uDispersedMotion: { value: 0 },
      uFlowOffset: { value: 0 },
      uHeadProgress: { value: 0 },
      uHeroScatter: {
        value: Array.from({ length: MAX_HEROES }, (_, slot) => {
          const hero = data.heroes[slot]
          return hero ? new Vector4(...hero.scatter) : new Vector4()
        }),
      },
      uHeroShapeSeed: { value: Float32Array.from({ length: MAX_HEROES }, (_, slot) => data.heroes[slot]?.shapeSeed ?? 0) },
      uIntensity: { value: 1.35 },
      uIntroProgress: { value: 1 },
      uLayerSpin: { value: Array.from({ length: MAX_SPIN_LAYERS }, () => new Vector2()) },
      uPathLayerCount: { value: data.layerCount },
      uPathMotion: { value: 1 },
      uPathSampleCount: { value: PATH_SAMPLE_COUNT },
      uPathTexture: { value: pathTexture },
      uPixelRatio: { value: 1 },
      uScatterCenter: { value: new Vector2() },
      uScatterSize: { value: new Vector2(data.size[0] * 2, data.size[1] * 2) },
      uScrollDrift: { value: 0 },
      uScrollPositionProgress: { value: 0 },
      uScrollScatter: { value: 0 },
      uScrollSizeScale: { value: 1 },
      uShapeBrightRetention: { value: 0.5 },
      uShapeCenter: { value: new Vector2() },
      uShapeFlowOffset: { value: 0 },
      uShapeFlowSign: { value: data.options.flowInward ? 1 : -1 },
      uShapeLayerDepth: {
        value: Float32Array.from({ length: MAX_SPIN_LAYERS }, (_, i) => data.layers[Math.min(i, data.layerCount - 1)]?.depth ?? 0),
      },
      uShapePositionProgress: { value: 0 },
      uShapeProgress: { value: 0 },
      uShapeRotation: { value: new Vector2() },
      uShapeSampleCount: { value: SHAPE_SAMPLE_COUNT },
      uShapeScatter: { value: 1 },
      uShapeSize: { value: new Vector2(1, 1) },
      uShapeTexture: { value: null },
      uSizeFalloff: { value: 0.45 },
      uSizeScale: { value: 1 },
      uTextBounds: { value: new Vector2(-3, 3) },
      uTime: { value: 0 },
      uTrailBrightness: { value: 0.9 },
      uTrailEnabled: { value: 0 },
      uTrailLength: { value: 0.16 },
      uTwinkleSpeed: { value: 0.62 },
      uViewportAspect: { value: 1 },
      uLensActive: { value: 0 },
      uLensDepth: { value: 0.5 },
      uLensIllumination: { value: 0.55 },
      uLensMagnification: { value: 0.18 },
      uLensPointer: { value: new Vector2() },
      uLensRadius: { value: 0.2 },
      uParticleMotionEnabled: { value: 0 },
      uParticleMotionTexture: { value: null },
      uParticleMotionAge: { value: 6 },
      uParticleMotionPointer: { value: new Vector2() },
      uParticleMotionPrevious: { value: new Vector2() },
      uParticleMotionImpulse: { value: new Vector2() },
      uPointerRepelRadius: { value: 0.39 },
    },
  })

  const points = new Points(geometry, material)
  points.frustumCulled = false

  const group = new Group()
  group.add(points)

  // 光晕追踪源：scale 0 的空对象，只用来读它在世界空间的位置；
  // userData.visibility 记录这颗星此刻的可见度（端点渐隐等），光晕据此淡出。
  const makeMarker = (position) => {
    const marker = new Object3D()
    marker.position.set(position[0], position[1], position[2])
    marker.scale.setScalar(0)
    marker.userData.visibility = 1
    group.add(marker)
    return marker
  }
  const heroes = data.heroes.map((hero) => ({
    ...hero,
    marker: makeMarker([
      arrays.positions[hero.index * 3],
      arrays.positions[hero.index * 3 + 1],
      arrays.positions[hero.index * 3 + 2],
    ]),
  }))
  const coreHero = heroes.find((hero) => hero.isCore) ?? null

  // 有星系核就让它当主光源；文字 / 图标由最大那层的主星顶上；
  // 路径形状和原站一样没有主光源，只有副光源跟着各段路径上的主星。
  const coreEntry = coreHero ?? (data.isPaths ? null : heroes[0] ?? null)
  const coreSource = coreEntry?.marker ?? null
  const secondaryEntries = heroes.filter((hero) => hero.marker !== coreSource).slice(0, 5)
  const secondarySources = secondaryEntries.map((hero) => hero.marker)
  // 每个光源对应粒子在推斥状态贴图里的 (u, v, 质量)，光晕着色器靠它读出被推开的位移
  const motionUvOf = (index) =>
    new Vector3(arrays.motionUv[index * 3], arrays.motionUv[index * 3 + 1], arrays.motionUv[index * 3 + 2])
  const coreMotionUv = coreEntry ? motionUvOf(coreEntry.index) : null
  const secondaryMotionUvs = secondaryEntries.map((hero) => motionUvOf(hero.index))

  return {
    group,
    points,
    geometry,
    material,
    pathTexture,
    count,
    options: data.options,
    layerCount: data.layerCount,
    isGalaxy: data.isGalaxy,
    isPaths: data.isPaths,
    isStrokes: data.isStrokes,
    layers: data.layers,
    heroes,
    coreHero,
    size: data.size,
    origin: data.origin,
    motionTextureSize: data.motionTextureSize,
    coreSource,
    secondarySources,
    coreMotionUv,
    secondaryMotionUvs,
    dispose() {
      geometry.dispose()
      material.dispose()
      pathTexture.dispose()
      group.clear()
    },
  }
}
