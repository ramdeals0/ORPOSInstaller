import bcrypt from 'bcryptjs'
import { getPrisma } from '@orpos/db'
import { DEFAULT_REGISTER_GROUP_RULES, DEFAULT_SETTINGS } from '@orpos/shared'

/** Create default admin user / rules if the DB is empty (common local-setup miss). */
export async function ensureSeed() {
  const prisma = getPrisma()
  const userCount = await prisma.user.count()
  if (userCount > 0) return { seeded: false, users: userCount }

  const passwordHash = await bcrypt.hash('admin123', 10)
  await prisma.user.create({
    data: {
      username: 'admin',
      displayName: 'IT Admin',
      passwordHash,
      role: 'ADMIN',
    },
  })
  await prisma.user.create({
    data: {
      username: 'operator',
      displayName: 'Deploy Operator',
      passwordHash: await bcrypt.hash('operator123', 10),
      role: 'OPERATOR',
    },
  })

  if ((await prisma.registerGroupRule.count()) === 0) {
    for (const rule of DEFAULT_REGISTER_GROUP_RULES) {
      await prisma.registerGroupRule.create({ data: { ...rule } })
    }
  }

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await prisma.systemSetting.upsert({
      where: { key },
      update: {},
      create: { key, valueJson: value },
    })
  }

  return { seeded: true, users: 2 }
}
