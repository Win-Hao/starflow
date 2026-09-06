# 示例：发布页 / Example: launch page

中文 · [English](#english)

`skill/assets/template.html` 的中文成品版：星流自己的发布页，也是抖音演示视频里录的那一页。首屏「星流 / Starflow」逐字入场，标题段翻转散开，星星先聚成光标、最后聚成爱心并常驻。

引擎从仓库的 `lib/starflow.js` 引入，所以要从仓库根启动静态服务：

```bash
npm run dev            # 然后打开 http://127.0.0.1:5173/examples/launch-page/
# 或
python3 -m http.server 8080 && open http://127.0.0.1:8080/examples/launch-page/
```

## 录屏参数

| 参数 | 作用 |
|---|---|
| `?autoscroll=110` | 入场结束后以 110px/s 匀速滚到底；滚轮、触摸或按键会让它停下 |
| `&delay=6` | 起始等待秒数（默认 6，等入场动画播完） |
| `&loop=1` | 到底后停 2.5 秒，回到顶部重播入场再滚一遍 |

竖屏（抖音）：把窗口拉成 9:16 或用设备模拟，`?autoscroll=140` 约 35 秒一遍；横屏 `?autoscroll=110` 约 45 秒。滚动条已隐藏。

换文案直接改 `index.html` 里的文字；换最后的形状改 `data-astra-paths` 里的 SVG 路径（`data-astra-viewbox` 跟着改）。

---

## English

The Chinese production version of `skill/assets/template.html`: Starflow's own launch page, the one recorded for the Douyin demo. Split labels reveal letter by letter, the title stage tilts and scatters the galaxy, the stars form a cursor and finally a heart that holds.

The engine is imported from the repository's `lib/starflow.js`, so serve from the repo root (`npm run dev`, then open `/examples/launch-page/`).

Recording helpers: `?autoscroll=110` scrolls to the bottom at 110 px/s once the intro has played (`&delay=6` seconds), `&loop=1` returns to the top and replays. Any wheel, touch or key press stops it. The scrollbar is hidden.
