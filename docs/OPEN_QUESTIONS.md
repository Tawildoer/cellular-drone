# Open questions

- [ ] Country or countries of operation, and which regulatory category applies (VLOS for now; BVLOS later?)
- [ ] Do you own a SpeedyBee F405 WING already, or should we buy an H743 FC?
- [ ] Airframe: off-the-shelf VTOL or a DIY conversion? Target endurance and range?
- [ ] Mission payload: is the gimbal camera just for situational awareness, or for real imaging or mapping (stills, geotagging)?
- [ ] What the onboard CV must do (detect people/vehicles, track a target, landing assist, mapping…). It sizes the compute: if the Orange Pi 5's NPU isn't enough, add a Hailo-8L over M.2 or move to a Jetson Orin NX (ADR-0018).
- [ ] Which gimbal, and exactly how many aux and CV cameras (and over which interfaces)?
- [ ] Obstacle avoidance (ADR-0019): stereo pair or one camera with monocular depth? Add a rangefinder/lidar for landing? Which escape action per flight phase?
- [ ] Single operator, or several users and roles in the web app?
- [ ] Custom domain name for the web app?
- [ ] Cellular carrier and the coverage at the flying site
- [ ] Is a recorded-video archive needed, or live view only?
