# 星流 Starflow

中文 · [English](README.en.md)

一片会流动的星空：基于 three.js + postprocessing 的星星粒子系统。一座螺旋星系随滚动翻转、散成两侧星轨，
再聚成光标和结；同一批星星还能摆成任意文字和图标。粒子的分布、流动、辉光和镜头光晕的算法细节参考了
OpenAI GPT-6 Astra 发布页的实现（下文简称「原站」），并在此基础上加了形状来源、性能自适应和中英文案。

![主页首屏：四千颗星组成的螺旋星系](docs/screenshots/01-hero.jpeg)

## 页面

| 路径 | 内容 |
|---|---|
| `/` | 主页：原站首页的滚动编排。右上角可切换中 / 英文，「调节粒子」打开调节面板 |
| `/lab.html` | 实验室：把星星摆成任意文字、内置图标、粘贴的 SVG 或上传的图片，所有参数可调 |
| `/embed.html` | 无 UI 的纯效果页，可直接 `<iframe>` 嵌入。`?shape=cursor` / `?shape=openai-knot` / `?text=6` / `?icon=heart` 切换形状 |

```bash
npm install
npm run dev      # http://127.0.0.1:5173
npm run build    # 三个页面都打进 dist/
```

## 滚动编排

主页把原站 `converge-tilt` 预设的整页编排搬了过来，四个阶段用的是同一批星星。

| 阶段 | 驱动 | 规则 |
|---|---|---|
| 翻转 | 首屏之后第一段文案的位置 | 星系绕 X 轴翻到 −52°，翻转进度 75% 处最大、100% 回平 |
| 两侧星轨 | 同上，文案中线到视口中线时散开完成 | 72% 的星被推到文案栏两侧，内缘用 sqrt 稀释；亮度降到 18%、暗星缩到 45%；随滚动有按深度的视差 |
| 光标 | `[data-astra-shape]` cue 元素（80vh 高、最宽 576px） | 进入视口 0–36% 处成形、50–86% 处消散；星星按种子落到路径上，带着自己在星系里的横向偏移和流速 |
| 结 | 最后一个 cue 常驻 | 6 段弧线各占总长的 1/6，流速按占比放大；成形时自动摆 0.42 rad |

| 翻转 | 两侧星轨 |
|---|---|
| ![星系绕 X 轴翻转](docs/screenshots/02-tilt.jpeg) | ![星星退到文案栏两侧](docs/screenshots/03-rails.jpeg) |

| 光标 | 结 |
|---|---|
| ![星星聚成光标](docs/screenshots/04-cursor.jpeg) | ![星星聚成 OpenAI 结](docs/screenshots/05-knot.jpeg) |

页面只量 DOM、算进度（`src/home.js`），阻尼、混合、光晕追踪都在引擎里（`setScroll`）：

```js
astra.setScroll({
  progress,          // scrollY / 800
  tiltProgress,      // 0..1，null = 跟随 progress
  scatterProgress,   // 0..1，null = 跟随 progress
  contentBounds,     // { left, right }，视口比例，星轨给它让位
  shape: { id, samples, strength, centerNdc, sizeNdc },   // samples 来自 createShapeSamples()
})
```

### 调节面板与 i18n

![调节面板](docs/screenshots/06-tuner.jpeg)

面板分四组：星场（星数、大小、星带宽度、背景星、厚度、调色板，改动会重建星场）、光学（bloom、亮度、
镜头光晕、氛围色、暗角）、动态（流速、闪烁、形状星带、推斥、星系核自转）、性能（后处理档位、自动降级）。

主页和实验室的文案都有中英两套（`src/i18n.js`），元素上写 `data-i18n="键"` 即可；默认按浏览器语言，切换后记在 `localStorage`。上面的截图是英文界面，下面是中文：

![中文版](docs/screenshots/07-chinese.jpeg)

## 实验室：任意文字与图标

![实验室](docs/screenshots/08-lab.jpeg)

原站的形状只有手绘曲线；实验室把形状来源扩展成三种，最后都变回「可以按弧长参数化的曲线」——
`orbitProgress` 这个一维弧长参数是整套动画（流动、渐隐、汇聚、光晕追踪）的地基。

```
形状来源
  ├─ galaxy        paths.js   原站 5 条曲线 → THREE.Curve（含 Z 向起伏）
  ├─ paths         paths.js   任意一组 SVG 路径，每条子路径一层（光标 / OpenAI 结）
  └─ text/svg/img  rasterize.js → contours.js   光栅化 → marching squares 抠闭合轮廓 → 等距重采样
        ↓
field.js      沿曲线撒星（原站逐星公式）+ 每层背景星 + 星系核 → BufferGeometry + 路径贴图
shaders.js    顶点着色器：路径位置 → 星轨 → 路径形状 → 入场汇聚；片元：圆盘 + 十字衍射 + 亚像素解析覆盖
scene.js      正交相机 + 原站同款 Bloom + 镜头光晕 + 氛围 / 暗角 + ACES；滚动状态机；主星追踪
motion.js     指针推斥的 GPGPU ping-pong 模拟
```

