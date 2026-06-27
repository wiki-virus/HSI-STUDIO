import { useState, useCallback, useEffect } from 'react'
import { X, Archive, Database, FileSpreadsheet, Image as ImageIcon, PaintBucket, Layers, FileBox, CheckCircle2 } from 'lucide-react'
import useAppStore from '../../stores/useAppStore'

const EXPORT_FORMATS = [
  { id: 'npz',       label: 'NumPy Archive (.npz)',      group: 'Full Datacube', icon: Archive, desc: 'Saves full datacube, wavelengths, and mask. (Python compatible)' },
  { id: 'envi',      label: 'ENVI (.hdr + .dat)',        group: 'Full Datacube', icon: Database, desc: 'Standard format for ENVI, MATLAB, and remote sensing tools.' },
  { id: 'csv',       label: 'Pixel-wise Data (.csv)',    group: 'Full Datacube', icon: FileSpreadsheet, desc: 'Exports all pixels + bands. Adds mask Class if present.' },
  { id: 'png-view',  label: 'Current View (PNG)',        group: 'Image Export', icon: ImageIcon, desc: 'Saves a screenshot of the currently displayed band view.' },
  { id: 'mask-png',  label: 'Annotation Mask (PNG)',     group: 'Mask Export', icon: PaintBucket, desc: 'Grayscale image of mask (white = annotated, black = back).' },
  { id: 'mask-npz',  label: 'Annotation Mask (NPZ)',     group: 'Mask Export', icon: FileBox, desc: 'NumPy array of the mask inside a .npz file.' },
  { id: 'mask-raw',  label: 'Annotation Mask (Raw)',     group: 'Mask Export', icon: Layers, desc: 'Raw binary file of the annotation mask.' },
]
export default function ExportPane({
  workerRef,
  canvasRef,
  maskRef,
  onClose
}) {
  const metadata = useAppStore(s => s.metadata)
  const fileName = useAppStore(s => s.fileName)
  const currentBand = useAppStore(s => s.currentBand)

  const [selectedFormat, setSelectedFormat] = useState('npz')
  const [saving, setSaving] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')
  const [excludeMasks, setExcludeMasks] = useState(false)

  const triggerDownload = useCallback((blob, filename) => {
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [])

  const handleSave = useCallback(async () => {
    if (!metadata) return
    setSaving(true)
    setStatusMsg('Preparing export...')

    const baseName = fileName || 'datacube'

    try {
      switch (selectedFormat) {
        // ─── Current View Screenshot ───
        case 'png-view': {
          setStatusMsg('Capturing current view...')
          const canvas = canvasRef?.current
          if (!canvas) throw new Error('No canvas available')

          let finalCanvas = canvas
          
          // If we want to include annotations, we combine them
          if (!excludeMasks) {
            const annotationCanvases = document.querySelectorAll('.annotation-canvas')
            if (annotationCanvases.length > 0) {
              finalCanvas = document.createElement('canvas')
              finalCanvas.width = canvas.width
              finalCanvas.height = canvas.height
              const ctx = finalCanvas.getContext('2d')
              ctx.drawImage(canvas, 0, 0)
              annotationCanvases.forEach(mCanvas => {
                ctx.drawImage(mCanvas, 0, 0, canvas.width, canvas.height)
              })
            }
          }

          const blob = await new Promise(resolve => finalCanvas.toBlob(resolve, 'image/png'))
          triggerDownload(blob, `${baseName}_band${currentBand}.png`)
          setStatusMsg('✓ Saved!')
          break
        }

        // ─── Mask as PNG ───
        case 'mask-png': {
          setStatusMsg('Exporting mask as PNG...')
          const mask = maskRef?.current
          if (!mask) throw new Error('No annotation mask available')

          const { samples, lines } = metadata
          const maskCanvas = document.createElement('canvas')
          maskCanvas.width = samples
          maskCanvas.height = lines
          const ctx = maskCanvas.getContext('2d')
          const imageData = ctx.createImageData(samples, lines)

          const classes = useAppStore.getState().classes
          const classColors = { 0: { r: 0, g: 0, b: 0 } }
          classes.forEach(c => {
            classColors[c.id] = {
              r: parseInt(c.color.slice(1, 3), 16),
              g: parseInt(c.color.slice(3, 5), 16),
              b: parseInt(c.color.slice(5, 7), 16)
            }
          })

          for (let i = 0; i < mask.length; i++) {
            const val = mask[i]
            const color = classColors[val] || { r: 255, g: 255, b: 255 }
            const offset = i * 4
            imageData.data[offset] = color.r
            imageData.data[offset + 1] = color.g
            imageData.data[offset + 2] = color.b
            imageData.data[offset + 3] = 255
          }
          ctx.putImageData(imageData, 0, 0)

          const blob = await new Promise(resolve => maskCanvas.toBlob(resolve, 'image/png'))
          triggerDownload(blob, `${baseName}_mask.png`)
          setStatusMsg('✓ Saved!')
          break
        }

        // ─── Mask as NPZ ───
        case 'mask-npz': {
          setStatusMsg('Building Mask NPZ...')
          const mask = maskRef?.current
          if (!mask) throw new Error('No annotation mask available')

          const { createNpyBuffer } = await import('../../lib/npzParser')
          const { default: JSZip } = await import('jszip')

          const zip = new JSZip()
          const maskNpy = createNpyBuffer(mask, [metadata.lines, metadata.samples], '|u1')
          zip.file('mask.npy', maskNpy)

          const blob = await zip.generateAsync({ type: 'blob' })
          triggerDownload(blob, `${baseName}_mask.npz`)
          setStatusMsg('✓ Saved!')
          break
        }

        // ─── Mask as Raw Binary ───
        case 'mask-raw': {
          setStatusMsg('Exporting raw mask binary...')
          const mask = maskRef?.current
          if (!mask) throw new Error('No annotation mask available')

          const blob = new Blob([mask.buffer], { type: 'application/octet-stream' })
          triggerDownload(blob, `${baseName}_mask.raw`)
          setStatusMsg('✓ Saved!')
          break
        }

        // ─── Full NPZ Archive ───
        case 'npz': {
          const worker = workerRef?.current
          if (!worker) throw new Error('Worker not available')

          setStatusMsg('Extracting BSQ datacube...')
          const msg = await new Promise((resolve, reject) => {
            const handler = (e) => {
              if (e.data.type === 'datacubeExport') {
                worker.removeEventListener('message', handler)
                resolve(e.data)
              } else if (e.data.type === 'error') {
                worker.removeEventListener('message', handler)
                reject(new Error(e.data.message))
              }
            }
            worker.addEventListener('message', handler)
            worker.postMessage({ type: 'exportDatacube' })

            setTimeout(() => {
              worker.removeEventListener('message', handler)
              reject(new Error('Export timed out'))
            }, 30000)
          })

          setStatusMsg('Building NPZ file...')
          const { default: JSZip } = await import('jszip')
          const zip = new JSZip()

          const { createNpyBuffer } = await import('../../lib/npzParser')

          const cubeNpy = createNpyBuffer(
            msg.data,
            [metadata.bands, metadata.lines, metadata.samples],
            '<f4'
          )
          zip.file('datacube.npy', cubeNpy)

          if (metadata.wavelengths) {
            const wlData = new Float32Array(metadata.wavelengths)
            const wlNpy = createNpyBuffer(wlData, [metadata.bands], '<f4')
            zip.file('wavelengths.npy', wlNpy)
          }

          const mask = maskRef?.current
          if (mask && mask.some(v => v > 0)) {
            const maskNpy = createNpyBuffer(mask, [metadata.lines, metadata.samples], '|u1')
            zip.file('mask.npy', maskNpy)
          }

          setStatusMsg('Compressing ZIP archive...')
          const blob = await zip.generateAsync({
            type: 'blob',
            compression: 'DEFLATE',
            compressionOptions: { level: 6 }
          })

          triggerDownload(blob, `${baseName}_archive.npz`)
          setStatusMsg('✓ NPZ Saved!')
          break
        }
        // ─── Pixel-wise CSV ───
        case 'csv': {
          const worker = workerRef?.current
          if (!worker) throw new Error('Worker not available')

          setStatusMsg('Extracting BSQ datacube...')
          const msg = await new Promise((resolve, reject) => {
            const handler = (e) => {
              if (e.data.type === 'datacubeExport') {
                worker.removeEventListener('message', handler)
                resolve(e.data)
              } else if (e.data.type === 'error') {
                worker.removeEventListener('message', handler)
                reject(new Error(e.data.message))
              }
            }
            worker.addEventListener('message', handler)
            worker.postMessage({ type: 'exportDatacube' })
            setTimeout(() => {
              worker.removeEventListener('message', handler)
              reject(new Error('Export timed out'))
            }, 30000)
          })

          setStatusMsg('Formatting CSV data...')
          const { bands, lines, samples } = metadata
          const data = new Float32Array(msg.data)
          const mask = maskRef?.current
          
          await new Promise(r => setTimeout(r, 50))
          
          const header = ['Pixel_X', 'Pixel_Y']
          for (let b = 0; b < bands; b++) {
            header.push(`Band_${b+1}`)
          }
          // Only add Class if there is ANY mask drawn
          let hasMask = false
          if (mask) {
            for (let i = 0; i < mask.length; i++) {
              if (mask[i] > 0) {
                hasMask = true
                break
              }
            }
          }
          if (hasMask) {
            header.push('Class')
          }
          
          const chunks = []
          chunks.push(header.join(',') + '\n')
          
          const totalPixels = lines * samples
          const chunkSize = 10000
          
          for (let i = 0; i < totalPixels; i += chunkSize) {
            setStatusMsg(`Formatting CSV... ${Math.round((i / totalPixels) * 100)}%`)
            await new Promise(r => setTimeout(r, 0))
            
            let chunkStr = ''
            const end = Math.min(i + chunkSize, totalPixels)
            for (let p = i; p < end; p++) {
              const y = Math.floor(p / samples)
              const x = p % samples
              let rowStr = `${x},${y},`
              for (let b = 0; b < bands; b++) {
                 // BSQ index: b * (lines * samples) + p
                 rowStr += data[b * totalPixels + p]
                 if (b < bands - 1 || hasMask) rowStr += ','
              }
              if (hasMask) {
                 rowStr += mask[p] || 0
              }
              chunkStr += rowStr + '\n'
            }
            chunks.push(chunkStr)
          }
          
          setStatusMsg('Saving CSV file...')
          const blob = new Blob(chunks, { type: 'text/csv' })
          triggerDownload(blob, `${baseName}.csv`)
          setStatusMsg('✓ Saved!')
          break
        }

        // ─── Full ENVI Archive ───
        case 'envi': {
          const worker = workerRef?.current
          if (!worker) throw new Error('Worker not available')

          setStatusMsg('Extracting BSQ datacube...')
          const msg = await new Promise((resolve, reject) => {
            const handler = (e) => {
              if (e.data.type === 'datacubeExport') {
                worker.removeEventListener('message', handler)
                resolve(e.data)
              } else if (e.data.type === 'error') {
                worker.removeEventListener('message', handler)
                reject(new Error(e.data.message))
              }
            }
            worker.addEventListener('message', handler)
            worker.postMessage({ type: 'exportDatacube' })
            setTimeout(() => {
              worker.removeEventListener('message', handler)
              reject(new Error('Export timed out'))
            }, 30000)
          })

          setStatusMsg('Building ENVI header...')
          let hdr = `ENVI
description = { Exported from HSI Studio }
samples = ${metadata.samples}
lines   = ${metadata.lines}
bands   = ${metadata.bands}
header offset = 0
file type = ENVI Standard
data type = 4
interleave = bsq
byte order = 0`

          if (metadata.wavelengths && metadata.wavelengths.length > 0) {
            const wlStr = metadata.wavelengths.map(w => typeof w === 'number' ? w.toFixed(2) : w).join(',\n ')
            hdr += `\nwavelength = {\n ${wlStr}\n}`
          }

          const hdrBlob = new Blob([hdr], { type: 'text/plain' })
          triggerDownload(hdrBlob, `${baseName}.hdr`)

          setStatusMsg('Downloading binary data...')
          const datBlob = new Blob([msg.data.buffer], { type: 'application/octet-stream' })
          triggerDownload(datBlob, `${baseName}.dat`)

          setStatusMsg('✓ ENVI Saved!')
          break
        }
      }
    } catch (err) {
      console.error(err)
      setStatusMsg(`✗ Error: ${err.message}`)
    } finally {
      setSaving(false)
    }
  }, [selectedFormat, metadata, fileName, currentBand, canvasRef, excludeMasks, maskRef, triggerDownload, workerRef])

  return (
    <div style={{
      width: '400px',
      background: 'var(--bg-secondary)',
      borderLeft: 'var(--border-default)',
      display: 'flex',
      flexDirection: 'column',
      padding: 'var(--space-md)',
      color: 'var(--text-primary)',
      fontFamily: 'var(--font-sans)',
      overflowY: 'auto'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-lg)' }}>
        <h2 style={{ fontSize: 'var(--font-lg)', fontWeight: 600, margin: 0 }}>Export</h2>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--text-secondary)',
            fontSize: 'var(--font-xl)',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: 'var(--radius-sm)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-tertiary)'}
          onMouseLeave={e => e.currentTarget.style.background = 'none'}
        >
          <X size={20} />
        </button>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', marginBottom: 'var(--space-lg)' }}>
        {['Full Datacube', 'Mask Export', 'Image Export'].map(groupName => (
          <div key={groupName}>
            <div style={{ fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-secondary)', marginBottom: 'var(--space-sm)' }}>
              {groupName}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-xs)' }}>
              {EXPORT_FORMATS.filter(f => f.group === groupName).map(f => {
                const isSelected = selectedFormat === f.id;
                const Icon = f.icon;
                return (
                  <button
                    key={f.id}
                    onClick={() => { setSelectedFormat(f.id); setStatusMsg(''); }}
                    disabled={saving}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 'var(--space-sm)',
                      padding: 'var(--space-sm)',
                      background: isSelected ? 'var(--bg-tertiary)' : 'transparent',
                      border: `1px solid ${isSelected ? 'var(--accent-teal)' : 'var(--border-default)'}`,
                      borderRadius: 'var(--radius-md)',
                      cursor: saving ? 'not-allowed' : 'pointer',
                      opacity: saving ? 0.5 : 1,
                      textAlign: 'left',
                      transition: 'all 0.2s ease',
                      boxShadow: isSelected ? '0 0 0 1px var(--accent-teal)' : 'none',
                    }}
                    onMouseEnter={e => {
                      if (!saving && !isSelected) {
                        e.currentTarget.style.background = 'var(--bg-tertiary)';
                        e.currentTarget.style.borderColor = 'var(--text-secondary)';
                      }
                    }}
                    onMouseLeave={e => {
                      if (!saving && !isSelected) {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.borderColor = 'var(--border-default)';
                      }
                    }}
                  >
                    <div style={{ color: isSelected ? 'var(--accent-teal)' : 'var(--text-secondary)', marginTop: '2px' }}>
                      <Icon size={18} />
                    </div>
                    <div>
                      <div style={{ fontSize: 'var(--font-sm)', fontWeight: 500, color: isSelected ? 'var(--text-primary)' : 'var(--text-primary)', marginBottom: '2px' }}>
                        {f.label}
                      </div>
                      <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
                        {f.desc}
                      </div>
                    </div>
                    {isSelected && (
                      <div style={{ marginLeft: 'auto', color: 'var(--accent-teal)', display: 'flex', alignItems: 'center', height: '100%' }}>
                        <CheckCircle2 size={16} />
                      </div>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {selectedFormat === 'png-view' && (
        <div style={{ marginBottom: 'var(--space-md)', padding: 'var(--space-sm)', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-md)' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-sm)', cursor: 'pointer' }}>
            <input 
              type="checkbox" 
              checked={excludeMasks} 
              onChange={(e) => setExcludeMasks(e.target.checked)}
              style={{ accentColor: 'var(--accent-blue)' }}
            />
            <span style={{ fontSize: 'var(--font-sm)' }}>Exclude annotations (Raw image only)</span>
          </label>
        </div>
      )}

      {/* Status */}
      {statusMsg && (
        <div style={{
          fontSize: 'var(--font-sm)',
          color: statusMsg.startsWith('✓') ? 'var(--accent-green)' :
                 statusMsg.startsWith('✗') ? 'var(--accent-red)' :
                 'var(--accent-teal)',
          marginBottom: 'var(--space-md)',
          fontFamily: 'var(--font-mono)',
        }} dangerouslySetInnerHTML={{ __html: statusMsg.replace(/\n/g, '<br/>') }} />
      )}

      {/* Actions */}
      <div style={{ marginTop: 'auto', display: 'flex', gap: 'var(--space-sm)' }}>
        <button
          onClick={handleSave}
          disabled={saving || !metadata}
          style={{
            flex: 1,
            background: saving ? 'var(--bg-tertiary)' : 'var(--accent-blue)',
            color: 'white',
            border: 'none',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-sm) var(--space-md)',
            fontWeight: 600,
            cursor: saving || !metadata ? 'not-allowed' : 'pointer',
            opacity: saving || !metadata ? 0.7 : 1,
          }}
        >
          {saving ? 'Exporting...' : 'Export File'}
        </button>
      </div>
    </div>
  )
}
