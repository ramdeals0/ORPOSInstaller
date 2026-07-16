import type { Prisma, PrismaClient, ReachabilityStatus, TargetStatus, WinrmStatus } from '@orpos/db'
import { parseHostname, resolveRegisterGroup, storeNumberFromCode } from '@orpos/shared'

export async function getActiveGroupRules(prisma: PrismaClient) {
  return prisma.registerGroupRule.findMany({
    where: { isActive: true },
    orderBy: [{ priority: 'asc' }, { minRegId: 'asc' }],
  })
}

export async function upsertMachineFromHostname(
  prisma: PrismaClient,
  hostname: string,
  extras: {
    fqdnOrIp?: string | null
    notes?: string | null
    isActive?: boolean
  } = {},
) {
  const parsed = parseHostname(hostname)
  if (!parsed) {
    throw new Error(`Invalid hostname format: ${hostname}. Expected <Storeid>pos<registerid>`)
  }

  const rules = await getActiveGroupRules(prisma)
  const registerGroupName = resolveRegisterGroup(parsed.registerId, rules)

  const storeNumber = storeNumberFromCode(parsed.storeCode) ?? null
  const store = await prisma.store.upsert({
    where: { storeCode: parsed.storeCode },
    update: {
      storeNumber: storeNumber ?? undefined,
      name: storeNumber != null ? `Store ${storeNumber} (${parsed.storeCode})` : `Store ${parsed.storeCode}`,
    },
    create: {
      storeCode: parsed.storeCode,
      storeNumber,
      name: storeNumber != null ? `Store ${storeNumber} (${parsed.storeCode})` : `Store ${parsed.storeCode}`,
    },
  })

  return prisma.machine.upsert({
    where: { hostname },
    update: {
      storeId: store.id,
      registerId: parsed.registerId,
      registerIdPadded: parsed.registerIdPadded,
      registerGroupName,
      fqdnOrIp: extras.fqdnOrIp ?? undefined,
      notes: extras.notes ?? undefined,
      isActive: extras.isActive ?? undefined,
    },
    create: {
      hostname,
      storeId: store.id,
      registerId: parsed.registerId,
      registerIdPadded: parsed.registerIdPadded,
      registerGroupName,
      fqdnOrIp: extras.fqdnOrIp ?? null,
      notes: extras.notes ?? null,
      isActive: extras.isActive ?? true,
    },
    include: { store: true },
  })
}

export async function recomputeMachineGroups(prisma: PrismaClient) {
  const rules = await getActiveGroupRules(prisma)
  const machines = await prisma.machine.findMany()
  let updated = 0
  for (const machine of machines) {
    const group = resolveRegisterGroup(machine.registerId, rules)
    if (group !== machine.registerGroupName) {
      await prisma.machine.update({
        where: { id: machine.id },
        data: { registerGroupName: group },
      })
      updated += 1
    }
  }
  return { total: machines.length, updated }
}

export type MachineListQuery = {
  q?: string
  storeId?: string
  registerGroup?: string
  registerIdMin?: number
  registerIdMax?: number
  hostname?: string
  reachabilityStatus?: ReachabilityStatus
  lastDeploymentStatus?: TargetStatus
  readyForDeploy?: boolean
  page?: number
  pageSize?: number
  sort?: string
}

export async function listMachines(prisma: PrismaClient, query: MachineListQuery) {
  const page = Math.max(1, query.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 50))

  const where: Prisma.MachineWhereInput = {
    isActive: true,
  }

  if (query.storeId) where.storeId = query.storeId
  if (query.registerGroup) where.registerGroupName = query.registerGroup
  if (query.hostname) where.hostname = { contains: query.hostname }
  if (query.reachabilityStatus) where.reachabilityStatus = query.reachabilityStatus
  if (query.lastDeploymentStatus) where.lastDeploymentStatus = query.lastDeploymentStatus
  if (typeof query.readyForDeploy === 'boolean') where.readyForDeploy = query.readyForDeploy
  if (query.registerIdMin != null || query.registerIdMax != null) {
    where.registerId = {}
    if (query.registerIdMin != null) where.registerId.gte = query.registerIdMin
    if (query.registerIdMax != null) where.registerId.lte = query.registerIdMax
  }
  if (query.q) {
    where.OR = [
      { hostname: { contains: query.q } },
      { registerGroupName: { contains: query.q } },
      { store: { storeCode: { contains: query.q } } },
      { store: { name: { contains: query.q } } },
    ]
  }

  const [total, items] = await Promise.all([
    prisma.machine.count({ where }),
    prisma.machine.findMany({
      where,
      include: { store: true },
      orderBy: [{ store: { storeCode: 'asc' } }, { registerId: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])

  return { total, page, pageSize, items }
}

export async function probeMachines(prisma: PrismaClient, machineIds?: string[]) {
  const where: Prisma.MachineWhereInput = { isActive: true }
  if (machineIds?.length) where.id = { in: machineIds }

  const machines = await prisma.machine.findMany({ where })
  const mode = process.env.DEPLOY_MODE ?? 'simulate'
  const now = new Date()

  const results = []
  for (const machine of machines) {
    // Simulate: most hosts OK; hostnames containing "999" fail
    const fail = mode === 'simulate' && machine.hostname.includes('999')
    const reachabilityStatus: ReachabilityStatus = fail ? 'UNREACHABLE' : 'REACHABLE'
    const winrmStatus: WinrmStatus = fail ? 'FAILED' : 'OK'
    const readyForDeploy = !fail

    const updated = await prisma.machine.update({
      where: { id: machine.id },
      data: {
        reachabilityStatus,
        winrmStatus,
        readyForDeploy,
        lastSeenAt: fail ? machine.lastSeenAt : now,
      },
      include: { store: true },
    })
    results.push(updated)
  }
  return results
}
