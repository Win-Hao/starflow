/**
 * GLSL。标了「原站」的片段是从 OpenAI Astra 的 chunk 861045 / 384051 / 83007
 * 里逐字取出的核心算法，其余是为「任意形状」这个需求重写的。
 */

export const PARTICLE_MOTION_SETTLE_SECONDS = 6
/** 每层各自带一点旋转滞后，最多给这么多层单独的滞后量（更多的层共用最后一档）。 */
export const MAX_SPIN_LAYERS = 8
/** 镜头光晕追踪的主星上限（5 层各一颗 + 星系核）。 */
export const MAX_HEROES = 8
/** 形状贴图的采样点数（原站同款）。 */
export const SHAPE_SAMPLE_COUNT = 1024

/**
 * 原站：亚像素点精灵的解析覆盖率。
 * 三次 B 样条核 × 真实直径的平方，代表这个点在当前像素上"洒了多少能量"。
 * 没有它，0.5px 的远星在移动时会剧烈闪烁——这是全套里最关键的抗锯齿技巧。
 */
const FILTERED_CORE = /* glsl */ `
  varying float vParticleDiameter;

  float astraCubicCoverage(float coordinate) {
    float x = abs(coordinate);
    if (x < 1.0) return (4.0 - 6.0 * x * x + 3.0 * x * x * x) / 6.0;
    float tail = max(2.0 - x, 0.0);
    return tail * tail * tail / 6.0;
  }

  float astraFilteredCore(vec2 pixel, float area) {
    return astraCubicCoverage(pixel.x) * astraCubicCoverage(pixel.y)
      * area * vParticleDiameter * vParticleDiameter;
  }
`

/**
 * 原站：入场汇聚。星星先在散乱位置绕一个随种子而异的角度公转，
 * 再被 smootherstep 拉回目标位置。每颗星起跑时间和时长都不同，
 * 所以形状是"渐渐凝聚"而不是整体平移。
 */
const INTRO_MOTION = /* glsl */ `
  vec3 astraIntroMotion(
    vec3 position, vec3 scattered, float progress,
    float seed, float travelSeed
  ) {
    if (progress >= 1.0) return position;
    float start = 0.14 + seed * 0.18;
    float duration = 0.58 + travelSeed * 0.1;
    float local = clamp((progress - start) / duration, 0.0, 1.0);
    float smoothPull = local * local * local * (local * (local * 6.0 - 15.0) + 10.0);
    float pull = mix(smoothPull, sin(smoothPull * 3.14159265359 * 0.5), 0.5);
    float angle = sin(pull * 3.14159265359) * (0.44 + seed * 0.22);
    float c = cos(angle);
    float s = sin(angle);
    vec3 orbiting = vec3(
      scattered.x * c - scattered.y * s,
      scattered.x * s + scattered.y * c,
      scattered.z
    );
    return mix(orbiting, position, pull);
  }
`

/** 原站：入场时先让散乱星场自己浮现，再开始拉扯。 */
const REVEAL_PROGRESS = /* glsl */ `
  float astraParticleRevealProgress(float progress, float seed) {
    float delay = seed * 0.015;
    return smoothstep(delay, 0.14 + delay, progress)
      * mix(0.2, 1.0, smoothstep(0.2, 1.0, progress));
  }
`

/**
 * 原站：散开到两侧星轨后的环境漂移 + 随滚动的视差。
 * 只作用在星轨位置上，星系成形时 strength = 0。
 */
const DISPERSED_MOTION = /* glsl */ `
  vec2 astraDispersedMotion(
    float time, float sx, float sy, float sz, float scrollDrift, float strength
  ) {
    float depth = clamp(sz, 0.0, 1.0);
    float motion = clamp(strength, 0.0, 1.0);
    float speed = mix(0.4, 0.8, depth);
    float amount = mix(0.035, 0.12, depth) * motion;
    float phaseX = sx * 6.28318530718 + sy * 2.7;
    float phaseY = sy * 6.28318530718 + sz * 3.1;
    float parallax = scrollDrift * mix(0.08, 0.28, depth * depth) * motion;
    return vec2(
      (sin(phaseX + time * speed) - sin(phaseX)) * amount,
      (cos(phaseY + time * speed * 0.73) - cos(phaseY)) * amount + parallax
    );
  }
`

