import type { JobExecutionMode, PrismaClient, TargetStatus } from '@orpos/db'
import {
  DEFAULT_BACKUP_RULE,
  DEFAULT_INSTALL_PATH,
  STEP_KEYS,
  formatBackupName,
  isRetryableTargetStatus,
  isTerminalTargetStatus,
  previewBackupPath,
} from '@orpos/shared'
import { AppError } from '../lib/errors.js'

const LIVE_STEPS = STEP_KEYS
const DRY_RUN_STEPS = ['queued', 'prechecks', 'terminal'] as const

export type CreateDeploymentInput = {
  releaseNumber: string
  installerZipPath: string
  antPropertiesPath: string
  remoteCopyPath: string
  remoteUnzipPath: string
  currentInstallPath?: string
  backupNamingRule?: string
  executionMode: JobExecutionMode
  scheduledFor?: string | null
  timezone?: string
  throttleLimit?: number
  machineIds: string[]
  autoRollback?: boolean
  createdById: string
}

export async function createDeployment(prisma: PrismaClient, input: CreateDeploymentInput) {
  if (!input.machineIds.length) {
    throw new AppError('NO_TARGETS', 'Select at least one target machine')
  }
  if (!input.releaseNumber?.trim()) {
    throw new AppError('VALIDATION', 'Release number is required')
  }
  if (!input.installerZipPath?.trim()) {
    throw new AppError('VALIDATION', 'Installer ZIP path is required')
  }
  if (!input.antPropertiesPath?.trim()) {
    throw new AppError('VALIDATION', 'ant.installer.properties local path on target host is required')
  }
  // Properties path is per-target local Windows path (e.g. C:\...), not a deploy-server UNC share.
  if (input.antPropertiesPath.trim().startsWith('\\\\')) {
    throw new AppError(
      'VALIDATION',
      'ant.installer.properties must be a local path on the target host (e.g. C:\\OracleRetailStore\\ant.installer.properties), not a UNC share',
    )
  }

  const machines = await prisma.machine.findMany({
    where: { id: { in: input.machineIds }, isActive: true },
  })
  if (machines.length !== input.machineIds.length) {
    throw new AppError('INVALID_MACHINES', 'One or more machine IDs are invalid')
  }

  const throttle = Math.min(20, Math.max(1, input.throttleLimit ?? 10))
  const currentInstallPath = input.currentInstallPath || DEFAULT_INSTALL_PATH
  const backupNamingRule = input.backupNamingRule || DEFAULT_BACKUP_RULE
  const isScheduled = input.executionMode === 'SCHEDULED'
  const scheduledFor = isScheduled && input.scheduledFor ? new Date(input.scheduledFor) : null

  if (isScheduled && (!scheduledFor || Number.isNaN(scheduledFor.getTime()))) {
    throw new AppError('VALIDATION', 'scheduledFor is required for SCHEDULED mode')
  }

  const initialJobStatus = isScheduled ? 'SCHEDULED' : 'QUEUED'
  const initialTargetStatus: TargetStatus = isScheduled ? 'PENDING' : 'QUEUED'
  const stepKeys = input.executionMode === 'DRY_RUN' ? DRY_RUN_STEPS : LIVE_STEPS

  const job = await prisma.$transaction(async (tx) => {
    const created = await tx.deploymentJob.create({
      data: {
        releaseNumber: input.releaseNumber.trim(),
        installerZipPath: input.installerZipPath.trim(),
        antPropertiesPath: input.antPropertiesPath.trim(),
        remoteCopyPath: input.remoteCopyPath.trim(),
        remoteUnzipPath: input.remoteUnzipPath.trim(),
        currentInstallPath,
        backupNamingRule,
        executionMode: input.executionMode,
        status: initialJobStatus,
        throttleLimit: throttle,
        autoRollback: input.autoRollback ?? true,
        createdById: input.createdById,
        scheduledFor,
        timezone: input.timezone || 'UTC',
        startedAt: isScheduled ? null : new Date(),
      },
    })

    for (const machine of machines) {
      const target = await tx.deploymentJobTarget.create({
        data: {
          jobId: created.id,
          machineId: machine.id,
          status: initialTargetStatus,
          queuedAt: isScheduled ? null : new Date(),
          remoteZipPath: `${input.remoteCopyPath}\\installer.zip`,
          remoteExtractPath: input.remoteUnzipPath,
        },
      })

      await tx.deploymentStep.createMany({
        data: stepKeys.map((stepKey, index) => ({
          targetId: target.id,
          stepKey,
          sequence: index + 1,
          status: 'PENDING',
        })),
      })
    }

    if (isScheduled && scheduledFor) {
      await tx.schedule.create({
        data: {
          jobId: created.id,
          fireAt: scheduledFor,
          timezone: input.timezone || 'UTC',
          status: 'ACTIVE',
        },
      })
    }

    await tx.deploymentLog.create({
      data: {
        jobId: created.id,
        source: 'system',
        level: 'INFO',
        message: `Job created in ${input.executionMode} mode for ${machines.length} machine(s)`,
      },
    })

    await tx.auditEvent.create({
      data: {
        userId: input.createdById,
        action: 'DEPLOYMENT_CREATED',
        entityType: 'DeploymentJob',
        entityId: created.id,
        detailJson: {
          releaseNumber: created.releaseNumber,
          executionMode: created.executionMode,
          targetCount: machines.length,
        },
      },
    })

    return created
  })

  return prisma.deploymentJob.findUniqueOrThrow({
    where: { id: job.id },
    include: {
      createdBy: { select: { id: true, username: true, displayName: true, role: true } },
      schedule: true,
      targets: {
        include: {
          machine: { include: { store: true } },
          steps: { orderBy: { sequence: 'asc' } },
        },
      },
    },
  })
}

