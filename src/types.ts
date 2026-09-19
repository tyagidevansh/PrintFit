export interface Photo {
  id: string
  file: File
  url: string
  width: number
  height: number
  aspect: number
  count: number
}

export interface PhotoPlacement {
  photo: Photo
  x: number
  y: number
  width: number
  height: number
}

export interface PageLayout {
  placements: PhotoPlacement[]
  efficiency: number
  usedWidth: number
  usedHeight: number
}

export type MarginPreset = 'normal' | 'narrow' | 'danger'
