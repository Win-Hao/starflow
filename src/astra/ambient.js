import { BlendFunction, Effect } from 'postprocessing'
import { Color, Uniform, Vector2 } from 'three'

/**
 * 页面原本用两层 CSS 做氛围色（plus-lighter 的径向渐变）和暗角。
 * 在大窗口 / 高刷屏上，带混合模式的全屏图层会让浏览器合成器每帧多画几遍整屏，
 * 这里把它们折进后处理的同一个 pass，对合成器来说画布只是一张不透明贴图。
 *
 * 数学与 CSS 一致，且在 sRGB 空间里做（CSS 就是在最终像素上叠的）：
 *   氛围色：ellipse farthest-corner，alpha = t²，plus-lighter = 直接相加
 *   暗角：circle farthest-corner，47% 处 0 → 72% 处 0.18 → 100% 处 0.78，乘到颜色上
 */
const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3  uAmbientColor;
  uniform float uAmbientOpacity;
  uniform float uVignette;
  uniform vec2  uAspect;

  vec3 astraToSrgb(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(max(c, vec3(0.0)), vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  vec3 astraToLinear(vec3 c) {
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
  }

  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    // farthest-corner：椭圆用视口的半宽半高归一，圆用对角线的一半归一
    vec2 offset = uv - 0.5;
    float ellipse = length(offset * 2.0);
    float circle = length(offset * uAspect) / (0.5 * length(uAspect));
    vec3 srgb = astraToSrgb(inputColor.rgb);
    srgb += uAmbientColor * (ellipse * ellipse) * uAmbientOpacity;
    float vignette = smoothstep(0.47, 0.72, circle) * 0.18
      + smoothstep(0.72, 1.0, circle) * 0.60;
    srgb *= 1.0 - vignette * uVignette;
    outputColor = vec4(astraToLinear(clamp(srgb, 0.0, 1.0)), inputColor.a);
  }
`

export class AstraAmbientEffect extends Effect {
  constructor({ color = '#23435f', opacity = 0.55, vignette = 1 } = {}) {
    super('AstraAmbient', FRAGMENT_SHADER, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['uAmbientColor', new Uniform(new Color(color))],
        ['uAmbientOpacity', new Uniform(opacity)],
        ['uVignette', new Uniform(vignette)],
        ['uAspect', new Uniform(new Vector2(1, 1))],
      ]),
    })
  }

  setAmbient(color, opacity, vignette) {
    // CSS 里的颜色是 sRGB 值，直接用，不走 three 的色彩管理
    const c = new Color().setStyle(color, 'srgb')
    this.uniforms.get('uAmbientColor').value.set(c.r, c.g, c.b)
    this.uniforms.get('uAmbientOpacity').value = opacity
    this.uniforms.get('uVignette').value = vignette
  }

  /** 滚动页每帧改氛围强度，只动一个 uniform。 */
  setOpacity(opacity) {
    this.uniforms.get('uAmbientOpacity').value = opacity
  }

  setViewport(width, height) {
    this.uniforms.get('uAspect').value.set(width / Math.max(height, 1), 1)
  }
}
