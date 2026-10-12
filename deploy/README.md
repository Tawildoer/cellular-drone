# deploy

The VPS (ADR-0030): Caddy in front of the server, on one origin. Caddy
gets a TLS certificate for `DOMAIN`, serves the console (the server-backed
web build) and proxies `/api`, `/signal` and `/healthz` to the server. The
server keeps its database, signing key and uploaded flight logs in the
`server-data` volume. Video and MAVLink go directly between the browser and
the drone over WebRTC; neither passes through here. TURN is on hold
(ADR-0015).

## First time

On a VPS with Docker, its DNS name pointing at it, and ports 80 and 443
(TCP, plus UDP for HTTP/3) open:

```bash
git clone <this repository> && cd cellular-drone
npm install && (cd web && npm install && npm run build:server)   # the console, into web/dist-server
cd deploy && cp .env.example .env                                 # DOMAIN, ADMIN_USERNAME, ADMIN_PASSWORD
docker compose up -d --build
docker compose logs server | grep session_signing_key            # or: docker compose exec server npm run cli -- keys:show
```

Then register each drone and point its agent here:

```bash
# on the drone
./agent -key /etc/cellular-drone/drone.key -print-key
# here
docker compose exec server npm run cli -- drone:add drone-1 <that key> --name "Drone 1"
# on the drone, from then on
./agent -signal wss://$DOMAIN/signal -key /etc/cellular-drone/drone.key -server-pubkey <server key> ...
```

## Day to day

```bash
docker compose exec server npm run cli -- user:add <name>      # asks for the password
docker compose exec server npm run cli -- user:list
docker compose exec server npm run cli -- drone:list
git pull && (cd ../web && npm run build:server) && docker compose up -d --build   # update
docker compose restart caddy                                                     # after a Caddyfile change
```

The Caddyfile is mounted as a single file, and `git pull` replaces it with a
new one, so `caddy reload` keeps the old copy: restart the container instead.

Back up the `server-data` volume (database, signing key, flight logs):

```bash
docker run --rm -v deploy_server-data:/data -v "$PWD":/backup alpine tar czf /backup/server-data.tgz -C /data .
```

The admin in `.env` is only created on the first start; it never resets an
existing password. To try the stack on a laptop, set `DOMAIN=localhost`
and other ports (`HTTPS_PORT=8443`): Caddy then uses its own local
certificate, which the browser will warn about.
