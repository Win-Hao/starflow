import { BlendFunction, Effect } from 'postprocessing'
import { MathUtils, Uniform, Vector2, Vector3 } from 'three'
import { PARTICLE_MOTION_SETTLE_SECONDS } from './shaders.js'

const MAX_SECONDARY = 5

/**
 * 原站：指针推斥的解析外推（与 shaders.js 里那份完全相同）。
 * 光晕跟着星星走的关键——星星被推开的位移只存在 GPU 状态贴图里，JS 读不到，
 * 所以光晕着色器自己去贴图里取那颗主星的 texel，用同一个公式外推。
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

/** 全屏三角形只有 3 个顶点，在这里采样状态贴图比逐像素采样便宜得多。 */
const VERTEX_SHADER = /* glsl */ `
  uniform sampler2D uParticleMotionTexture;
  uniform float uParticleMotionAge;
  uniform vec3  uPrimaryMotionUv;
  uniform vec3  uSecondaryMotionUvs[${MAX_SECONDARY}];
  varying vec2  vPrimaryMotion;
  varying vec2  vSecondaryMotion0;
  varying vec2  vSecondaryMotion1;
  varying vec2  vSecondaryMotion2;
  varying vec2  vSecondaryMotion3;
  varying vec2  vSecondaryMotion4;
  ${COAST}

  // particleUv = (贴图 u, 贴图 v, 质量)；u < 0 表示这个光源没有对应的粒子。
  // 位移是 NDC 单位，光晕用的是 [0,1] 的 uv，所以乘 0.5。
  vec2 astraParticleOffset(vec3 particleUv) {
    if (particleUv.x < 0.0 || uParticleMotionAge >= ${PARTICLE_MOTION_SETTLE_SECONDS}.0) return vec2(0.0);
    return astraCoast(
      texture2D(uParticleMotionTexture, particleUv.xy), particleUv.z, uParticleMotionAge
    ).xy * 0.5;
  }

  void mainSupport() {
    vPrimaryMotion = astraParticleOffset(uPrimaryMotionUv);
    vSecondaryMotion0 = astraParticleOffset(uSecondaryMotionUvs[0]);
    vSecondaryMotion1 = astraParticleOffset(uSecondaryMotionUvs[1]);
    vSecondaryMotion2 = astraParticleOffset(uSecondaryMotionUvs[2]);
    vSecondaryMotion3 = astraParticleOffset(uSecondaryMotionUvs[3]);
    vSecondaryMotion4 = astraParticleOffset(uSecondaryMotionUvs[4]);
  }
`

/**
 * 镜头光晕。数学取自原站的 AstraLensFlare（chunk 947344），
 * 省掉了那张程序化脏玻璃贴图，保留核心 + 光晕 + 光环 + 各向异性条纹 + 鬼影。
 *
 * 要点：光晕的位置来自"把某颗主星投影到屏幕空间"，而不是一个固定坐标——
 * 所以形状旋转时光晕会跟着那颗星走，看起来才像真的是它发出来的。
 */
