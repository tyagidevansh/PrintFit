import type { PageLayout, Photo } from './types'

type Direction = 'horizontal' | 'vertical'

interface Rect {
  id: string
  x: number
  y: number
  width: number
  height: number
}

interface Node {
  width: number
  height: number
  leaves: Rect[]
}

const PAGE_WIDTH = 210
const PAGE_HEIGHT = 297

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hashPhotos(photos: Photo[]) {
  let hash = 2166136261
  for (const photo of photos) {
    hash ^= Math.round(photo.aspect * 10000)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function leaf(photo: Photo): Node {
  return {
    width: photo.aspect,
    height: 1,
    leaves: [{ id: photo.id, x: 0, y: 0, width: photo.aspect, height: 1 }],
  }
}

function scaleNode(node: Node, scale: number, dx = 0, dy = 0): Rect[] {
  return node.leaves.map((rect) => ({
    id: rect.id,
    x: rect.x * scale + dx,
    y: rect.y * scale + dy,
    width: rect.width * scale,
    height: rect.height * scale,
  }))
}

function combine(a: Node, b: Node, direction: Direction): Node {
  if (direction === 'horizontal') {
    const height = Math.max(a.height, b.height)
    const scaleA = height / a.height
    const scaleB = height / b.height
    const widthA = a.width * scaleA
    const widthB = b.width * scaleB
    return {
      width: widthA + widthB,
      height,
      leaves: [...scaleNode(a, scaleA), ...scaleNode(b, scaleB, widthA, 0)],
    }
  }

  const width = Math.max(a.width, b.width)
  const scaleA = width / a.width
  const scaleB = width / b.width
  const heightA = a.height * scaleA
  const heightB = b.height * scaleB
  return {
    width,
    height: heightA + heightB,
    leaves: [...scaleNode(a, scaleA), ...scaleNode(b, scaleB, 0, heightA)],
  }
}

function shuffled<T>(items: T[], random: () => number) {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function buildRandomTree(photos: Photo[], random: () => number): Node {
  const nodes = shuffled(photos, random).map(leaf)
  while (nodes.length > 1) {
    const firstIndex = Math.floor(random() * nodes.length)
    const [first] = nodes.splice(firstIndex, 1)
    const secondIndex = Math.floor(random() * nodes.length)
    const [second] = nodes.splice(secondIndex, 1)

    const horizontal = random() < 0.5
    const swap = random() < 0.5
    nodes.push(combine(swap ? second : first, swap ? first : second, horizontal ? 'horizontal' : 'vertical'))
  }
  return nodes[0]
}

function buildGreedyTree(photos: Photo[], targetAspect: number, alternate: boolean): Node {
  let nodes = [...photos]
    .sort((a, b) => (alternate ? a.aspect - b.aspect : b.aspect - a.aspect))
    .map(leaf)

  while (nodes.length > 1) {
    let best: { i: number; j: number; node: Node; score: number } | undefined
    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        for (const direction of ['horizontal', 'vertical'] as const) {
          const node = combine(nodes[i], nodes[j], direction)
          const ratio = node.width / node.height
          const score = Math.abs(Math.log(ratio / targetAspect))
          if (!best || score < best.score) best = { i, j, node, score }
        }
      }
    }
    if (!best) break
    nodes = nodes.filter((_, index) => index !== best!.i && index !== best!.j)
    nodes.push(best.node)
  }
  return nodes[0]
}

function scoreNode(node: Node, targetAspect: number) {
  const ratio = node.width / node.height
  const waste = 1 - Math.min(ratio / targetAspect, targetAspect / ratio)
  const areas = node.leaves.map((item) => item.width * item.height)
  const logs = areas.map(Math.log)
  const mean = logs.reduce((sum, value) => sum + value, 0) / logs.length
  const deviation = Math.sqrt(logs.reduce((sum, value) => sum + (value - mean) ** 2, 0) / logs.length)
  const spread = Math.max(...areas) / Math.max(0.0001, Math.min(...areas))
  return waste * 12 + deviation * 0.09 + Math.max(0, spread - 2.4) * 0.35
}

function optimizePage(photos: Photo[], margin: number, targetCount: number): PageLayout {
  const usableWidth = PAGE_WIDTH - margin * 2
  const usableHeight = PAGE_HEIGHT - margin * 2
  const targetAspect = usableWidth / usableHeight

  if (photos.length === 1) {
    const photo = photos[0]
    const fullScale = Math.min(usableWidth / photo.aspect, usableHeight)
    const currentEfficiency = (photo.aspect * fullScale * fullScale) / (usableWidth * usableHeight)
    const desiredEfficiency = 1 / targetCount
    const scale = fullScale * Math.min(1, Math.sqrt(desiredEfficiency / currentEfficiency))
    const width = photo.aspect * scale
    const height = scale
    return {
      placements: [{ photo, x: margin + (usableWidth - width) / 2, y: margin + (usableHeight - height) / 2, width, height }],
      efficiency: (width * height) / (usableWidth * usableHeight),
      usedWidth: width,
      usedHeight: height,
    }
  }

  const random = mulberry32(hashPhotos(photos))
  const iterations = Math.min(12000, 2200 + photos.length * 650)
  let best = buildGreedyTree(photos, targetAspect, false)
  let bestScore = scoreNode(best, targetAspect)
  const otherGreedy = buildGreedyTree(photos, targetAspect, true)
  const otherScore = scoreNode(otherGreedy, targetAspect)
  if (otherScore < bestScore) {
    best = otherGreedy
    bestScore = otherScore
  }

  for (let i = 0; i < iterations; i += 1) {
    const candidate = buildRandomTree(photos, random)
    const score = scoreNode(candidate, targetAspect)
    if (score < bestScore) {
      best = candidate
      bestScore = score
    }
  }

  const fullScale = Math.min(usableWidth / best.width, usableHeight / best.height)
  const fullEfficiency = (best.width * best.height * fullScale * fullScale) / (usableWidth * usableHeight)
  const desiredEfficiency = photos.length / targetCount
  const scale = fullScale * Math.min(1, Math.sqrt(desiredEfficiency / fullEfficiency))
  const width = best.width * scale
  const height = best.height * scale
  const offsetX = margin + (usableWidth - width) / 2
  const offsetY = margin + (usableHeight - height) / 2
  const byId = new Map(photos.map((photo) => [photo.id, photo]))

  return {
    placements: best.leaves.map((rect) => ({
      photo: byId.get(rect.id)!,
      x: offsetX + rect.x * scale,
      y: offsetY + rect.y * scale,
      width: rect.width * scale,
      height: rect.height * scale,
    })),
    efficiency: (width * height) / (usableWidth * usableHeight),
    usedWidth: width,
    usedHeight: height,
  }
}

export function createLayouts(photos: Photo[], perPage: number, margin: number) {
  const safePerPage = Math.max(1, Math.floor(perPage || 1))
  const pages: PageLayout[] = []
  for (let index = 0; index < photos.length; index += safePerPage) {
    pages.push(optimizePage(photos.slice(index, index + safePerPage), margin, safePerPage))
  }
  return pages
}

export function createFixedSizeLayouts(photos: Photo[], cellWidth: number, cellHeight: number, margin: number) {
  const usableWidth = PAGE_WIDTH - margin * 2
  const usableHeight = PAGE_HEIGHT - margin * 2
  const longSide = Math.max(cellWidth, cellHeight)
  const shortSide = Math.min(cellWidth, cellHeight)

  const pages: PageLayout[] = []
  let placements: PageLayout['placements'] = []
  let x = margin
  let y = margin
  let shelfHeight = 0

  const flushPage = () => {
    if (!placements.length) return
    pages.push({
      placements,
      efficiency: placements.reduce((sum, p) => sum + p.width * p.height, 0) / (usableWidth * usableHeight),
      usedWidth: usableWidth,
      usedHeight: usableHeight,
    })
    placements = []
  }

  for (const photo of photos) {
    const cell = photo.aspect >= 1 ? { w: longSide, h: shortSide } : { w: shortSide, h: longSide }

    if (x + cell.w > margin + usableWidth + 1e-6) {
      x = margin
      y += shelfHeight
      shelfHeight = 0
    }

    if (y + cell.h > margin + usableHeight + 1e-6) {
      flushPage()
      x = margin
      y = margin
      shelfHeight = 0
    }

    let drawW = cell.w
    let drawH = cell.h
    if (photo.aspect > cell.w / cell.h) drawH = cell.w / photo.aspect
    else drawW = cell.h * photo.aspect

    placements.push({
      photo,
      x: x + (cell.w - drawW) / 2,
      y: y + (cell.h - drawH) / 2,
      width: drawW,
      height: drawH,
    })

    x += cell.w
    shelfHeight = Math.max(shelfHeight, cell.h)
  }

  flushPage()
  return pages
}

export function createCustomShelfLayouts(
  photos: Photo[],
  overrides: Record<string, { width: number; height: number }>,
  baseSizes: Record<string, { width: number; height: number }>,
  margin: number
) {
  const usableWidth = PAGE_WIDTH - margin * 2
  const usableHeight = PAGE_HEIGHT - margin * 2

  const pages: PageLayout[] = []
  let placements: PageLayout['placements'] = []
  let x = margin
  let y = margin
  let shelfHeight = 0

  const flushPage = () => {
    if (!placements.length) return
    pages.push({
      placements,
      efficiency: placements.reduce((sum, p) => sum + p.width * p.height, 0) / (usableWidth * usableHeight),
      usedWidth: usableWidth,
      usedHeight: usableHeight,
    })
    placements = []
  }

  for (const photo of photos) {
    const baseId = photo.id.split('__copy-')[0]
    let drawW: number
    let drawH: number

    if (overrides[baseId]) {
      drawW = overrides[baseId].width * 10
      drawH = overrides[baseId].height * 10
    } else {
      const base = baseSizes[baseId]
      if (base) {
        drawW = base.width
        drawH = base.height
      } else {
        if (photo.aspect >= 1) {
          drawW = 88.9
          drawH = 88.9 / photo.aspect
        } else {
          drawH = 88.9
          drawW = 88.9 * photo.aspect
        }
      }
    }

    // Cap to page printable area
    if (drawW > usableWidth) {
      drawH = (usableWidth / drawW) * drawH
      drawW = usableWidth
    }
    if (drawH > usableHeight) {
      drawW = (usableHeight / drawH) * drawW
      drawH = usableHeight
    }

    // Wrap to new shelf
    if (x + drawW > margin + usableWidth + 1e-6) {
      x = margin
      y += shelfHeight
      shelfHeight = 0
    }

    // Wrap to new page
    if (y + drawH > margin + usableHeight + 1e-6) {
      flushPage()
      x = margin
      y = margin
      shelfHeight = 0
    }

    placements.push({
      photo,
      x,
      y,
      width: drawW,
      height: drawH,
    })

    x += drawW
    shelfHeight = Math.max(shelfHeight, drawH)
  }

  flushPage()
  return pages
}
