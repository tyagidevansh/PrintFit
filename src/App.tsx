import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  Check,
  FileDown,
  ImagePlus,
  Link2,
  Link2Off,
  LoaderCircle,
  LockKeyhole,
  Minus,
  Plus,
  RotateCcw,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { createCustomShelfLayouts, createFixedSizeLayouts, createLayouts } from './layout'
import { exportPdf } from './pdf'
import type { MarginPreset, Photo } from './types'

const MIN_PER_PAGE = 1
const MAX_PER_PAGE = 30
const MIN_COPIES = 1
const MAX_COPIES = 20
const DEFAULT_FIXED_WIDTH_CM = 8.89
const DEFAULT_FIXED_HEIGHT_CM = 6.35

const MARGINS: Record<MarginPreset, { label: string; value: number; note: string }> = {
  normal: { label: 'Normal', value: 12.7, note: 'Safe for every printer' },
  narrow: { label: 'Narrow', value: 6.35, note: 'More room, usually safe' },
  danger: { label: 'Dangerously narrow', value: 3, note: 'Check your printer first' },
}

const SIZE_OPTIONS = [
  { value: 2, label: '½ page' },
  { value: 4, label: '¼ page' },
  { value: 6, label: '⅙ page' },
  { value: 8, label: '⅛ page' },
  { value: 9, label: '¹⁄₉ page' },
  { value: 12, label: '¹⁄₁₂ page' },
]

function readPhoto(file: File): Promise<Photo> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () =>
      resolve({
        id: `${file.name}-${file.lastModified}-${file.size}-${crypto.randomUUID()}`,
        file,
        url,
        width: image.naturalWidth,
        height: image.naturalHeight,
        aspect: image.naturalWidth / image.naturalHeight,
        count: 1,
      })
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`${file.name} could not be read.`))
    }
    image.src = url
  })
}

