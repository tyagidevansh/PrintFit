import type { PageLayout } from './types'

const A4_WIDTH_MM = 210
const A4_HEIGHT_MM = 297
const EXPORT_DPI = 180
const PX_PER_MM = EXPORT_DPI / 25.4
const GUTTER_MM = 0.7

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('A photo could not be read.'))
    image.src = url
  })
}

async function renderPage(page: PageLayout) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(A4_WIDTH_MM * PX_PER_MM)
  canvas.height = Math.round(A4_HEIGHT_MM * PX_PER_MM)
  const context = canvas.getContext('2d', { alpha: false })
  if (!context) throw new Error('Canvas is not available in this browser.')

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'

  await Promise.all(
    page.placements.map(async (placement) => {
      const image = await loadImage(placement.photo.url)
      const inset = GUTTER_MM / 2
      const boxX = placement.x + inset
      const boxY = placement.y + inset
      const boxW = Math.max(0.1, placement.width - GUTTER_MM)
      const boxH = Math.max(0.1, placement.height - GUTTER_MM)
      const imageAspect = image.naturalWidth / image.naturalHeight
      const boxAspect = boxW / boxH
      let drawW = boxW
      let drawH = boxH
      if (imageAspect > boxAspect) drawH = boxW / imageAspect
      else drawW = boxH * imageAspect

      context.drawImage(
        image,
        (boxX + (boxW - drawW) / 2) * PX_PER_MM,
        (boxY + (boxH - drawH) / 2) * PX_PER_MM,
        drawW * PX_PER_MM,
        drawH * PX_PER_MM,
      )
    }),
  )

  return canvas.toDataURL('image/jpeg', 0.94)
}

export async function exportPdf(layouts: PageLayout[], onProgress: (progress: number) => void) {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true })

  for (let index = 0; index < layouts.length; index += 1) {
    if (index > 0) pdf.addPage('a4', 'portrait')
    const pageImage = await renderPage(layouts[index])
    pdf.addImage(pageImage, 'JPEG', 0, 0, A4_WIDTH_MM, A4_HEIGHT_MM, undefined, 'FAST')
    onProgress((index + 1) / layouts.length)
    await new Promise((resolve) => window.setTimeout(resolve, 0))
  }

  pdf.save(`printfit-${new Date().toISOString().slice(0, 10)}.pdf`)
}
