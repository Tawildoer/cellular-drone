import { buildApp } from './app.ts'
import { loadConfig } from './config.ts'
import { openDb } from './db.ts'
import { seedAdmin } from './users.ts'

const config = loadConfig()
const db = openDb(config.dbPath)
const app = await buildApp(config, db)

const admin = await seedAdmin(db, config.adminUsername, config.adminPassword)
if (admin) app.log.info({ username: admin.username }, 'admin_created')

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    void app.close().then(() => {
      db.close()
      process.exit(0)
    })
  })
}

await app.listen({ host: config.host, port: config.port })