export type PrecheckInput = {
  installerZipPath: string
  antPropertiesPath: string
  remoteCopyPath: string
  remoteUnzipPath: string
  currentInstallPath?: string
  machineIds: string[]
}

export async function runPrecheckPreview(prisma: PrismaClient, input: PrecheckInput) {
  const machines = await prisma.machine.findMany({
    where: { id: { in: input.machineIds }, isActive: true },
    include: { store: true },
  })

  const zipOk = Boolean(input.installerZipPath?.trim())
  const propsOk = Boolean(input.antPropertiesPath?.trim())
  const mode = process.env.DEPLOY_MODE ?? 'simulate'

  return {
    results: machines.map((machine) => {
      const unreachable = machine.reachabilityStatus === 'UNREACHABLE' || machine.hostname.includes('999')
      const winrmFail = machine.winrmStatus === 'FAILED' || unreachable
      // Deterministic disk fail for register 045 in simulate mode for demo
      const diskFail = mode === 'simulate' && machine.registerId === 45

      const checks = [
        { key: 'reachable', ok: !unreachable, message: unreachable ? 'Host unreachable' : 'Host reachable' },
        { key: 'winrm', ok: !winrmFail, message: winrmFail ? 'WinRM session failed' : 'WinRM OK' },
        { key: 'installer_zip', ok: zipOk, message: zipOk ? 'Installer ZIP path provided' : 'Installer ZIP path missing' },
        {
          key: 'ant_properties',
          ok: propsOk && !input.antPropertiesPath.trim().startsWith('\\\\'),
          message: !propsOk
            ? 'Properties path missing'
            : input.antPropertiesPath.trim().startsWith('\\\\')
              ? 'Must be a local path on the target host (not UNC)'
              : `Will verify local file on host: ${input.antPropertiesPath}`,
        },
        { key: 'remote_copy_path', ok: Boolean(input.remoteCopyPath), message: 'Remote copy path OK / creatable' },
        { key: 'remote_unzip_path', ok: Boolean(input.remoteUnzipPath), message: 'Remote unzip path OK / creatable' },
        {
          key: 'current_install_path',
          ok: Boolean(input.currentInstallPath || DEFAULT_INSTALL_PATH),
          message: `Current install path ${(input.currentInstallPath || DEFAULT_INSTALL_PATH)}`,
        },
        {
          key: 'disk_space',
          ok: !diskFail,
          message: diskFail ? 'Insufficient free disk (simulated)' : 'Sufficient free disk (estimated)',
        },
      ]

      return {
        machineId: machine.id,
        hostname: machine.hostname,
        storeCode: machine.store.storeCode,
        registerGroupName: machine.registerGroupName,
        ok: checks.every((c) => c.ok),
        checks,
        backupPreview: previewBackupPath(
          input.currentInstallPath || DEFAULT_INSTALL_PATH,
          DEFAULT_BACKUP_RULE,
        ),
      }
    }),
  }
}

