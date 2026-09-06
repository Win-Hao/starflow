/**
 * 把光栅蒙版变成「笔画中线」。
 * 原站的数字、光标、结都是手写的中心线 SVG：星星沿中线两侧撒成一根管子，越靠中线越密，
 * 没有清晰的边缘。文字和描边图标走这里而不是轮廓：
 *   距离变换 → 每处的半笔宽；Zhang–Suen 细化 → 骨架；骨架像素串成折线，短毛刺剪掉，
 *   交点处把方向最顺的两条接成一条长笔画，再按弧长等距重采样。
 */

const NEIGHBOURS = [
  [0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1],
]

/** 3-4 倒角距离变换：前景像素到最近背景像素的距离（像素），误差 < 8%，对半笔宽足够。 */
function distanceTransform(bin, width, height) {
  const d = new Float32Array(width * height)
  const BIG = 1e9
  for (let i = 0; i < d.length; i += 1) d[i] = bin[i] ? BIG : 0
  const at = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : d[y * width + x])
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      if (d[i] === 0) continue
      d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4)
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const i = y * width + x
      if (d[i] === 0) continue
      d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4)
    }
  }
  for (let i = 0; i < d.length; i += 1) d[i] /= 3
  return d
}

/** Zhang–Suen 细化：保持 8 连通地把前景削成一像素宽的骨架。 */
function thin(bin, width, height) {
  const img = Uint8Array.from(bin)
  const at = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : img[y * width + x])
  const remove = []
  let changed = true
  while (changed) {
    changed = false
    for (let pass = 0; pass < 2; pass += 1) {
      remove.length = 0
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (!img[y * width + x]) continue
          const p2 = at(x, y - 1)
          const p3 = at(x + 1, y - 1)
          const p4 = at(x + 1, y)
          const p5 = at(x + 1, y + 1)
          const p6 = at(x, y + 1)
          const p7 = at(x - 1, y + 1)
          const p8 = at(x - 1, y)
          const p9 = at(x - 1, y - 1)
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
          if (b < 2 || b > 6) continue
          let a = 0
          if (p2 === 0 && p3 === 1) a += 1
          if (p3 === 0 && p4 === 1) a += 1
          if (p4 === 0 && p5 === 1) a += 1
          if (p5 === 0 && p6 === 1) a += 1
          if (p6 === 0 && p7 === 1) a += 1
          if (p7 === 0 && p8 === 1) a += 1
          if (p8 === 0 && p9 === 1) a += 1
          if (p9 === 0 && p2 === 1) a += 1
          if (a !== 1) continue
          if (pass === 0) {
            if (p2 * p4 * p6 !== 0 || p4 * p6 * p8 !== 0) continue
          } else if (p2 * p4 * p8 !== 0 || p2 * p6 * p8 !== 0) continue
          remove.push(y * width + x)
        }
      }
      if (remove.length > 0) {
        changed = true
        for (const i of remove) img[i] = 0
      }
    }
  }
  return img
}

/**
 * 骨架 → 折线。度数 ≠ 2 的像素是节点（端点 / 交点），相邻节点并成一簇；
 * 簇之间的度数 2 像素链是一条分支，剩下没走过的链是闭环。
 */
