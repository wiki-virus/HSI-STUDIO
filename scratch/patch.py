import re

with open('src/components/Viewer/DatacubeViewer.jsx', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. Replace annotationCanvasRef declaration
code = code.replace(
    'const annotationCanvasRef = useRef(null)',
    'const maskCanvasRef = useRef(null)\n  const vectorCanvasRef = useRef(null)'
)

# 2. Replace redrawOverlay with redrawMask and redrawVectors
redraw_overlay_regex = re.compile(
    r'  const redrawOverlay = useCallback\(\(\) => \{.*?\n  \}, \[.*?\]\)',
    re.DOTALL
)

new_redraws = """  const redrawMask = useCallback((dirtyRect = null) => {
    const canvas = maskCanvasRef.current
    if (!canvas || !metadata) return

    const { samples, lines } = metadata
    let x0 = 0, y0 = 0, w = samples, h = lines
    if (dirtyRect) {
      x0 = dirtyRect.x
      y0 = dirtyRect.y
      w = dirtyRect.w
      h = dirtyRect.h
    } else {
      canvas.width = samples
      canvas.height = lines
    }

    const ctx = canvas.getContext('2d')
    if (!showMaskOverlay || !maskRef.current) {
      if (!dirtyRect) ctx.clearRect(0, 0, canvas.width, canvas.height)
      return
    }

    const imgData = ctx.createImageData(w, h)
    const data = imgData.data
    const mask = maskRef.current
    
    const r = parseInt(maskColor.slice(1, 3), 16)
    const g = parseInt(maskColor.slice(3, 5), 16)
    const b = parseInt(maskColor.slice(5, 7), 16)

    let dataIdx = 0
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        const maskVal = mask[y * samples + x]
        if (maskVal > 0) {
          data[dataIdx] = r
          data[dataIdx + 1] = g
          data[dataIdx + 2] = b
          data[dataIdx + 3] = Math.floor(maskOpacity * 255 * (maskVal / 255))
        }
        dataIdx += 4
      }
    }

    if (!dirtyRect) {
      ctx.clearRect(0, 0, samples, lines)
    }
    ctx.putImageData(imgData, x0, y0)
  }, [metadata, showMaskOverlay, maskOpacity, maskColor])

  const redrawVectors = useCallback(() => {
    const canvas = vectorCanvasRef.current
    if (!canvas || !metadata) return

    canvas.width = metadata.samples
    canvas.height = metadata.lines

    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)

    if (polygonPoints.length > 0 || lassoPointsRef.current.length > 0) {
      ctx.strokeStyle = maskColor
      ctx.lineWidth = 2 / zoom
      ctx.setLineDash([5 / zoom, 5 / zoom])
      
      const drawPath = (points, close) => {
        if (points.length === 0) return
        ctx.beginPath()
        ctx.moveTo(points[0].x, points[0].y)
        for (let i = 1; i < points.length; i++) {
          ctx.lineTo(points[i].x, points[i].y)
        }
        if (close) ctx.closePath()
        ctx.stroke()
      }

      if (polygonPoints.length > 0) {
        drawPath(polygonPoints, false)
        if (screenMousePos) {
          const mCoords = screenToImage(screenMousePos.x, screenMousePos.y)
          if (mCoords) {
            ctx.beginPath()
            ctx.moveTo(polygonPoints[polygonPoints.length - 1].x, polygonPoints[polygonPoints.length - 1].y)
            ctx.lineTo(mCoords.x, mCoords.y)
            ctx.stroke()
          }
        }
      }

      if (lassoPointsRef.current.length > 0) {
        drawPath(lassoPointsRef.current, false)
      }
      ctx.setLineDash([])
    }
  }, [metadata, maskColor, polygonPoints, screenMousePos, screenToImage, zoom])"""

code = redraw_overlay_regex.sub(new_redraws, code)

# 3. Update useEffect
code = code.replace(
    '  useEffect(() => {\n    redrawOverlay()\n  }, [redrawOverlay, renderTick, initialMaskData])',
    '  useEffect(() => {\n    redrawMask()\n    redrawVectors()\n  }, [redrawMask, redrawVectors, renderTick, initialMaskData])'
)

# 4. Update fillPolygon
code = code.replace(
    '    redrawOverlay()\n  }, [metadata, redrawOverlay])',
    '    redrawMask()\n    redrawVectors()\n  }, [metadata, redrawMask, redrawVectors])'
)

# 5. Update paintLine
old_paint_line = """  const paintLine = useCallback((x0, y0, x1, y1, erase) => {
    const dx = Math.abs(x1 - x0)
    const dy = Math.abs(y1 - y0)
    const steps = Math.max(dx, dy, 1)

    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps
      const x = Math.round(x0 + (x1 - x0) * t)
      const y = Math.round(y0 + (y1 - y0) * t)
      paintAt(x, y, erase)
    }
  }, [paintAt])"""

new_paint_line = """  const paintLine = useCallback((x0, y0, x1, y1, erase) => {
    const minX = Math.max(0, Math.min(x0, x1) - brushSize)
    const minY = Math.max(0, Math.min(y0, y1) - brushSize)
    const maxX = Math.min(metadata.samples - 1, Math.max(x0, x1) + brushSize)
    const maxY = Math.min(metadata.lines - 1, Math.max(y0, y1) + brushSize)
    const w = maxX - minX + 1
    const h = maxY - minY + 1
    
    const dx = Math.abs(x1 - x0)
    const dy = Math.abs(y1 - y0)
    const steps = Math.max(dx, dy, 1)

    for (let i = 0; i <= steps; i++) {
      const t = steps === 0 ? 0 : i / steps
      const x = Math.round(x0 + (x1 - x0) * t)
      const y = Math.round(y0 + (y1 - y0) * t)
      paintAt(x, y, erase)
    }
    
    return { x: minX, y: minY, w, h }
  }, [paintAt, metadata, brushSize])"""

code = code.replace(old_paint_line, new_paint_line)

# 6. Update handlers replacing redrawOverlay
code = code.replace('redrawOverlay()', 'redrawMask()\n        redrawVectors()')

# specific fix for handleMouseMove paintLine usage
code = code.replace(
    '        paintLine(lastPaintPosRef.current.x, lastPaintPosRef.current.y, coords.x, coords.y, annotationMode === \'eraser\')\n        lastPaintPosRef.current = coords\n\n        // Quick overlay redraw\n        redrawMask()\n        redrawVectors()',
    '        const dirtyRect = paintLine(lastPaintPosRef.current.x, lastPaintPosRef.current.y, coords.x, coords.y, annotationMode === \'eraser\')\n        lastPaintPosRef.current = coords\n\n        // Quick mask redraw (only dirty rect)\n        redrawMask(dirtyRect)'
)

# specific fix for setScreenMousePos inside handleMouseMove to also trigger redrawVectors
code = code.replace(
    '    setScreenMousePos({ x: e.clientX, y: e.clientY })\n\n    if (isPanningRef.current)',
    '    setScreenMousePos({ x: e.clientX, y: e.clientY })\n    if (polygonPoints.length > 0 || isLassoingRef.current) redrawVectors()\n\n    if (isPanningRef.current)'
)

# 7. Update JSX
jsx_old = """        <canvas
          ref={annotationCanvasRef}
          className="absolute top-0 left-0 w-full h-full pointer-events-none"
        />"""

jsx_new = """        <canvas
          ref={maskCanvasRef}
          className="absolute top-0 left-0 w-full h-full pointer-events-none"
        />
        <canvas
          ref={vectorCanvasRef}
          className="absolute top-0 left-0 w-full h-full pointer-events-none"
        />"""

code = code.replace(jsx_old, jsx_new)

# 8. Fix dependency arrays
code = code.replace(
    '  }, [annotationMode, screenToImage, onPixelClick, panOffset, paintAt, redrawOverlay])',
    '  }, [annotationMode, screenToImage, onPixelClick, panOffset, paintAt, redrawMask, redrawVectors])'
)
code = code.replace(
    '  }, [screenToImage, setPanOffset, annotationMode, paintLine, redrawOverlay])',
    '  }, [screenToImage, setPanOffset, annotationMode, paintLine, redrawMask, redrawVectors, polygonPoints])'
)
code = code.replace(
    '  }, [fillPolygon, redrawOverlay])',
    '  }, [fillPolygon, redrawMask, redrawVectors])'
)

with open('src/components/Viewer/DatacubeViewer.jsx', 'w', encoding='utf-8') as f:
    f.write(code)

print("Patch applied successfully.")
