import type { DeploymentJob, DeploymentJobTarget, Machine, PrismaClient } from '@orpos/db'
import { formatBackupName, isTerminalTargetStatus } from '@orpos/shared'

type TargetWithMachine = DeploymentJobTarget & { machine: Machine }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function writeLog(
  prisma: PrismaClient,
  opts: {
    jobId: string
    targetId: string
    attemptNumber: number
    source: string
    level: string
    message: string
    rawChunk?: string
  },
) {
  await prisma.deploymentLog.create({ data: opts })
}

async function setStep(
  prisma: PrismaClient,
  targetId: string,
  attemptNumber: number,
  stepKey: string,
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED',
  message?: string,
  detailJson?: object,
) {
  const data: Record<string, unknown> = { status, message, detailJson }
  if (status === 'RUNNING') data.startedAt = new Date()
  if (status === 'SUCCEEDED' || status === 'FAILED' || status === 'SKIPPED') data.finishedAt = new Date()

  await prisma.deploymentStep.updateMany({
    where: { targetId, attemptNumber, stepKey },
    data,
  })
}

async function setTargetStatus(
  prisma: PrismaClient,
  targetId: string,
  status: DeploymentJobTarget['status'],
  extra: Record<string, unknown> = {},
) {
  await prisma.deploymentJobTarget.update({
    where: { id: targetId },
    data: {
      status,
      ...extra,
      ...(isTerminalTargetStatus(status) ? { finishedAt: new Date(), leasedBy: null, leaseExpiresAt: null } : {}),
      ...(!['PENDING', 'QUEUED'].includes(status) && !extra.startedAt
        ? {}
        : {}),
      ...(status !== 'QUEUED' && status !== 'PENDING' ? { startedAt: extra.startedAt ?? new Date() } : {}),
    },
  })
}

async function aggregateJob(prisma: PrismaClient, jobId: string) {
  const targets = await prisma.deploymentJobTarget.findMany({ where: { jobId } })
  const counts: Record<string, number> = {}
  for (const t of targets) counts[t.status] = (counts[t.status] ?? 0) + 1

  const allTerminal = targets.every((t) => isTerminalTargetStatus(t.status))
  const successes = targets.filter((t) => ['SUCCEEDED', 'DRY_RUN_PASSED'].includes(t.status)).length
  let status: 'QUEUED' | 'RUNNING' | 'COMPLETED' | 'PARTIAL' | 'FAILED' | 'CANCELLED' = 'RUNNING'

  const job = await prisma.deploymentJob.findUniqueOrThrow({ where: { id: jobId } })
  if (job.status === 'CANCELLED') {
    status = 'CANCELLED'
  } else if (!allTerminal) {
    status = targets.some((t) => t.status === 'QUEUED' || t.status === 'PENDING') &&
      !targets.some((t) => !isTerminalTargetStatus(t.status) && t.status !== 'QUEUED' && t.status !== 'PENDING')
      ? 'QUEUED'
      : 'RUNNING'
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
      summaryJson: { counts, successes, total: targets.length },
      finishedAt: allTerminal ? new Date() : null,
    },
  })

  // Update machine last deployment fields for latest attempts that are terminal
  for (const t of targets) {
    if (!isTerminalTargetStatus(t.status)) continue
    await prisma.machine.update({
      where: { id: t.machineId },
      data: {
        lastDeploymentStatus: t.status,
        lastDeploymentAt: t.finishedAt ?? new Date(),
      },
    })
  }
}

