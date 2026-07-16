import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env') })

import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import { AppError, errorBody } from './lib/errors.js'
import { ensureSeed } from './lib/ensureSeed.js'
import { authRoutes } from './routes/auth.js'
import { machineRoutes } from './routes/machines.js'
import { deploymentRoutes } from './routes/deployments.js'
import { dashboardRoutes } from './routes/dashboard.js'
import { settingsRoutes } from './routes/settings.js'

const app = Fastify({ logger: true })

try {
  const seed = await ensureSeed()
  if (seed.seeded) {
    app.log.warn('Empty database detected — created default users admin/admin123 and operator/operator123')
  }
} catch (err) {
  app.log.error({ err }, 'Failed to ensure seed data — login may fail until migrations/seed are run')
}

await app.register(cors, {
  // Internal tool: allow local Vite and cloud-agent preview origins
  origin: true,
  credentials: true,
})

await app.register(jwt, {
  secret: process.env.JWT_SECRET ?? 'orpos-dev-secret-change-me',
})

app.setErrorHandler((err: unknown, _request, reply) => {
  if (err instanceof AppError) {
    return reply.code(err.statusCode).send(errorBody(err))
  }
  if (typeof err === 'object' && err && 'name' in err && (err as { name: string }).name === 'ZodError') {
    return reply.code(400).send({
      error: {
        code: 'VALIDATION',
        message: 'Invalid request',
        details: (err as { issues?: unknown }).issues ?? [],
      },
    })
  }
  app.log.error(err)
  return reply.code(500).send({
    error: { code: 'INTERNAL', message: 'Internal server error', details: [] },
  })
})

app.get('/api/v1/health', async () => ({
  ok: true,
  service: 'orpos-api',
  deployMode: process.env.DEPLOY_MODE ?? 'simulate',
}))

await app.register(authRoutes)
await app.register(machineRoutes)
await app.register(deploymentRoutes)
await app.register(dashboardRoutes)
await app.register(settingsRoutes)

const port = Number(process.env.PORT ?? 3001)
const host = process.env.HOST ?? '0.0.0.0'

await app.listen({ port, host })
console.log(`ORPOS API listening on http://${host}:${port}`)