const FRAGMENT_SHADER = /* glsl */ `
  uniform vec2  uCenter;
  uniform float uAspect;
  uniform float uGhosts;
  uniform float uGrain;
  uniform float uHalo;
  uniform float uIntensity;
  uniform vec2  uSecondaryCenters[${MAX_SECONDARY}];
  uniform float uSecondaryIntensity;
  uniform float uSecondaryVisibility[${MAX_SECONDARY}];
  uniform float uStreakLength;
  uniform float uStreaks;
  uniform float uVerticalStreaks;
  uniform float uVisibility;
  varying vec2  vPrimaryMotion;
  varying vec2  vSecondaryMotion0;
  varying vec2  vSecondaryMotion1;
  varying vec2  vSecondaryMotion2;
  varying vec2  vSecondaryMotion3;
  varying vec2  vSecondaryMotion4;

  float astraHash(vec2 point) {
    return fract(sin(dot(point, vec2(127.1, 311.7))) * 43758.5453123);
  }

  float softDisc(vec2 point, float radius, float softness) {
    return 1.0 - smoothstep(radius - softness, radius + softness, length(point));
  }

  float softRing(vec2 point, float radius, float width) {
    return 1.0 - smoothstep(width, width * 2.0, abs(length(point) - radius));
  }

  vec2 aspectCorrect(vec2 point) {
    point.x *= uAspect;
    return point;
  }

  // 副源只给柔和的光晕和克制的条纹：锐利的核心已经由那颗星本身和 bloom 提供了，
  // 再画一次会因为亚像素误差被看成"第二颗星"。
  float secondaryFlare(vec2 center, vec2 uv) {
    vec2 point = aspectCorrect(uv - center);
    float d = length(point);
    // 0.4 之外各项指数衰减都已低于千分之一，直接跳过。
    // 这个分支在屏幕上是大块连续的，GPU 不会为它分叉。
    if (d > 0.4) return 0.0;
    float nearHalo = exp(-d * d * 520.0) * 0.1;
    float halo = exp(-d * 17.0) * 0.055;
    float hWindow = 1.0 - smoothstep(uStreakLength * 0.72, uStreakLength, abs(point.x));
    float vWindow = 1.0 - smoothstep(uStreakLength * 0.72, uStreakLength, abs(point.y));
    hWindow = mix(hWindow, 1.0, step(0.99, uStreakLength));
    vWindow = mix(vWindow, 1.0, step(0.99, uStreakLength));
    float hStreak = exp(-abs(point.y) * 360.0) * exp(-abs(point.x) * 10.0) * hWindow * 0.24;
    float vStreak = exp(-abs(point.x) * 360.0) * exp(-abs(point.y) * 10.0)
      * vWindow * 0.24 * uVerticalStreaks;
    return nearHalo + halo + hStreak + vStreak;
  }

  float secondaryTerm(int i, vec2 motion, vec2 uv) {
    if (uSecondaryVisibility[i] <= 0.001) return 0.0;
    return secondaryFlare(uSecondaryCenters[i] + motion, uv) * uSecondaryVisibility[i];
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 base = inputColor.rgb;
    // 被指针推开时，光晕跟着那颗星一起走
    vec2 movingCenter = uCenter + vPrimaryMotion;
    vec2 source = aspectCorrect(uv - movingCenter);
    float d = length(source);

    // 主光源的核心 / 光晕 / 条纹在 1.0 之外都已衰减到不可见，只有鬼影会落在远处。
    float core = 0.0;
    float halo = 0.0;
    float streak = 0.0;
    if (d < 1.0) {
      core = exp(-d * d * 480.0) * 0.18;
      halo = exp(-d * 11.5) * uHalo;
      halo += softRing(source, 0.105, 0.006) * 0.05 * uHalo;

      float hWindow = 1.0 - smoothstep(uStreakLength * 0.72, uStreakLength, abs(source.x));
      float vWindow = 1.0 - smoothstep(uStreakLength * 0.72, uStreakLength, abs(source.y));
      hWindow = mix(hWindow, 1.0, step(0.99, uStreakLength));
      vWindow = mix(vWindow, 1.0, step(0.99, uStreakLength));
      float hStreak = exp(-abs(source.y) * 310.0) * exp(-abs(source.x) * 7.5) * hWindow;
      float hSoft  = exp(-abs(source.y) * 78.0)  * exp(-abs(source.x) * 5.2) * hWindow * 0.16;
      float vStreak = exp(-abs(source.x) * 310.0) * exp(-abs(source.y) * 7.5) * vWindow;
      float vSoft  = exp(-abs(source.x) * 78.0)  * exp(-abs(source.y) * 5.2) * vWindow * 0.16;
      streak = (hStreak + hSoft + (vStreak + vSoft) * uVerticalStreaks) * uStreaks;
    }

    // 鬼影沿"光源 → 画面中心"这条光轴排列，这是真实镜头内反射的几何。
    vec2 axis = vec2(0.5) - movingCenter;
    float ghosts = 0.0;
    ghosts += softDisc(aspectCorrect(uv - (movingCenter + axis * 0.82)), 0.016, 0.014) * 0.18;
    ghosts += softRing(aspectCorrect(uv - (movingCenter + axis * 1.38)), 0.046, 0.006) * 0.11;
    ghosts += softDisc(aspectCorrect(uv - (movingCenter + axis * 1.82)), 0.025, 0.02) * 0.08;
    ghosts *= uGhosts;

    float flare = (core + halo + streak + ghosts) * uIntensity;

    float secondary = secondaryTerm(0, vSecondaryMotion0, uv)
      + secondaryTerm(1, vSecondaryMotion1, uv)
      + secondaryTerm(2, vSecondaryMotion2, uv)
      + secondaryTerm(3, vSecondaryMotion3, uv)
      + secondaryTerm(4, vSecondaryMotion4, uv);
    secondary *= uIntensity * uSecondaryIntensity;

    vec3 color = base + vec3(0.956) * (flare * uVisibility + secondary);

    float luminance = dot(base, vec3(0.2126, 0.7152, 0.0722));
    float reveal = smoothstep(0.025, 0.72, luminance);
    float grain = astraHash(floor(uv * vec2(1536.0, 1024.0)));
    color += vec3((grain - 0.5) * uGrain) * (0.18 + reveal * 0.82);

    outputColor = vec4(max(color, vec3(0.0)), inputColor.a);
  }
`

export const DEFAULT_FLARE = {
  enabled: true,
  // 原站默认值：主光源是星系核里那颗超亮主星，光晕和条纹都是照它配的
  ghosts: 0.1,
  grain: 0.031,
  halo: 0.12,
  intensity: 0.28,
  secondary: 0.55,
  streakLength: 0.03485,
  streaks: 0.18,
  verticalStreaks: 1,
}

/** 光源滑出画面时淡出，避免在边缘"啪"地消失。 */
function edgeVisibility(projected) {
  if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) return 0
  if (projected.z < -1 || projected.z > 1) return 0
  const edge = Math.max(Math.abs(projected.x), Math.abs(projected.y))
  return 1 - MathUtils.smoothstep(edge, 0.88, 1.08)
}

