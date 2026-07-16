import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../../generated/prisma/client'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function resolveDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL ?? 'file:./dev.db'
  if (!raw.startsWith('file:')) return raw
  const filePath = raw.slice('file:'.length)
  if (path.isAbsolute(filePath)) return raw
  // Prisma CLI resolves file:./ relative to repo root (prisma.config.ts cwd)
  const repoRoot = path.resolve(__dirname, '../../..')
  const abs = path.resolve(repoRoot, filePath)
  return `file:${abs}`
}

export type { PrismaClient }
export * from '../../../generated/prisma/client'

let prisma: PrismaClient | undefined

export function createPrismaClient(): PrismaClient {
  const url = resolveDatabaseUrl()
  let adapter: unknown

  if (url.startsWith('file:')) {
    adapter = new PrismaBetterSqlite3({ url })
  } else if (url.startsWith('postgresql:') || url.startsWith('postgres://')) {
    // PrismaPg accepts a connection string directly.
    adapter = new PrismaPg(url)
  } else {
    throw new Error(`Unsupported DATABASE_URL scheme for driver adapter: ${url}`)
  }

  return new PrismaClient({ adapter: adapter as never })
}

export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = createPrismaClient()
  }
  return prisma
}
