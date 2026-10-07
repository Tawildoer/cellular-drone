import { describe, expect, it } from 'vitest'
import type { LinkStatus } from '../../domain'
import { appendLinkHistory, LINK_HISTORY_WINDOW_MS } from '../linkHistory'

const up: LinkStatus = { state: 'connected', rttMs: 40, videoFps: 30 }

describe('appendLinkHistory', () => {
  it('keeps at most one point per second, whatever rate the link reports at', () => {
    let history = appendLinkHistory([], up, 0)
    history = appendLinkHistory(history, up, 100) // MockLink-style 100 ms tick: ignored
    history = appendLinkHistory(history, up, 1000)
    expect(history.map((p) => p.at)).toEqual([0, 1000])
  })

  it('drops points older than the window', () => {
    let history = appendLinkHistory([], up, 0)
    history = appendLinkHistory(history, up, LINK_HISTORY_WINDOW_MS + 1000)
    expect(history.map((p) => p.at)).toEqual([LINK_HISTORY_WINDOW_MS + 1000])
  })

  it('records a gap (no values), not zeros, while the link is down', () => {
    const history = appendLinkHistory([], { state: 'connecting', rttMs: 40 }, 0)
    expect(history).toEqual([{ at: 0, up: false }])
  })

  it('records the measured values while the link is up', () => {
    expect(appendLinkHistory([], up, 0)[0]).toMatchObject({ rttMs: 40, videoFps: 30 })
  })
})
