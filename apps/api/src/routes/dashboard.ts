import type { FastifyInstance } from 'fastify'
import { getPrisma } from '@orpos/db'
import { requireAuth } from '../lib/auth.js'

export async function dashboardRoutes(app: FastifyInstance) {
  const prisma = getPrisma()

  app.get('/api/v1/dashboard/summary', { preHandler: requireAuth }, async () => {
    const [
      machines,
      reachable,
      readyForDeploy,
      deploymentsInProgress,
      deploymentFailures,
      rollbackSuccesses,
      rollbackFailures,
      recentJobs,
      targets,
    ] = await Promise.all([
      prisma.machine.count({ where: { isActive: true } }),
      prisma.machine.count({ where: { isActive: true, reachabilityStatus: 'REACHABLE' } }),
      prisma.machine.count({ where: { isActive: true, readyForDeploy: true } }),
      prisma.deploymentJob.count({ where: { status: { in: ['QUEUED', 'RUNNING'] } } }),
      prisma.deploymentJobTarget.count({
        where: { status: { in: ['FAILED', 'PRECHECK_FAILED', 'DRY_RUN_FAILED'] } },
      }),
      prisma.deploymentJobTarget.count({ where: { status: 'ROLLBACK_SUCCEEDED' } }),
      prisma.deploymentJobTarget.count({ where: { status: 'ROLLBACK_FAILED' } }),
      prisma.deploymentJob.findMany({
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          createdBy: { select: { username: true } },
          targets: { select: { status: true } },
        },
      }),
      prisma.deploymentJobTarget.findMany({
        where: {
          status: { in: ['SUCCEEDED', 'FAILED', 'ROLLBACK_SUCCEEDED', 'ROLLBACK_FAILED', 'DRY_RUN_PASSED', 'DRY_RUN_FAILED'] },
        },
        include: {
          machine: { include: { store: true } },
          job: { select: { releaseNumber: true } },
        },
        take: 500,
        orderBy: { finishedAt: 'desc' },
      }),
    ])

    const byStore = new Map<string, { storeCode: string; count: number; failed: number; succeeded: number }>()
    const byGroup = new Map<string, { registerGroupName: string; count: number; failed: number; succeeded: number }>()

    for (const t of targets) {
      const storeCode = t.machine.store.storeCode
      const group = t.machine.registerGroupName
      const succeeded = ['SUCCEEDED', 'DRY_RUN_PASSED'].includes(t.status)
      const failed = ['FAILED', 'PRECHECK_FAILED', 'ROLLBACK_FAILED', 'DRY_RUN_FAILED', 'ROLLBACK_SUCCEEDED'].includes(t.status)

      const s = byStore.get(storeCode) ?? { storeCode, count: 0, failed: 0, succeeded: 0 }
      s.count += 1
      if (succeeded) s.succeeded += 1
      if (failed) s.failed += 1
      byStore.set(storeCode, s)

      const g = byGroup.get(group) ?? { registerGroupName: group, count: 0, failed: 0, succeeded: 0 }
      g.count += 1
      if (succeeded) g.succeeded += 1
      if (failed) g.failed += 1
      byGroup.set(group, g)
    }

    return {
      totals: {
        machines,
        reachable,
        readyForDeploy,
        deploymentsInProgress,
        deploymentFailures,
        rollbackSuccesses,
        rollbackFailures,
      },
      recentJobs: recentJobs.map((job) => ({
        id: job.id,
        releaseNumber: job.releaseNumber,
        status: job.status,
        executionMode: job.executionMode,
        createdAt: job.createdAt,
        createdBy: job.createdBy.username,
        summaryJson: job.summaryJson,
        progress: `${job.targets.filter((t) => ['SUCCEEDED', 'FAILED', 'PRECHECK_FAILED', 'ROLLBACK_SUCCEEDED', 'ROLLBACK_FAILED', 'CANCELLED', 'DRY_RUN_PASSED', 'DRY_RUN_FAILED'].includes(t.status)).length}/${job.targets.length}`,
      })),
      deploymentsByStore: [...byStore.values()].sort((a, b) => a.storeCode.localeCompare(b.storeCode)),
      deploymentsByRegisterGroup: [...byGroup.values()].sort((a, b) => a.registerGroupName.localeCompare(b.registerGroupName)),
    }
  })
}
