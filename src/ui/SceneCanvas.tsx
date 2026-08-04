import { useCallback, useEffect, useRef, useState } from 'react'
import type { Vec2 } from '../core/types'
import { useFloorplanStore } from '../state/store'
import { useSceneStore } from '../state/sceneStore'
import { useSimStore } from '../state/simStore'
import { sceneBounds, wallLength, type SceneWall } from '../scene/model'
import { AIR_TYPE_ID } from '../scene/defaults'
import { AP_COLOURS, renderHeatmap } from './heatmapColours'

const HANDLE_HIT_PX = 9
const WALL_HIT_PX = 7

function pointToSegment(p: Vec2, a: Vec2, b: Vec2): { dist: number; t: number } {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return { dist: Math.hypot(p.x - a.x, p.y - a.y), t: 0 }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return { dist: Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)), t }
}

export function SceneCanvas({ onProbe }: { onProbe?: (x: number, y: number) => void } = {}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  /** Scene view: pixels per metre plus a pan offset. */
  const [view, setView] = useState({ ppm: 40, panX: 0, panY: 0 })

  const scene = useSceneStore((s) => s.scene)
  const transform = useSceneStore((s) => s.transform)
  const selection = useSceneStore((s) => s.selection)
  const setSelection = useSceneStore((s) => s.setSelection)
  const tool = useSceneStore((s) => s.tool)
  const setTool = useSceneStore((s) => s.setTool)
  const pendingOpeningKind = useSceneStore((s) => s.pendingOpeningKind)
  const addWall = useSceneStore((s) => s.addWall)
  const updateWall = useSceneStore((s) => s.updateWall)
  const addOpening = useSceneStore((s) => s.addOpening)
  const addFurniture = useSceneStore((s) => s.addFurniture)
  const updateFurniture = useSceneStore((s) => s.updateFurniture)
  const pushHistory = useSceneStore((s) => s.pushHistory)

  const image = useFloorplanStore((s) => s.image)
  const [showScan, setShowScan] = useState(true)

  const heatmap = useSimStore((s) => s.heatmap)
  const heatLayer = useSimStore((s) => s.layer)
  const heatOpacity = useSimStore((s) => s.heatmapOpacity)
  const aps = useSimStore((s) => s.aps)
  const selectedApId = useSimStore((s) => s.selectedApId)
  const selectAp = useSimStore((s) => s.selectAp)
  const updateAp = useSimStore((s) => s.updateAp)
  const addAp = useSimStore((s) => s.addAp)
  const placingAp = useSimStore((s) => s.placingAp)
  const probeMode = useSimStore((s) => s.probeMode)
  const probe = useSimStore((s) => s.probe)
  const externalNetworks = useSimStore((s) => s.externalNetworks)
  const placingExternal = useSimStore((s) => s.placingExternal)
  const setPlacingExternal = useSimStore((s) => s.setPlacingExternal)
  const addExternal = useSimStore((s) => s.addExternal)
  const updateExternal = useSimStore((s) => s.updateExternal)
  const selectedExternalId = useSimStore((s) => s.selectedExternalId)

  /** Rasterised heatmap, regenerated whenever the data or the layer changes. */
  const [heatBitmap, setHeatBitmap] = useState<ImageBitmap | null>(null)
  useEffect(() => {
    if (!heatmap) {
      setHeatBitmap(null)
      return
    }
    let cancelled = false
    void createImageBitmap(renderHeatmap(heatmap, heatLayer, heatOpacity)).then((bmp) => {
      if (cancelled) bmp.close()
      else setHeatBitmap(bmp)
    })
    return () => {
      cancelled = true
    }
  }, [heatmap, heatLayer, heatOpacity])

  const drag = useRef<
    | { mode: 'pan'; startScreen: Vec2; startPan: Vec2 }
    | { mode: 'draw'; from: Vec2; to: Vec2 }
    | { mode: 'wall-end'; wallId: string; end: 'a' | 'b' }
    | { mode: 'wall-move'; wallId: string; grab: Vec2; a0: Vec2; b0: Vec2 }
    | { mode: 'furniture-move'; id: string; grab: Vec2; c0: Vec2 }
    | { mode: 'ap-move'; id: string }
    | null
  >(null)
  const [, forceRedraw] = useState(0)

  const toScene = useCallback(
    (x: number, y: number): Vec2 => ({
      x: (x - view.panX) / view.ppm,
      y: (y - view.panY) / view.ppm,
    }),
    [view],
  )

  const fit = useCallback(() => {
    const b = sceneBounds(scene)
    if (!b || size.w === 0) return
    const w = Math.max(1, b.maxX - b.minX)
    const h = Math.max(1, b.maxY - b.minY)
    const ppm = Math.min(size.w / w, size.h / h) * 0.88
    setView({
      ppm,
      panX: size.w / 2 - ((b.minX + b.maxX) / 2) * ppm,
      panY: size.h / 2 - ((b.minY + b.maxY) / 2) * ppm,
    })
  }, [scene, size])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const fittedFor = useRef(0)
  useEffect(() => {
    if (scene.walls.length > 0 && size.w > 0 && fittedFor.current !== scene.walls.length) {
      fittedFor.current = scene.walls.length
      fit()
    }
  }, [scene.walls.length, size, fit])

  // --- draw --------------------------------------------------------------
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

    ctx.save()
    ctx.translate(view.panX, view.panY)
    ctx.scale(view.ppm, view.ppm)

    // Scan backdrop, mapped through the calibration transform.
    if (showScan && image && transform) {
      ctx.save()
      ctx.globalAlpha = 0.22
      ctx.scale(transform.metresPerPixel, transform.metresPerPixel)
      ctx.translate(-transform.originPx.x, -transform.originPx.y)
      ctx.drawImage(image.bitmap, 0, 0)
      ctx.restore()
    }

    // Heatmap sits under the geometry so walls stay readable on top of it.
    // Cell (0,0) is centred on the grid origin, hence the half-cell offset.
    if (heatBitmap && heatmap) {
      const half = heatmap.spec.resolutionM / 2
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(
        heatBitmap,
        heatmap.spec.minX - half,
        heatmap.spec.minY - half,
        heatmap.cols * heatmap.spec.resolutionM,
        heatmap.rows * heatmap.spec.resolutionM,
      )
    }

    // 1 m grid.
    const b = sceneBounds(scene)
    if (b) {
      ctx.strokeStyle = 'rgba(148,163,184,0.10)'
      ctx.lineWidth = 1 / view.ppm
      ctx.beginPath()
      for (let x = Math.floor(b.minX) - 2; x <= Math.ceil(b.maxX) + 2; x++) {
        ctx.moveTo(x, b.minY - 2)
        ctx.lineTo(x, b.maxY + 2)
      }
      for (let y = Math.floor(b.minY) - 2; y <= Math.ceil(b.maxY) + 2; y++) {
        ctx.moveTo(b.minX - 2, y)
        ctx.lineTo(b.maxX + 2, y)
      }
      ctx.stroke()
    }

    const typeById = new Map(scene.wallTypes.map((t) => [t.id, t]))

    // Furniture footprints.
    for (const f of scene.furniture) {
      const isSel = selection.kind === 'furniture' && selection.id === f.id
      ctx.save()
      ctx.translate(f.centre.x, f.centre.y)
      ctx.rotate(f.rotationRad)
      ctx.fillStyle = isSel ? 'rgba(250,204,21,0.35)' : 'rgba(148,163,184,0.22)'
      ctx.strokeStyle = isSel ? '#facc15' : typeById.get(f.typeId)?.colour ?? '#94a3b8'
      ctx.lineWidth = 2 / view.ppm
      ctx.fillRect(-f.widthM / 2, -f.depthM / 2, f.widthM, f.depthM)
      ctx.strokeRect(-f.widthM / 2, -f.depthM / 2, f.widthM, f.depthM)
      ctx.restore()
    }

    // Walls, drawn at their build-up thickness.
    for (const w of scene.walls) {
      const type = typeById.get(w.typeId)
      const thickness = type ? type.layers.reduce((a, l) => a + l.thicknessM, 0) : 0.1
      const isSel = selection.kind === 'wall' && selection.id === w.id
      const isParent = selection.kind === 'opening' && selection.wallId === w.id

      ctx.lineCap = 'butt'
      ctx.strokeStyle = isSel || isParent ? '#facc15' : type?.colour ?? '#94a3b8'
      ctx.globalAlpha = isSel || isParent ? 0.85 : 0.6
      ctx.lineWidth = Math.max(thickness, 2 / view.ppm)
      ctx.beginPath()
      ctx.moveTo(w.a.x, w.a.y)
      ctx.lineTo(w.b.x, w.b.y)
      ctx.stroke()
      ctx.globalAlpha = 1

      // Openings drawn over the wall body.
      const len = wallLength(w)
      if (len > 1e-6) {
        const ux = (w.b.x - w.a.x) / len
        const uy = (w.b.y - w.a.y) / len
        for (const o of w.openings) {
          const selOpening =
            selection.kind === 'opening' && selection.openingId === o.id
          const s0 = o.offsetM
          const s1 = Math.min(len, o.offsetM + o.widthM)
          ctx.strokeStyle = selOpening
            ? '#f472b6'
            : o.typeId === AIR_TYPE_ID
              ? '#0b1120'
              : (typeById.get(o.typeId)?.colour ?? '#38bdf8')
          ctx.lineWidth = Math.max(thickness * 0.8, 2 / view.ppm)
          ctx.beginPath()
          ctx.moveTo(w.a.x + ux * s0, w.a.y + uy * s0)
          ctx.lineTo(w.a.x + ux * s1, w.a.y + uy * s1)
          ctx.stroke()
        }
      }

      if (isSel) {
        ctx.fillStyle = '#facc15'
        for (const p of [w.a, w.b]) {
          ctx.beginPath()
          ctx.arc(p.x, p.y, 5 / view.ppm, 0, Math.PI * 2)
          ctx.fill()
        }
      }
    }

    // Probe point and its dominant ray paths.
    if (probe) {
      ctx.lineWidth = 1.2 / view.ppm
      probe.paths.slice(0, 8).forEach((path, i) => {
        const points = [
          { x: aps[probe.apIndex]?.x ?? probe.point.x, y: aps[probe.apIndex]?.y ?? probe.point.y },
          ...path.interactions.map((it) => ({ x: it.point.x, y: it.point.y })),
          { x: probe.point.x, y: probe.point.y },
        ]
        ctx.strokeStyle = `rgba(250, 204, 21, ${Math.max(0.12, 0.85 - i * 0.1)})`
        ctx.beginPath()
        ctx.moveTo(points[0].x, points[0].y)
        for (const p of points.slice(1)) ctx.lineTo(p.x, p.y)
        ctx.stroke()
      })
      ctx.fillStyle = '#fde047'
      ctx.strokeStyle = '#0b1120'
      ctx.lineWidth = 2 / view.ppm
      ctx.beginPath()
      ctx.arc(probe.point.x, probe.point.y, 7 / view.ppm, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }

    // Neighbouring networks and their measurement reference points.
    for (const net of externalNetworks) {
      const isSel = net.id === selectedExternalId
      ctx.fillStyle = net.enabled ? '#c026d3' : '#475569'
      ctx.strokeStyle = isSel ? '#ffffff' : '#0b1120'
      ctx.lineWidth = 2 / view.ppm
      ctx.beginPath()
      ctx.arc(net.x, net.y, (isSel ? 9 : 7) / view.ppm, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      if (net.calibration) {
        ctx.strokeStyle = 'rgba(192, 38, 211, 0.55)'
        ctx.setLineDash([5 / view.ppm, 4 / view.ppm])
        ctx.lineWidth = 1.2 / view.ppm
        ctx.beginPath()
        ctx.moveTo(net.x, net.y)
        ctx.lineTo(net.calibration.refX, net.calibration.refY)
        ctx.stroke()
        ctx.setLineDash([])
        ctx.strokeStyle = '#c026d3'
        ctx.lineWidth = 2 / view.ppm
        const r = 5 / view.ppm
        ctx.beginPath()
        ctx.moveTo(net.calibration.refX - r, net.calibration.refY)
        ctx.lineTo(net.calibration.refX + r, net.calibration.refY)
        ctx.moveTo(net.calibration.refX, net.calibration.refY - r)
        ctx.lineTo(net.calibration.refX, net.calibration.refY + r)
        ctx.stroke()
      }
    }

    // Access points.
    aps.forEach((ap, i) => {
      const colour = AP_COLOURS[i % AP_COLOURS.length]
      const isSel = ap.id === selectedApId
      const r = (isSel ? 11 : 8) / view.ppm
      ctx.fillStyle = ap.enabled ? `rgb(${colour[0]},${colour[1]},${colour[2]})` : '#475569'
      ctx.strokeStyle = isSel ? '#ffffff' : '#0b1120'
      ctx.lineWidth = 2.5 / view.ppm
      ctx.beginPath()
      ctx.arc(ap.x, ap.y, r, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#0b1120'
      ctx.beginPath()
      ctx.arc(ap.x, ap.y, r * 0.35, 0, Math.PI * 2)
      ctx.fill()

      // Antenna orientation. For a sector the arrow is the beam; for an omni it
      // is the rod's own direction, drawn only once it is tilted off vertical
      // (an upright whip has no meaningful azimuth).
      const bore = ap.antenna.boresight
      const horizontal = Math.hypot(bore.x, bore.y)
      const isSector = ap.antenna.kind === 'sector'
      if (horizontal > 0.08) {
        const ux = bore.x / horizontal
        const uy = bore.y / horizontal
        const length = (isSector ? 34 : 22) / view.ppm
        ctx.strokeStyle = '#facc15'
        ctx.fillStyle = '#facc15'
        ctx.lineWidth = 2 / view.ppm

        if (isSector) {
          // Beam wedge at the configured horizontal beamwidth.
          const half = (((ap.antenna.hBeamwidthDeg ?? 65) / 2) * Math.PI) / 180
          const base = Math.atan2(uy, ux)
          ctx.globalAlpha = 0.25
          ctx.beginPath()
          ctx.moveTo(ap.x, ap.y)
          ctx.arc(ap.x, ap.y, length, base - half, base + half)
          ctx.closePath()
          ctx.fill()
          ctx.globalAlpha = 1
        }
        ctx.beginPath()
        ctx.moveTo(ap.x, ap.y)
        ctx.lineTo(ap.x + ux * length, ap.y + uy * length)
        ctx.stroke()
        // Arrowhead.
        const head = 5 / view.ppm
        const tipX = ap.x + ux * length
        const tipY = ap.y + uy * length
        ctx.beginPath()
        ctx.moveTo(tipX, tipY)
        ctx.lineTo(tipX - ux * head + uy * head * 0.6, tipY - uy * head - ux * head * 0.6)
        ctx.lineTo(tipX - ux * head - uy * head * 0.6, tipY - uy * head + ux * head * 0.6)
        ctx.closePath()
        ctx.fill()
      } else if (!isSector) {
        // Upright rod: a ring, since it radiates equally all around.
        ctx.strokeStyle = 'rgba(250, 204, 21, 0.55)'
        ctx.lineWidth = 1.5 / view.ppm
        ctx.setLineDash([4 / view.ppm, 3 / view.ppm])
        ctx.beginPath()
        ctx.arc(ap.x, ap.y, r * 2.1, 0, Math.PI * 2)
        ctx.stroke()
        ctx.setLineDash([])
      }
    })

    // Wall being drawn.
    const d = drag.current
    if (d && d.mode === 'draw') {
      ctx.strokeStyle = '#38bdf8'
      ctx.lineWidth = 2 / view.ppm
      ctx.setLineDash([6 / view.ppm, 4 / view.ppm])
      ctx.beginPath()
      ctx.moveTo(d.from.x, d.from.y)
      ctx.lineTo(d.to.x, d.to.y)
      ctx.stroke()
      ctx.setLineDash([])
    }

    ctx.restore()
  }, [
    size,
    view,
    scene,
    selection,
    image,
    transform,
    showScan,
    heatBitmap,
    heatmap,
    aps,
    selectedApId,
    probe,
    externalNetworks,
    selectedExternalId,
  ])

  // --- interaction -------------------------------------------------------
  const hitTest = (p: Vec2) => {
    const tolWall = WALL_HIT_PX / view.ppm
    const tolHandle = HANDLE_HIT_PX / view.ppm

    if (selection.kind === 'wall') {
      const w = scene.walls.find((x) => x.id === selection.id)
      if (w) {
        if (Math.hypot(p.x - w.a.x, p.y - w.a.y) < tolHandle)
          return { kind: 'handle' as const, wall: w, end: 'a' as const }
        if (Math.hypot(p.x - w.b.x, p.y - w.b.y) < tolHandle)
          return { kind: 'handle' as const, wall: w, end: 'b' as const }
      }
    }
    for (const f of scene.furniture) {
      const c = Math.cos(-f.rotationRad)
      const s = Math.sin(-f.rotationRad)
      const lx = (p.x - f.centre.x) * c - (p.y - f.centre.y) * s
      const ly = (p.x - f.centre.x) * s + (p.y - f.centre.y) * c
      if (Math.abs(lx) <= f.widthM / 2 && Math.abs(ly) <= f.depthM / 2) {
        return { kind: 'furniture' as const, furniture: f }
      }
    }
    let best: { wall: SceneWall; t: number; dist: number } | null = null
    for (const w of scene.walls) {
      const { dist, t } = pointToSegment(p, w.a, w.b)
      if (dist < tolWall && (!best || dist < best.dist)) best = { wall: w, t, dist }
    }
    if (best) return { kind: 'wall' as const, wall: best.wall, t: best.t }
    return { kind: 'empty' as const }
  }

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const p = toScene(sx, sy)

    if (e.button === 1 || e.button === 2) {
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = { mode: 'pan', startScreen: { x: sx, y: sy }, startPan: { x: view.panX, y: view.panY } }
      return
    }

    // Simulation interactions take precedence over the geometry tools.
    if (placingAp) {
      addAp(p.x, p.y)
      return
    }
    if (placingExternal) {
      if (placingExternal.id === 'new') {
        addExternal(p.x, p.y)
      } else if (placingExternal.what === 'source') {
        updateExternal(placingExternal.id, { x: p.x, y: p.y })
        setPlacingExternal(null)
      } else {
        const net = externalNetworks.find((n) => n.id === placingExternal.id)
        updateExternal(placingExternal.id, {
          calibration: {
            refX: p.x,
            refY: p.y,
            refHeightM: 1.1,
            measuredDbm: net?.calibration?.measuredDbm ?? -70,
          },
        })
        setPlacingExternal(null)
      }
      return
    }
    if (probeMode) {
      onProbe?.(p.x, p.y)
      return
    }
    const apHitRadius = 12 / view.ppm
    const hitAp = aps.find((a) => Math.hypot(a.x - p.x, a.y - p.y) < apHitRadius)
    if (hitAp) {
      e.currentTarget.setPointerCapture(e.pointerId)
      selectAp(hitAp.id)
      drag.current = { mode: 'ap-move', id: hitAp.id }
      return
    }

    if (tool === 'draw-wall') {
      e.currentTarget.setPointerCapture(e.pointerId)
      drag.current = { mode: 'draw', from: p, to: p }
      forceRedraw((n) => n + 1)
      return
    }

    if (tool === 'add-furniture') {
      addFurniture(p)
      setTool('select')
      return
    }

    const hit = hitTest(p)

    if (tool === 'add-opening') {
      if (hit.kind === 'wall') {
        addOpening(hit.wall.id, pendingOpeningKind, hit.t * wallLength(hit.wall))
        setTool('select')
      }
      return
    }

    e.currentTarget.setPointerCapture(e.pointerId)
    if (hit.kind === 'handle') {
      // One undo entry for the whole drag, not one per pointer move.
      pushHistory()
      drag.current = { mode: 'wall-end', wallId: hit.wall.id, end: hit.end }
    } else if (hit.kind === 'furniture') {
      setSelection({ kind: 'furniture', id: hit.furniture.id })
      pushHistory()
      drag.current = {
        mode: 'furniture-move',
        id: hit.furniture.id,
        grab: p,
        c0: hit.furniture.centre,
      }
    } else if (hit.kind === 'wall') {
      setSelection({ kind: 'wall', id: hit.wall.id })
      pushHistory()
      drag.current = {
        mode: 'wall-move',
        wallId: hit.wall.id,
        grab: p,
        a0: hit.wall.a,
        b0: hit.wall.b,
      }
    } else {
      setSelection({ kind: 'none' })
      drag.current = { mode: 'pan', startScreen: { x: sx, y: sy }, startPan: { x: view.panX, y: view.panY } }
    }
  }

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current
    if (!d) return
    const rect = e.currentTarget.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const p = toScene(sx, sy)

    if (d.mode === 'pan') {
      setView((v) => ({
        ...v,
        panX: d.startPan.x + (sx - d.startScreen.x),
        panY: d.startPan.y + (sy - d.startScreen.y),
      }))
    } else if (d.mode === 'draw') {
      d.to = p
      forceRedraw((n) => n + 1)
    } else if (d.mode === 'wall-end') {
      updateWall(d.wallId, { [d.end]: p } as Partial<SceneWall>, false)
    } else if (d.mode === 'wall-move') {
      const dx = p.x - d.grab.x
      const dy = p.y - d.grab.y
      updateWall(
        d.wallId,
        { a: { x: d.a0.x + dx, y: d.a0.y + dy }, b: { x: d.b0.x + dx, y: d.b0.y + dy } },
        false,
      )
    } else if (d.mode === 'furniture-move') {
      updateFurniture(
        d.id,
        { centre: { x: d.c0.x + (p.x - d.grab.x), y: d.c0.y + (p.y - d.grab.y) } },
        false,
      )
    } else if (d.mode === 'ap-move') {
      updateAp(d.id, { x: p.x, y: p.y })
    }
  }

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current
    drag.current = null
    if (!d) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (d.mode === 'draw') {
      if (Math.hypot(d.to.x - d.from.x, d.to.y - d.from.y) > 0.05) addWall(d.from, d.to)
      setTool('select')
      forceRedraw((n) => n + 1)
    }
  }

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const sx = e.clientX - rect.left
    const sy = e.clientY - rect.top
    const before = toScene(sx, sy)
    const ppm = Math.max(2, Math.min(600, view.ppm * Math.exp(-e.deltaY * 0.0015)))
    setView({ ppm, panX: sx - before.x * ppm, panY: sy - before.y * ppm })
  }

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-slate-950">
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none cursor-crosshair"
        style={{ width: size.w, height: size.h }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
      />
      {scene.walls.length === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-slate-500">
          No model yet — trace a floorplan and press “Build model”, or draw walls manually.
        </div>
      )}
      <div className="absolute bottom-3 left-3 flex gap-2 text-[11px] text-slate-400">
        <span className="rounded bg-slate-900/80 px-2 py-1 font-mono">
          {view.ppm.toFixed(0)} px/m
        </span>
        <label className="flex cursor-pointer items-center gap-1.5 rounded bg-slate-900/80 px-2 py-1">
          <input
            type="checkbox"
            checked={showScan}
            onChange={() => setShowScan((v) => !v)}
            className="accent-sky-400"
          />
          Scan backdrop
        </label>
        <span className="rounded bg-slate-900/80 px-2 py-1">right-drag = pan · wheel = zoom</span>
      </div>
      <button
        onClick={fit}
        className="absolute right-3 bottom-3 rounded border border-slate-700 bg-slate-900/80 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800"
      >
        Fit
      </button>
    </div>
  )
}
