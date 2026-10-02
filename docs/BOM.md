# Bill of materials (draft, confirm in Phase 0)

| Item | Candidate | Approx. | Notes |
|---|---|---|---|
| Airframe | Foam VTOL (e.g. Heewing T2 VTOL class) or DIY QuadPlane conversion | €200–600 | Must have room for the camera board, modem and antennas. Check CG. |
| Flight controller | SpeedyBee F405 WING (prototype) / H743 wing FC (final) | €40–90 | See ADR-0002 |
| GPS + compass | M10 GPS with compass | €25–40 | Mount away from the modem and its antenna |
| Airspeed sensor | Digital (MS4525 / DLVR) | €20–40 | Strongly recommended for fixed-wing auto |
| Air unit SoC | OpenIPC SSC338Q board (or SSC30KQ) + sensor (e.g. IMX415/IMX335) | €40–80 | As in QuadroFleet |
| 4G modem | Quectel EC25 (mini-PCIe / USB) or EP06 (Cat6) | €30–80 | Pick the band variant for your region (e.g. EC25-E for Europe) |
| Modem antennas | 2× LTE flexible antennas | €10–20 | Keep them away from GPS. Mind polarisation and orientation. |
| Backup RC | ELRS receiver + transmitter | €20–150 | Local safety pilot (Phases 3–4) |
| Power | 5 V 3 A BEC for the air unit + low-ESR cap | €10 | Modem TX current peaks |
| Batteries | Li-ion / LiPo per airframe | €40–100 | |
| Data SIM | Carrier data SIM with public internet (CGNAT OK, since WG is outbound) | monthly | Check the carrier's terms for airborne use |
| VPS | 1–2 vCPU, 2 GB RAM, near the flying area | €5–10/mo | |