export async function processTarget(
  prisma: PrismaClient,
  job: DeploymentJob,
  target: TargetWithMachine,
) {
  const { id: targetId, attemptNumber, machine } = target
  const dryRun = job.executionMode === 'DRY_RUN'

  try {
    await setStep(prisma, targetId, attemptNumber, 'queued', 'SUCCEEDED', 'Dequeued by worker')
    await setTargetStatus(prisma, targetId, 'CONNECTING', { startedAt: new Date() })
    await writeLog(prisma, {
      jobId: job.id,
      targetId,
      attemptNumber,
      source: 'worker',
      level: 'INFO',
      message: `Connecting to ${machine.hostname} (mode=${process.env.DEPLOY_MODE ?? 'simulate'})`,
    })
    await sleep(300)

    // CONNECT / PRECHECK
    await setTargetStatus(prisma, targetId, 'PRECHECKING')
    await setStep(prisma, targetId, attemptNumber, 'prechecks', 'RUNNING', 'Running prechecks')

    const forceFail = machine.hostname.includes('fail') || machine.registerId === 45
    const connectFail = machine.hostname.includes('999')

    if (connectFail) {
      await setStep(prisma, targetId, attemptNumber, 'prechecks', 'FAILED', 'WinRM connection failed')
      await setTargetStatus(prisma, targetId, dryRun ? 'DRY_RUN_FAILED' : 'PRECHECK_FAILED', {
        errorCode: 'WINRM_FAILED',
        errorMessage: 'Unable to establish WinRM session',
      })
      await writeLog(prisma, {
        jobId: job.id,
        targetId,
        attemptNumber,
        source: 'precheck',
        level: 'ERROR',
        message: 'WinRM session could not be established',
      })
      await aggregateJob(prisma, job.id)
      return
    }

    if (forceFail && !dryRun) {
      // continue to install then fail for rollback demo on register 45; for dry run mark fail at precheck disk
    }

    if (forceFail && dryRun) {
      await setStep(prisma, targetId, attemptNumber, 'prechecks', 'FAILED', 'Disk space precheck failed')
      await setTargetStatus(prisma, targetId, 'DRY_RUN_FAILED', {
        errorCode: 'DISK_SPACE',
        errorMessage: 'Insufficient free disk (simulated)',
      })
      await setStep(prisma, targetId, attemptNumber, 'terminal', 'FAILED', 'Dry run failed')
      await aggregateJob(prisma, job.id)
      return
    }

    await setStep(prisma, targetId, attemptNumber, 'prechecks', 'SUCCEEDED', 'All prechecks passed')
    await writeLog(prisma, {
      jobId: job.id,
      targetId,
      attemptNumber,
      source: 'precheck',
      level: 'INFO',
      message: 'Prechecks passed',
    })

    if (dryRun) {
      await setStep(prisma, targetId, attemptNumber, 'terminal', 'SUCCEEDED', 'Dry run passed — no mutations performed', {
        planned: {
          backup: `${job.currentInstallPath}_${formatBackupName(job.backupNamingRule.replace('CLIENT_', ''))}`,
          zip: job.installerZipPath,
          extract: job.remoteUnzipPath,
          command: 'install.cmd silent',
        },
      })
      await setTargetStatus(prisma, targetId, 'DRY_RUN_PASSED')
      await writeLog(prisma, {
        jobId: job.id,
        targetId,
        attemptNumber,
        source: 'worker',
        level: 'INFO',
        message: 'Dry run completed successfully',
      })
      await aggregateJob(prisma, job.id)
      return
    }

    // BACKUP
    const dateStamp = formatBackupName('yyyyMMdd_HHmmss')
    const backupLeaf = formatBackupName(job.backupNamingRule.includes('{') ? job.backupNamingRule : `CLIENT_{yyyyMMdd_HHmmss}`)
    const backupPath = job.currentInstallPath.replace(/CLIENT$/i, backupLeaf.replace(/^CLIENT_?/, 'CLIENT_').startsWith('CLIENT')
      ? backupLeaf
      : `CLIENT_${dateStamp}`)
    // Normalize: CLIENT_<DATE>
    const resolvedBackup = `${job.currentInstallPath}_${dateStamp}`.replace('CLIENT_', 'CLIENT_').replace(/CLIENT_CLIENT_/, 'CLIENT_')
    // Prefer standard: parent\CLIENT_<DATE>
    const parent = job.currentInstallPath.replace(/\\CLIENT$/i, '')
    const finalBackup = `${parent}\\CLIENT_${dateStamp}`

    await setTargetStatus(prisma, targetId, 'BACKING_UP', { backupPath: finalBackup })
    await setStep(prisma, targetId, attemptNumber, 'backup_current_install', 'RUNNING', `Renaming to ${finalBackup}`)
    await sleep(400)
    await setStep(prisma, targetId, attemptNumber, 'backup_current_install', 'SUCCEEDED', `Backed up to ${finalBackup}`)
    await writeLog(prisma, {
      jobId: job.id,
      targetId,
      attemptNumber,
      source: 'winrm',
      level: 'INFO',
      message: `Renamed ${job.currentInstallPath} -> ${finalBackup}`,
    })

    // COPY ZIP
    const remoteZip = `${job.remoteCopyPath}\\ORPOS-${job.releaseNumber}.zip`
    await setTargetStatus(prisma, targetId, 'COPYING_ZIP', { remoteZipPath: remoteZip })
    await setStep(prisma, targetId, attemptNumber, 'copy_zip', 'RUNNING')
    await sleep(500)
    await setStep(prisma, targetId, attemptNumber, 'copy_zip', 'SUCCEEDED', `Copied ZIP to ${remoteZip}`)
    await writeLog(prisma, {
      jobId: job.id,
      targetId,
      attemptNumber,
      source: 'winrm',
      level: 'INFO',
      message: `Copied installer ZIP to ${remoteZip}`,
    })

    // UNZIP
    await setTargetStatus(prisma, targetId, 'UNZIPPING', { remoteExtractPath: job.remoteUnzipPath })
    await setStep(prisma, targetId, attemptNumber, 'unzip', 'RUNNING')
    await sleep(500)
    await setStep(prisma, targetId, attemptNumber, 'unzip', 'SUCCEEDED', `Extracted to ${job.remoteUnzipPath}`)

    // PROPERTIES
    await setTargetStatus(prisma, targetId, 'PLACING_PROPERTIES')
    await setStep(prisma, targetId, attemptNumber, 'place_properties', 'RUNNING')
    await sleep(250)
    await setStep(
      prisma,
      targetId,
      attemptNumber,
      'place_properties',
      'SUCCEEDED',
      'Copied ant.installer.properties to installer root',
    )

    // INSTALL
    await setTargetStatus(prisma, targetId, 'INSTALLING')
    await setStep(prisma, targetId, attemptNumber, 'run_install', 'RUNNING', 'Running install.cmd silent')
    await sleep(800)

    const installFails = forceFail
    if (installFails) {
      await setStep(prisma, targetId, attemptNumber, 'run_install', 'FAILED', 'Installer exited with code 1')
      await writeLog(prisma, {
        jobId: job.id,
        targetId,
        attemptNumber,
        source: 'installer',
        level: 'ERROR',
        message: 'install.cmd silent failed',
        rawChunk: 'BUILD FAILED\nInstallation failed at step ConfigureClient',
      })
    } else {
      await setStep(prisma, targetId, attemptNumber, 'run_install', 'SUCCEEDED', 'install.cmd silent exit 0')
    }

    // INSPECT LOG
    await setTargetStatus(prisma, targetId, 'INSPECTING_LOG', {
      installExitCode: installFails ? 1 : 0,
    })
    await setStep(prisma, targetId, attemptNumber, 'inspect_log', 'RUNNING')
    await sleep(300)

    const matchedLogPath = `${job.remoteUnzipPath}\\ORPOS-${job.releaseNumber}\\pos-install-${dateStamp}log`
    if (installFails) {
      await setStep(prisma, targetId, attemptNumber, 'inspect_log', 'FAILED', 'Log verdict: FAILURE')
      await setTargetStatus(prisma, targetId, 'FAILED', {
        logVerdict: 'FAILURE',
        matchedLogPath,
        errorCode: 'INSTALL_FAILED',
        errorMessage: 'Installer log indicates failure',
        backupPath: finalBackup,
      })
      await writeLog(prisma, {
        jobId: job.id,
        targetId,
        attemptNumber,
        source: 'installer',
        level: 'ERROR',
        message: `Parsed ${matchedLogPath}: FAILURE`,
        rawChunk: 'BUILD FAILED\nInstallation failed',
      })

      // ROLLBACK
      if (job.autoRollback) {
        await setTargetStatus(prisma, targetId, 'ROLLING_BACK')
        await sleep(400)
        const rollbackFails = machine.registerId === 45 && machine.hostname.includes('badrollback')
        if (rollbackFails) {
          await setTargetStatus(prisma, targetId, 'ROLLBACK_FAILED', {
            rollbackResult: 'FAILED',
            errorMessage: 'Rollback rename failed',
          })
          await setStep(prisma, targetId, attemptNumber, 'terminal', 'FAILED', 'Rollback failed')
          await writeLog(prisma, {
            jobId: job.id,
            targetId,
            attemptNumber,
            source: 'worker',
            level: 'ERROR',
            message: `Failed to restore ${finalBackup} -> ${job.currentInstallPath}`,
          })
        } else {
          await setTargetStatus(prisma, targetId, 'ROLLBACK_SUCCEEDED', {
            rollbackResult: 'SUCCEEDED',
          })
          await setStep(prisma, targetId, attemptNumber, 'terminal', 'FAILED', 'Install failed; rollback succeeded')
          await writeLog(prisma, {
            jobId: job.id,
            targetId,
            attemptNumber,
            source: 'worker',
            level: 'WARN',
            message: `Rolled back: ${finalBackup} -> ${job.currentInstallPath}`,
          })
        }
      } else {
        await setStep(prisma, targetId, attemptNumber, 'terminal', 'FAILED', 'Install failed; rollback skipped')
      }
      await aggregateJob(prisma, job.id)
      return
    }

    await setStep(prisma, targetId, attemptNumber, 'inspect_log', 'SUCCEEDED', 'Log verdict: SUCCESS')
    await setStep(prisma, targetId, attemptNumber, 'terminal', 'SUCCEEDED', 'Deployment succeeded')
    await setTargetStatus(prisma, targetId, 'SUCCEEDED', {
      logVerdict: 'SUCCESS',
      matchedLogPath,
      rollbackResult: 'NOT_NEEDED',
      backupPath: finalBackup,
    })
    await writeLog(prisma, {
      jobId: job.id,
      targetId,
      attemptNumber,
      source: 'installer',
      level: 'INFO',
      message: `Parsed ${matchedLogPath}: SUCCESS`,
      rawChunk: 'Installation completed successfully',
    })
    await aggregateJob(prisma, job.id)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await writeLog(prisma, {
      jobId: job.id,
      targetId,
      attemptNumber,
      source: 'worker',
      level: 'ERROR',
      message: `Unhandled worker error: ${message}`,
    })
    await setTargetStatus(prisma, targetId, 'FAILED', {
      errorCode: 'WORKER_ERROR',
      errorMessage: message,
    })
    await aggregateJob(prisma, job.id)
  }
}
