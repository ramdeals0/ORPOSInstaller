import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { getPrisma } from '@orpos/db'
import { requireAuth } from '../lib/auth.js'

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

export async function authRoutes(app: FastifyInstance) {
  const prisma = getPrisma()

  app.post('/api/v1/auth/login', async (request, reply) => {
    const body = loginSchema.parse(request.body)
    const user = await prisma.user.findUnique({ where: { username: body.username } })
    if (!user || !user.isActive) {
      return reply.code(401).send({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' } })
    }
    const ok = await bcrypt.compare(body.password, user.passwordHash)
    if (!ok) {
      return reply.code(401).send({ error: { code: 'INVALID_CREDENTIALS', message: 'Invalid username or password' } })
    }

    const token = await reply.jwtSign({
      sub: user.id,
      username: user.username,
      role: user.role,
    })

    return {
      token,
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      },
    }
  })

  app.post('/api/v1/auth/logout', { preHandler: requireAuth }, async () => ({ ok: true }))

  app.get('/api/v1/auth/me', { preHandler: requireAuth }, async (request) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.user.id } })
    return {
      user: {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      },
    }
  })
}
