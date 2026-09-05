import {
  Color,
  HalfFloatType,
  NearestFilter,
  NoBlending,
  Points,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
} from 'three'
import { PARTICLE_MOTION_SETTLE_SECONDS, SIMULATION_FRAGMENT_SHADER } from './shaders.js'

/**
 * 指针推斥的 GPGPU 模拟，照搬原站的结构：
 *   - 状态存在 128 × ceil(N/128) 的 HalfFloat ping-pong 贴图里，每像素 = (偏移xy, 速度xy)
 *   - 模拟 pass 复用渲染用的同一份 vertex shader，只加一个 define
 *   - 指针不动时一帧都不跑，位置由 astraCoast() 在顶点着色器里解析外推
 */
export class ParticleMotion {
  constructor(field) {
    const [columns, rows] = field.motionTextureSize
    const targetOptions = {
      type: HalfFloatType,
      minFilter: NearestFilter,
      magFilter: NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    }
    this.front = new WebGLRenderTarget(columns, rows, targetOptions)
    this.back = this.front.clone()
    this.uniforms = field.material.uniforms
    this.uniforms.uParticleMotionTexture.value = this.front.texture
    this.uniforms.uParticleMotionEnabled.value = 1

    this.material = new ShaderMaterial({
      uniforms: this.uniforms,
      defines: { ASTRA_PARTICLE_SIMULATION: 1 },
      vertexShader: field.material.vertexShader,
      fragmentShader: SIMULATION_FRAGMENT_SHADER,
      blending: NoBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    })

    this.scene = new Scene()
    this.source = field.points
    this.simulation = new Points(field.geometry, this.material)
    this.simulation.matrixAutoUpdate = false
    this.simulation.frustumCulled = false
    this.scene.add(this.simulation)

    this.initialized = false
    this.clearColor = new Color()
    this.pointer = new Vector2()
    this.previous = new Vector2()
    this.impulse = new Vector2()
    this.active = false
    this.remaining = 0
  }

  reset() {
    this.initialized = false
    this.remaining = 0
    this.active = false
    this.uniforms.uParticleMotionAge.value = PARTICLE_MOTION_SETTLE_SECONDS
  }

  /** 把这一帧的指针位置转成冲量。指针必须"连续移动"才产生推力。 */
  feed(pointer, delta) {
    this.impulse.set(0, 0)
    const engaged = pointer.active && !pointer.reset
    if (engaged) {
      this.previous.copy(this.pointer)
      this.pointer.set(pointer.x, pointer.y)
      if (this.active) {
        this.impulse.subVectors(this.pointer, this.previous)
        if (this.impulse.lengthSq() > 1e-8) this.remaining = PARTICLE_MOTION_SETTLE_SECONDS
      } else {
        this.previous.copy(this.pointer)
      }
    }
    this.active = engaged
    this.remaining = Math.max(0, this.remaining - delta)
  }

  update(renderer, camera, delta) {
    const age = this.uniforms.uParticleMotionAge
    age.value = Math.min(PARTICLE_MOTION_SETTLE_SECONDS, age.value + Math.max(delta, 0))
    if (this.impulse.lengthSq() <= 1e-8) return

    this.uniforms.uParticleMotionPointer.value.copy(this.pointer)
    this.uniforms.uParticleMotionPrevious.value.copy(this.previous)
    this.uniforms.uParticleMotionImpulse.value.copy(this.impulse)

    const previousTarget = renderer.getRenderTarget()
    const previousAlpha = renderer.getClearAlpha()
    renderer.getClearColor(this.clearColor)
    renderer.setClearColor(0, 0)
    try {
      if (!this.initialized) {
        renderer.setRenderTarget(this.front)
        renderer.clear()
        this.initialized = true
      }
      this.source.updateWorldMatrix(true, false)
      this.simulation.matrix.copy(this.source.matrixWorld)
      renderer.setRenderTarget(this.back)
      renderer.render(this.scene, camera)
      const swap = this.front
      this.front = this.back
      this.back = swap
      this.uniforms.uParticleMotionTexture.value = this.front.texture
      // age 归零，让顶点着色器从这一帧的新状态重新开始外推。
      age.value = 0
    } finally {
      renderer.setRenderTarget(previousTarget)
      renderer.setClearColor(this.clearColor, previousAlpha)
    }
  }

  dispose() {
    this.front.dispose()
    this.back.dispose()
    this.material.dispose()
    this.scene.clear()
  }
}

/** HalfFloat 作为渲染目标需要这个扩展，缺了就退回无推斥模式。 */
export function supportsParticleMotion(renderer) {
  return (
    renderer.extensions.has('EXT_color_buffer_float') ||
    renderer.extensions.has('EXT_color_buffer_half_float')
  )
}
