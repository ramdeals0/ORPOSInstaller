import bcrypt from 'bcryptjs'
import {
  DEFAULT_REGISTER_GROUP_RULES,
  DEFAULT_SETTINGS,
  STORE_CATALOG,
  parseHostname,
  resolveRegisterGroup,
} from '../packages/shared/src/index.ts'
import { createPrismaClient } from '../packages/db/src/index.ts'

const prisma = createPrismaClient()

async function main() {
  const passwordHash = await bcrypt.hash('admin123', 10)

  const admin = await prisma.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      displayName: 'IT Admin',
      passwordHash,
      role: 'ADMIN',
    },
  })

  await prisma.user.upsert({
    where: { username: 'operator' },
    update: {},
    create: {
      username: 'operator',
      displayName: 'Deploy Operator',
      passwordHash: await bcrypt.hash('operator123', 10),
      role: 'OPERATOR',
    },
  })

  await prisma.user.upsert({
    where: { username: 'auditor' },
    update: {},
    create: {
      username: 'auditor',
      displayName: 'Auditor',
      passwordHash: await bcrypt.hash('auditor123', 10),
      role: 'AUDITOR',
    },
  })

  const rules = DEFAULT_REGISTER_GROUP_RULES.map((r) => ({ ...r }))

  await prisma.registerGroupRule.deleteMany()
  for (const rule of rules) {
    await prisma.registerGroupRule.create({ data: rule })
  }

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.systemSetting.upsert({
      where: { key },
      update: { valueJson: value },
      create: { key, valueJson: value, updatedBy: admin.id },
    })
  }

  // Seed full store catalog: numeric id → 3-letter hostname code
  for (const entry of STORE_CATALOG) {
    await prisma.store.upsert({
      where: { storeCode: entry.storeCode },
      update: {
        storeNumber: entry.storeNumber,
        name: entry.name ?? `Store ${entry.storeNumber} (${entry.storeCode})`,
        isActive: true,
      },
      create: {
        storeCode: entry.storeCode,
        storeNumber: entry.storeNumber,
        name: entry.name ?? `Store ${entry.storeNumber} (${entry.storeCode})`,
      },
    })
  }

  // Sample hosts: <3-letter-code>pos<registerid>
  const sampleHosts = [
    'APPpos001', // G1 — store 100
    'APPpos015', // G1
    'APPpos045', // G1 — simulate install-fail/rollback demo
    'FDLpos001', // G1 — store 200
    'FDLpos100', // G2
    'MARpos110', // G3 — store 300
    'WASpos150', // G4 — store 400
    'FEFpos260', // G5 — store 500
    'ALXpos360', // G6 — store 700
    'GBEpos470', // G7 — store 800
    'MENpos570', // G8 — store 900
    'BEDpos680', // G9 — store 1000
    'PLYpos790', // G10 — store 1100
    'WAPpos796', // Attendant Station — store 1200
    'MANpos801', // SCO Register — store 1300
    'HUDpos830', // G11 — store 1400
    'STPpos930', // G12 — store 1500
  ]

  for (const hostname of sampleHosts) {
    const parsed = parseHostname(hostname)
    if (!parsed) {
      console.warn(`Skipping invalid hostname: ${hostname}`)
      continue
    }
    const store = await prisma.store.findUnique({ where: { storeCode: parsed.storeCode } })
    if (!store) {
      console.warn(`No catalog store for code ${parsed.storeCode}`)
      continue
    }
    const group = resolveRegisterGroup(parsed.registerId, rules)
    await prisma.machine.upsert({
      where: { hostname },
      update: {
        storeId: store.id,
        registerId: parsed.registerId,
        registerIdPadded: parsed.registerIdPadded,
        registerGroupName: group,
        reachabilityStatus: 'REACHABLE',
        winrmStatus: 'OK',
        readyForDeploy: true,
        lastSeenAt: new Date(),
      },
      create: {
        hostname,
        storeId: store.id,
        registerId: parsed.registerId,
        registerIdPadded: parsed.registerIdPadded,
        registerGroupName: group,
        reachabilityStatus: 'REACHABLE',
        winrmStatus: 'OK',
        readyForDeploy: true,
        lastSeenAt: new Date(),
      },
    })
  }

  // Remove legacy machines that do not use 3-letter store codes (e.g. 1234pos001)
  const machines = await prisma.machine.findMany()
  for (const machine of machines) {
    if (!/^[A-Za-z]{3}pos\d+/i.test(machine.hostname)) {
      await prisma.deploymentJobTarget.deleteMany({ where: { machineId: machine.id } })
      await prisma.machine.delete({ where: { id: machine.id } })
    }
  }

  // Remove stores not in the 3-letter catalog
  const catalogCodes = new Set(STORE_CATALOG.map((s) => s.storeCode))
  for (const store of await prisma.store.findMany()) {
    if (!catalogCodes.has(store.storeCode)) {
      const remaining = await prisma.machine.count({ where: { storeId: store.id } })
      if (remaining === 0) {
        await prisma.store.delete({ where: { id: store.id } })
      }
    }
  }

  console.log('Seed complete. Users: admin/admin123, operator/operator123, auditor/auditor123')
  console.log(`Stores: ${await prisma.store.count()} (3-letter hostname codes)`)
  console.log(`Machines: ${await prisma.machine.count()}`)
  console.log(`Register groups: ${rules.length}`)
  console.log('Hostname format: <CODE>pos<registerid> e.g. APPpos001')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
