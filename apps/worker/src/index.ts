import path from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../.env') })

import { getPrisma } from '@orpos/db'
import { processTarget } from './pipeline.js'

const prisma = getPrisma()
const workerId = process.env.WORKER_ID ?? `worker-${process.pid}`
const leaseMs = Number(process.env.LEASE_MS ?? 60_000)
const pollMs = Number(process.env.POLL_MS ?? 2_000)
const globalThrottle = Number(process.env.THROTTLE_DEFAULT ?? 10)

const inFlight = new Set<string>()

async function fireDueSchedules() {
  const due = await prisma.schedule.findMany({
    where: {
      status: 'ACTIVE',
      fireAt: { lte: new Date() },
    },
    include: { job: { include: { targets: true } } },
  })

  for (const schedule of due) {
    await prisma.$transaction(async (tx) => {
      await tx.schedule.update({
        where: { id: schedule.id },
        data: { status: 'FIRED', firedAt: new Date() },
      })
      await tx.deploymentJob.update({
        where: { id: schedule.jobId },
        data: { status: 'QUEUED', startedAt: new Date() },
      })
      await tx.deploymentJobTarget.updateMany({
        where: { jobId: schedule.jobId, status: 'PENDING' },
        data: { status: 'QUEUED', queuedAt: new Date() },
      })
      await tx.deploymentLog.create({
        data: {
          jobId: schedule.jobId,
          source: 'system',
          level: 'INFO',
          message: `Schedule fired at ${new Date().toISOString()}`,
        },
      })
    })
  }
}

async function countInFlightForJob(jobId: string) {
  return prisma.deploymentJobTarget.count({
    where: {
      jobId,
      status: {
        in: [
          'CONNECTING',
          'PRECHECKING',
          'BACKING_UP',
          'COPYING_ZIP',
          'UNZIPPING',
          'PLACING_PROPERTIES',
          'INSTALLING',
          'INSPECTING_LOG',
          'ROLLING_BACK',
        ],
      },
    },
  })
}

async function claimTargets() {
  const now = new Date()
  // Release expired leases back to QUEUED if still non-terminal mid-flight somehow
  await prisma.deploymentJobTarget.updateMany({
    where: {
      status: 'QUEUED',
      leaseExpiresAt: { lt: now },
    },
    data: { leasedBy: null, leaseExpiresAt: null },
  })

  const queued = await prisma.deploymentJobTarget.findMany({
    where: {
      status: 'QUEUED',
      OR: [{ leasedBy: null }, { leaseExpiresAt: { lt: now } }],
      job: { status: { in: ['QUEUED', 'RUNNING'] } },
    },
    include: {
      machine: true,
      job: true,
    },
    orderBy: { queuedAt: 'asc' },
    take: 50,
  })

  const claimed = []
  for (const target of queued) {
    if (inFlight.size >= globalThrottle) break
    if (inFlight.has(target.id)) continue

    const jobInFlight = await countInFlightForJob(target.jobId)
    const jobThrottle = Math.min(target.job.throttleLimit, globalThrottle)
    // Count local in-flight for this job
    const localJobInFlight = [...inFlight].filter((id) =>
      queued.find((q) => q.id === id && q.jobId === target.jobId),
    ).length
    if (jobInFlight + localJobInFlight >= jobThrottle) continue

    const leaseExpiresAt = new Date(Date.now() + leaseMs)
    const updated = await prisma.deploymentJobTarget.updateMany({
      where: {
        id: target.id,
        status: 'QUEUED',
        OR: [{ leasedBy: null }, { leaseExpiresAt: { lt: now } }],
      },
      data: {
        leasedBy: workerId,
        leaseExpiresAt,
      },
    })
    if (updated.count === 1) {
      claimed.push(target)
    }
  }
  return claimed
}

async function runClaimed(target: Awaited<ReturnType<typeof claimTargets>>[number]) {
  inFlight.add(target.id)
  try {
    await prisma.deploymentJob.updateMany({
      where: { id: target.jobId, status: { in: ['QUEUED', 'READY'] } },
      data: { status: 'RUNNING', startedAt: new Date() },
    })
    await processTarget(prisma, target.job, target)
  } finally {
    inFlight.delete(target.id)
  }
}

async function tick() {
  try {
    await fireDueSchedules()
    const claimed = await claimTargets()
    await Promise.all(claimed.map((t) => runClaimed(t)))
  } catch (err) {
    console.error('[worker] tick error', err)
  }
}

console.log(`[worker] starting ${workerId} mode=${process.env.DEPLOY_MODE ?? 'simulate'} throttle=${globalThrottle}`)
await tick()
setInterval(tick, pollMs)
