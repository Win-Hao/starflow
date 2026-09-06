import { EffectComposer, EffectPass, RenderPass, ToneMappingEffect, ToneMappingMode } from 'postprocessing'
import {
  ClampToEdgeWrapping,
  Color,
  DataTexture,
  Euler,
  FloatType,
  Group,
  HalfFloatType,
  MathUtils,
  NearestFilter,
  NoToneMapping,
  OrthographicCamera,
  Quaternion,
  RGBAFormat,
  SRGBColorSpace,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { AstraAmbientEffect } from './ambient.js'
import { AstraBloomEffect } from './bloom.js'
import { createAstraField, densityProgress, PATH_SAMPLE_COUNT, samplePath, sizeFalloff, tipFade } from './field.js'
import { prefersReducedMotion } from './fallback.js'
import { AstraLensFlare, DEFAULT_FLARE } from './lensflare.js'
import { ParticleMotion, supportsParticleMotion } from './motion.js'
import { MAX_SPIN_LAYERS, SHAPE_SAMPLE_COUNT } from './shaders.js'

// 世界坐标以"视口高度 = 10 单位"为基准，星星大小则是纯像素单位，
// 两者解耦之后改窗口大小不会让星星忽大忽小。
const VIEW_HEIGHT = 10
const ZERO = new Vector2()
// 自适应降级的像素预算下限：再低星星就糊了，宁可改成隔帧渲染
const MIN_PIXEL_BUDGET = 1.2e6
// 原站：滚动时星系绕 X 轴最多翻 -52°，再回平
const TILT_ANGLE = MathUtils.degToRad(-52)
// 原站：散开进度从 0.375 起步、到 1.1875 完成（进度以 scrollDisperseDistance 归一）
const SCATTER_START = 0.375
const SCATTER_END = 1.1875
const TAU = Math.PI * 2

export const DEFAULT_CONFIG = {
  // 后处理档位：full / lite / none
  quality: 'full',
  // 原站的像素预算：DPR 再高也不让缓冲区超过 240 万像素
  pixelBudget: 2.4e6,
  // 持续掉帧时自动降级：先隔帧渲染，到底了再收紧像素预算
  adaptiveQuality: true,
  bloomIntensity: 0.7,
  bloomThreshold: 0.08,
  bloomRadius: 0.72,
  intensity: 1.35,
  twinkleSpeed: 0.62,
  sizeScale: 1,
  // 星星沿星臂流动的速度（原站 0.8）。0 = 静止
  flowSpeed: 0.8,
  // 开放曲线两端的星缩小的程度（原站 0.45）
  sizeFalloff: 0.45,
  // 暗星的尺寸倍率。独立路径形状预设用 0.8，星系是 1
  dimSizeScale: 1,
  // 星系核自转
  coreSpin: true,
  // 拖拽时各层的旋转滞后（原站 0.68）。0 = 整体刚性旋转
  rotationLag: 0.68,
  // 沿轮廓游走的光带（本项目的扩展）。0 = 关闭
  trailLength: 0,
  trailBrightness: 0.9,
  trailSpeed: 0.09,
  introDuration: 5.5,
  // 原站的星系不自转，只响应拖拽；留一个开关给想要动感的场景
  autoRotate: false,
  autoRotateAmount: 0.16,
  autoRotateSpeed: 0.22,
  pointerRepel: true,
  lensMode: false,
  // 默认跟随系统的"减少动态效果"设置，构图保留、动画停住
  reducedMotion: undefined,
  // 形状占视口的比例。原站：星系高 9.7，视口高 10.9
  fillX: 0.8,
  fillY: 0.89,
  // 形状在视口里的偏移，单位是"半个视口"。用来给侧边栏之类的 UI 让位，
  // 背景星仍然铺满整块画布，所以让位不会露出黑边。
  center: [0, 0],
  lensFlare: { ...DEFAULT_FLARE },
  // 氛围色和暗角（原本是两层 CSS，现在在后处理里做）
  ambientColor: '#23435f',
  ambientOpacity: 0.55,
  // 氛围色里铺满整屏的比例（0 = 纯径向渐变，1 = 均匀底色）。发布页骨架用 0.4 配 vignette 0，对应原站截图的底色
  ambientFloor: 0,
  vignette: 1,
  // --- 滚动编排（原站 converge-tilt 预设）---
  scrollEffects: true,
  // 星轨里的星随滚动的视差速度
  scrollStarDriftSpeed: 3,
  // 星系核的主光晕随滚动淡出
  showCenterCluster: true,
  // 路径形状成形时自动摆一下（原站 0.42 rad）
  shapeAutoRotate: true,
  shapeAutoRotateAmount: 0.42,
  // 路径形状的星带宽度倍率
  shapeScatter: 1,
  // 路径形状里保留多少亮星不被压暗
  shapeBrightRetention: 0.5,
}

function resolvePixelRatio(width, height, pixelBudget) {
  const dpr = window.devicePixelRatio || 1
  const budget = Math.sqrt(pixelBudget / Math.max(width * height, 1))
  return Math.max(0.5, Math.min(dpr, 2, budget))
}

function wrapAngle(angle) {
  return MathUtils.euclideanModulo(angle + Math.PI, Math.PI * 2) - Math.PI
}

/** 原站的阻尼：足够接近目标就直接吸附，避免无休止的微小变化。 */
function approach(current, target, rate, delta) {
  const next = MathUtils.damp(current, target, rate, delta)
  return Math.abs(target - next) <= 1e-4 ? target : next
}

/** 与着色器里 astraDispersedMotion 相同的 JS 版，给主星追踪用。 */
function dispersedMotion(target, time, sx, sy, sz, scrollDrift, strength) {
  const depth = MathUtils.clamp(sz, 0, 1)
  const motion = MathUtils.clamp(strength, 0, 1)
  const speed = MathUtils.lerp(0.4, 0.8, depth)
  const amount = MathUtils.lerp(0.035, 0.12, depth) * motion
  const phaseX = sx * TAU + sy * 2.7
  const phaseY = sy * TAU + sz * 3.1
  const parallax = scrollDrift * MathUtils.lerp(0.08, 0.28, depth * depth) * motion
  return target.set(
    (Math.sin(phaseX + time * speed) - Math.sin(phaseX)) * amount,
    (Math.cos(phaseY + time * speed * 0.73) - Math.cos(phaseY)) * amount + parallax,
  )
}

/** 形状贴图的 JS 采样，与着色器里的 astraSampleShape 一致。 */
function sampleShape(samples, progress, target) {
  const scaled = MathUtils.clamp(progress, 0, 1) * (SHAPE_SAMPLE_COUNT - 1)
  const lower = Math.floor(scaled)
  const upper = Math.min(lower + 1, SHAPE_SAMPLE_COUNT - 1)
  const blend = scaled - lower
  return target.set(
    MathUtils.lerp(samples[lower * 4], samples[upper * 4], blend),
    MathUtils.lerp(samples[lower * 4 + 1], samples[upper * 4 + 1], blend),
  )
}

export function createAstraScene(canvas, initialConfig = {}) {
  const config = {
    ...DEFAULT_CONFIG,
    reducedMotion: prefersReducedMotion(),
    ...initialConfig,
    lensFlare: { ...DEFAULT_FLARE, ...initialConfig.lensFlare },
  }

  const renderer = new WebGLRenderer({
    canvas,
    alpha: false,
    antialias: false,
    depth: false,
    powerPreference: 'high-performance',
  })
  renderer.outputColorSpace = SRGBColorSpace
  // 全程线性工作，ACES 留到后处理的最后一个 pass 做。
  // 这一步搞错，bloom 会提前削顶，画面会发灰。
  renderer.toneMapping = NoToneMapping
  renderer.setClearColor(0x000000, 1)

  const scene = new Scene()
  scene.background = new Color(0x000000)
  const animationRoot = new Group()
  const spinRoot = new Group()
  animationRoot.add(spinRoot)
  scene.add(animationRoot)

  const camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
  camera.position.set(0, 0, 20)

  const composer = new EffectComposer(renderer, {
    depthBuffer: false,
    frameBufferType: HalfFloatType,
    multisampling: 0,
  })
  composer.addPass(new RenderPass(scene, camera))

  const bloom = new AstraBloomEffect({
    intensity: config.bloomIntensity,
    luminanceThreshold: config.bloomThreshold,
    luminanceSmoothing: 0.18,
    mipmapBlur: true,
    levels: 5,
    radius: config.bloomRadius,
  })
  bloom.resolution.scale = 0.5

  const flare = new AstraLensFlare(config.lensFlare)
  const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC })
  const ambient = new AstraAmbientEffect({
    color: config.ambientColor,
    opacity: config.ambientOpacity,
    vignette: config.vignette,
  })
  let effectPass = null

  /**
   * 后处理档位（对应原站的 GPU 分级）：
   *   full  = bloom + 镜头光晕 + ACES
   *   lite  = bloom + ACES（省掉全屏的光晕着色器）
   *   none  = 只做 ACES
   */
  function buildPostprocessing() {
    if (effectPass) {
      composer.removePass(effectPass)
      // 不能调 effectPass.dispose()：它会连 bloom / flare 一起销毁
      effectPass.fullscreenMaterial?.dispose()
    }
    const effects =
      config.quality === 'full' ? [bloom, flare, toneMapping, ambient]
      : config.quality === 'lite' ? [bloom, toneMapping, ambient]
      : [toneMapping, ambient]
    effectPass = new EffectPass(camera, ...effects)
    composer.addPass(effectPass)
  }
  buildPostprocessing()

  // 路径形状贴图（原站 createPathShapeTexture）：换形状时只重写数据，贴图对象复用
  const shapeTexture = new DataTexture(
    new Float32Array(SHAPE_SAMPLE_COUNT * 4),
    SHAPE_SAMPLE_COUNT,
    1,
    RGBAFormat,
    FloatType,
  )
  shapeTexture.magFilter = NearestFilter
  shapeTexture.minFilter = NearestFilter
  shapeTexture.generateMipmaps = false
  shapeTexture.wrapS = ClampToEdgeWrapping
  shapeTexture.wrapT = ClampToEdgeWrapping
  shapeTexture.needsUpdate = true

  const pointer = { x: 0, y: 0, active: false, pressed: false, reset: true }
  const drag = { active: false, lastX: 0, lastY: 0 }
  // rotation：拖拽累积的目标角度；spin：根节点实际到达的角度；layerSpins：各层带滞后的角度
  const rotation = new Vector2()
  const spin = new Vector2()
  const layerSpins = Array.from({ length: MAX_SPIN_LAYERS }, () => new Vector2())
  const identity = new Quaternion()
  const backgroundScale = new Vector3()
  const euler = new Euler()
  const coreEuler = new Euler()
  const heroPosition = new Vector3()
  const heroBefore = new Vector3()
  const heroAfter = new Vector3()
  const heroTangent = new Vector3()
  const heroNormal = new Vector3()
  const heroRail = new Vector3()
  const heroShape = new Vector3()
  const heroDrift = new Vector2()
  const shapePoint = new Vector2()
  const shapeBefore = new Vector2()
  const shapeAfter = new Vector2()
  const lensTarget = new Vector2()

  /**
   * 滚动输入（由页面每帧喂进来，单位见 setScroll）：
   *   progress        以 scrollDisperseDistance 归一的滚动距离，可以超过 1
   *   tiltProgress    翻转进度 0..1；null = 跟随 progress
   *   scatterProgress 散开进度 0..1；null = 跟随 progress
   *   shape           当前路径形状 cue：samples / strength / centerNdc / sizeNdc
   *   contentBounds   文案栏在视口里的左右边界（0..1），星轨给它让位；null = 原站默认宽度
   */
  const scrollInput = {
    progress: 0,
    tiltProgress: null,
    scatterProgress: null,
    starsOpacity: 1,
    contentBounds: null,
    shape: { id: null, samples: null, strength: 0, centerNdc: [0, 0], sizeNdc: [0, 0] },
  }
  // 阻尼后的滚动状态（原站 createAstraAnimationState）
  const scrollState = {
    progress: 0,
    tilt: 0,
    scatterScroll: 0,
    scatterPosition: 0,
    shapeProgress: 0,
    shapePosition: 0,
    starsOpacity: 1,
    resolved: false,
    lastSamples: null,
    shapeRotation: new Vector2(),
    shapePointer: new Vector2(),
    shapeFlowOffset: 0,
  }

  let field = null
  let motion = null
  let viewWidth = VIEW_HEIGHT
  let viewHeight = VIEW_HEIGHT
  let viewportWidth = 1
  let fieldScale = 1
  let elapsed = 0
  let introElapsed = 0
  let flowOffset = 0
  let coreTarget = 0
  let coreRotation = 0
  let running = true
  let disposed = false
  let lastFrame = performance.now()
  let lastTick = lastFrame
  let pixelBudget = config.pixelBudget

  // 掉帧监测：以见过的最短 rAF 间隔当作刷新周期，1.2 秒窗口里超过两成的帧慢于阈值就降一级。
  // 降级顺序：先降渲染节奏（每 2 / 3 / 4 个刷新周期渲染一次——稳定的低帧率比忽快忽慢好看得多，
  // 而且大窗口 / 高刷屏上的瓶颈常常在浏览器的合成与送显，降分辨率毫无帮助），
  // 节奏降到底了还追不上，再逐级收紧像素预算。
  const MAX_DIVISOR = 4
  const governor = { refresh: Infinity, missed: 0, total: 0, windowStart: 0, lastStep: 0, divisor: 1, tick: 0 }

  function stepDown(now) {
    governor.lastStep = now
    if (governor.divisor < MAX_DIVISOR) {
      governor.divisor += 1
    } else if (pixelBudget > MIN_PIXEL_BUDGET) {
      pixelBudget = Math.max(MIN_PIXEL_BUDGET, pixelBudget * 0.75)
      layout()
    }
  }

  function govern(now, rawDelta) {
    // 入场阶段和切回前台的第一帧不算数
    if (!config.adaptiveQuality || introElapsed < 1.5 || rawDelta > 0.25) return
    const interval = rawDelta * 1000
    if (interval > 3) governor.refresh = Math.min(governor.refresh, interval)
    governor.total += 1
    // 渲染帧之间有 divisor 个周期可用，拖过半个周期以上才算掉帧
    if (interval > governor.refresh * (governor.divisor + 0.5)) governor.missed += 1
    if (now - governor.windowStart < 1200) return
    const ratio = governor.missed / Math.max(governor.total, 1)
    governor.windowStart = now
    governor.missed = 0
    governor.total = 0
    if (ratio > 0.2 && now - governor.lastStep > 2000) stepDown(now)
  }

  function layout() {
    const rect = canvas.getBoundingClientRect()
    const width = Math.max(1, Math.floor(rect.width))
    const height = Math.max(1, Math.floor(rect.height))
    const aspect = width / height
    viewportWidth = width

    viewHeight = VIEW_HEIGHT
    viewWidth = VIEW_HEIGHT * aspect
    camera.left = -viewWidth / 2
    camera.right = viewWidth / 2
    camera.top = viewHeight / 2
    camera.bottom = -viewHeight / 2
    camera.updateProjectionMatrix()

    const pixelRatio = resolvePixelRatio(width, height, pixelBudget)
    renderer.setPixelRatio(pixelRatio)
    // 第三个参数 false：不让 three 把尺寸写成 canvas 的内联样式，否则容器再变化时 ResizeObserver 不会触发
    composer.setSize(width, height, false)
    flare.setViewport(width, height)
    ambient.setViewport(width, height)

    if (!field) return

    // 形状按可用区域等比缩放，几何本身不用重建。
    fieldScale = Math.min((viewWidth * config.fillX) / field.size[0], (viewHeight * config.fillY) / field.size[1])
    field.group.scale.setScalar(fieldScale)
    // 包围盒中心对齐到视口中心（加上 center 偏移）。旋转轴仍在形状自己的原点上——
    // 星系模式下那就是星系核，和原站一致。
    animationRoot.position.set(
      (config.center[0] * viewWidth) / 2 - field.origin[0] * fieldScale,
      (config.center[1] * viewHeight) / 2 - field.origin[1] * fieldScale,
      0,
    )

    const uniforms = field.material.uniforms
    uniforms.uPixelRatio.value = pixelRatio
    uniforms.uViewportAspect.value = aspect
    // 散开位置在 group 局部坐标里，所以要反向补偿 scale 才能铺满屏（原站 1.12 倍视口）；
    // 再把散布中心从形状原点挪到视口中心。
    uniforms.uScatterSize.value.set((viewWidth * 1.12) / fieldScale, (viewHeight * 1.12) / fieldScale)
    uniforms.uScatterCenter.value.set(-animationRoot.position.x / fieldScale, -animationRoot.position.y / fieldScale)
    // 背景星挂在未旋转的根节点下：同样的缩放和位移，但不吃拖拽旋转。
    backgroundScale.setScalar(fieldScale)
    uniforms.uBackgroundModelMatrix.value.compose(animationRoot.position, identity, backgroundScale)
    // 原站：推斥半径 176px，换算成以视口高度归一的 NDC 单位。
    uniforms.uPointerRepelRadius.value = 352 / height
    updateTextBounds()
  }

  /** 星轨给文案栏让位：默认按原站的栏宽公式，页面也可以直接给出栏的左右边界。 */
  function updateTextBounds() {
    if (!field) return
    const width = viewportWidth
    let left
    let right
    if (scrollInput.contentBounds) {
      left = (MathUtils.clamp(scrollInput.contentBounds.left, 0, 1) - 0.5) * viewWidth
      right = (MathUtils.clamp(scrollInput.contentBounds.right, 0, 1) - 0.5) * viewWidth
    } else {
      const halfWidth = Math.min(0.5 * Math.min(676, Math.max(width - 48, 0)) + 48, 0.36 * width)
      left = -(halfWidth / width) * viewWidth
      right = (halfWidth / width) * viewWidth
    }
    field.material.uniforms.uTextBounds.value.set(left / fieldScale, right / fieldScale)
  }

  function releaseField() {
    if (!field) return
    motion?.dispose()
    motion = null
    spinRoot.remove(field.group)
    field.dispose()
    field = null
  }

  /** 换形状：重建星场并重放入场动画。 */
  function setSource(source, fieldOptions = {}) {
    releaseField()
    field = createAstraField(source, fieldOptions)
    field.material.uniforms.uShapeTexture.value = shapeTexture
    spinRoot.add(field.group)

    if (config.pointerRepel && supportsParticleMotion(renderer)) {
      motion = new ParticleMotion(field)
      // 模拟用的着色器提前编译，否则第一次划过画布时会卡一下
      renderer.compileAsync?.(motion.scene, camera).catch(() => {})
    } else {
      field.material.uniforms.uParticleMotionEnabled.value = 0
    }

    scrollState.resolved = false
    applyConfig()
    layout()
    replay()
    return { count: field.count, layers: field.layerCount, contours: field.layerCount }
  }

  function applyConfig() {
    bloom.intensity = config.bloomIntensity
    bloom.luminanceMaterial.threshold = config.bloomThreshold
    if (bloom.mipmapBlurPass) bloom.mipmapBlurPass.radius = config.bloomRadius
    flare.setConfig(config.lensFlare)
    ambient.setAmbient(config.ambientColor, config.ambientOpacity, config.vignette, MathUtils.clamp(config.ambientFloor ?? 0, 0, 1))
    if (!field) return
    const u = field.material.uniforms
    u.uTwinkleSpeed.value = config.twinkleSpeed
    u.uSizeScale.value = config.sizeScale
    u.uSizeFalloff.value = MathUtils.clamp(config.sizeFalloff, 0, 1)
    u.uDimSizeScale.value = MathUtils.clamp(config.dimSizeScale, 0.1, 1)
    u.uTrailEnabled.value = config.trailLength > 0 ? 1 : 0
    u.uTrailLength.value = Math.max(config.trailLength, 0.0001)
    u.uTrailBrightness.value = config.trailBrightness
    u.uShapeScatter.value = MathUtils.clamp(config.shapeScatter, 0, 3)
    u.uShapeBrightRetention.value = MathUtils.clamp(config.shapeBrightRetention, 0, 1)
    u.uParticleMotionEnabled.value = motion && config.pointerRepel ? 1 : 0
  }

  function setConfig(patch) {
    const previousQuality = config.quality
    Object.assign(config, patch)
    if (patch.lensFlare) config.lensFlare = { ...config.lensFlare, ...patch.lensFlare }
    if (patch.pixelBudget) {
      pixelBudget = patch.pixelBudget
      governor.divisor = 1
    }
    if (config.quality !== previousQuality) buildPostprocessing()
    applyConfig()
    layout()
  }

  /**
   * 喂滚动状态。所有字段都可选，只更新给到的部分。
   * shape.samples 换了才会重写形状贴图。
   */
  function setScroll(patch) {
    if (!patch) return
    const { shape, ...rest } = patch
    Object.assign(scrollInput, rest)
    if (shape) {
      Object.assign(scrollInput.shape, shape)
      const samples = scrollInput.shape.samples
      if (samples && samples !== scrollState.lastSamples) {
        shapeTexture.image.data.set(samples)
        shapeTexture.needsUpdate = true
        scrollState.lastSamples = samples
      }
    }
    if (patch.contentBounds !== undefined) updateTextBounds()
  }

  function replay() {
    introElapsed = 0
    flowOffset = 0
    scrollState.shapeFlowOffset = 0
    motion?.reset()
  }

  /** 不滚动也能散开：等价于把页面滚到散开完成的位置。 */
  function setDisperse(value) {
    const amount = MathUtils.clamp(value, 0, 1)
    scrollInput.progress = amount * SCATTER_END
    scrollInput.tiltProgress = null
    scrollInput.scatterProgress = null
  }

  /**
   * 主星的位置要在 JS 里重算一遍给镜头光晕用：星系位置 → 星轨 → 路径形状，
   * 和着色器走同一条链、用同一组 uniform 数值，所以光晕永远贴着那颗星。
   */
  function trackHeroes(state) {
    const u = field.material.uniforms
    const layerSpin = u.uLayerSpin.value
    const scatterSize = u.uScatterSize.value
    const scatterCenter = u.uScatterCenter.value
    const textBounds = u.uTextBounds.value
    const samples = scrollState.lastSamples
    const shapeScatter = u.uShapeScatter.value
    const step = 1 / (PATH_SAMPLE_COUNT - 1)
    const shapeStep = 1 / (SHAPE_SAMPLE_COUNT - 1)
    const coreVisibility = config.showCenterCluster ? 1 - MathUtils.smootherstep(scrollState.progress, 0.5, 1) : 0

    for (const hero of field.heroes) {
      let fade = 1
      let sizeFade = 1
      if (hero.isCore) {
        heroPosition.set(hero.position[0], hero.position[1], hero.position[2]).applyEuler(coreEuler)
      } else {
        const layer = field.layers[hero.layer]
        const phase = MathUtils.euclideanModulo(hero.seed + flowOffset * (hero.speed ?? layer.speed), 1)
        const progress = densityProgress(phase, field.options.densityFalloff)
        const param = layer.closed ? MathUtils.euclideanModulo(progress, 1) : MathUtils.clamp(progress, 0, 1)
        const before = layer.closed ? MathUtils.euclideanModulo(param - step, 1) : Math.max(param - step, 0)
        const after = layer.closed ? MathUtils.euclideanModulo(param + step, 1) : Math.min(param + step, 1)
        samplePath(layer.samples, param, heroPosition)
        samplePath(layer.samples, before, heroBefore)
        samplePath(layer.samples, after, heroAfter)
        heroTangent.subVectors(heroAfter, heroBefore).normalize()
        heroNormal.set(-heroTangent.y, heroTangent.x, 0).normalize()
        heroPosition.addScaledVector(heroNormal, hero.across)
        heroPosition.z += hero.depth
        const spinIndex = Math.min(hero.layer, MAX_SPIN_LAYERS - 1)
        euler.set(layerSpin[spinIndex].x, layerSpin[spinIndex].y, 0, 'XYZ')
        heroPosition.applyEuler(euler)
        if (!layer.closed) {
          fade = tipFade(progress)
          sizeFade = sizeFalloff(progress, config.sizeFalloff)
        }
      }

      // 星轨
      const [sx, sy, sz, clearance] = hero.scatter
      const keepInCenter = clearance >= 0.72 ? 1 : 0
      const side = sx < 0.5 ? -1 : 1
      const outerProgress = Math.sqrt(MathUtils.euclideanModulo(sx * 2, 1))
      const outerX = side * MathUtils.lerp(side < 0 ? -textBounds.x : textBounds.y, scatterSize.x * 0.5, outerProgress)
      dispersedMotion(heroDrift, elapsed, sx, sy, sz, state.scrollDrift, state.railPresence)
      heroRail.set(
        MathUtils.lerp(outerX, (sx - 0.5) * scatterSize.x, keepInCenter) + heroDrift.x + scatterCenter.x,
        MathUtils.euclideanModulo((sy - 0.5) * scatterSize.y + heroDrift.y + scatterSize.y * 0.5, scatterSize.y)
          - scatterSize.y * 0.5
          - Math.sin(state.scatterPosition * Math.PI) * (0.15 + sz * 0.25)
          + scatterCenter.y,
        (sz - 0.5) * 0.5,
      )
      heroPosition.lerp(heroRail, state.scatterPosition)
      fade = MathUtils.lerp(fade, 1, state.scatter)
      sizeFade = MathUtils.lerp(sizeFade, 1, state.scatter)

      // 路径形状
      let depthCue = 1
      let opacityCue = 1
      if (samples && (state.shapeProgress > 0 || state.shapePosition > 0)) {
        const seed = hero.shapeSeed
        const rangeIndex = Math.min(Math.floor(MathUtils.clamp(seed, 0, 0.999999) * SHAPE_SAMPLE_COUNT), SHAPE_SAMPLE_COUNT - 1)
        const rangeStart = samples[rangeIndex * 4 + 2]
        const rangeEnd = samples[rangeIndex * 4 + 3]
        const span = Math.max(rangeEnd - rangeStart, 1 / SHAPE_SAMPLE_COUNT)
        const localSeed = MathUtils.clamp((seed - rangeStart) / span, 0, 1)
        const localPhase = MathUtils.euclideanModulo(
          localSeed + (scrollState.shapeFlowOffset * Math.abs(hero.speed) * u.uShapeFlowSign.value) / span,
          1,
        )
        const localProgress = densityProgress(localPhase, field.options.densityFalloff)
        const shapeSeed = MathUtils.lerp(rangeStart, rangeEnd, localProgress)
        sampleShape(samples, shapeSeed, shapePoint)
        sampleShape(samples, Math.max(shapeSeed - shapeStep, rangeStart), shapeBefore).multiply(state.shapeSize)
        sampleShape(samples, Math.min(shapeSeed + shapeStep, rangeEnd), shapeAfter).multiply(state.shapeSize)
        const tangentX = shapeAfter.x - shapeBefore.x + 0.0001
        const tangentY = shapeAfter.y - shapeBefore.y
        const tangentLength = Math.hypot(tangentX, tangentY) || 1
        const acrossX = -tangentY / tangentLength
        const acrossY = tangentX / tangentLength
        const scatter = (hero.across * 1.1 + (sx + sy - 1) * 0.12) * shapeScatter
        const layerIndex = hero.isCore ? 0 : Math.min(hero.layer, MAX_SPIN_LAYERS - 1)
        const layerDepth = field.layers[Math.min(layerIndex, field.layerCount - 1)]?.depth ?? 0
        const contourDepth = Math.sin(localProgress * Math.PI * 1.35 + 0.82 * layerIndex) * layerDepth * Math.sin(localProgress * Math.PI)
        heroShape.set(
          shapePoint.x * state.shapeSize.x + acrossX * scatter,
          shapePoint.y * state.shapeSize.y + acrossY * scatter,
          (contourDepth + hero.depth * 0.75 + (sz - 0.5) * 0.22) * shapeScatter,
        )
        // 着色器里形状是先绕 X 再绕 Y（Ry·Rx），对应 three.js 的 'YXZ' 序；用 'XYZ' 会在两个角都非零（拖动）时和星星分叉
        euler.set(state.shapeRotation.x, state.shapeRotation.y, 0, 'YXZ')
        heroShape.applyEuler(euler)
        const frontness = MathUtils.smoothstep(heroShape.z, -1.15, 1.15)
        heroShape.x += state.shapeCenter.x
        heroShape.y += state.shapeCenter.y
        heroPosition.lerp(heroShape, state.shapePosition)
        fade = MathUtils.lerp(fade, tipFade(localProgress), state.shapeProgress)
        sizeFade = MathUtils.lerp(sizeFade, sizeFalloff(localProgress, config.sizeFalloff), state.shapeProgress)
        depthCue = MathUtils.lerp(1, MathUtils.lerp(0.78, 1.18, frontness), state.shapeProgress)
        opacityCue = MathUtils.lerp(1, MathUtils.lerp(0.72, 1, frontness), state.shapeProgress)
      }

      hero.marker.position.copy(heroPosition)
      const visibility =
        fade * sizeFade * depthCue * opacityCue
        * MathUtils.lerp(state.sizeScale, 1, state.shapeProgress)
        * state.flareVisibility
        * (hero.isCore ? coreVisibility : 1)
      hero.marker.userData.visibility = MathUtils.clamp(visibility, 0, 1)
    }
  }

  const frameState = {
    scatter: 0,
    scatterPosition: 0,
    shapeProgress: 0,
    shapePosition: 0,
    sizeScale: 1,
    flareVisibility: 1,
    railPresence: 0,
    scrollDrift: 0,
    shapeCenter: new Vector2(),
    shapeSize: new Vector2(1, 1),
    shapeRotation: scrollState.shapeRotation,
  }

  function frame(now) {
    if (disposed) return
    requestAnimationFrame(frame)
    const rawDelta = (now - lastTick) / 1000
    lastTick = now
    if (!running || !field) return
    govern(now, rawDelta)
    // 降节奏渲染：每 divisor 个刷新周期渲染一次
    governor.tick = (governor.tick + 1) % governor.divisor
    if (governor.tick !== 0) return
    const delta = Math.min((now - lastFrame) / 1000, 0.05)
    lastFrame = now

    const reduced = Boolean(config.reducedMotion)
    // 减少动态效果时时间轴整体冻结：闪烁、流动、自转一并停下，
    // 但形状、配色和 bloom 全部保留，画面依然完整。
    if (!reduced) {
      elapsed += delta
      introElapsed += delta
    }
    const introProgress = reduced
      ? 1
      : MathUtils.clamp(introElapsed / Math.max(config.introDuration, 0.2), 0, 1)

    // --- 滚动编排（原站 updateAstraAnimation 的 converge-tilt 分支）---
    const effects = config.scrollEffects && !reduced
    const snap = reduced || !scrollState.resolved
    const rawProgress = effects ? Math.max(scrollInput.progress, 0) : 0
    const clampedProgress = MathUtils.clamp(rawProgress, 0, 1)
    scrollState.progress = snap ? clampedProgress : approach(scrollState.progress, clampedProgress, 6, delta)
    const tiltTarget = effects && scrollInput.tiltProgress !== null
      ? MathUtils.clamp(scrollInput.tiltProgress, 0, 1)
      : clampedProgress
    scrollState.tilt = snap ? tiltTarget : approach(scrollState.tilt, tiltTarget, 6, delta)
    const scatterStart = reduced ? 0.5 : SCATTER_START
    const scatterEnd = reduced ? 1 : SCATTER_END
    const scatterTarget = effects && scrollInput.scatterProgress !== null
      ? MathUtils.lerp(scatterStart, scatterEnd, MathUtils.clamp(scrollInput.scatterProgress, 0, 1))
      : MathUtils.clamp(rawProgress, 0, scatterEnd)
    scrollState.scatterScroll = snap ? scatterTarget : approach(scrollState.scatterScroll, scatterTarget, 6, delta)
    const sizeProgress = MathUtils.smootherstep(scrollState.progress, 0, 0.5)
    const tiltRise = Math.sin(MathUtils.clamp(scrollState.tilt / 0.75, 0, 1) * Math.PI * 0.5)
    const tiltFall = 1 - MathUtils.smootherstep(scrollState.tilt, 0.75, 1)
    const scatter = MathUtils.smootherstep(scrollState.scatterScroll, scatterStart, scatterEnd)
    const scatterPositionTarget = MathUtils.smoothstep(MathUtils.smootherstep(scatterTarget, scatterStart, scatterEnd), 0, 1)
    scrollState.scatterPosition = snap
      ? scatterPositionTarget
      : approach(scrollState.scatterPosition, scatterPositionTarget, 4, delta)
    // 原站的 tt：入场过半后动态才逐渐"开机"，散开时再关掉
    const gate = (1 - scatter) * MathUtils.smoothstep(introProgress, 0.55, 1)
    const sizeScale = effects ? MathUtils.lerp(1, 0.45, sizeProgress) : 1
    // 星系绕 X 轴翻转：0.75 处最大，1 回平
    animationRoot.rotation.x = TILT_ANGLE * tiltRise * tiltFall

    const shapeStrength = effects ? MathUtils.clamp(scrollInput.shape.strength, 0, 1) : 0
    scrollState.shapeProgress = snap ? shapeStrength : approach(scrollState.shapeProgress, shapeStrength, 6, delta)
    const shapePositionTarget = MathUtils.smoothstep(shapeStrength, 0, 1)
    scrollState.shapePosition = snap
      ? shapePositionTarget
      : approach(scrollState.shapePosition, shapePositionTarget, 4, delta)
    const shapeProgress = scrollState.shapeProgress
    const railPresence = effects ? MathUtils.clamp(scatter * (1 - shapeProgress), 0, 1) : 0
    const scrollDrift = reduced ? 0 : rawProgress * MathUtils.clamp(config.scrollStarDriftSpeed, 0, 3)
    const intensityScale = MathUtils.lerp(1, 0.18, railPresence)
    const flareScale = MathUtils.lerp(1, 0.1, railPresence)
    const opacityTarget = MathUtils.clamp(scrollInput.starsOpacity, 0, 1)
    scrollState.starsOpacity = snap ? opacityTarget : approach(scrollState.starsOpacity, opacityTarget, 6, delta)
    scrollState.resolved = true

    // 路径形状的姿态：跟指针的旋转 + 成形时自动摆一下
    if (reduced) {
      scrollState.shapeRotation.set(0, 0)
      scrollState.shapePointer.set(0, 0)
    } else {
      const follow = MathUtils.smootherstep(shapeProgress, 0.05, 0.4)
      const ease = 1 - Math.exp(-(drag.active ? 14 : 5.5) * delta)
      scrollState.shapePointer.lerp(drag.active ? rotation : ZERO, ease)
      const amount = MathUtils.clamp(config.shapeAutoRotateAmount, 0, 1.2)
      const swingIn = MathUtils.smootherstep(shapeProgress, 0.001, 0.12)
      const settle = MathUtils.smootherstep(shapeProgress, 0.04, 0.82)
      const auto = config.shapeAutoRotate ? 1 : 0
      const yaw = MathUtils.lerp(-amount, 0, settle) * swingIn * auto
      const bump = settle > 0 && settle < 1 ? Math.sin(settle * Math.PI) : 0
      scrollState.shapeRotation.set(
        scrollState.shapePointer.x * follow - bump * amount * 0.34 * swingIn * auto,
        scrollState.shapePointer.y * follow + yaw,
      )
    }
    if (!reduced) {
      flowOffset += delta * config.flowSpeed * gate
      scrollState.shapeFlowOffset += delta * config.flowSpeed * MathUtils.smootherstep(shapeProgress, 0.08, 0.5)
    }

    // 形状的中心和尺寸：cue 元素在视口里的位置 → 世界单位 → 星场局部单位
    const { centerNdc, sizeNdc } = scrollInput.shape
    frameState.shapeCenter.set(
      ((centerNdc[0] * viewWidth) / 2 - animationRoot.position.x) / fieldScale,
      ((centerNdc[1] * viewHeight) / 2 - animationRoot.position.y) / fieldScale,
    )
    frameState.shapeSize.set(
      (Math.max(sizeNdc[0], 0.0001) * viewWidth) / 2 / fieldScale,
      (Math.max(sizeNdc[1], 0.0001) * viewHeight) / 2 / fieldScale,
    )
    frameState.scatter = scatter
    frameState.scatterPosition = scrollState.scatterPosition
    frameState.shapeProgress = shapeProgress
    frameState.shapePosition = scrollState.shapePosition
    frameState.sizeScale = sizeScale
    frameState.railPresence = railPresence
    frameState.scrollDrift = scrollDrift
    frameState.flareVisibility = MathUtils.smoothstep(introProgress, 0.35, 0.9) * flareScale

    const u = field.material.uniforms
    u.uTime.value = elapsed
    u.uIntroProgress.value = introProgress
    u.uFlowOffset.value = flowOffset
    u.uHeadProgress.value = (elapsed * config.trailSpeed) % 1
    u.uIntensity.value = MathUtils.clamp(config.intensity * intensityScale, 0.1, 3) * scrollState.starsOpacity
    u.uScrollScatter.value = scatter
    u.uScrollPositionProgress.value = scrollState.scatterPosition
    u.uScrollSizeScale.value = sizeScale
    u.uScrollDrift.value = scrollDrift
    u.uDispersedMotion.value = railPresence
    u.uShapeProgress.value = shapeProgress
    u.uShapePositionProgress.value = scrollState.shapePosition
    u.uShapeRotation.value.copy(scrollState.shapeRotation)
    u.uShapeCenter.value.copy(frameState.shapeCenter)
    u.uShapeSize.value.copy(frameState.shapeSize)
    u.uShapeFlowOffset.value = scrollState.shapeFlowOffset

    // 拖拽时跟手（14），松手后慢慢回正（5.5）；每条星臂各带一点滞后。
    const target = drag.active && !reduced ? rotation : ZERO
    const rate = drag.active ? 14 : 5.5
    spin.lerp(target, 1 - Math.exp(-rate * delta))
    const layerSpin = u.uLayerSpin.value
    for (let i = 0; i < MAX_SPIN_LAYERS; i += 1) {
      const lag = 0.18 + 0.17 * i
      const layerRate = rate / (1 + lag * config.rotationLag * 2.5)
      layerSpins[i].lerp(target, 1 - Math.exp(-layerRate * delta))
      layerSpin[i].set((layerSpins[i].x - spin.x) * gate, (layerSpins[i].y - spin.y) * gate)
    }
    const autoTilt = config.autoRotate && !reduced
      ? Math.sin(elapsed * config.autoRotateSpeed) * config.autoRotateAmount
      : 0
    spinRoot.rotation.set(spin.x * gate, spin.y * gate + autoTilt, 0)

    // 星系核自转（原站 0.36 × flowSpeed rad/s）+ 轻微摆动。
    if (config.coreSpin && !reduced) {
      const direction = field.options.flowInward ? 1 : -1
      coreTarget = wrapAngle(coreTarget + delta * 0.36 * config.flowSpeed * direction)
      const difference = Math.atan2(Math.sin(coreTarget - coreRotation), Math.cos(coreTarget - coreRotation))
      coreRotation = wrapAngle(coreRotation + difference * (1 - Math.exp(-14 * delta)))
    }
    u.uCoreRotation.value.set(
      reduced ? 0 : 0.08 * Math.sin(0.22 * elapsed) * gate,
      reduced ? 0 : 0.14 * Math.cos(0.28 * elapsed) * gate,
      coreRotation * gate,
    )
    coreEuler.set(u.uCoreRotation.value.x, u.uCoreRotation.value.y, u.uCoreRotation.value.z, 'XYZ')
    trackHeroes(frameState)

    if (config.lensMode && !reduced) {
      u.uLensActive.value = MathUtils.damp(u.uLensActive.value, pointer.active ? 1 : 0, 8, delta)
      lensTarget.set(pointer.x, pointer.y)
      u.uLensPointer.value.lerp(lensTarget, 1 - Math.exp(-6 * delta))
    } else {
      u.uLensActive.value = 0
    }

    if (motion && config.pointerRepel && !reduced) {
      motion.feed(pointer, delta)
      motion.update(renderer, camera, delta)
    }

    // 光晕跟着被推开的主星走：把状态贴图和主星的 texel 坐标交给光晕着色器
    const motionActive = motion && config.pointerRepel && !reduced
    flare.setParticleMotion(
      motionActive ? u.uParticleMotionTexture.value : null,
      u.uParticleMotionAge.value,
      field.coreMotionUv,
      field.secondaryMotionUvs,
    )
    // 每颗主星此刻的可见度已经算进 marker.userData.visibility 里了
    flare.updateSources(field.coreSource, field.secondarySources, camera, 1)
    // 氛围强度允许页面每帧直接改 config（滚动页会随进度退掉它）
    ambient.setOpacity(config.ambientOpacity)

    composer.render(delta)
  }
  requestAnimationFrame(frame)

  // --- 输入 ---
  const toNdc = (event) => {
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return {
      x: MathUtils.clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1),
      y: MathUtils.clamp(-(((event.clientY - rect.top) / rect.height) * 2 - 1), -1, 1),
    }
  }

  const onPointerMove = (event) => {
    const ndc = toNdc(event)
    if (!ndc) return
    pointer.x = ndc.x
    pointer.y = ndc.y
    pointer.active = true
    pointer.reset = false
    if (drag.active) {
      rotation.y = MathUtils.clamp(rotation.y + (event.clientX - drag.lastX) * 0.006, -1.4, 1.4)
      rotation.x = MathUtils.clamp(rotation.x + (event.clientY - drag.lastY) * 0.006, -1.4, 1.4)
      drag.lastX = event.clientX
      drag.lastY = event.clientY
    }
  }
  const onPointerLeave = () => {
    pointer.active = false
    pointer.pressed = false
    pointer.reset = true
  }
  const onPointerDown = (event) => {
    drag.active = true
    drag.lastX = event.clientX
    drag.lastY = event.clientY
    // 从当前实际角度接着转，回正途中再次按下不会跳一下
    rotation.copy(spin)
    pointer.pressed = true
    canvas.setPointerCapture?.(event.pointerId)
  }
  const onPointerUp = (event) => {
    drag.active = false
    pointer.pressed = false
    canvas.releasePointerCapture?.(event.pointerId)
  }
  const onVisibility = () => {
    running = document.visibilityState === 'visible'
    if (running) lastFrame = performance.now()
  }

  canvas.addEventListener('pointermove', onPointerMove, { passive: true })
  canvas.addEventListener('pointerleave', onPointerLeave, { passive: true })
  canvas.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointerup', onPointerUp)
  document.addEventListener('visibilitychange', onVisibility)
  const observer = new ResizeObserver(() => layout())
  observer.observe(canvas)
  layout()

  return {
    config,
    setSource,
    setConfig,
    setScroll,
    replay,
    setDisperse,
    /** 调试用：直接摸到渲染管线的各个部件。 */
    debug: {
      renderer, composer, bloom, flare,
      get effectPass() { return effectPass },
      get field() { return field },
      get motion() { return motion },
      get pixelBudget() { return pixelBudget },
      get divisor() { return governor.divisor },
      get halfRate() { return governor.divisor > 1 },
      get scrollState() { return scrollState },
    },
    get stats() {
      return field ? { count: field.count, layers: field.layerCount, contours: field.layerCount } : null
    },
    dispose() {
      disposed = true
      observer.disconnect()
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerleave', onPointerLeave)
      canvas.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointerup', onPointerUp)
      document.removeEventListener('visibilitychange', onVisibility)
      releaseField()
      shapeTexture.dispose()
      composer.dispose()
      renderer.dispose()
    },
  }
}