function traceBranches(skel, width, height) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < width && y < height
  const has = (x, y) => inside(x, y) && skel[y * width + x] === 1
  const degree = new Uint8Array(width * height)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!skel[y * width + x]) continue
      let n = 0
      for (const [dx, dy] of NEIGHBOURS) if (has(x + dx, y + dy)) n += 1
      degree[y * width + x] = n
    }
  }
  const isNode = (i) => skel[i] === 1 && degree[i] !== 2

  // 节点簇
  const cluster = new Int32Array(width * height).fill(-1)
  const clusters = []
  for (let i = 0; i < skel.length; i += 1) {
    if (!isNode(i) || cluster[i] >= 0) continue
    const id = clusters.length
    const members = []
    const stack = [i]
    cluster[i] = id
    while (stack.length > 0) {
      const p = stack.pop()
      members.push(p)
      const px = p % width
      const py = (p - px) / width
      for (const [dx, dy] of NEIGHBOURS) {
        const x = px + dx
        const y = py + dy
        if (!inside(x, y)) continue
        const q = y * width + x
        if (isNode(q) && cluster[q] < 0) {
          cluster[q] = id
          stack.push(q)
        }
      }
    }
    clusters.push({ members, ends: [] })
  }

  const visited = new Uint8Array(width * height)
  const branches = []
  const pushBranch = (points, from, to) => {
    if (points.length < 2) return
    const id = branches.length
    branches.push({ points, from, to, closed: false })
    if (from >= 0) clusters[from].ends.push({ branch: id, side: 0 })
    if (to >= 0) clusters[to].ends.push({ branch: id, side: 1 })
  }

  // 从每个节点出发沿度数 2 的链走到下一个节点
  for (let start = 0; start < skel.length; start += 1) {
    if (!isNode(start)) continue
    const sx = start % width
    const sy = (start - sx) / width
    for (const [dx, dy] of NEIGHBOURS) {
      const x = sx + dx
      const y = sy + dy
      if (!has(x, y)) continue
      const q = y * width + x
      if (isNode(q)) {
        // 相邻的两个节点分属不同簇：一条两像素的短分支
        if (cluster[q] !== cluster[start] && start < q) pushBranch([[sx, sy], [x, y]], cluster[start], cluster[q])
        continue
      }
      if (visited[q]) continue
      const points = [[sx, sy]]
      let prev = start
      let cur = q
      let to = -1
      while (true) {
        visited[cur] = 1
        const cx = cur % width
        const cy = (cur - cx) / width
        points.push([cx, cy])
        let next = -1
        for (const [ex, ey] of NEIGHBOURS) {
          const nx = cx + ex
          const ny = cy + ey
          if (!has(nx, ny)) continue
          const n = ny * width + nx
          if (n === prev) continue
          if (isNode(n)) {
            next = n
            break
          }
          if (!visited[n]) next = n
        }
        if (next < 0) break
        if (isNode(next)) {
          points.push([next % width, Math.floor(next / width)])
          to = cluster[next]
          break
        }
        prev = cur
        cur = next
      }
      pushBranch(points, cluster[start], to)
    }
  }

  // 闭环：没有节点的链
  for (let start = 0; start < skel.length; start += 1) {
    if (!skel[start] || visited[start] || isNode(start)) continue
    const points = []
    let prev = -1
    let cur = start
    while (cur >= 0 && !visited[cur]) {
      visited[cur] = 1
      const cx = cur % width
      const cy = (cur - cx) / width
      points.push([cx, cy])
      let next = -1
      for (const [ex, ey] of NEIGHBOURS) {
        const nx = cx + ex
        const ny = cy + ey
        if (!has(nx, ny)) continue
        const n = ny * width + nx
        if (n !== prev && !visited[n]) {
          next = n
          break
        }
      }
      prev = cur
      cur = next
    }
    if (points.length >= 6) branches.push({ points, from: -1, to: -1, closed: true })
  }

  return { branches, clusters }
}

function polylineLength(points, closed) {
  let length = 0
  for (let i = 0; i < points.length - 1; i += 1) length += Math.hypot(points[i + 1][0] - points[i][0], points[i + 1][1] - points[i][1])
  if (closed && points.length > 1) length += Math.hypot(points[0][0] - points[points.length - 1][0], points[0][1] - points[points.length - 1][1])
  return length
}

/** 分支在某一端的「来向」：从端点往里数几个点，指向端点。 */
function endDirection(points, side) {
  const k = Math.min(6, points.length - 1)
  const a = side === 0 ? points[k] : points[points.length - 1 - k]
  const b = side === 0 ? points[0] : points[points.length - 1]
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len = Math.hypot(dx, dy) || 1
  return [dx / len, dy / len]
}

