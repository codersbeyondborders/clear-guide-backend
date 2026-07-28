import { FastifyRequest, FastifyReply } from 'fastify';
import { auth } from './firebase';

export type UserRole = 'admin' | 'enterprise_author' | 'technician' | 'end_user';

export interface AuthenticatedUser {
  uid: string;
  email?: string;
  name?: string;
  picture?: string;
  role: UserRole;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser | null;
  }
}

/**
 * Strict authentication middleware. Rejects request with 401 if valid token is not present.
 */
export async function verifyAuth(request: FastifyRequest, reply: FastifyReply) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Unauthorized: Missing or malformed token' });
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decoded = await auth.verifyIdToken(token);
    const role: UserRole = (decoded.role as UserRole) || 'end_user';

    request.user = {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name || decoded.displayName,
      picture: decoded.picture || decoded.photoURL,
      role,
    };
  } catch (error) {
    request.log.warn({ error }, 'Failed to verify Auth token');
    return reply.status(401).send({ error: 'Unauthorized: Invalid token' });
  }
}

/**
 * Role-Based Access Control (RBAC) middleware factory.
 * Rejects requests with 403 Forbidden if the authenticated user does not have one of the allowed roles.
 * 'admin' role automatically passes all permission checks.
 */
export function requireRole(allowedRoles: UserRole[]) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized: User not authenticated' });
    }

    const { role } = request.user;
    if (role === 'admin') {
      return; // Admin bypasses all role checks
    }

    if (!allowedRoles.includes(role)) {
      return reply.status(403).send({
        error: `Forbidden: Insufficient permissions. Required role: [${allowedRoles.join(', ')}]`,
        currentRole: role,
      });
    }
  };
}

/**
 * Optional authentication middleware. Populates request.user if token is valid, but allows unauthenticated access.
 */
export async function optionalAuth(request: FastifyRequest) {
  const authHeader = request.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    request.user = null;
    return;
  }

  const token = authHeader.split('Bearer ')[1];
  try {
    const decoded = await auth.verifyIdToken(token);
    const role: UserRole = (decoded.role as UserRole) || 'end_user';

    request.user = {
      uid: decoded.uid,
      email: decoded.email,
      name: decoded.name || decoded.displayName,
      picture: decoded.picture || decoded.photoURL,
      role,
    };
  } catch (error) {
    request.user = null;
  }
}

