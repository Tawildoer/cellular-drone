# Bill of materials (draft, confirm in Phase 0)

| Item | Candidate | Approx. | Notes |
|---|---|---|---|
| Airframe | Foam VTOL (e.g. Heewing T2 VTOL class) or DIY QuadPlane conversion | €200–600 | Room for the SBC, modem and antennas. Check CG. |
| Flight controller | SpeedyBee F405 WING (prototype) / H743 wing FC (final) | €40–90 | ADR-0002 |
| GPS + compass | M10 GPS with compass | €25–40 | Away from the modem and antennas |
| Airspeed sensor | Digital (MS4525 / DLVR) | €20–40 | Strongly recommended for fixed-wing auto |
| Companion computer | Orange Pi 5 (RK3588S, 8 GB+ RAM), with heatsink/fan and eMMC or NVMe | €100–150 | ADR-0018 (replaces Radxa Zero 3W, ADR-0006). Weigh it with cooling before choosing the airframe. |
| Gimbal camera | 2-axis gimbal with integrated camera and its own H.264/H.265 encoder, Ethernet video out, ArduPilot-supported (e.g. SIYI A8 mini class) | €250–400 | The streamed camera. Ethernet to the Orange Pi; control from the FC over MAVLink/serial. |
| Aux / CV cameras | Up to 3–4 small cameras, MIPI CSI or UVC USB | €20–40 each | Check the Orange Pi 5's camera interfaces and RK3588S driver support first; extras will likely be USB. |
| LTE modem | Quectel EC25 (EC25-E for Europe) or EG25-G (global) on a USB adapter | €30–80 | Pick bands for your carrier |
| LTE antennas | 2× flexible LTE antennas | €10–20 | Keep them away from GPS |
| RC override | ELRS receiver + transmitter (EdgeTX radio) | €20–150 | Permanent override link (ADR-0008) |
| Power | 5 V 5 A+ BEC for the Orange Pi 5 + cameras, separate supply for the gimbal per its spec, low-ESR cap at the modem | €15–30 | Measure total draw with CV running and the modem transmitting |
| Batteries | Li-ion / LiPo per airframe | €40–100 | |
| Data SIM | Data SIM that **must provide IPv6** (dual-stack IPv4 + IPv6), ideally on the same carrier as the operator's phone | monthly | IPv6 is the direct path (ADR-0015): carrier IPv4 NAT blocks direct connections. Many data-only and reseller SIMs are IPv4-only; confirm before buying. Check the carrier's terms for airborne use. |
| VPS | 1–2 vCPU, 2 GB RAM, near the flying area | €5–10/mo | Watch TURN bandwidth allowance |
