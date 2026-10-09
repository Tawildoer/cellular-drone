import { useEffect, useState } from 'react'

/** The current time, refreshed every `intervalMs`: for ages that must grow
 * while nothing else changes (e.g. telemetry that has stopped arriving). */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
