# ArduPlane SITL (QuadPlane) for cellular-drone. Builds ArduPilot from
# source for this machine's architecture (arm64 Macs included): the first
# build takes a while, later runs reuse the image.
ARG ARDUPILOT_TAG=Plane-4.7.1

FROM ubuntu:24.04 AS build
ARG ARDUPILOT_TAG
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      git ca-certificates build-essential g++ python3 python3-pip python3-dev \
      pkg-config libtool ccache rsync \
    && rm -rf /var/lib/apt/lists/*
# waf's code generators (MAVLink headers, DroneCAN DSDL) need these.
RUN pip3 install --break-system-packages empy==3.3.4 pexpect future lxml dronecan
RUN git clone --depth 1 --branch ${ARDUPILOT_TAG} --recurse-submodules --shallow-submodules \
      https://github.com/ArduPilot/ardupilot.git /ardupilot
WORKDIR /ardupilot
RUN ./waf configure --board sitl && ./waf plane

FROM ubuntu:24.04
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /ardupilot/build/sitl/bin/arduplane /sitl/arduplane
COPY --from=build /ardupilot/Tools/autotest/default_params/ /sitl/default_params/
COPY params/ /sitl/params/
# SITL loads Lua scripts from ./scripts relative to its working directory.
COPY scripts/ /sitl/state/scripts/
COPY run.sh /sitl/run.sh
WORKDIR /sitl/state
# 5760: the agent (SERIAL0). 5762: a ground-station tool alongside it
# (Mission Planner / QGroundControl / MAVProxy), e.g. for tuning or checking
# what the agent uploaded.
EXPOSE 5760 5762
ENTRYPOINT ["/sitl/run.sh"]
