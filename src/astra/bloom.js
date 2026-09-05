import { BloomEffect } from 'postprocessing'
import { Uniform, Vector2 } from 'three'

/**
 * 原站的 Bloom（chunk 947344）在 postprocessing 的 BloomEffect 之上补了两件事：
 *
 * 1. 亮度提取先做 2×2 盒采样再判阈值。半像素偏移的 4 次采样等于一次线性降采样，
 *    亚像素的小星星也能被 bloom 捞到，不会在阈值边缘闪来闪去。
 * 2. mipmap 模糊的结果再过一道高斯"重建"，把半分辨率上采样的方块感抹掉。
 *
 * 原站用两个额外的 pass 做重建。实测在 ANGLE/Metal 上每多一个 pass 都很贵
 * （半分辨率也要 1 ms 上下），所以这里把重建折进合成着色器：合成时对 bloom 贴图
 * 做 4 次带双线性插值的偏移采样，等效于一次 3×3 帐篷滤波，零额外 pass。
 */
const LUMINANCE_SHADER = /* glsl */ `
  uniform sampler2D inputBuffer;
  uniform vec2 sourceTexelSize;
  uniform float threshold;
  uniform float smoothing;
  varying vec2 vUv;

  float astraLuminance(vec3 rgb) {
    return dot(rgb, vec3(0.2126, 0.7152, 0.0722));
  }

  void main() {
    vec2 offset = sourceTexelSize * 0.5;
    vec4 color = (
      texture2D(inputBuffer, vUv + vec2(-offset.x, -offset.y)) +
      texture2D(inputBuffer, vUv + vec2( offset.x, -offset.y)) +
      texture2D(inputBuffer, vUv + vec2(-offset.x,  offset.y)) +
      texture2D(inputBuffer, vUv + vec2( offset.x,  offset.y))
    ) * 0.25;
    gl_FragColor = color * smoothstep(threshold, threshold + smoothing, astraLuminance(color.rgb));
  }
`

const COMPOSITE_SHADER = /* glsl */ `
  #ifdef FRAMEBUFFER_PRECISION_HIGH
    uniform mediump sampler2D map;
  #else
    uniform lowp sampler2D map;
  #endif
  uniform float intensity;
  uniform vec2 mapTexelSize;

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec2 offset = mapTexelSize * 1.25;
    vec4 bloom = texture2D(map, uv + vec2(-offset.x, -offset.y))
      + texture2D(map, uv + vec2( offset.x, -offset.y))
      + texture2D(map, uv + vec2(-offset.x,  offset.y))
      + texture2D(map, uv + vec2( offset.x,  offset.y));
    outputColor = bloom * (0.25 * intensity);
  }
`

export class AstraBloomEffect extends BloomEffect {
  constructor(options) {
    super(options)
    this.sourceTexelSize = new Uniform(new Vector2())
    this.luminanceMaterial.uniforms.sourceTexelSize = this.sourceTexelSize
    this.luminanceMaterial.fragmentShader = LUMINANCE_SHADER
    this.luminanceMaterial.needsUpdate = true
    this.uniforms.set('mapTexelSize', new Uniform(new Vector2(1 / 512, 1 / 512)))
    this.setFragmentShader(COMPOSITE_SHADER)
  }

  setSize(width, height) {
    super.setSize(width, height)
    const texture = this.mipmapBlurPass.texture
    const w = Math.max(texture?.image?.width ?? this.resolution.width, 1)
    const h = Math.max(texture?.image?.height ?? this.resolution.height, 1)
    this.uniforms.get('mapTexelSize').value.set(1 / w, 1 / h)
  }

  update(renderer, inputBuffer, deltaTime) {
    this.sourceTexelSize.value.set(1 / inputBuffer.width, 1 / inputBuffer.height)
    super.update(renderer, inputBuffer, deltaTime)
  }
}