function App() {
  const [photos, setPhotos] = useState<Photo[]>([])
  const [perPage, setPerPage] = useState(6)
  const [customInput, setCustomInput] = useState('6')
  const [fixedSizeOn, setFixedSizeOn] = useState(false)
  const [fixedWidthCm, setFixedWidthCm] = useState(String(DEFAULT_FIXED_WIDTH_CM))
  const [fixedHeightCm, setFixedHeightCm] = useState(String(DEFAULT_FIXED_HEIGHT_CM))
  const [marginPreset, setMarginPreset] = useState<MarginPreset>('narrow')
  const [dragging, setDragging] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [inputOverrides, setInputOverrides] = useState<Record<string, { width: string; height: string }>>({})
  const [unlockedPhotos, setUnlockedPhotos] = useState<Record<string, boolean>>({})
  const fileInput = useRef<HTMLInputElement>(null)
  const photosRef = useRef<Photo[]>([])

  useEffect(() => {
    photosRef.current = photos
  }, [photos])

  useEffect(
    () => () => {
      photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.url))
    },
    [],
  )

  const addFiles = useCallback(async (incoming: FileList | File[]) => {
    const files = Array.from(incoming).filter((file) => file.type.startsWith('image/'))
    if (!files.length) {
      setError('Choose image files such as JPEG, PNG, or WebP.')
      return
    }

    setError('')
    const results = await Promise.allSettled(files.map(readPhoto))
    const loaded = results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
    setPhotos((current) => [...current, ...loaded])
    if (loaded.length !== files.length) setError(`${files.length - loaded.length} image${files.length - loaded.length === 1 ? '' : 's'} could not be read.`)
  }, [])

  const margin = MARGINS[marginPreset].value
  const expandedPhotos = useMemo(
    () => photos.flatMap((photo) => Array.from({ length: photo.count }, (_, copyIndex) => (copyIndex === 0 ? photo : { ...photo, id: `${photo.id}__copy-${copyIndex}` }))),
    [photos],
  )
  const fixedWidthMm = (Number(fixedWidthCm) || DEFAULT_FIXED_WIDTH_CM) * 10
  const fixedHeightMm = (Number(fixedHeightCm) || DEFAULT_FIXED_HEIGHT_CM) * 10

  const baseLayouts = useMemo(
    () =>
      fixedSizeOn
        ? createFixedSizeLayouts(expandedPhotos, fixedWidthMm, fixedHeightMm, margin)
        : createLayouts(expandedPhotos, perPage, margin),
    [expandedPhotos, perPage, margin, fixedSizeOn, fixedWidthMm, fixedHeightMm],
  )

  const baseSizes = useMemo(() => {
    const sizes: Record<string, { width: number; height: number }> = {}
    for (const page of baseLayouts) {
      for (const placement of page.placements) {
        const baseId = placement.photo.id.split('__copy-')[0]
        if (!sizes[baseId]) {
          sizes[baseId] = {
            width: placement.width,
            height: placement.height,
          }
        }
      }
    }
    return sizes
  }, [baseLayouts])

  const overrides = useMemo(() => {
    const parsed: Record<string, { width: number; height: number }> = {}
    for (const [id, val] of Object.entries(inputOverrides)) {
      const w = parseFloat(val.width)
      const h = parseFloat(val.height)
      if (!Number.isNaN(w) && w > 0 && !Number.isNaN(h) && h > 0) {
        parsed[id] = { width: w, height: h }
      }
    }
    return parsed
  }, [inputOverrides])

  const hasOverrides = useMemo(() => Object.keys(overrides).length > 0, [overrides])

  const layouts = useMemo(() => {
    if (hasOverrides) {
      return createCustomShelfLayouts(expandedPhotos, overrides, baseSizes, margin)
    } else {
      return baseLayouts
    }
  }, [hasOverrides, expandedPhotos, overrides, baseSizes, margin, baseLayouts])

  const averageEfficiency = layouts.length
    ? Math.round((layouts.reduce((sum, page) => sum + page.efficiency, 0) / layouts.length) * 100)
    : 0

  const removePhoto = (id: string) => {
    setPhotos((current) => {
      const target = current.find((photo) => photo.id === id)
      if (target) URL.revokeObjectURL(target.url)
      return current.filter((photo) => photo.id !== id)
    })
    setInputOverrides((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
    setUnlockedPhotos((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
  }

  const clearPhotos = () => {
    photos.forEach((photo) => URL.revokeObjectURL(photo.url))
    setPhotos([])
    setInputOverrides({})
    setUnlockedPhotos({})
  }

  const handleOverrideWidthChange = (photo: Photo, valueString: string) => {
    const isUnlocked = !!unlockedPhotos[photo.id]

    if (valueString === '') {
      setInputOverrides((current) => {
        const next = { ...current }
        if (next[photo.id]) {
          const defaultH = baseSizes[photo.id]
            ? (baseSizes[photo.id].height / 10).toFixed(2)
            : ((photo.aspect >= 1 ? 63.5 : 88.9) / 10).toFixed(2)
          next[photo.id] = {
            width: '',
            height: next[photo.id].height || defaultH,
          }
        }
        return next
      })
      return
    }

    const w = parseFloat(valueString)
    if (!Number.isNaN(w) && w > 0) {
      if (isUnlocked) {
        setInputOverrides((current) => {
          const next = { ...current }
          const defaultH = baseSizes[photo.id]
            ? (baseSizes[photo.id].height / 10).toFixed(2)
            : ((photo.aspect >= 1 ? 63.5 : 88.9) / 10).toFixed(2)
          next[photo.id] = {
            width: valueString,
            height: next[photo.id]?.height || defaultH,
          }
          return next
        })
      } else {
        const h = w / photo.aspect
        setInputOverrides((current) => ({
          ...current,
          [photo.id]: {
            width: valueString,
            height: h.toFixed(2),
          },
        }))
      }
    } else {
      setInputOverrides((current) => ({
        ...current,
        [photo.id]: {
          ...current[photo.id],
          width: valueString,
        },
      }))
    }
  }

  const handleOverrideHeightChange = (photo: Photo, valueString: string) => {
    const isUnlocked = !!unlockedPhotos[photo.id]

    if (valueString === '') {
      setInputOverrides((current) => {
        const next = { ...current }
        if (next[photo.id]) {
          const defaultW = baseSizes[photo.id]
            ? (baseSizes[photo.id].width / 10).toFixed(2)
            : ((photo.aspect >= 1 ? 88.9 : 63.5) / 10).toFixed(2)
          next[photo.id] = {
            width: next[photo.id].width || defaultW,
            height: '',
          }
        }
        return next
      })
      return
    }

    const h = parseFloat(valueString)
    if (!Number.isNaN(h) && h > 0) {
      if (isUnlocked) {
        setInputOverrides((current) => {
          const next = { ...current }
          const defaultW = baseSizes[photo.id]
            ? (baseSizes[photo.id].width / 10).toFixed(2)
            : ((photo.aspect >= 1 ? 88.9 : 63.5) / 10).toFixed(2)
          next[photo.id] = {
            width: next[photo.id]?.width || defaultW,
            height: valueString,
          }
          return next
        })
      } else {
        const w = h * photo.aspect
        setInputOverrides((current) => ({
          ...current,
          [photo.id]: {
            width: w.toFixed(2),
            height: valueString,
          },
        }))
      }
    } else {
      setInputOverrides((current) => ({
        ...current,
        [photo.id]: {
          ...current[photo.id],
          height: valueString,
        },
      }))
    }
  }

  const toggleAspectLock = (photo: Photo) => {
    const nextUnlocked = !unlockedPhotos[photo.id]
    setUnlockedPhotos((current) => ({
      ...current,
      [photo.id]: nextUnlocked,
    }))

    // If locking back, align height to preserve aspect based on the current width override
    if (!nextUnlocked) {
      const currentOverride = inputOverrides[photo.id]
      if (currentOverride && currentOverride.width !== '') {
        const w = parseFloat(currentOverride.width)
        if (!Number.isNaN(w) && w > 0) {
          const h = w / photo.aspect
          setInputOverrides((current) => ({
            ...current,
            [photo.id]: {
              width: currentOverride.width,
              height: h.toFixed(2),
            },
          }))
        }
      }
    }
  }

  const resetOverride = (id: string) => {
    setInputOverrides((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
  }

  const changeCopies = (id: string, delta: number) => {
    setPhotos((current) =>
      current.map((photo) =>
        photo.id === id ? { ...photo, count: Math.max(MIN_COPIES, Math.min(MAX_COPIES, photo.count + delta)) } : photo,
      ),
    )
  }

  const handleSelectPreset = (value: number) => {
    setPerPage(value)
    setCustomInput(String(value))
  }

  const handleStep = (delta: number) => {
    const next = Math.max(MIN_PER_PAGE, Math.min(MAX_PER_PAGE, perPage + delta))
    setPerPage(next)
    setCustomInput(String(next))
  }

  const handleCustomInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const raw = event.target.value
    setCustomInput(raw)
    if (raw === '') return
    const parsed = parseInt(raw, 10)
    if (!Number.isNaN(parsed) && parsed >= MIN_PER_PAGE && parsed <= MAX_PER_PAGE) {
      setPerPage(parsed)
    }
  }

  const handleCustomInputBlur = () => {
    const parsed = parseInt(customInput, 10)
    if (Number.isNaN(parsed) || parsed < MIN_PER_PAGE) {
      setPerPage(MIN_PER_PAGE)
      setCustomInput(String(MIN_PER_PAGE))
    } else if (parsed > MAX_PER_PAGE) {
      setPerPage(MAX_PER_PAGE)
      setCustomInput(String(MAX_PER_PAGE))
    } else {
      setPerPage(parsed)
      setCustomInput(String(parsed))
    }
  }

  const handleCustomKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.currentTarget.blur()
    }
  }

  const isCustomActive = !SIZE_OPTIONS.some((opt) => opt.value === perPage)

  const handleExport = async () => {
    if (!layouts.length || isExporting) return
    setIsExporting(true)
    setProgress(0)
    setError('')
    try {
      await exportPdf(layouts, setProgress)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The PDF could not be created.')
    } finally {
      setIsExporting(false)
    }
  }

  return (
    <main>
      <header className="site-header">
        <a className="brand" href="#top" aria-label="PrintFit home">
          <span className="brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          PrintFit
        </a>
        <div className="privacy-pill"><LockKeyhole size={14} /> 100% on your device</div>
      </header>

      <section className="hero" id="top">
        <div className="eyebrow"><Sparkles size={15} /> A tiny tool for expensive ink</div>
        <h1>Make every<br /><em>sheet</em> count.</h1>
        <p>Drop in your photos. PrintFit finds a space-saving arrangement, then makes a crisp A4 PDF—without uploading a single pixel.</p>
        <button className="hero-cta" onClick={() => fileInput.current?.click()}>
          Choose your photos <ArrowRight size={18} />
        </button>
        <div className="scribble" aria-hidden="true">less blank page<br />more good stuff ↗</div>
      </section>

      <section className="workspace" aria-label="Photo arrangement workspace">
        <div className="controls-panel">
          <div className="panel-heading">
            <div>
              <span className="step-number">01</span>
              <h2>Add photos</h2>
            </div>
            {photos.length > 0 && <button className="text-button" onClick={clearPhotos}><Trash2 size={14} /> Clear</button>}
          </div>

          <div
            className={`dropzone ${dragging ? 'is-dragging' : ''}`}
            onDragEnter={(event) => { event.preventDefault(); setDragging(true) }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false) }}
            onDrop={(event) => {
              event.preventDefault()
              setDragging(false)
              void addFiles(event.dataTransfer.files)
            }}
            onClick={() => fileInput.current?.click()}
          >
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
              multiple
              onChange={(event) => {
                if (event.target.files) void addFiles(event.target.files)
                event.target.value = ''
              }}
            />
            <div className="upload-icon"><ImagePlus size={25} strokeWidth={1.7} /></div>
            <strong>{dragging ? 'Drop them here' : 'Drop photos here'}</strong>
            <span>or click to browse · JPG, PNG, WebP</span>
          </div>

          {photos.length > 0 && (
            <div className="photo-strip">
              {photos.map((photo, index) => (
                <div className="photo-chip" key={photo.id}>
                  <img src={photo.url} alt={photo.file.name} />
                  <span>{index + 1}</span>
                  <button onClick={() => removePhoto(photo.id)} aria-label={`Remove ${photo.file.name}`}><X size={12} /></button>
                  <div className="copy-controls">
                    <button
                      type="button"
                      className="copy-btn"
                      onClick={() => changeCopies(photo.id, -1)}
                      disabled={photo.count <= MIN_COPIES}
                      aria-label={`Print ${photo.file.name} one fewer time`}
                    >
                      <Minus size={11} />
                    </button>
                    <span className="copy-count">{photo.count}</span>
                    <button
                      type="button"
                      className="copy-btn"
                      onClick={() => changeCopies(photo.id, 1)}
                      disabled={photo.count >= MAX_COPIES}
                      aria-label={`Print ${photo.file.name} one more time`}
                    >
                      <Plus size={11} />
                    </button>
                  </div>
                </div>
              ))}
              <button className="add-more" onClick={() => fileInput.current?.click()} aria-label="Add more photos"><ImagePlus size={20} /></button>
            </div>
          )}

          <div className="setting-block">
            <div className="setting-title"><span className="step-number">02</span><h2>Photo size</h2></div>
            <p>About how much of a sheet should each photo use?</p>
            <div className={`segmented size-options ${fixedSizeOn ? 'is-disabled' : ''}`}>
              {SIZE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className={perPage === option.value ? 'selected' : ''}
                  onClick={() => handleSelectPreset(option.value)}
                  disabled={fixedSizeOn}
                >
                  <span>{option.label}</span>
                  <small>{option.value} / page</small>
                </button>
              ))}
            </div>

            <div className={`custom-count-card ${isCustomActive ? 'active' : ''} ${fixedSizeOn ? 'is-disabled' : ''}`}>
              <div className="custom-count-info">
                <label htmlFor="custom-per-page">Custom count</label>
                <small>1–30 per sheet</small>
              </div>
              <div className="custom-count-stepper">
                <button
                  type="button"
                  className="stepper-btn"
                  onClick={() => handleStep(-1)}
                  disabled={fixedSizeOn || perPage <= MIN_PER_PAGE}
                  aria-label="Decrease photos per page"
                >
                  <Minus size={14} />
                </button>
                <input
                  id="custom-per-page"
                  type="number"
                  inputMode="numeric"
                  min={MIN_PER_PAGE}
                  max={MAX_PER_PAGE}
                  value={customInput}
                  onChange={handleCustomInputChange}
                  onBlur={handleCustomInputBlur}
                  onKeyDown={handleCustomKeyDown}
                  disabled={fixedSizeOn}
                  aria-label="Custom photos per page"
                />
                <button
                  type="button"
                  className="stepper-btn"
                  onClick={() => handleStep(1)}
                  disabled={fixedSizeOn || perPage >= MAX_PER_PAGE}
                  aria-label="Increase photos per page"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>

            <div className={`custom-count-card fixed-size-card ${fixedSizeOn ? 'active' : ''}`}>
              <div className="custom-count-info">
                <label htmlFor="fixed-size-toggle">Fixed print size</label>
                <small>exact cm, no cropping</small>
              </div>
              <button
                id="fixed-size-toggle"
                type="button"
                className={`toggle-switch ${fixedSizeOn ? 'on' : ''}`}
                onClick={() => setFixedSizeOn((current) => !current)}
                aria-pressed={fixedSizeOn}
                aria-label="Toggle fixed print size"
              >
                <span />
              </button>
            </div>

            {fixedSizeOn && (
              <div className="fixed-size-inputs">
                <label>
                  Width
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="1"
                    value={fixedWidthCm}
                    onChange={(event) => setFixedWidthCm(event.target.value)}
                  />
                  cm
                </label>
                <label>
                  Height
                  <input
                    type="number"
                    inputMode="decimal"
                    step="0.01"
                    min="1"
                    value={fixedHeightCm}
                    onChange={(event) => setFixedHeightCm(event.target.value)}
                  />
                  cm
                </label>
              </div>
            )}
          </div>

          <div className="setting-block">
            <div className="setting-title"><span className="step-number">03</span><h2>Page margins</h2></div>
            <div className="margin-options">
              {(Object.entries(MARGINS) as [MarginPreset, (typeof MARGINS)[MarginPreset]][]).map(([key, option]) => (
                <button key={key} className={marginPreset === key ? 'selected' : ''} onClick={() => setMarginPreset(key)}>
                  <span className="radio">{marginPreset === key && <Check size={12} strokeWidth={3} />}</span>
                  <span><strong>{option.label}</strong><small>{option.value} mm · {option.note}</small></span>
                </button>
              ))}
            </div>
          </div>

          {error && <div className="error-message">{error}</div>}

          <button className="export-button" onClick={handleExport} disabled={!photos.length || isExporting}>
            {isExporting ? <LoaderCircle className="spinner" size={19} /> : <FileDown size={19} />}
            {isExporting ? `Making PDF · ${Math.round(progress * 100)}%` : 'Download print-ready PDF'}
          </button>
          <p className="export-note">A4 · 180 DPI · Images stay on this device</p>
        </div>

        <div className="preview-panel">
          <div className="preview-header">
            <div>
              <span className="preview-label">Live preview</span>
              <h2>{photos.length ? `${layouts.length} A4 sheet${layouts.length === 1 ? '' : 's'}` : 'Your pages will appear here'}</h2>
            </div>
            {photos.length > 0 && (
              <div className="efficiency"><span>{averageEfficiency}%</span><small>space filled</small></div>
            )}
          </div>

          {!photos.length ? (
            <div className="empty-preview">
              <div className="empty-sheet">
                <div /><div /><div /><div /><div /><div />
              </div>
              <h3>Ready when you are.</h3>
              <p>Add two or more photos and watch the layout snap into place.</p>
            </div>
          ) : (
            <div className="page-list">
              {layouts.map((page, pageIndex) => (
                <div className="page-wrap" key={`${pageIndex}-${perPage}-${marginPreset}`}>
                  <div className="page-meta"><span>PAGE {String(pageIndex + 1).padStart(2, '0')}</span><span>{Math.round(page.efficiency * 100)}% FILLED</span></div>
                  <div className="a4-page">
                    {page.placements.map((placement) => (
                      <div
                        className="photo-placement"
                        key={placement.photo.id}
                        style={{
                          left: `${(placement.x / 210) * 100}%`,
                          top: `${(placement.y / 297) * 100}%`,
                          width: `${(placement.width / 210) * 100}%`,
                          height: `${(placement.height / 297) * 100}%`,
                        }}
                      >
                        <img src={placement.photo.url} alt="" />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {photos.length > 0 && (
            <div className="optimizer-note">
              <RotateCcw size={17} />
              <div><strong>Best fit found</strong><span>Compared thousands of arrangements while keeping every photo uncropped.</span></div>
            </div>
          )}
        </div>

        <div className="dimensions-panel">
          <span className="preview-label">Exact Sizing</span>
          <h2>Image sizes</h2>
          <p>View calculated dimensions or type specific sizes in <strong>cm</strong> to customize.</p>

          {!photos.length ? (
            <div className="empty-table-state">
              Add photos to see and customize print sizes.
            </div>
          ) : (
            <table className="dimensions-table">
              <thead>
                <tr>
                  <th>Photo</th>
                  <th>Width (cm)</th>
                  <th></th>
                  <th>Height (cm)</th>
                  <th style={{ width: '40px' }}></th>
                </tr>
              </thead>
              <tbody>
                {photos.map((photo, idx) => {
                  const hasOverride = !!overrides[photo.id]
                  const isUnlocked = !!unlockedPhotos[photo.id]
                  const currentW = hasOverride
                    ? inputOverrides[photo.id].width
                    : baseSizes[photo.id]
                    ? Number((baseSizes[photo.id].width / 10).toFixed(2))
                    : Number(((photo.aspect >= 1 ? 88.9 : 63.5) / 10).toFixed(2))
                  const currentH = hasOverride
                    ? inputOverrides[photo.id].height
                    : baseSizes[photo.id]
                    ? Number((baseSizes[photo.id].height / 10).toFixed(2))
                    : Number(((photo.aspect >= 1 ? 63.5 : 88.9) / 10).toFixed(2))

                  return (
                    <tr key={photo.id}>
                      <td>
                        <div className="table-photo-cell">
                          <span className="table-photo-idx">{idx + 1}</span>
                          <img src={photo.url} alt="" />
                        </div>
                      </td>
                      <td>
                        <div className="dim-input-group">
                          <input
                            type="number"
                            inputMode="decimal"
                            step="0.1"
                            min="0.1"
                            className={`dim-input ${hasOverride && inputOverrides[photo.id]?.width !== '' ? 'is-custom' : ''}`}
                            value={currentW}
                            onChange={(e) => handleOverrideWidthChange(photo, e.target.value)}
                            aria-label={`Width for photo ${idx + 1}`}
                          />
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className={`aspect-lock-btn ${isUnlocked ? 'is-unlocked' : 'is-locked'}`}
                          onClick={() => toggleAspectLock(photo)}
                          title={isUnlocked ? 'Aspect ratio is unlocked. Click to lock.' : 'Aspect ratio is locked. Click to unlock.'}
                          aria-label={isUnlocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
                        >
                          {isUnlocked ? <Link2Off size={14} /> : <Link2 size={14} />}
                        </button>
                      </td>
                      <td>
                        <div className="dim-input-group">
                          <input
                            type="number"
                            inputMode="decimal"
                            step="0.1"
                            min="0.1"
                            className={`dim-input ${hasOverride && inputOverrides[photo.id]?.height !== '' ? 'is-custom' : ''}`}
                            value={currentH}
                            onChange={(e) => handleOverrideHeightChange(photo, e.target.value)}
                            aria-label={`Height for photo ${idx + 1}`}
                          />
                        </div>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="reset-dim-btn"
                          onClick={() => resetOverride(photo.id)}
                          disabled={!hasOverride}
                          title="Reset to default calculated size"
                          aria-label={`Reset size for photo ${idx + 1}`}
                        >
                          <RotateCcw size={13} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <footer>
        <span>PrintFit</span>
        <p>No accounts. No uploads. No nonsense.</p>
        <span>Made for home printers</span>
      </footer>
    </main>
  )
}

export default App
