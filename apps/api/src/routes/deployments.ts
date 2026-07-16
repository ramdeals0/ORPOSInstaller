import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getPrisma } from '@orpos/db'
import {
  DEFAULT_BACKUP_RULE,
  DEFAULT_INSTALL_PATH,
  DEFAULT_REMOTE_COPY,
  DEFAULT_REMOTE_UNZIP,
} from '@orpos/shared'
import { requireAuth, requireOperator } from '../lib/auth.js'
import { AppError } from '../lib/errors.js'
import {
  aggregateJobStatus,
  buildBackupPreview,
  cancelJob,
  createDeployment,
  getJobDetail,
  retryFailedTargets,
  runPrecheckPreview,
} from '../services/deployments.js'

const deploymentBody = z.object({
  releaseNumber: z.string().min(1),
  installerZipPath: z.string().min(1),
  antPropertiesPath: z.string().min(1),
  remoteCopyPath: z.string().default(DEFAULT_REMOTE_COPY),
  remoteUnzipPath: z.string().default(DEFAULT_REMOTE_UNZIP),
  currentInstallPath: z.string().default(DEFAULT_INSTALL_PATH),
  backupNamingRule: z.string().default(DEFAULT_BACKUP_RULE),
  executionMode: z.enum(['DRY_RUN', 'RUN_NOW', 'SCHEDULED']),
  scheduledFor: z.string().optional().nullable(),
  timezone: z.string().default('UTC'),
  throttleLimit: z.number().int().min(1).max(20).default(10),
  machineIds: z.array(z.string()).min(1),
  autoRollback: z.boolean().default(true),
})