export async function aggregateJobStatus(prisma: PrismaClient, jobId: string) {
  const targets = await prisma.deploymentJobTarget.findMany({ where: { jobId } })
  const counts: Record<string, number> = {}
  for (const t of targets) {
    counts[t.status] = (counts[t.status] ?? 0) + 1
  }

  const allTerminal = targets.every((t) => isTerminalTargetStatus(t.status))
  const anyRunning = targets.some((t) => !isTerminalTargetStatus(t.status) && t.status !== 'PENDING')
  const successes = targets.filter((t) =>
    ['SUCCEEDED', 'DRY_RUN_PASSED'].includes(t.status),
  ).length
  const failures = targets.filter((t) =>
    ['FAILED', 'PRECHECK_FAILED', 'ROLLBACK_FAILED', 'DRY_RUN_FAILED', 'ROLLBACK_SUCCEEDED', 'CANCELLED'].includes(
      t.status,
    ),
  ).length

  let status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED' | 'SCHEDULED' = 'QUEUED'
  const job = await prisma.deploymentJob.findUniqueOrThrow({ where: { id: jobId } })
  if (job.status === 'CANCELLED') {
    status = 'CANCELLED'
  } else if (job.status === 'SCHEDULED') {
    status = 'SCHEDULED'
  } else if (!allTerminal) {
    status = anyRunning || targets.some((t) => t.status !== 'PENDING') ? 'RUNNING' : 'QUEUED'
  } else if (successes === targets.length) {
    status = 'COMPLETED'
  } else if (successes > 0) {
    status = 'PARTIAL'
  } else {
    status = 'FAILED'
  }

  await prisma.deploymentJob.update({
    where: { id: jobId },
    data: {
      status,
      summaryJson: { counts, successes, failures, total: targets.length },
      finishedAt: allTerminal ? new Date() : null,
      startedAt: job.startedAt ?? new Date(),
    },
  })

  return { status, counts, successes, failures, total: targets.length }
}

export async function retryFailedTargets(prisma: PrismaClient, jobId: string, targetIds?: string[]) {
  const job = await prisma.deploymentJob.findUniqueOrThrow({
    where: { id: jobId },
    include: { targets: true },
  })

  const candidates = job.targets.filter(
    (t) => isRetryableTargetStatus(t.status) && (!targetIds?.length || targetIds.includes(t.id)),
  )
  if (!candidates.length) {
    throw new AppError('NO_RETRYABLE', 'No retryable failed targets found')
  }

  const stepKeys = job.executionMode === 'DRY_RUN' ? DRY_RUN_STEPS : LIVE_STEPS

  await prisma.$transaction(async (tx) => {
    for (const old of candidates) {
      const attemptNumber = old.attemptNumber + 1
      const target = await tx.deploymentJobTarget.create({
        data: {
          jobId,
          machineId: old.machineId,
          attemptNumber,
          status: 'QUEUED',
          queuedAt: new Date(),
          remoteZipPath: old.remoteZipPath,
          remoteExtractPath: old.remoteExtractPath,
        },
      })
      await tx.deploymentStep.createMany({
        data: stepKeys.map((stepKey, index) => ({
          targetId: target.id,
          attemptNumber,
          stepKey,
          sequence: index + 1,
          status: 'PENDING',
        })),
      })
    }

    await tx.deploymentJob.update({
      where: { id: jobId },
      data: {
        status: 'QUEUED',
        finishedAt: null,
        startedAt: new Date(),
      },
    })

    await tx.deploymentLog.create({
      data: {
        jobId,
        source: 'system',
        level: 'INFO',
        message: `Retry enqueued for ${candidates.length} target(s)`,
      },
    })
  })

  return getJobDetail(prisma, jobId)
}

export async function cancelJob(prisma: PrismaClient, jobId: string) {
  const job = await prisma.deploymentJob.findUniqueOrThrow({
    where: { id: jobId },
    include: { targets: true, schedule: true },
  })

  await prisma.$transaction(async (tx) => {
    await tx.deploymentJob.update({
      where: { id: jobId },
      data: { status: 'CANCELLED', finishedAt: new Date() },
    })
    if (job.schedule && job.schedule.status === 'ACTIVE') {
      await tx.schedule.update({
        where: { id: job.schedule.id },
        data: { status: 'CANCELLED' },
      })
    }
    for (const t of job.targets) {
      if (!isTerminalTargetStatus(t.status) || t.status === 'PENDING' || t.status === 'QUEUED') {
        await tx.deploymentJobTarget.update({
          where: { id: t.id },
          data: {
            status: 'CANCELLED',
            finishedAt: new Date(),
            errorMessage: 'Cancelled by operator',
          },
        })
      }
    }
  })

  return getJobDetail(prisma, jobId)
}

export async function getJobDetail(prisma: PrismaClient, jobId: string) {
  const job = await prisma.deploymentJob.findUnique({
    where: { id: jobId },
    include: {
      createdBy: { select: { id: true, username: true, displayName: true, role: true } },
      schedule: true,
      targets: {
        include: {
          machine: { include: { store: true } },
          steps: { orderBy: { sequence: 'asc' } },
        },
        orderBy: [{ machine: { hostname: 'asc' } }, { attemptNumber: 'desc' }],
      },
    },
  })
  if (!job) throw new AppError('NOT_FOUND', 'Deployment job not found', 404)

  const counts: Record<string, number> = {}
  for (const t of job.targets) {
    counts[t.status] = (counts[t.status] ?? 0) + 1
  }

  return {
    job,
    targets: job.targets,
    summary: { counts },
  }
}

export function buildBackupPreview(rule: string, installPath: string) {
  const name = formatBackupName(rule)
  return {
    rule,
    previewName: name,
    previewPath: previewBackupPath(installPath, rule),
  }
}
