import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getPrisma } from '@orpos/db'
import { requireAuth, requireAdmin, requireOperator } from '../lib/auth.js'
import { AppError } from '../lib/errors.js'
import {
  listMachines,
  probeMachines,
  recomputeMachineGroups,
  upsertMachineFromHostname,
} from '../services/machines.js'

export async function machineRoutes(app: FastifyInstance) {
  const prisma = getPrisma()

  app.get('/api/v1/stores', { preHandler: requireAuth }, async () => {
    const stores = await prisma.store.findMany({
      orderBy: [{ storeNumber: 'asc' }, { storeCode: 'asc' }],
    })
    return { stores }
  })

  app.post('/api/v1/stores', { preHandler: requireAdmin }, async (request) => {
    const body = z.object({
      storeCode: z.string().length(3).transform((s) => s.toUpperCase()),
      storeNumber: z.number().int().optional(),
      name: z.string().optional(),
      isActive: z.boolean().optional(),
    }).parse(request.body)
    const store = await prisma.store.create({ data: body })
    return { store }
  })

  app.patch('/api/v1/stores/:id', { preHandler: requireAdmin }, async (request) => {
    const { id } = request.params as { id: string }
    const body = z.object({
      storeNumber: z.number().int().nullable().optional(),
      name: z.string().optional(),
      isActive: z.boolean().optional(),
    }).parse(request.body)
    const store = await prisma.store.update({ where: { id }, data: body })
    return { store }
  })

  app.get('/api/v1/machines', { preHandler: requireAuth }, async (request) => {
    const q = request.query as Record<string, string | undefined>
    const result = await listMachines(prisma, {
      q: q.q,
      storeId: q.storeId,
      registerGroup: q.registerGroup,
      registerIdMin: q.registerIdMin ? Number(q.registerIdMin) : undefined,
      registerIdMax: q.registerIdMax ? Number(q.registerIdMax) : undefined,
      hostname: q.hostname,
      reachabilityStatus: q.reachabilityStatus as never,
      lastDeploymentStatus: q.lastDeploymentStatus as never,
      readyForDeploy: q.readyForDeploy === undefined ? undefined : q.readyForDeploy === 'true',
      page: q.page ? Number(q.page) : 1,
      pageSize: q.pageSize ? Number(q.pageSize) : 50,
    })
    return result
  })

  app.get('/api/v1/machines/:id', { preHandler: requireAuth }, async (request) => {
    const { id } = request.params as { id: string }
    const machine = await prisma.machine.findUnique({
      where: { id },
      include: {
        store: true,
        targets: {
          take: 10,
          orderBy: { createdAt: 'desc' },
          include: {
            job: { select: { id: true, releaseNumber: true, status: true, createdAt: true } },
          },
        },
      },
    })
    if (!machine) throw new AppError('NOT_FOUND', 'Machine not found', 404)
    return { machine }
  })

  app.post('/api/v1/machines', { preHandler: requireAdmin }, async (request) => {
    const body = z.object({
      hostname: z.string().min(1),
      fqdnOrIp: z.string().optional(),
      notes: z.string().optional(),
      isActive: z.boolean().optional(),
    }).parse(request.body)
    const machine = await upsertMachineFromHostname(prisma, body.hostname, body)
    return { machine }
  })

  app.patch('/api/v1/machines/:id', { preHandler: requireAdmin }, async (request) => {
    const { id } = request.params as { id: string }
    const body = z.object({
      fqdnOrIp: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      isActive: z.boolean().optional(),
    }).parse(request.body)
    const machine = await prisma.machine.update({
      where: { id },
      data: body,
      include: { store: true },
    })
    return { machine }
  })

  app.post('/api/v1/machines/import', { preHandler: requireAdmin }, async (request) => {
    const body = z.object({
      hostnames: z.array(z.string()).min(1),
    }).parse(request.body)
    const machines = []
    for (const hostname of body.hostnames) {
      machines.push(await upsertMachineFromHostname(prisma, hostname.trim()))
    }
    return { imported: machines.length, machines }
  })

  app.post('/api/v1/machines/probe', { preHandler: requireOperator }, async (request) => {
    const body = z.object({
      machineIds: z.array(z.string()).optional(),
    }).parse(request.body ?? {})
    const machines = await probeMachines(prisma, body.machineIds)
    return { machines }
  })

  app.post('/api/v1/settings/register-group-rules/recompute', { preHandler: requireAdmin }, async () => {
    const result = await recomputeMachineGroups(prisma)
    return result
  })
}
