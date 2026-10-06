/**
 * Stops the browser magnifying the whole page on a trackpad pinch. Desktop
 * Chrome delivers a pinch as `wheel` events with ctrlKey set; MapLibre already
 * cancels those over the map canvas (and zooms the map instead), but a pinch
 * that starts over a floating panel or the frame never reaches the map, so
 * Chrome zoomed the entire console. Safari sends its own `gesture*` events for
 * the same thing. Keyboard page zoom (⌘+ / ⌘−) still works.
 *
 * Registered on the window, so it runs after any element's own handler —
 * MapLibre still sees the pinch first. Returns a function that removes it.
 */
export function preventPagePinchZoom(target: Window = window): () => void {
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey) e.preventDefault()
  }
  const onGesture = (e: Event) => e.preventDefault()
  const gestureTypes = ['gesturestart', 'gesturechange', 'gestureend']

  target.addEventListener('wheel', onWheel, { passive: false })
  for (const type of gestureTypes) target.addEventListener(type, onGesture)
  return () => {
    target.removeEventListener('wheel', onWheel)
    for (const type of gestureTypes) target.removeEventListener(type, onGesture)
  }
}