/** three 的 Euler 'XYZ'：先转 Z，再 Y，最后 X。星系核自转和分层滞后都用它。 */
const ROTATE = /* glsl */ `
  vec3 astraRotate(vec3 p, vec3 e) {
    float cz = cos(e.z);
    float sz = sin(e.z);
    p = vec3(p.x * cz - p.y * sz, p.x * sz + p.y * cz, p.z);
    float cy = cos(e.y);
    float sy = sin(e.y);
    p = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
    float cx = cos(e.x);
    float sx = sin(e.x);
    return vec3(p.x, p.y * cx - p.z * sx, p.y * sx + p.z * cx);
  }
`

/**
 * 原站：指针推斥的解析外推。
 * state = (偏移xy, 速度xy)。位置按 e^-age 回归原位，速度按 e^-drag*age 衰减，
 * 两者的耦合项有闭式解——所以松开鼠标后完全不需要再跑一帧模拟，
 * 顶点着色器自己就能算出 6 秒内任意时刻的位置。
 */
const COAST = /* glsl */ `
  vec4 astraCoast(vec4 state, float mass, float age) {
    float drag = 2.3 / sqrt(mass);
    float velocityDecay = exp(-drag * age);
    float returnDecay = exp(-age);
    state.xy = state.xy * returnDecay
      + state.zw * (returnDecay - velocityDecay) / (drag - 1.0);
    state.zw *= velocityDecay;
    return state;
  }
`

/**
 * 原站：模拟 pass 复用同一份 vertex shader，只靠 ASTRA_PARTICLE_SIMULATION
 * 这个 define 把裁剪坐标改写成"该粒子在状态贴图里的那一个 texel"。
 * 渲染和物理共享一份代码，位置计算永远不会对不上。
 */
const PARTICLE_MOTION = /* glsl */ `
  attribute vec3 particleMotionUv;
  uniform sampler2D uParticleMotionTexture;
  uniform float uParticleMotionEnabled;
  uniform float uParticleMotionAge;
  uniform vec2 uParticleMotionPointer;
  uniform vec2 uParticleMotionPrevious;
  uniform vec2 uParticleMotionImpulse;
  uniform float uPointerRepelRadius;
  varying vec4 vParticleMotionState;

  ${COAST}

  void astraParticleMotion(inout vec4 clipPosition) {
    if (uParticleMotionEnabled < 0.5
      || uParticleMotionAge >= ${PARTICLE_MOTION_SETTLE_SECONDS}.0) return;
    float mass = particleMotionUv.z;
    vec4 state = astraCoast(
      texture2D(uParticleMotionTexture, particleMotionUv.xy),
      mass,
      uParticleMotionAge
    );
    #ifdef ASTRA_PARTICLE_SIMULATION
      float aspect = max(uViewportAspect, 0.0001);
      vec2 scale = vec2(aspect, 1.0);
      vec2 current = (clipPosition.xy / clipPosition.w + state.xy) * scale;
      vec2 start = uParticleMotionPrevious * scale;
      vec2 segment = (uParticleMotionPointer - uParticleMotionPrevious) * scale;
      // 冲量作用在指针"扫过的线段"上，而不是一个点——快速划过才不会漏掉粒子。
      float t = clamp(
        dot(current - start, segment) / max(dot(segment, segment), 0.000001),
        0.0, 1.0
      );
      float radius = max(uPointerRepelRadius * 0.5, 0.025);
      float weight = pow(
        1.0 - smoothstep(0.0, radius, length(current - start - segment * t)),
        2.0
      );
      vec2 impulse = uParticleMotionImpulse * scale;
      impulse *= min(1.0, 0.18 / max(length(impulse), 0.00001));
      state.zw += impulse / scale * weight * 5.4 / mass;
      float speed = length(state.zw * scale);
      state.zw *= min(1.0, 0.5 / max(speed, 0.00001));
      vParticleMotionState = state;
      gl_PointSize = 1.0;
      clipPosition = vec4(particleMotionUv.xy * 2.0 - 1.0, 0.0, 1.0);
    #else
      clipPosition.xy += state.xy * clipPosition.w;
    #endif
  }
`

