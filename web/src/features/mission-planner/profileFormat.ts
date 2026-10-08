/** "850 m" under a kilometre, "12.4 km" above. */
export function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`
}

/** "4:05" under an hour, "1:02:05" above. */
export function formatDuration(s: number): string {
  const total = Math.round(s)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const sec = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** Round axis ticks: steps of 1, 2, 2.5 or 5 × 10ⁿ, at most `maxTicks`. */
export function niceTicks(min: number, max: number, maxTicks: number): number[] {
  const span = max - min
  if (span <= 0) return [min]
  const raw = span / maxTicks
  const magnitude = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((f) => f * magnitude).find((s) => s >= raw) ?? 10 * magnitude
  const ticks: number[] = []
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) ticks.push(Number(t.toFixed(6)))
  return ticks
}

/** The range widened to whole tick steps, so both ends are labelled. */
export function niceDomain(min: number, max: number, maxTicks: number): { min: number; max: number; ticks: number[] } {
  const ticks = niceTicks(min, max, maxTicks)
  const step = ticks.length > 1 ? ticks[1]! - ticks[0]! : Math.max(1, Math.abs(max - min))
  const lo = Math.floor(min / step) * step
  const hi = Math.max(lo + step, Math.ceil(max / step) * step)
  return { min: lo, max: hi, ticks: niceTicks(lo, hi, Math.round((hi - lo) / step)) }
}
