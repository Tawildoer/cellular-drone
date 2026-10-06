import { afterEach, describe, expect, it } from 'vitest'
import { preventPagePinchZoom } from '../preventPagePinchZoom'

function wheel(ctrlKey: boolean): WheelEvent {
  const event = new WheelEvent('wheel', { ctrlKey, deltaY: -10, bubbles: true, cancelable: true })
  document.body.dispatchEvent(event)
  return event
}

describe('preventPagePinchZoom', () => {
  let remove = () => {}
  afterEach(() => remove())

  it('cancels a trackpad pinch (ctrl + wheel) so the page is not magnified', () => {
    remove = preventPagePinchZoom()
    expect(wheel(true).defaultPrevented).toBe(true)
  })

  it('leaves ordinary scrolling alone', () => {
    remove = preventPagePinchZoom()
    expect(wheel(false).defaultPrevented).toBe(false)
  })

  it('cancels Safari gesture events', () => {
    remove = preventPagePinchZoom()
    const event = new Event('gesturestart', { bubbles: true, cancelable: true })
    document.body.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
  })

  it('stops cancelling once removed', () => {
    preventPagePinchZoom()()
    expect(wheel(true).defaultPrevented).toBe(false)
  })
})
