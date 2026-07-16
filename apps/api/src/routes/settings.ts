import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getPrisma } from '@orpos/db'
import { requireAuth, requireAdmin } from '../lib/auth.js'
import { recomputeMachineGroups } from '../services/machines.js'

export async function settingsRoutes(app: FastifyInstance) {
  const prisma = getPrisma()

  app.get('/api/v1/settings', { preHandler: requireAuth }, async () => {
    const settings = await prisma.systemSetting.findMany({ orderBy: { key: 'asc' } })
    const map: Record<string, unknown> = {}
    for (const s of settings) map[s.key] = s.valueJson
    return { settings: map }
  })

  app.put('/api/v1/settings/:key', { preHandler: requireAdmin }, async (request) => {
    const { key } = request.params as { key: string }
    const body = z.object({ valueJson: z.unknown() }).parse(request.body)
    const setting = await prisma.systemSetting.upsert({
      where: { key },
      update: { valueJson: body.valueJson as object, updatedBy: request.user.id },
      create: { key, valueJson: body.valueJson as object, updatedBy: request.user.id },
    })
    return { setting }
  })

  app.get('/api/v1/settings/register-group-rules', { preHandler: requireAuth }, async () => {
    const rules = await prisma.registerGroupRule.findMany({
      orderBy: [{ priority: 'asc' }, { minRegId: 'asc' }],
    })
    return { rules }
  })

  app.put('/api/v1/settings/register-group-rules', { preHandler: requireAdmin }, async (request) => {
    const body = z.object({
      rules: z.array(z.object({
        name: z.string().min(1),
        minRegId: z.number().int().min(0),
        maxRegId: z.number().int().min(0),
        priority: z.number().int().default(100),
        isActive: z.boolean().default(true),
      })),
    }).parse(request.body)

    await prisma.$transaction(async (tx) => {
      await tx.registerGroupRule.deleteMany()
      for (const rule of body.rules) {
        await tx.registerGroupRule.create({ data: rule })
      }
    })

    const recompute = await recomputeMachineGroups(prisma)
    const rules = await prisma.registerGroupRule.findMany({
      orderBy: [{ priority: 'asc' }, { minRegId: 'asc' }],
    })
    return { rules, recompute }
  })

  app.get('/api/v1/schedules', { preHandler: requireAuth }, async (request) => {
    const q = request.query as { status?: string }
    const schedules = await prisma.schedule.findMany({
      where: q.status ? { status: q.status as never } : undefined,
      include: {
        job: {
          include: {
            createdBy: { select: { username: true } },
            targets: { select: { id: true } },
          },
        },
      },
      orderBy: { fireAt: 'asc' },
    })
    return { schedules }
  })

  app.patch('/api/v1/schedules/:id', { preHandler: requireAdmin }, async (request) => {
    const { id } = request.params as { id: string }
    const body = z.object({
      fireAt: z.string().optional(),
      status: z.enum(['ACTIVE', 'DISABLED', 'CANCELLED']).optional(),
    }).parse(request.body)

    const schedule = await prisma.schedule.update({
      where: { id },
      data: {
        ...(body.fireAt ? { fireAt: new Date(body.fireAt) } : {}),
        ...(body.status ? { status: body.status } : {}),
      },
      include: { job: true },
    })

    if (body.status === 'CANCELLED') {
      await prisma.deploymentJob.update({
        where: { id: schedule.jobId },
        data: { status: 'CANCELLED', finishedAt: new Date() },
      })
    }

    return { schedule }
  })

  app.get('/api/v1/logs', { preHandler: requireAuth }, async (request) => {
    const q = request.query as Record<string, string | undefined>
    const page = Math.max(1, Number(q.page ?? 1))
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize ?? 50)))
    const where: Record<string, unknown> = {}
    if (q.jobId) where.jobId = q.jobId
    if (q.level) where.level = q.level
    if (q.q) where.message = { contains: q.q }

    const [total, logs] = await Promise.all([
      prisma.deploymentLog.count({ where }),
      prisma.deploymentLog.findMany({
        where,
        include: {
          job: { select: { id: true, releaseNumber: true } },
          target: {
            select: {
              id: true,
              machine: { select: { hostname: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])
    return { total, page, pageSize, logs }
  })

  app.get('/api/v1/users', { preHandler: requireAdmin }, async () => {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
      orderBy: { username: 'asc' },
    })
    return { users }
  })
}