export class AstraLensFlare extends Effect {
  constructor(config = DEFAULT_FLARE) {
    const uniforms = new Map([
      ['uCenter', new Uniform(new Vector2(0.5, 0.5))],
      ['uAspect', new Uniform(1)],
      ['uGhosts', new Uniform(config.ghosts)],
      ['uGrain', new Uniform(config.grain)],
      ['uHalo', new Uniform(config.halo)],
      ['uIntensity', new Uniform(config.intensity)],
      ['uSecondaryCenters', new Uniform(Array.from({ length: MAX_SECONDARY }, () => new Vector2(-2, -2)))],
      ['uSecondaryIntensity', new Uniform(config.secondary)],
      ['uSecondaryVisibility', new Uniform(Array.from({ length: MAX_SECONDARY }, () => 0))],
      ['uStreakLength', new Uniform(config.streakLength)],
      ['uStreaks', new Uniform(config.streaks)],
      ['uVerticalStreaks', new Uniform(config.verticalStreaks)],
      ['uVisibility', new Uniform(1)],
      ['uParticleMotionTexture', new Uniform(null)],
      ['uParticleMotionAge', new Uniform(PARTICLE_MOTION_SETTLE_SECONDS)],
      ['uPrimaryMotionUv', new Uniform(new Vector3(-1, -1, 1))],
      ['uSecondaryMotionUvs', new Uniform(Array.from({ length: MAX_SECONDARY }, () => new Vector3(-1, -1, 1)))],
    ])
    super('AstraLensFlare', FRAGMENT_SHADER, {
      blendFunction: BlendFunction.NORMAL,
      uniforms,
      vertexShader: VERTEX_SHADER,
    })
    this.projected = new Vector3()
    this.secondaryProjected = Array.from({ length: MAX_SECONDARY }, () => new Vector3())
  }

  get(name) {
    return this.uniforms.get(name)
  }

  setConfig(config) {
    this.get('uGhosts').value = config.ghosts
    this.get('uGrain').value = config.grain
    this.get('uHalo').value = config.halo
    this.get('uIntensity').value = config.enabled ? config.intensity : 0
    this.get('uSecondaryIntensity').value = config.secondary
    this.get('uStreakLength').value = config.streakLength
    this.get('uStreaks').value = config.streaks
    this.get('uVerticalStreaks').value = config.verticalStreaks
  }

  setViewport(width, height) {
    this.get('uAspect').value = Math.max(width, 1) / Math.max(height, 1)
  }

  /**
   * 把推斥模拟的状态贴图和各光源对应粒子的 texel 坐标喂给着色器。
   * @param {Texture|null} texture 当前的状态贴图，null = 推斥关闭
   * @param {number} age 上一次模拟到现在的秒数
   * @param {Vector3|null} primary 主光源的 (u, v, 质量)
   * @param {Vector3[]} secondaries 副光源的 (u, v, 质量)
   */
  setParticleMotion(texture, age, primary, secondaries = []) {
    this.get('uParticleMotionTexture').value = texture
    this.get('uParticleMotionAge').value = texture ? age : PARTICLE_MOTION_SETTLE_SECONDS
    const primaryUv = this.get('uPrimaryMotionUv').value
    if (texture && primary) primaryUv.copy(primary)
    else primaryUv.set(-1, -1, 1)
    const secondaryUvs = this.get('uSecondaryMotionUvs').value
    for (let i = 0; i < MAX_SECONDARY; i += 1) {
      const uv = secondaries[i]
      if (texture && uv) secondaryUvs[i].copy(uv)
      else secondaryUvs[i].set(-1, -1, 1)
    }
  }

  /** 每帧把主星和副星投影到 [0,1] 屏幕空间。 */
  updateSources(core, secondaries, camera, globalVisibility = 1) {
    camera.updateMatrixWorld()
    if (core) {
      core.getWorldPosition(this.projected).project(camera)
      this.get('uCenter').value.set(this.projected.x * 0.5 + 0.5, this.projected.y * 0.5 + 0.5)
      this.get('uVisibility').value =
        edgeVisibility(this.projected) * globalVisibility * (core.userData.visibility ?? 1)
    } else {
      this.get('uVisibility').value = 0
    }

    const centers = this.get('uSecondaryCenters').value
    const visibility = this.get('uSecondaryVisibility').value
    for (let i = 0; i < MAX_SECONDARY; i += 1) {
      const marker = secondaries[i]
      if (!marker) {
        centers[i].set(-2, -2)
        visibility[i] = 0
        continue
      }
      const projected = this.secondaryProjected[i]
      marker.getWorldPosition(projected).project(camera)
      centers[i].set(projected.x * 0.5 + 0.5, projected.y * 0.5 + 0.5)
      // 主星沿星臂流到端点时会渐隐，光晕跟着一起淡出。
      visibility[i] = edgeVisibility(projected) * globalVisibility * (marker.userData.visibility ?? 1)
    }
  }
}
