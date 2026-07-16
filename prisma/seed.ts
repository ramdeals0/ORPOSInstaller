import bcrypt from 'bcryptjs'
import {
  DEFAULT_REGISTER_GROUP_RULES,
  DEFAULT_SETTINGS,
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

  // Sample hosts covering multiple RegisterG* ranges from application.xml
  const sampleHosts = [
    '1234pos001', // G1
    '1234pos015', // G1
    '1234pos050', // G1
    '1234pos100', // G2
    '1234pos110', // G3
    '1234pos150', // G4
    '1234pos260', // G5
    '5678pos360', // G6
    '5678pos470', // G7
    '5678pos570', // G8
    '5678pos680', // G9
    '9012pos790', // G10
    '9012pos796', // Attendant Station (G14)
    '9012pos801', // SCO Register (G13)
    '9012pos830', // G11
    '9012pos930', // G12
    '5678pos045', // G1 — used by simulate worker for install-fail/rollback demo
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

  // Recompute groups for every machine (including leftover inventory)
  const allMachines = await prisma.machine.findMany()
  let recomputed = 0
  for (const machine of allMachines) {
    const group = resolveRegisterGroup(machine.registerId, rules)
    if (group !== machine.registerGroupName) {
      await prisma.machine.update({
        where: { id: machine.id },
        data: { registerGroupName: group },
      })
      recomputed += 1
    }
  }

  console.log('Seed complete. Users: admin/admin123, operator/operator123, auditor/auditor123')
  console.log(`Register groups: ${rules.length} (RegisterG1–G14 from ORPOS application.xml)`)
  console.log(`Recomputed groups on ${recomputed}/${allMachines.length} machines`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
