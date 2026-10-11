# server

Logins, missions and the signalling relay between the browser and the drone
agent (Phase 1c, ADR-0030): Fastify on Node 24 (≥ 24.7), SQLite through
`node:sqlite`, argon2id and Ed25519 through `node:crypto`. It brokers the
WebRTC handshake; video and MAVLink never pass through it.

## Set up and run locally

```bash
npm install                      # at the repository root first (packages/protocol), then here
cp .env.example .env             # set ADMIN_USERNAME and ADMIN_PASSWORD
npm run dev                      # :8788; creates data/server.db, data/session-signing.key and the admin
```

Register the drone and give it the server's key:

```bash
(cd ../agent && go run ./cmd/agent -print-key)   # the drone's public key (creates agent/drone.key)
npm run cli -- drone:add drone-1 <that key>
npm run cli -- keys:show                         # pass to the agent as -server-pubkey
```

Then run the agent (`../agent/README.md`) and the console with
`VITE_VEHICLE_LINK=webrtc npm run dev` in `web/`: Vite proxies `/api` and
`/signal` to this server, so the session cookie works as in a deploy.

`data/` holds the database, the signing key and the uploaded flight logs:
it's gitignored, and it's what to back up. Losing the signing key only means
giving every drone the new public key.

## Admin

```bash
npm run cli -- user:add <name> [--admin]     # password typed without echo (or PASSWORD=… for scripts)
npm run cli -- user:passwd <name>            # also signs them out everywhere
npm run cli -- user:remove <name>
npm run cli -- user:list
npm run cli -- drone:add <id> <public key> [--name <name>]
npm run cli -- drone:remove <id>
npm run cli -- drone:list
npm run cli -- keys:show
```

## API

| | |
| --- | --- |
| `POST /api/login` `{username, password}` | sets the session cookie; 401 wrong, 429 locked out for a while |
| `POST /api/logout` | |
| `GET /api/me` | the signed-in user, or 401 |
| `GET/POST /api/missions`, `GET/PUT/DELETE /api/missions/:id` | missions shared by every signed-in user, checked against the protocol's `missionSchema` |
| `POST /api/vehicles/:id/logs/:name` | a drone uploading a finished flight log, signed with its key (`X-Drone-Timestamp`, `X-Drone-Signature`) |
| `GET /api/vehicles/:id/logs`, `GET /api/vehicles/:id/logs/:name` | signed-in users: the uploaded flight logs, and one to download |
| `GET /healthz` | |
| `/signal` (WebSocket) | signalling v2 (`packages/protocol/src/signalling.ts`): operators need the session cookie; drones sign a challenge |

State-changing requests and the signalling upgrade must come from the
server's own origin (or one in `ALLOWED_ORIGINS`).

## Tests

```bash
npm test          # node:test on an in-memory database; includes the shared auth vectors in ../testdata/auth
npm run typecheck
```
