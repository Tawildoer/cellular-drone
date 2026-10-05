# Bill of materials (draft, confirm in Phase 0)

| Item | Candidate | Approx. | Notes |
|---|---|---|---|
| Airframe | Foam VTOL (e.g. Heewing T2 VTOL class) or DIY QuadPlane conversion | €200–600 | Room for the SBC, modem and antennas. Check CG. |
| Flight controller | SpeedyBee F405 WING (prototype) / H743 wing FC (final) | €40–90 | ADR-0002 |
| GPS + compass | M10 GPS with compass | €25–40 | Away from the modem and antennas |
| Airspeed sensor | Digital (MS4525 / DLVR) | €20–40 | Strongly recommended for fixed-wing auto |
| Companion computer | Radxa Zero 3W (2–4 GB RAM, eMMC) | €30–50 | ADR-0006 |
| Camera | MIPI CSI camera supported by Radxa (e.g. Radxa Camera 4K / IMX415 module), or a UVC USB camera | €20–40 | Check driver support for RK3566 before buying |
| LTE modem | Quectel EC25 (EC25-E for Europe) or EG25-G (global) on a USB adapter | €30–80 | Pick bands for your carrier |
| LTE antennas | 2× flexible LTE antennas | €10–20 | Keep them away from GPS |
| RC override | ELRS receiver + transmitter (EdgeTX radio) | €20–150 | Permanent override link (ADR-0008) |
| Power | 5 V 3–5 A BEC + low-ESR cap | €10 | SBC + modem TX peaks |
| Batteries | Li-ion / LiPo per airframe | €40–100 | |
| Data SIM | Data SIM that **must provide IPv6** (dual-stack IPv4 + IPv6), ideally on the same carrier as the operator's phone | monthly | IPv6 is the direct path (ADR-0015): carrier IPv4 NAT blocks direct connections. Many data-only and reseller SIMs are IPv4-only; confirm before buying. Check the carrier's terms for airborne use. |
| VPS | 1–2 vCPU, 2 GB RAM, near the flying area | €5–10/mo | Watch TURN bandwidth allowance |