/**
 * 顶点着色器。属性打包成 11 个（WebGL 上限 16）：
 *   starFlags = (主星槽位 + 1, 填充星, 背景星, 星系核)
 *   starPath  = (路径层下标, 流速, 是否开放曲线)
 *   starOffsets = (法向偏移, 深度偏移)   starTwinkle = (相位, 速率)
 *
 * 位置的合成顺序和原站一致：
 *   路径位置（流动 / 端点渐隐）→ 星系核自转 / 分层滞后
 *   → 按滚动混到两侧星轨（uScrollPositionProgress）
 *   → 按 cue 混到路径形状（uShapePositionProgress）
 *   → 入场汇聚
 * 主星的随机量由 JS 以 uniform 下发（uHeroScatter / uHeroShapeSeed），
 * 这样 JS 能算出和 GPU 完全一致的位置来放镜头光晕。
 */
export const STAR_VERTEX_SHADER = /* glsl */ `
  attribute float orbitProgress;
  attribute vec2  starOffsets;
  attribute float starBrightness;
  attribute vec3  starColor;
  attribute float starOpacity;
  attribute float starScale;
  attribute vec4  starFlags;
  attribute vec3  starPath;
  attribute vec2  starTwinkle;

  uniform mat4  uBackgroundModelMatrix;
  uniform vec3  uCoreRotation;
  uniform float uDensityFalloff;
  uniform float uDimSizeScale;
  uniform float uDispersedMotion;
  uniform float uFlowOffset;
  uniform float uHeadProgress;
  uniform vec4  uHeroScatter[${MAX_HEROES}];
  uniform float uHeroShapeSeed[${MAX_HEROES}];
  uniform float uIntensity;
  uniform float uIntroProgress;
  uniform vec2  uLayerSpin[${MAX_SPIN_LAYERS}];
  uniform float uPathLayerCount;
  uniform float uPathMotion;
  uniform float uPathSampleCount;
  uniform sampler2D uPathTexture;
  uniform float uPixelRatio;
  uniform vec2  uScatterCenter;
  uniform vec2  uScatterSize;
  uniform float uScrollDrift;
  uniform float uScrollPositionProgress;
  uniform float uScrollScatter;
  uniform float uScrollSizeScale;
  uniform float uShapeBrightRetention;
  uniform vec2  uShapeCenter;
  uniform float uShapeFlowOffset;
  uniform float uShapeFlowSign;
  uniform float uShapeLayerDepth[${MAX_SPIN_LAYERS}];
  uniform float uShapePositionProgress;
  uniform float uShapeProgress;
  uniform vec2  uShapeRotation;
  uniform float uShapeSampleCount;
  uniform float uShapeScatter;
  uniform vec2  uShapeSize;
  uniform sampler2D uShapeTexture;
  uniform float uSizeFalloff;
  uniform float uSizeScale;
  uniform vec2  uTextBounds;
  uniform float uTime;
  uniform float uTrailBrightness;
  uniform float uTrailEnabled;
  uniform float uTrailLength;
  uniform float uTwinkleSpeed;
  uniform float uViewportAspect;

  uniform float uLensActive;
  uniform float uLensDepth;
  uniform float uLensIllumination;
  uniform float uLensMagnification;
  uniform vec2  uLensPointer;
  uniform float uLensRadius;

  varying float vBrightness;
  varying vec3  vColor;
  varying float vLens;
  varying float vOpacity;
  varying float vParticleDiameter;
  varying float vRayStrength;

  ${PARTICLE_MOTION}
  ${REVEAL_PROGRESS}
  ${DISPERSED_MOTION}
  ${INTRO_MOTION}
  ${ROTATE}

  const float ASTRA_PI = 3.14159265359;
  const float ASTRA_TAU = 6.28318530718;

  float astraHash(vec2 p, vec2 k) {
    return fract(sin(dot(p, k)) * 43758.5453);
  }

  // 路径贴图：每行一条曲线，512 个等弧长采样点（xyz）。
  vec3 astraSamplePath(float layer, float progress) {
    float scaled = clamp(progress, 0.0, 1.0) * (uPathSampleCount - 1.0);
    float lower = floor(scaled);
    float upper = min(lower + 1.0, uPathSampleCount - 1.0);
    float v = (layer + 0.5) / max(uPathLayerCount, 1.0);
    vec3 a = texture2D(uPathTexture, vec2((lower + 0.5) / uPathSampleCount, v)).xyz;
    vec3 b = texture2D(uPathTexture, vec2((upper + 0.5) / uPathSampleCount, v)).xyz;
    return mix(a, b, fract(scaled));
  }

  // 形状贴图：1024 个按总长等距的采样点，xy 是相对 viewBox 的归一坐标，zw 是所在子路径的范围。
  vec4 astraSampleShape(float progress) {
    float scaled = clamp(progress, 0.0, 1.0) * (uShapeSampleCount - 1.0);
    float lower = floor(scaled);
    float upper = min(lower + 1.0, uShapeSampleCount - 1.0);
    vec4 a = texture2D(uShapeTexture, vec2((lower + 0.5) / uShapeSampleCount, 0.5));
    vec4 b = texture2D(uShapeTexture, vec2((upper + 0.5) / uShapeSampleCount, 0.5));
    return mix(a, b, fract(scaled));
  }

  vec2 astraSampleShapeRange(float progress) {
    float index = min(floor(clamp(progress, 0.0, 0.999999) * uShapeSampleCount), uShapeSampleCount - 1.0);
    return texture2D(uShapeTexture, vec2((index + 0.5) / uShapeSampleCount, 0.5)).zw;
  }

  void main() {
    int heroSlot = int(starFlags.x + 0.5) - 1;
    float isHero = step(0.5, starFlags.x);
    float isFill = starFlags.y;
    float isBackground = starFlags.z;
    float isCore = starFlags.w;
    float open = starPath.z;
    float ridesPath = uPathMotion * (1.0 - isFill) * (1.0 - isCore);
    int layerIndex = int(clamp(starPath.x, 0.0, float(${MAX_SPIN_LAYERS - 1})));

    float twinkle = 0.86 + 0.14 * sin(
      starTwinkle.x + uTime * uTwinkleSpeed * starTwinkle.y
    );

    // 原站：沿路径流动 + 疏密调制。orbitProgress 是均匀种子，
    // densityFalloff 把它沿弧长挤一挤，端点稀、中段密。
    float pathPhase = fract(orbitProgress + uFlowOffset * starPath.y);
    float progress = pathPhase + uDensityFalloff * sin(pathPhase * ASTRA_TAU) / ASTRA_TAU;
    float pathParam = open > 0.5 ? clamp(progress, 0.0, 1.0) : fract(progress);

    // 开放曲线：两端的星更小（sizeFalloff）并渐隐（tip fade）。
    // 背景星虽然不在路径上，原站也让它们吃同一套包络，所以这里不排除它们。
    float envelopeWeight = ridesPath * open;
    float middle = sin(clamp(progress, 0.0, 1.0) * ASTRA_PI);
    float sizeEnvelope = mix(
      1.0,
      0.14 + 0.86 * pow(max(middle, 0.0), 0.68),
      uSizeFalloff * envelopeWeight
    );
    float endpointVisibility = mix(
      1.0,
      smoothstep(0.0, 0.055, progress) * (1.0 - smoothstep(0.945, 1.0, progress)),
      envelopeWeight
    );

    vec3 animatedPosition = position;
    if (ridesPath * (1.0 - isBackground) > 0.5) {
      float step = 1.0 / max(uPathSampleCount - 1.0, 1.0);
      float before = open > 0.5 ? max(pathParam - step, 0.0) : fract(pathParam - step);
      float after = open > 0.5 ? min(pathParam + step, 1.0) : fract(pathParam + step);
      vec3 pathPosition = astraSamplePath(starPath.x, pathParam);
      vec3 tangent = normalize(
        astraSamplePath(starPath.x, after) - astraSamplePath(starPath.x, before)
      );
      vec3 across = normalize(vec3(-tangent.y, tangent.x, 0.0));
      animatedPosition = pathPosition
        + across * starOffsets.x
        + vec3(0.0, 0.0, starOffsets.y);
    }

    // 星系核自转 + 轻微摆动；每条星臂对拖拽有各自的滞后量。
    if (isCore > 0.5) {
      animatedPosition = astraRotate(animatedPosition, uCoreRotation);
    } else if (isBackground < 0.5) {
      vec2 spin = uLayerSpin[layerIndex];
      animatedPosition = astraRotate(animatedPosition, vec3(spin.x, spin.y, 0.0));
    }

    // 沿轮廓游走的光带（复刻版扩展，默认关闭）。
    float distanceBehind = uHeadProgress - pathPhase;
    if (distanceBehind < 0.0) distanceBehind += 1.0;
    float trail = 1.0 - smoothstep(0.0, max(uTrailLength, 0.0001), distanceBehind);
    trail *= trail * uTrailEnabled * ridesPath;

    // 几个互不相关的哈希，给每颗星稳定的"散开时该去哪 / 在形状上落在哪"。
    // 主星用 JS 下发的同一组值，光晕才能追得上。
    float scatterX = astraHash(vec2(orbitProgress, starTwinkle.x), vec2(127.1, 311.7));
    float scatterY = astraHash(vec2(starTwinkle.x, starScale), vec2(269.5, 183.3));
    float scatterZ = astraHash(vec2(orbitProgress, starBrightness), vec2(419.2, 371.9));
    float clearanceSeed = astraHash(vec2(starOpacity, starTwinkle.y), vec2(157.3, 283.9));
    float shapeBaseSeed = fract(
      orbitProgress * 0.754877666 + starTwinkle.x * 0.159154943 + starScale * 0.117
    );
    if (heroSlot >= 0) {
      vec4 tracked = uHeroScatter[heroSlot];
      scatterX = tracked.x;
      scatterY = tracked.y;
      scatterZ = tracked.z;
      clearanceSeed = tracked.w;
      shapeBaseSeed = uHeroShapeSeed[heroSlot];
    }

    // 入场时铺满视口的散布位置
    vec3 introScattered = vec3(
      (scatterX - 0.5) * uScatterSize.x,
      (scatterY - 0.5) * uScatterSize.y,
      (scatterZ - 0.5) * 0.5
    );
    introScattered.xy += uScatterCenter;

    // 原站：滚动时散到两侧星轨。72% 的星被推到文案栏外侧，
    // 内缘用 sqrt 稀释，星轨看起来是松散的星场而不是一堵墙。
    float keepInCenter = step(0.72, clearanceSeed);
    float scatterSide = scatterX < 0.5 ? -1.0 : 1.0;
    float outerProgress = sqrt(fract(scatterX * 2.0));
    float outerX = scatterSide * mix(
      scatterSide < 0.0 ? -uTextBounds.x : uTextBounds.y,
      uScatterSize.x * 0.5,
      outerProgress
    );
    vec3 railPosition = vec3(
      mix(outerX, (scatterX - 0.5) * uScatterSize.x, keepInCenter),
      (scatterY - 0.5) * uScatterSize.y,
      (scatterZ - 0.5) * 0.5
    );
    vec2 dispersedOffset = astraDispersedMotion(
      uTime, scatterX, scatterY, scatterZ, uScrollDrift, uDispersedMotion
    );
    railPosition.x += dispersedOffset.x;
    railPosition.y = mod(
      railPosition.y + dispersedOffset.y + uScatterSize.y * 0.5,
      uScatterSize.y
    ) - uScatterSize.y * 0.5;
    railPosition.y -= sin(uScrollPositionProgress * ASTRA_PI) * (0.15 + scatterZ * 0.25);
    railPosition.xy += uScatterCenter;

    // 背景星平时留在天上；滚动散开时所有星一起去星轨。
    animatedPosition = mix(animatedPosition, introScattered, isBackground);
    animatedPosition = mix(animatedPosition, railPosition, uScrollPositionProgress);
    endpointVisibility = mix(endpointVisibility, 1.0, uScrollScatter);
    sizeEnvelope = mix(sizeEnvelope, 1.0, uScrollScatter);

    // 原站的路径形状（光标 / OpenAI 结）：按种子落到某条子路径上，
    // 带着自己在星系里的横向偏移，沿子路径流动，两端渐隐。
    float shapeProgress = uShapeProgress * (1.0 - isBackground);
    float shapePositionProgress = uShapePositionProgress * (1.0 - isBackground);
    float shapeDepthCue = 1.0;
    float shapeOpacityCue = 1.0;
    float shapeBrightKeep = 1.0;
    if (shapeProgress > 0.0 || shapePositionProgress > 0.0) {
      vec2 range = astraSampleShapeRange(shapeBaseSeed);
      float span = max(range.y - range.x, 1.0 / uShapeSampleCount);
      float localSeed = clamp((shapeBaseSeed - range.x) / span, 0.0, 1.0);
      float localPhase = fract(localSeed + uShapeFlowOffset * abs(starPath.y) * uShapeFlowSign / span);
      float localProgress = localPhase + uDensityFalloff * sin(localPhase * ASTRA_TAU) / ASTRA_TAU;
      float shapeSeed = mix(range.x, range.y, localProgress);
      float shapeStep = 1.0 / max(uShapeSampleCount - 1.0, 1.0);
      vec2 shapePoint = astraSampleShape(shapeSeed).xy;
      vec2 shapeBefore = astraSampleShape(max(shapeSeed - shapeStep, range.x)).xy * uShapeSize;
      vec2 shapeAfter = astraSampleShape(min(shapeSeed + shapeStep, range.y)).xy * uShapeSize;
      vec2 shapeTangent = normalize(shapeAfter - shapeBefore + vec2(0.0001, 0.0));
      vec2 shapeAcross = vec2(-shapeTangent.y, shapeTangent.x);
      float shapeScatter = (starOffsets.x * 1.1 + (scatterX + scatterY - 1.0) * 0.12) * uShapeScatter;
      float depthEnvelope = sin(localProgress * ASTRA_PI);
      float contourDepth = sin(localProgress * ASTRA_PI * 1.35 + 0.82 * starPath.x)
        * uShapeLayerDepth[layerIndex] * depthEnvelope;
      vec3 shapeOffset = vec3(
        shapePoint * uShapeSize + shapeAcross * shapeScatter,
        contourDepth + starOffsets.y * 0.75 + (scatterZ - 0.5) * 0.22
      );
      shapeOffset.z *= uShapeScatter;
      float cx = cos(uShapeRotation.x);
      float sx = sin(uShapeRotation.x);
      shapeOffset = vec3(
        shapeOffset.x,
        shapeOffset.y * cx - shapeOffset.z * sx,
        shapeOffset.y * sx + shapeOffset.z * cx
      );
      float cy = cos(uShapeRotation.y);
      float sy = sin(uShapeRotation.y);
      shapeOffset = vec3(
        shapeOffset.x * cy + shapeOffset.z * sy,
        shapeOffset.y,
        -shapeOffset.x * sy + shapeOffset.z * cy
      );
      vec3 shapePosition = vec3(uShapeCenter, 0.0) + shapeOffset;
      float frontness = smoothstep(-1.15, 1.15, shapeOffset.z);
      shapeDepthCue = mix(0.78, 1.18, frontness);
      shapeOpacityCue = mix(0.72, 1.0, frontness);
      float shapeMiddle = sin(clamp(localProgress, 0.0, 1.0) * ASTRA_PI);
      float shapeSizeEnvelope = mix(1.0, 0.14 + 0.86 * pow(max(shapeMiddle, 0.0), 0.68), uSizeFalloff);
      float shapeEndpointVisibility = smoothstep(0.0, 0.055, localProgress)
        * (1.0 - smoothstep(0.945, 1.0, localProgress));
      float brightSeed = astraHash(vec2(orbitProgress, starTwinkle.x), vec2(193.7, 417.2));
      shapeBrightKeep = max(isHero, step(1.0 - uShapeBrightRetention, brightSeed));
      animatedPosition = mix(animatedPosition, shapePosition, shapePositionProgress);
      endpointVisibility = mix(endpointVisibility, shapeEndpointVisibility, shapeProgress);
      sizeEnvelope = mix(sizeEnvelope, shapeSizeEnvelope, shapeProgress);
    }

    // 滚动和 cue 只是换了目的地，入场的拉扯照常进行。
    animatedPosition = astraIntroMotion(
      animatedPosition, introScattered, mix(uIntroProgress, 1.0, isBackground), scatterZ, scatterY
    );

    float brightStarWeight = smoothstep(1.35, 1.65, starBrightness);
    float suppressedBright = shapeProgress * brightStarWeight * (1.0 - shapeBrightKeep);
    vBrightness = uIntensity * starBrightness * twinkle
      * (1.0 + trail * uTrailBrightness)
      * mix(1.0, shapeDepthCue, shapeProgress)
      * mix(1.0, 0.42, suppressedBright);
    vColor = starColor;

    // 原站：背景星的浮现进度封顶在 0.2，于是它们永远只有 sqrt(0.2)≈45% 的尺寸；
    // 散开成星轨时它们才和别的星一样大。
    float introLocalProgress = astraParticleRevealProgress(uIntroProgress, scatterZ);
    float backgroundPresence = isBackground * max(1.0 - uScrollScatter, uShapeProgress);
    introLocalProgress = mix(introLocalProgress, min(introLocalProgress, 0.2), backgroundPresence);
    float introScale = sqrt(introLocalProgress);

    vOpacity = starOpacity
      * endpointVisibility
      * (0.92 + twinkle * 0.08)
      * mix(1.0, shapeOpacityCue, shapeProgress)
      * smoothstep(0.0, 0.2, introLocalProgress);
    // 填充星尘不出十字星芒，星芒是留给少数亮星的特征。
    vRayStrength = smoothstep(1.45, 2.8, starBrightness * (1.0 + trail * uTrailBrightness))
      * (1.0 - isFill)
      * mix(1.0, shapeBrightKeep, shapeProgress);

    // 原站：滚动后暗星缩到 45%，形状里被保留的亮星回到原大。
    float scrollSizeScale = mix(uScrollSizeScale, 1.0, shapeProgress * brightStarWeight * shapeBrightKeep);
    scrollSizeScale = mix(scrollSizeScale, 1.0, backgroundPresence);

    gl_PointSize = uPixelRatio * uSizeScale
      * (0.35 + starScale * sizeEnvelope * endpointVisibility * 3.8)
      * (0.97 + twinkle * 0.03)
      * (1.0 + trail * 0.45)
      * scrollSizeScale
      * mix(1.0, shapeDepthCue, shapeProgress)
      * introScale;
    // 独立路径形状预设用：暗星缩小、亮星保持原大
    gl_PointSize *= mix(uDimSizeScale, 1.0, brightStarWeight);

    // 背景星挂在未旋转的根节点下：拖拽旋转星系时，天空不跟着转。
    vec4 worldPosition = isBackground > 0.5
      ? uBackgroundModelMatrix * vec4(animatedPosition, 1.0)
      : modelMatrix * vec4(animatedPosition, 1.0);
    vec4 viewPosition = viewMatrix * worldPosition;
    vec4 clipPosition = projectionMatrix * viewPosition;
    vec2 ndc = clipPosition.xy / max(clipPosition.w, 0.0001);

    vLens = 0.0;
    if (uLensActive > 0.0) {
      float lensDistance = length((ndc - uLensPointer) * vec2(uViewportAspect, 1.0));
      vLens = (1.0 - smoothstep(0.0, uLensRadius, lensDistance)) * uLensActive;
      viewPosition.z += vLens * uLensDepth;
      clipPosition = projectionMatrix * viewPosition;
      clipPosition.xy = uLensPointer * clipPosition.w
        + (clipPosition.xy - uLensPointer * clipPosition.w)
        * (1.0 + vLens * uLensMagnification);
    }
    vBrightness *= 1.0 + vLens * uLensIllumination;
    gl_PointSize *= 1.0 + vLens * uLensMagnification * 0.7;

    // 真实直径存进 varying，实际画在至少 4px 的 quad 里，
    // 让亚像素的星也有足够的采样面积做解析覆盖。
    vParticleDiameter = gl_PointSize;
    gl_PointSize = max(gl_PointSize, 4.0);

    astraParticleMotion(clipPosition);
    gl_Position = clipPosition;
  }
`