```js
import { createAstraScene } from './astra/index.js'

const astra = createAstraScene(document.querySelector('canvas'))
astra.setSource({ type: 'galaxy' })                                              // 原站星系
astra.setSource({ type: 'paths', paths: ['M… C…'], viewBox: [0, 0, 19, 19] })     // 一组 SVG 路径
astra.setSource({ type: 'text', value: '6', fontWeight: 700 })                   // 任意文字
astra.setSource({ type: 'svg', markup: '<svg viewBox="0 0 24 24">…</svg>' })
astra.setSource({ type: 'image', image: htmlImageElement, useLuminance: true })

astra.setConfig({ flowSpeed: 0, bloomIntensity: 0.9 })
astra.setDisperse(1)   // 散成两侧星轨，0 是聚回形状
astra.replay()         // 重播入场
astra.dispose()
```

## 算法要点（参考原站实现）

| 位置 | 做什么 |
|---|---|
| `GALAXY_PATHS` / `GALAXY_LAYERS` (paths.js) | 5 条手绘曲线 + 每层的深度 / 相位 / 流速 / 强弱。星数按「强 220 : 弱 170」分配，与弧长无关 |
| 逐星公式 (field.js) | 星带宽 = scatter × lerp(0.3, 1, sin πt)；亮星比例强层 8.5% / 弱层 5.5%，端点处再打两折；RNG 种子与原站相同，所以每一颗星的位置都一样 |
| 星系核 (field.js) | 96 颗，半径 r^2.4 × 0.42 的椭圆分布，越靠中心越亮越白，自转 0.36 × flowSpeed rad/s |
| 背景星 | 每层额外 12/88 的星留在天上，浮现进度封顶 0.2 → 永远只有 45% 尺寸；挂在未旋转的根节点下，拖拽时天空不动 |
| `astraFilteredCore` (shaders.js) | 亚像素点的**解析覆盖率**（三次 B 样条核）。没有它，0.5px 的远星移动时会剧烈闪烁 |
| 尺寸包络 / 端点渐隐 | `sizeEnvelope = mix(1, 0.14 + 0.86·sin(πt)^0.68, 0.45)`，`tipFade = smoothstep(0, .055, t) × (1 − smoothstep(.945, 1, t))`。流动时星星从端点消失、另一端出现 |
| `astraIntroMotion` | 入场汇聚。每颗星起跑时间和公转角度都不同，形状是「凝聚」而非整体平移 |
| `astraCoast` (shaders.js) | 推斥后的闭式解析外推。松开鼠标后一帧模拟都不用跑 |
| 光晕跟随推斥 (lensflare.js) | 星星被推开的位移只存在 GPU 状态贴图里，所以把主星的 texel 坐标和质量传给光晕着色器，在顶点阶段用同一份 `astraCoast` 读出偏移 |
| 路径形状 (shaders.js) | 每条子路径当开放曲线；暗星缩小、一半亮星压到 42%；没有主光晕，5 颗主星散在各段路径上带副光晕；变形时带着星系里的横向偏移和流速，5 档流速混在同一条路径上 |
| `AstraBloomEffect` (bloom.js) | 亮度提取前先 2×2 盒采样；原站用两个额外 pass 做高斯重建，这里折进合成着色器，效果等价、零额外 pass |
| 调色板 5 档量化 (palette.js) | 36% 青 / 16% 蓝 / 12% 橙 / 10% 浅橙 / 26% 白。固定比例是「冷底 + 一成暖」观感的来源 |
| 分层旋转滞后 (scene.js) | 拖拽时每条星臂的阻尼 = 14 / (1 + (0.18 + 0.17i) × 0.68 × 2.5)，内圈跟手、外圈慢半拍 |

### 最容易做错的地方

1. **色彩管线**：全程线性，ACES 只在后处理最后做（`renderer.toneMapping = NoToneMapping`，
   `material.toneMapped = false`，`frameBufferType = HalfFloatType`）。顺序搞反，bloom 会提前削顶，画面发灰。
2. **星星大小是 2.05，不是 1**：亮星要画到 15px 上下再交给 bloom，才是原站那种「大而软」的光斑。
3. **辉光来自极低的阈值**（0.08），不是大半径。
4. **曲线必须是开放的**：闭合轮廓没有端点，就没有渐隐和尺寸衰减，星臂会变成一根均匀的项链。

