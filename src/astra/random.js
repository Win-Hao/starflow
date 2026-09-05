/** mulberry32：和原站同款的确定性 PRNG，保证同一输入每次生成同一片星空。 */
export function makeRandom(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), 1 | t)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 近似正态：6 次均匀采样求和，落在 [-1, 1]。 */
export function gaussian(random) {
  return (random() + random() + random() + random() + random() + random() - 3) / 3
}
