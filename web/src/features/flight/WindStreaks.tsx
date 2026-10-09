import { useEffect, useRef } from 'react'
import type { Map as MaplibreMap } from 'maplibre-gl'
import { fromLocalEastNorthM, WIND_MODERATE_MPS, WIND_STRONG_MPS, type GeoPoint } from '../../domain'
import { metersPerPixel } from './flightMapGeo'
import { windAt, type WindGrid } from './weatherOverlay'

/** On-screen drift per m/s of wind, so a 10 m/s wind reads as brisk
 * whatever the zoom (the real speed is far too slow to see move). */
const PX_PER_S_PER_MPS = 7
/** One streak per this many square pixels of map, within the bounds below.
 * Kept modest: every streak is projected each frame. */
const PX_PER_STREAK = 4000
const MIN_STREAKS = 80
const MAX_STREAKS = 300
/** Points kept for each streak's tail. */
const TAIL_POINTS = 6
/** Drawn at most this often: drifting wind doesn't need 60 fps. */
const FRAME_MS = 1000 / 30
/** A streak lives this long (seconds, randomised) before starting afresh. */
const LIFE_MIN_S = 2
const LIFE_MAX_S = 5
/** Fade in and out over this much of a life, so streaks don't pop. */
const FADE_S = 0.6
const LINE_WIDTH_PX = 1.4
/** Calm white, then the status palette's amber and red as it strengthens. */
const COLORS = ['255, 255, 255', '250, 178, 25', '208, 59, 59']
/** The newer half of a tail, and the older half (or a streak fading in or
 * out): two brightnesses, so all streaks draw in six strokes a frame. */
const BRIGHT_ALPHA = 0.7
const FAINT_ALPHA = 0.3

interface Streak {
  tail: GeoPoint[]
  ageS: number
  lifeS: number
}

/**
 * Wind as moving streaks over the map (ADR-0026): short lines drifting with
 * the wind, faster and warmer where it's stronger, like Windy. Each streak
 * keeps its recent positions on the ground and is projected afresh every
 * frame, so tails stay right as the map pans, tilts or follows the drone.
 * Drawn on a canvas over the map (it can't go under the route there, so the
 * lines are kept thin and translucent). With reduced motion, a still
 * snapshot instead.
 */
export function WindStreaks({ map, grid }: { map: MaplibreMap; grid: WindGrid }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const gridRef = useRef(grid)
  useEffect(() => {
    gridRef.current = grid
  }, [grid])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const container = map.getContainer()
    let streaks: Streak[] = []
    let frame = 0
    let lastMs = performance.now()
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    const resize = () => {
      const dpr = window.devicePixelRatio || 1
      canvas.width = Math.round(container.clientWidth * dpr)
      canvas.height = Math.round(container.clientHeight * dpr)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(container)

    const spawn = (): Streak => {
      const p = map.unproject([Math.random() * container.clientWidth, Math.random() * container.clientHeight])
      return { tail: [{ lat: p.lat, lon: p.lng }], ageS: 0, lifeS: LIFE_MIN_S + Math.random() * (LIFE_MAX_S - LIFE_MIN_S) }
    }

    const step = (dtS: number) => {
      const target = Math.round(
        Math.min(MAX_STREAKS, Math.max(MIN_STREAKS, (container.clientWidth * container.clientHeight) / PX_PER_STREAK)),
      )
      while (streaks.length < target) {
        const s = spawn()
        s.ageS = Math.random() * s.lifeS // stagger, so they don't all expire together
        streaks.push(s)
      }
      streaks.length = target
      const mpp = metersPerPixel(map.getZoom(), map.getCenter().lat)
      const k = PX_PER_S_PER_MPS * mpp * dtS
      // In place: no new arrays per streak per frame.
      for (let i = 0; i < streaks.length; i++) {
        const s = streaks[i]!
        s.ageS += dtS
        if (s.ageS >= s.lifeS) {
          streaks[i] = spawn()
          continue
        }
        const head = s.tail[s.tail.length - 1]!
        const wind = windAt(gridRef.current, head)
        s.tail.push(fromLocalEastNorthM(head, wind.eastMps * k, wind.northMps * k))
        if (s.tail.length > TAIL_POINTS) s.tail.shift()
      }
    }

    // One path per colour and brightness: six strokes a frame in all.
    const paths = COLORS.map(() => ({ bright: new Path2D(), faint: new Path2D() }))
    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      for (let c = 0; c < paths.length; c++) paths[c] = { bright: new Path2D(), faint: new Path2D() }
      for (const s of streaks) {
        const n = s.tail.length
        if (n < 2) continue
        const head = s.tail[n - 1]!
        const speed = windAt(gridRef.current, head).speedMps
        const bucket = paths[speed >= WIND_STRONG_MPS ? 2 : speed >= WIND_MODERATE_MPS ? 1 : 0]!
        const fading = s.ageS < FADE_S || s.lifeS - s.ageS < FADE_S
        let prev = map.project([s.tail[0]!.lon, s.tail[0]!.lat])
        for (let i = 1; i < n; i++) {
          const p = s.tail[i]!
          const next = map.project([p.lon, p.lat])
          const path = fading || i <= n / 2 ? bucket.faint : bucket.bright
          path.moveTo(prev.x, prev.y)
          path.lineTo(next.x, next.y)
          prev = next
        }
      }
      ctx.lineWidth = LINE_WIDTH_PX
      ctx.lineCap = 'round'
      paths.forEach((p, c) => {
        ctx.strokeStyle = `rgba(${COLORS[c]}, ${FAINT_ALPHA})`
        ctx.stroke(p.faint)
        ctx.strokeStyle = `rgba(${COLORS[c]}, ${BRIGHT_ALPHA})`
        ctx.stroke(p.bright)
      })
    }

    if (still) {
      // A still picture: grow the streaks once, draw, and redraw on moves.
      const snapshot = () => {
        streaks = []
        step(0)
        for (let i = 0; i < TAIL_POINTS; i++) step(0.25)
        draw()
      }
      snapshot()
      map.on('moveend', snapshot)
      return () => {
        observer.disconnect()
        map.off('moveend', snapshot)
        ctx.clearRect(0, 0, canvas.width, canvas.height)
      }
    }

    const tick = (nowMs: number) => {
      frame = requestAnimationFrame(tick)
      if (nowMs - lastMs < FRAME_MS || document.hidden) return
      const dtS = Math.min(0.1, (nowMs - lastMs) / 1000)
      lastMs = nowMs
      step(dtS)
      draw()
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
  }, [map])

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none absolute inset-0 h-full w-full" />
}
