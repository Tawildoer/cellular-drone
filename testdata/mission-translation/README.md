# Mission translation golden files

Each file is an app `Mission` (the `protocol/` v1 shape), the vehicle home,
and the ArduPlane mission, fence, params and issue codes it must translate to
(docs/MAVLINK.md, ADR-0017).

Both translators run every file here:
- the browser's preview translator: `web/src/ardupilot/__tests__/golden.test.ts`
- the agent's authoritative translator: `agent/internal/mission/translate_test.go`

Write the expected output by hand from ArduPilot's rules, never by copying
what a translator printed: the point is to catch both of them being wrong.
Issues compare by `itemIndex`, `code` and `severity` only (messages are free
text). Changing a file means changing both translators.