/**
 * 剪毛刺 + 在交点把分支接成长笔画。
 * 一簇只剩两条分支时直接相接（拐角也接，星星会顺着拐过去）；三条以上按来向最接近反向的成对相接。
 */
function assemble(branches, clusters, spurLength) {
  const alive = branches.map(() => true)
  // 毛刺：一端是自由端、长度很短、另一端是交点的分支
  for (let round = 0; round < 2; round += 1) {
    for (let i = 0; i < branches.length; i += 1) {
      const b = branches[i]
      if (!alive[i] || b.closed) continue
      const length = polylineLength(b.points, false)
      if (length >= spurLength) continue
      const incident = (c) => (c < 0 ? 0 : clusters[c].ends.filter((e) => alive[e.branch]).length)
      const fromN = incident(b.from)
      const toN = incident(b.to)
      const freeFrom = b.from < 0 || fromN <= 1
      const freeTo = b.to < 0 || toN <= 1
      if ((freeFrom && toN >= 3) || (freeTo && fromN >= 3)) alive[i] = false
    }
  }

  // 链：每条链两端各记着原始分支端的 id（branch*2+side）
  const chains = new Map()
  const endToChain = new Map()
  for (let i = 0; i < branches.length; i += 1) {
    if (!alive[i]) continue
    const chain = { points: branches[i].points.slice(), head: i * 2, tail: i * 2 + 1, closed: branches[i].closed }
    chains.set(i, chain)
    if (!chain.closed) {
      endToChain.set(chain.head, chain)
      endToChain.set(chain.tail, chain)
    }
  }
  const join = (endA, endB) => {
    const a = endToChain.get(endA)
    const b = endToChain.get(endB)
    if (!a || !b) return
    if (a === b) {
      a.closed = true
      endToChain.delete(a.head)
      endToChain.delete(a.tail)
      return
    }
    if (a.head === endA) {
      a.points.reverse()
      ;[a.head, a.tail] = [a.tail, a.head]
    }
    if (b.tail === endB) {
      b.points.reverse()
      ;[b.head, b.tail] = [b.tail, b.head]
    }
    const merged = { points: a.points.concat(b.points.slice(1)), head: a.head, tail: b.tail, closed: false }
    endToChain.delete(endA)
    endToChain.delete(endB)
    endToChain.set(merged.head, merged)
    endToChain.set(merged.tail, merged)
    for (const [key, chain] of chains) if (chain === a || chain === b) chains.delete(key)
    chains.set(`m${merged.head}`, merged)
  }

  for (const cluster of clusters) {
    const ends = cluster.ends.filter((e) => alive[e.branch]).map((e) => ({
      id: e.branch * 2 + e.side,
      dir: endDirection(branches[e.branch].points, e.side),
    }))
    if (ends.length === 2) {
      join(ends[0].id, ends[1].id)
      continue
    }
    if (ends.length < 3) continue
    const pairs = []
    for (let i = 0; i < ends.length; i += 1) {
      for (let j = i + 1; j < ends.length; j += 1) {
        const straight = -(ends[i].dir[0] * ends[j].dir[0] + ends[i].dir[1] * ends[j].dir[1])
        if (straight > 0.5) pairs.push({ i, j, straight })
      }
    }
    pairs.sort((p, q) => q.straight - p.straight)
    const used = new Set()
    for (const { i, j } of pairs) {
      if (used.has(i) || used.has(j)) continue
      used.add(i)
      used.add(j)
      join(ends[i].id, ends[j].id)
    }
  }
  return Array.from(chains.values())
}

/** 移动平均平滑；开放折线固定两端。 */
function smooth(points, closed, iterations) {
  let current = points
  for (let it = 0; it < iterations; it += 1) {
    const n = current.length
    const next = new Array(n)
    for (let i = 0; i < n; i += 1) {
      if (!closed && (i === 0 || i === n - 1)) {
        next[i] = current[i]
        continue
      }
      const a = current[(i - 1 + n) % n]
      const b = current[i]
      const c = current[(i + 1) % n]
      next[i] = [(a[0] + 2 * b[0] + c[0]) / 4, (a[1] + 2 * b[1] + c[1]) / 4]
    }
    current = next
  }
  return current
}

