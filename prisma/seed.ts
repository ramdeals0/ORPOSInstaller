import bcrypt from 'bcryptjs'
import { DEFAULT_SETTINGS, parseHostname, resolveRegisterGroup } from '../packages/shared/src/index.ts'
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

  const rules = [
    { name: 'Front End Registers', minRegId: 1, maxRegId: 50, priority: 10 },
    { name: 'Service Desk', minRegId: 150, maxRegId: 200, priority: 10 },
  ]

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

  const sampleHosts = [
    '1234pos001',
    '1234pos002',
    '1234pos015',
    '1234pos150',
    '1234pos151',
    '5678pos001',
    '5678pos045',
    '5678pos160',
    '9012pos010',
    '9012pos200',
  ]

  for (const hostname of sampleHosts) {
    const parsed = parseHostname(hostname)
    if (!parsed) continue
    const store = await prisma.store.upsert({
      where: { storeCode: parsed.storeCode },
      update: {},
      create: {
        storeCode: parsed.storeCode,
        name: `Store ${parsed.storeCode}`,
      },
    })
    const group = resolveRegisterGroup(parsed.registerId, rules)
    await prisma.machine.upsert({
      where: { hostname },
      update: {
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

  console.log('Seed complete. Users: admin/admin123, operator/operator123, auditor/auditor123')
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