## 性能

实测（Apple M4，ANGLE/Metal）：整帧 GPU 约 6 ms，星星本身只占 0.5 ms，其余全是后处理——
每个全分辨率 pass 约 2 ms，小 pass 也有 0.15 ms 左右的固定开销。所以优化思路是减 pass，而不是减星星：

- Bloom 的高斯重建从两个 pass 折进合成着色器；镜头光晕着色器对远离光源的像素提前退出
- 氛围色和暗角从 CSS 图层搬进后处理：带 `mix-blend-mode` 的全屏图层会让合成器每帧多画几遍整屏，5K 窗口上占一半掉帧
- 指针推斥的模拟着色器在建场时预编译，第一次划过画布不再卡一下
- **自适应降级**：1.2 秒窗口里两成以上的帧慢于阈值就降一级。先降渲染节奏（每 2 / 3 / 4 个刷新周期渲染一次），
  节奏到底了才逐级收紧像素预算。大窗口 / 高刷屏上的瓶颈常在浏览器的合成与送显，降分辨率毫无帮助——
  实测连 300×300 的 2D canvas 每帧变色都只能跑到 48fps
- `quality: 'lite' | 'none'` 给低端设备；`pixelBudget` 可直接指定

## 参数

### 形状参数（`setSource` 第二个参数，改动会重建几何）

| 参数 | 默认（原站） | 说明 |
|---|---|---|
| `starCount` | 4000 | 路径星总数，按层权重分配 |
| `backgroundRatio` | 0.14 | 留在天上的背景星，相对路径星的比例 |
| `scatter` | 0.041 | 星带半宽，相对形状高度（原站 0.4 / 9.7） |
| `densityFalloff` | 0.22 | 沿路径的疏密调制 |
| `rotationDepth` | 1.4 | 曲线的 Z 向起伏，旋转时星臂的前后层次 |
| `flowInward` | true | 流向星系核；false 向外 |
| `size` | 2.05 | 星星整体大小 |
| `centerCluster` / `clusterCount` | true / 96 | 星系核（仅星系模式） |
| `fillRatio` | 0 | 光栅形状内部的星尘占比（仅文字 / 图标） |
| `brightRetention` | 1 | 亮星里保留多少不被压暗到 42%。路径形状预设用 0.5 |
| `palette` | `astra` | `astra` / `aurora` / `ember` / `ice` / `gold` |
| `seed` | 0 | 0 = 与原站逐星一致 |

### 渲染参数（`setConfig`，只更新 uniform）

| 参数 | 默认（原站） | 说明 |
|---|---|---|
| `bloomIntensity` / `bloomThreshold` | 0.7 / 0.08 | |
| `intensity` | 1.35 | 星星整体亮度 |
| `flowSpeed` | 0.8 | 沿星臂流动的速度，0 = 静止 |
| `sizeFalloff` | 0.45 | 端点处星星缩小的程度 |
| `dimSizeScale` | 1 | 暗星的尺寸倍率。路径形状预设用 0.8 |
| `coreSpin` | true | 星系核自转 |
| `rotationLag` | 0.68 | 拖拽时各层的滞后，0 = 刚性旋转 |
| `twinkleSpeed` | 0.62 | 闪烁 |
| `introDuration` | 5.5 | 入场汇聚时长（秒） |
| `pointerRepel` | true | GPGPU 指针推斥，半径 176px |
| `lensMode` | false | 指针透镜放大 |
| `fillX` / `fillY` | 0.8 / 0.89 | 形状占视口的比例（原站：9.7 / 10.9） |
| `center` | `[0, 0]` | 形状偏移，单位是半个视口 |
| `lensFlare` | 原站默认 | `intensity .28 / halo .12 / streaks .18 / secondary .55 / ghosts .1` |
| `ambientColor` / `ambientOpacity` / `vignette` | `#23435f` / 0.55 / 1 | 氛围色与暗角 |
| `ambientFloor` | 0 | 氛围色里铺满整屏的比例，0 = 纯径向渐变。发布页骨架用 0.4 配 `vignette: 0`、`ambientOpacity: 0.3`，对应原站截图里近乎均匀的深蓝黑底色 |
| `scrollEffects` / `scrollStarDriftSpeed` | true / 3 | 滚动编排开关、星轨视差速度 |
| `shapeAutoRotate` / `shapeScatter` / `shapeBrightRetention` | true / 1 / 0.5 | 路径形状的摆动、星带宽度、亮星保留 |
| `quality` | `full` | `full`（bloom + 光晕）/ `lite`（只 bloom）/ `none`（只 ACES） |
| `pixelBudget` / `adaptiveQuality` | 2.4e6 / true | 像素预算与自动降级 |

## 降级

