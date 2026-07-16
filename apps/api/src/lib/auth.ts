import type { FastifyReply, FastifyRequest } from 'fastify'
import type { UserRole } from '@orpos/db'

export type AuthUser = {
  id: string
  username: string
  role: UserRole
  displayName?: string | null
}

declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { sub: string; username: string; role: UserRole }
    user: AuthUser
  }
}

export async function authenticate(request: FastifyRequest, reply: FastifyReply) {
  try {
    const payload = await request.jwtVerify<{ sub: string; username: string; role: UserRole }>()
    request.user = {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
    }
  } catch {
    return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } })
  }
}

export function requireRoles(...roles: UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await authenticate(request, reply)
    if (reply.sent) return
    if (!roles.includes(request.user.role)) {
      return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Insufficient role' } })
    }
  }
}

export const requireAuth = authenticate
export const requireOperator = requireRoles('ADMIN', 'OPERATOR')
export const requireAdmin = requireRoles('ADMIN')
