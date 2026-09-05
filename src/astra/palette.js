import { Color } from 'three'

// Astra 原站的三套调色板（从 chunk 396522 提取）
export const PALETTES = {
  astra:  ['#6DCBF4', '#7AB1FE', '#F87915', '#FA994C', '#F5F6FB'],
  aurora: ['#47E2C2', '#6DCBF4', '#B06DFF', '#E96AC8', '#F5F6FB'],
  ember:  ['#F7CB59', '#FA994C', '#F67576', '#B06DFF', '#F5F6FB'],
  ice:    ['#8FD8FF', '#6FA8FF', '#B7C6FF', '#DCE6FF', '#FFFFFF'],
  gold:   ['#FFD27A', '#FFB347', '#FF7A45', '#FFE9B8', '#FFFDF5'],
}

// 与原站一致的 5 档量化：36% / 16% / 12% / 10% / 26%
// 这个固定比例是「冷底 + 一成暖」观感的来源，别改成连续渐变。
const STOPS = [0.36, 0.52, 0.64, 0.74]

const cache = new Map()

function colorsFor(paletteId) {
  let list = cache.get(paletteId)
  if (!list) {
    const hex = PALETTES[paletteId] ?? PALETTES.astra
    list = hex.map((h) => new Color(h))
    cache.set(paletteId, list)
  }
  return list
}

/** 把一个 [0,1) 随机种子映射成调色板中的一档，写进 Float32Array。 */
export function writeStarColor(target, offset, seed, paletteId = 'astra', colorMode = true) {
  if (!colorMode) {
    target[offset] = 1
    target[offset + 1] = 1
    target[offset + 2] = 1
    return
  }
  const colors = colorsFor(paletteId)
  let index = 4
  for (let i = 0; i < STOPS.length; i += 1) {
    if (seed < STOPS[i]) {
      index = i
      break
    }
  }
  const c = colors[index]
  target[offset] = c.r
  target[offset + 1] = c.g
  target[offset + 2] = c.b
}

/** 每条路径层的 hero 星用固定种子，保证各层主星颜色互不相同。 */
export const HERO_COLOR_SEEDS = [0.08, 0.58, 0.22, 0.68, 0.44]