export async function deploymentRoutes(app: FastifyInstance) {
  const prisma = getPrisma()

  app.post('/api/v1/deployments/precheck', { preHandler: requireOperator }, async (request) => {
    const body = z.object({
      installerZipPath: z.string(),
      antPropertiesPath: z.string(),
      remoteCopyPath: z.string(),
      remoteUnzipPath: z.string(),
      currentInstallPath: z.string().optional(),
      machineIds: z.array(z.string()).min(1),
    }).parse(request.body)
    return runPrecheckPreview(prisma, body)
  })

  app.post('/api/v1/deployments/backup-preview', { preHandler: requireAuth }, async (request) => {
    const body = z.object({
      backupNamingRule: z.string().default(DEFAULT_BACKUP_RULE),
      currentInstallPath: z.string().default(DEFAULT_INSTALL_PATH),
    }).parse(request.body ?? {})
    return buildBackupPreview(body.backupNamingRule, body.currentInstallPath)
  })

  app.post('/api/v1/deployments', { preHandler: requireOperator }, async (request) => {
    const body = deploymentBody.parse(request.body)
    const job = await createDeployment(prisma, {
      ...body,
      createdById: request.user.id,
    })
    return { job }
  })

  app.get('/api/v1/deployments', { preHandler: requireAuth }, async (request) => {
    const q = request.query as Record<string, string | undefined>
    const page = Math.max(1, Number(q.page ?? 1))
    const pageSize = Math.min(100, Math.max(1, Number(q.pageSize ?? 25)))
    const where: Record<string, unknown> = {}
    if (q.status) where.status = q.status
    if (q.releaseNumber) where.releaseNumber = { contains: q.releaseNumber }

    const [total, jobs] = await Promise.all([
      prisma.deploymentJob.count({ where }),
      prisma.deploymentJob.findMany({
        where,
        include: {
          createdBy: { select: { id: true, username: true, displayName: true } },
          targets: { select: { id: true, status: true } },
          schedule: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ])

    return {
      total,
      page,
      pageSize,
      jobs: jobs.map((job) => ({
        ...job,
        progress: {
          total: job.targets.length,
          terminal: job.targets.filter((t) =>
            [
              'SUCCEEDED',
              'FAILED',
              'PRECHECK_FAILED',
              'ROLLBACK_SUCCEEDED',
              'ROLLBACK_FAILED',
              'CANCELLED',
              'DRY_RUN_PASSED',
              'DRY_RUN_FAILED',
            ].includes(t.status),
          ).length,
        },
      })),
    }
  })

  app.get('/api/v1/deployments/:jobId', { preHandler: requireAuth }, async (request) => {
    const { jobId } = request.params as { jobId: string }
    await aggregateJobStatus(prisma, jobId).catch(() => undefined)
    return getJobDetail(prisma, jobId)
  })

  app.get('/api/v1/deployments/:jobId/targets/:targetId', { preHandler: requireAuth }, async (request) => {
    const { targetId } = request.params as { targetId: string }
    const target = await prisma.deploymentJobTarget.findUnique({
      where: { id: targetId },
      include: {
        machine: { include: { store: true } },
        steps: { orderBy: { sequence: 'asc' } },
        logs: { orderBy: { createdAt: 'asc' }, take: 500 },
      },
    })
    if (!target) throw new AppError('NOT_FOUND', 'Target not found', 404)
    return { target }
  })

  app.get('/api/v1/deployments/:jobId/targets/:targetId/logs', { preHandler: requireAuth }, async (request) => {
    const { targetId } = request.params as { targetId: string }
    const q = request.query as { after?: string; attemptNumber?: string }
    const logs = await prisma.deploymentLog.findMany({
      where: {
        targetId,
        ...(q.attemptNumber ? { attemptNumber: Number(q.attemptNumber) } : {}),
        ...(q.after ? { createdAt: { gt: new Date(q.after) } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: 1000,
    })
    return { logs }
  })

  app.post('/api/v1/deployments/:jobId/cancel', { preHandler: requireOperator }, async (request) => {
    const { jobId } = request.params as { jobId: string }
    return cancelJob(prisma, jobId)
  })

  app.post('/api/v1/deployments/:jobId/retry', { preHandler: requireOperator }, async (request) => {
    const { jobId } = request.params as { jobId: string }
    const body = z.object({ targetIds: z.array(z.string()).optional() }).parse(request.body ?? {})
    return retryFailedTargets(prisma, jobId, body.targetIds)
  })

  app.post('/api/v1/deployments/:jobId/precheck', { preHandler: requireOperator }, async (request) => {
    const { jobId } = request.params as { jobId: string }
    const detail = await getJobDetail(prisma, jobId)
    const body = z.object({ targetIds: z.array(z.string()).optional() }).parse(request.body ?? {})
    const machineIds = detail.targets
      .filter((t) => !body.targetIds?.length || body.targetIds.includes(t.id))
      .map((t) => t.machineId)
    return runPrecheckPreview(prisma, {
      installerZipPath: detail.job.installerZipPath,
      antPropertiesPath: detail.job.antPropertiesPath,
      remoteCopyPath: detail.job.remoteCopyPath,
      remoteUnzipPath: detail.job.remoteUnzipPath,
      currentInstallPath: detail.job.currentInstallPath,
      machineIds,
    })
  })

  app.get('/api/v1/deployments/:jobId/export', { preHandler: requireAuth }, async (request, reply) => {
    const { jobId } = request.params as { jobId: string }
    const q = request.query as { format?: string }
    const detail = await getJobDetail(prisma, jobId)
    if (q.format === 'json') {
      return detail
    }

    const header = [
      'hostname',
      'store',
      'registerGroup',
      'attempt',
      'status',
      'logVerdict',
      'rollbackResult',
      'errorMessage',
      'startedAt',
      'finishedAt',
    ]
    const rows = detail.targets.map((t) => [
      t.machine.hostname,
      t.machine.store.storeCode,
      t.machine.registerGroupName,
      String(t.attemptNumber),
      t.status,
      t.logVerdict,
      t.rollbackResult ?? '',
      (t.errorMessage ?? '').replaceAll(',', ';'),
      t.startedAt?.toISOString() ?? '',
      t.finishedAt?.toISOString() ?? '',
    ].join(','))
    const csv = [header.join(','), ...rows].join('\n')
    reply.header('Content-Type', 'text/csv')
    reply.header('Content-Disposition', `attachment; filename="deployment-${jobId}.csv"`)
    return csv
  })
}
