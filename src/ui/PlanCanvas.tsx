import { useCallback, useEffect, useRef, useState } from 'react'
import type { Vec2 } from '../core/types'
import { metresPerPixel, useFloorplanStore } from '../state/store'
import type { Rect } from '../floorplan/pipeline'

function normaliseRect(a: Vec2, b: Vec2): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  }
}

export function PlanCanvas() {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })

  const image = useFloorplanStore((s) => s.image)
  const maskBitmap = useFloorplanStore((s) => s.maskBitmap)
  const skeletonBitmap = useFloorplanStore((s) => s.skeletonBitmap)
  const walls = useFloorplanStore((s) => s.walls)
  const layers = useFloorplanStore((s) => s.layers)
  const view = useFloorplanStore((s) => s.view)
  const setView = useFloorplanStore((s) => s.setView)
  const tool = useFloorplanStore((s) => s.tool)
  const params = useFloorplanStore((s) => s.params)
  const patchParams = useFloorplanStore((s) => s.patchParams)
  const addExcludeRect = useFloorplanStore((s) => s.addExcludeRect)
  const calibration = useFloorplanStore((s) => s.calibration)
  const setCalibration = useFloorplanStore((s) => s.setCalibration)
  const pendingRect = useFloorplanStore((s) => s.pendingRect)
  const setPendingRect = useFloorplanStore((s) => s.setPendingRect)

  const drag = useRef<{
    mode: 'pan' | 'rect'
    startScreen: Vec2
    startImage: Vec2
    startPan: Vec2
  } | null>(null)

  // --- coordinate helpers ------------------------------------------------
  const screenToImage = useCallback(
    (sx: number, sy: number): Vec2 => ({
      x: (sx - view.panX) / view.zoom,
      y: (sy - view.panY) / view.zoom,
    }),
    [view],
  )

  const fitToView = useCallback(() => {
    if (!image || size.w === 0 || size.h === 0) return
    const zoom = Math.min(size.w / image.width, size.h / image.height) * 0.95
    setView({
      zoom,
      panX: (size.w - image.width * zoom) / 2,
      panY: (size.h - image.height * zoom) / 2,
    })
  }, [image, size, setView])

  // --- sizing ------------------------------------------------------------
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // Fit whenever a new image arrives.
  const lastFitted = useRef<ImageBitmap | null>(null)
  useEffect(() => {
    if (image && image.bitmap !== lastFitted.current && size.w > 0) {
      lastFitted.current = image.bitmap
      fitToView()
    }
  }, [image, size, fitToView])

  // --- rendering ---------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || size.w === 0) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(size.w * dpr)
    canvas.height = Math.round(size.h * dpr)
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.fillStyle = '#0b1120'
    ctx.fillRect(0, 0, size.w, size.h)

    if (!image) {
      ctx.fillStyle = '#475569'
      ctx.font = '14px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('Load a floorplan image to begin', size.w / 2, size.h / 2)
      return
    }

    ctx.save()
    ctx.translate(view.panX, view.panY)
    ctx.scale(view.zoom, view.zoom)
    ctx.imageSmoothingEnabled = view.zoom < 2

    if (layers.source) {
      ctx.globalAlpha = layers.mask ? 0.55 : 1
      ctx.drawImage(image.bitmap, 0, 0)
      ctx.globalAlpha = 1
    }
    if (layers.mask && maskBitmap) ctx.drawImage(maskBitmap, 0, 0)
    if (layers.skeleton && skeletonBitmap) ctx.drawImage(skeletonBitmap, 0, 0)

    if (layers.walls && walls.length > 0) {
      // Wall bodies at their measured thickness, then the centreline.
      ctx.lineCap = 'butt'
      for (const w of walls) {
        ctx.strokeStyle = 'rgba(52, 211, 153, 0.35)'
        ctx.lineWidth = Math.max(1 / view.zoom, w.thicknessPx)
        ctx.beginPath()
        ctx.moveTo(w.a.x, w.a.y)
        ctx.lineTo(w.b.x, w.b.y)
        ctx.stroke()
      }
      ctx.strokeStyle = '#10b981'
      ctx.lineWidth = 1.5 / view.zoom
      ctx.beginPath()
      for (const w of walls) {
        ctx.moveTo(w.a.x, w.a.y)
        ctx.lineTo(w.b.x, w.b.y)
      }
      ctx.stroke()

      ctx.fillStyle = '#a7f3d0'
      const r = 2.5 / view.zoom
      for (const w of walls) {
        ctx.beginPath()
        ctx.arc(w.a.x, w.a.y, r, 0, Math.PI * 2)
        ctx.fill()
        ctx.beginPath()
        ctx.arc(w.b.x, w.b.y, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    // Region of interest.
    if (params.roi) {
      ctx.strokeStyle = '#38bdf8'
      ctx.lineWidth = 1.5 / view.zoom
      ctx.setLineDash([6 / view.zoom, 4 / view.zoom])
      ctx.strokeRect(params.roi.x, params.roi.y, params.roi.w, params.roi.h)
      ctx.setLineDash([])
    }

    // Excluded rectangles.
    ctx.fillStyle = 'rgba(148, 163, 184, 0.25)'
    ctx.strokeStyle = '#94a3b8'
    ctx.lineWidth = 1 / view.zoom
    for (const r of params.excludeRects) {
      ctx.fillRect(r.x, r.y, r.w, r.h)
      ctx.strokeRect(r.x, r.y, r.w, r.h)
    }

    // The rectangle currently being dragged.
    if (pendingRect) {
      ctx.strokeStyle = tool === 'exclude' ? '#94a3b8' : '#38bdf8'
      ctx.lineWidth = 1.5 / view.zoom
      ctx.setLineDash([4 / view.zoom, 3 / view.zoom])
      ctx.strokeRect(pendingRect.x, pendingRect.y, pendingRect.w, pendingRect.h)
      ctx.setLineDash([])
    }

    // Calibration line.
    if (calibration.a) {
      ctx.strokeStyle = '#fbbf24'
      ctx.fillStyle = '#fbbf24'
      ctx.lineWidth = 2 / view.zoom
      const r = 4 / view.zoom
      ctx.beginPath()
      ctx.arc(calibration.a.x, calibration.a.y, r, 0, Math.PI * 2)
      ctx.fill()
      if (calibration.b) {
        ctx.beginPath()
        ctx.moveTo(calibration.a.x, calibration.a.y)
        ctx.lineTo(calibration.b.x, calibration.b.y)
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(calibration.b.x, calibration.b.y, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    ctx.restore()
  }, [
    size,
    image,
    maskBitmap,
    skeletonBitmap,
    walls,
    layers,
    view,
    params.roi,
    params.excludeRects,
    pendingRect,
    calibration,
    tool,
  ])

  // --- interaction -------------------------------------------------------
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!image) return
    const rect = e.currentTarget.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const img = screenToImage(sx, sy)

    if (tool === 'calibrate' && e.button === 0) {
      if (!calibration.a || calibration.b) setCalibration({ a: img, b: null })
      else setCalibration({ b: img })
      return
    }

    e.currentTarget.setPointerCapture(e.pointerId)
    const panning = e.button === 1 || e.button === 2 || tool === 'pan'
    drag.current = {
      mode: panning ? 'pan' : 'rect',
      startScreen: { x: sx, y: sy },
      startImage: img,
      startPan: { x: view.panX, y: view.panY },
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current
    if (!d) return
    const rect = e.currentTarget.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top

    if (d.mode === 'pan') {
      setView({
        panX: d.startPan.x + (sx - d.startScreen.x),
        panY: d.startPan.y + (sy - d.startScreen.y),
      })
    } else {
      setPendingRect(normaliseRect(d.startImage, screenToImage(sx, sy)))
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (d.mode !== 'rect') return

    const rect = e.currentTarget.getBoundingClientRect()
    const finished = normaliseRect(
      d.startImage,
      screenToImage(e.clientX - rect.left, e.clientY - rect.top),
    )
    setPendingRect(null)
    if (finished.w < 4 || finished.h < 4) return

    if (tool === 'roi') patchParams({ roi: finished })
    else if (tool === 'exclude') addExcludeRect(finished)
  }

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!image) return
    const rect = e.currentTarget.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const before = screenToImage(sx, sy)
    const factor = Math.exp(-e.deltaY * 0.0015)
    const zoom = Math.max(0.02, Math.min(40, view.zoom * factor))
    setView({ zoom, panX: sx - before.x * zoom, panY: sy - before.y * zoom })
  }

  const mpp = metresPerPixel(calibration)
  const cursorClass =
    tool === 'pan' ? 'cursor-grab' : tool === 'calibrate' ? 'cursor-crosshair' : 'cursor-crosshair'

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-slate-950">
      <canvas
        ref={canvasRef}
        className={`h-full w-full touch-none ${cursorClass}`}
        style={{ width: size.w, height: size.h }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className="pointer-events-none absolute bottom-3 left-3 flex gap-2 text-[11px] text-slate-400">
        <span className="rounded bg-slate-900/80 px-2 py-1 font-mono">
          {(view.zoom * 100).toFixed(0)}%
        </span>
        {mpp && (
          <span className="rounded bg-slate-900/80 px-2 py-1 font-mono">
            {(1 / mpp).toFixed(1)} px/m
          </span>
        )}
        <span className="rounded bg-slate-900/80 px-2 py-1">
          wheel = zoom · right-drag = pan
        </span>
      </div>
      <div className="absolute right-3 bottom-3">
        <button
          onClick={fitToView}
          className="rounded border border-slate-700 bg-slate-900/80 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
        >
          Fit
        </button>
      </div>
    </div>
  )
}
