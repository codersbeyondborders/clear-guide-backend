import { FastifyInstance } from 'fastify';
import { auth } from '../lib/firebase';
import { verifyAuth, requireRole, UserRole } from '../lib/auth';

const VALID_ROLES: UserRole[] = ['admin', 'enterprise_author', 'technician', 'end_user'];

export default async function (fastify: FastifyInstance) {
  /**
   * GET /me
   * Fetches the profile and role of the currently authenticated user.
   */
  fastify.get('/me', { preHandler: [verifyAuth] }, async (request, reply) => {
    if (!request.user) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    try {
      const userRecord = await auth.getUser(request.user.uid);
      const customClaims = userRecord.customClaims || {};
      const role: UserRole = (customClaims.role as UserRole) || request.user.role || 'end_user';

      return reply.send({
        uid: userRecord.uid,
        email: userRecord.email,
        displayName: userRecord.displayName,
        photoURL: userRecord.photoURL,
        role,
        customClaims,
      });
    } catch (error) {
      request.log.error({ err: error }, 'Failed to fetch user profile');
      return reply.status(500).send({ error: 'Failed to fetch user profile' });
    }
  });

  /**
   * POST /set-role
   * Allows Admin users to assign roles to users.
   * Body: { targetUid: string, role: UserRole }
   */
  fastify.post(
    '/set-role',
    { preHandler: [verifyAuth, requireRole(['admin'])] },
    async (request, reply) => {
      const { targetUid, role } = request.body as { targetUid: string; role: UserRole };

      if (!targetUid || typeof targetUid !== 'string') {
        return reply.status(400).send({ error: 'Missing or invalid targetUid' });
      }

      if (!role || !VALID_ROLES.includes(role)) {
        return reply.status(400).send({
          error: `Invalid role. Allowed roles: [${VALID_ROLES.join(', ')}]`,
        });
      }

      try {
        // Fetch existing custom claims to preserve other claims
        const userRecord = await auth.getUser(targetUid);
        const currentClaims = userRecord.customClaims || {};

        await auth.setCustomUserClaims(targetUid, {
          ...currentClaims,
          role,
        });

        request.log.info(
          { adminUid: request.user?.uid, targetUid, newRole: role },
          'User role updated successfully'
        );

        return reply.send({
          success: true,
          targetUid,
          role,
          message: `Role successfully updated to '${role}'.`,
        });
      } catch (error) {
        request.log.error({ err: error, targetUid }, 'Failed to set custom user claims');
        return reply.status(500).send({ error: 'Failed to set user role' });
      }
    }
  );
}