- **无 WebGL** → `renderStaticFallback()` 用 Canvas 2D 画同一份星场数据，构图和配色保住
- **`prefers-reduced-motion`** → 冻结时间轴（闪烁、流动、自转、推斥全停），形状和 bloom 保留
- **无 `EXT_color_buffer_float`** → 自动关闭 GPGPU 推斥，其余不受影响

## 尚未实现的部分

- 轨道星尘（orbitalDust）：原站有这套代码但默认关闭
- 程序化脏玻璃贴图：原站会运行时生成污渍图做 UV 微畸变，这里只保留胶片颗粒
- GPU 分级：原站用 detect-gpu 分 4 档，这里换成运行时的自适应降级

## 作为库使用

引擎可以脱离这三个页面单独使用。`npm run build:lib` 产出三个文件：

| 文件 | 内容 | 用法 |
|---|---|---|
| `lib/starflow.js` | ES 模块，自带 three + postprocessing（约 640 KB，gzip 162 KB） | 复制到任意页面，`<script type="module">` 里 `import { createAstraScene } from './starflow.js'` |
| `lib/starflow.iife.js` | 同上，挂成全局 `window.Starflow` | 不用模块的页面 |
| `lib/starflow.slim.js` | 不带依赖 | `npm i starflow` 后 `import { createAstraScene } from 'starflow'`，three / postprocessing 由 npm 解析 |

```js
import { createAstraScene, detectWebGL, renderStaticFallback } from './starflow.js'

const canvas = document.querySelector('canvas')
if (detectWebGL()) {
  const astra = createAstraScene(canvas, { autoRotate: true })
  astra.setSource({ type: 'galaxy' })          // 或 { type: 'paths' | 'text' | 'svg' | 'image', … }
  // 滚动编排：每帧把进度喂进来，见 src/home.js
  // astra.setScroll({ progress, tiltProgress, scatterProgress, contentBounds, shape })
} else {
  renderStaticFallback(canvas, { type: 'galaxy' })
}
```

想让 coding agent 直接做出整页的滚动编排，用仓库里的 skill，见下一节。

## Skill 与设计系统

仓库同时带一个给 coding agent 用的 skill 和一份 DESIGN.md 设计系统，三者共用同一份引擎：

| 目录 | 内容 | 用法 |
|---|---|---|
| [`skill/`](skill/) | `starflow-launch`：SKILL.md、接好线的发布页骨架、纯首屏页、引擎单文件、参考文档 | Open Design：`od plugin install github:Win-Hao/starflow@main/skill`；Claude Code / Cursor：把 `skill/` 拷进 skills 目录，然后说「用 starflow 做一个发布页」 |
| [`design-systems/openai-astra/`](design-systems/openai-astra/) | 从 GPT-6 Astra 发布页公开 CSS 提炼的暗色设计系统（DESIGN.md、tokens.css、组件页、preview），按 Open Design 项目规范打包，已投 [nexu-io/open-design#7806](https://github.com/nexu-io/open-design/pull/7806) | 单独把 `DESIGN.md` 丢进任何项目根目录，agent 就会按这套风格生成界面 |
| [`docs/upstream-prs.md`](docs/upstream-prs.md) | 往上游目录投稿的步骤与 PR 文案 | |

`npm run build:lib` 会把引擎产物同时写进 `lib/` 和 `skill/assets/`；改了 `tokens.css` 或 DESIGN.md 后跑 `scripts/sync-skill.sh` 同步组件页和副本。


## 项目结构

```
index.html / src/home.js / src/home.css   主页（滚动编排 + 调节面板 + i18n）
lab.html   / src/lab.js  / src/lab.css    实验室
embed.html                                嵌入页
src/i18n.js                               中英文案
src/presets.js                            原站路径数据（光标、OpenAI 结）与图标预设
src/lib.js / vite.lib.config.js          库入口与库构建（lib/starflow*.js）
src/astra/                                引擎：scene / field / shaders / paths / bloom / lensflare / ambient / motion / …
docs/screenshots/                         README 用图
skill/                                    coding agent 用的 skill（SKILL.md、页面骨架、引擎单文件）
design-systems/openai-astra/              openai-astra DESIGN.md 设计系统包
docs/upstream-prs.md                      往上游目录投稿的步骤与 PR 文案
scripts/sync-skill.sh                     重建组件页、同步 DESIGN.md 副本
examples/launch-page/                     中文发布页成品（演示视频用的那页，带录屏自动滚动参数）
```

参考页面的抓包文件和分析笔记不在仓库里；星星相关的算法都已按上表在源码里注明出处。

## 许可

[MIT](LICENSE)。粒子效果的算法参考自 OpenAI GPT-6 Astra 发布页；代码为本项目独立实现。