/** 按弧长等距重采样（开放或闭合）。 */
function resample(points, closed, spacing) {
  const n = points.length
  const segments = closed ? n : n - 1
  const lengths = new Float32Array(segments + 1)
  for (let i = 0; i < segments; i += 1) {
    const a = points[i]
    const b = points[(i + 1) % n]
    lengths[i + 1] = lengths[i] + Math.hypot(b[0] - a[0], b[1] - a[1])
  }
  const total = lengths[segments]
  if (total <= 0) return { points: [], length: 0 }
  const count = Math.max(closed ? 3 : 2, Math.round(total / spacing) + (closed ? 0 : 1))
  const out = new Array(count)
  let cursor = 0
  for (let i = 0; i < count; i += 1) {
    const target = closed ? (i / count) * total : (i / (count - 1)) * total
    while (cursor < segments - 1 && lengths[cursor + 1] < target) cursor += 1
    const span = lengths[cursor + 1] - lengths[cursor]
    const t = span > 1e-9 ? (target - lengths[cursor]) / span : 0
    const a = points[cursor]
    const b = points[(cursor + 1) % n]
    out[i] = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
  }
  return { points: out, length: total }
}

/**
 * @param {Float32Array} mask 0..1 的 alpha 蒙版
 * @returns {{ strokes: Array<{points:[number,number][], widths:number[], closed:boolean, length:number}>, maxHalfWidth:number }}
 *   points / widths / length 都是蒙版像素单位；widths 是每个点处的半笔宽。
 */
export function extractStrokes(mask, width, height, { threshold = 0.5, spacing = 1.6, spur = 0.06, minLength = 6 } = {}) {
  // 细化的代价和像素数成正比，最长边超过 320 就减半分辨率算；用 max 采样，细描边不会断
  const step = Math.max(width, height) > 320 ? 2 : 1
  const w = Math.ceil(width / step)
  const h = Math.ceil(height / step)
  const bin = new Uint8Array(w * h)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let on = 0
      for (let sy = 0; sy < step && !on; sy += 1) {
        for (let sx = 0; sx < step; sx += 1) {
          const mx = Math.min(width - 1, x * step + sx)
          const my = Math.min(height - 1, y * step + sy)
          if (mask[my * width + mx] >= threshold) {
            on = 1
            break
          }
        }
      }
      bin[y * w + x] = on
    }
  }

  const distance = distanceTransform(bin, w, h)
  const skeleton = thin(bin, w, h)
  const { branches, clusters } = traceBranches(skeleton, w, h)
  const chains = assemble(branches, clusters, (spur * Math.max(w, h)))

  const widthAt = (x, y) => {
    const ix = Math.max(0, Math.min(w - 1, Math.round(x)))
    const iy = Math.max(0, Math.min(h - 1, Math.round(y)))
    return Math.max(0.5, distance[iy * w + ix])
  }
  let maxHalfWidth = 0
  for (let i = 0; i < skeleton.length; i += 1) if (skeleton[i] && distance[i] > maxHalfWidth) maxHalfWidth = distance[i]

  const strokes = []
  for (const chain of chains) {
    const smoothed = smooth(chain.points, chain.closed, 3)
    const { points, length } = resample(smoothed, chain.closed, spacing / step)
    if (points.length < 2 || length * step < minLength) continue
    strokes.push({
      points: points.map(([x, y]) => [(x + 0.5) * step, (y + 0.5) * step]),
      widths: points.map(([x, y]) => widthAt(x, y) * step),
      closed: chain.closed,
      length: length * step,
    })
  }
  strokes.sort((a, b) => b.length - a.length)
  return { strokes, maxHalfWidth: maxHalfWidth * step }
}