/** 原站片元着色器，逐字保留：无贴图，圆盘 + 十字衍射 + 亚像素解析覆盖。 */
export const STAR_FRAGMENT_SHADER = /* glsl */ `
  varying float vBrightness;
  varying vec3  vColor;
  varying float vLens;
  varying float vOpacity;
  varying float vRayStrength;
  ${FILTERED_CORE}

  void main() {
    vec2 pixel = (gl_PointCoord - vec2(0.5)) * max(vParticleDiameter, 4.0);
    vec2 point = pixel * 2.0 / max(vParticleDiameter, 0.0001);
    float distanceToCenter = length(point);
    float disc = 1.0 - smoothstep(0.08, 1.0, distanceToCenter);
    float core = pow(disc, 2.2);
    float horizontalRay = exp(-abs(point.y) * 28.0)
      * (1.0 - smoothstep(0.18, 1.0, abs(point.x)));
    float verticalRay = exp(-abs(point.x) * 28.0)
      * (1.0 - smoothstep(0.18, 1.0, abs(point.y)));
    float rays = max(horizontalRay, verticalRay) * 0.28 * vRayStrength;
    // 直径小于 2px 走解析覆盖，大于 4px 走圆盘，中间平滑过渡。
    float resolved = smoothstep(2.0, 4.0, vParticleDiameter);
    float alpha = mix(astraFilteredCore(pixel, 0.150904), max(core, rays), resolved)
      * vOpacity;

    if (alpha <= 0.0) discard;

    float whiteCore = mix(0.59228, core, resolved)
      * smoothstep(0.9, 2.8, vBrightness) * 0.82;
    float colorEnergy = 1.0 - min(vColor.r, min(vColor.g, vColor.b));
    vec3 emission = mix(vColor, vec3(1.0), whiteCore)
      * vBrightness
      * (1.0 + colorEnergy * 0.42);
    gl_FragColor = vec4(emission, alpha);
  }
`

/** 模拟 pass：只把顶点算出来的新状态原样写进状态贴图。 */
export const SIMULATION_FRAGMENT_SHADER = /* glsl */ `
  varying vec4 vParticleMotionState;
  void main() { gl_FragColor = vParticleMotionState; }
`
