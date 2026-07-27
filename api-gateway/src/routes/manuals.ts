import { FastifyInstance } from 'fastify';
import { db } from '../lib/db';
import { manuals } from '../lib/schema';
import { auth } from '../lib/firebase';
import { eq, desc, and } from 'drizzle-orm';

export default async function (fastify: FastifyInstance) {
  fastify.get('/', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const token = authHeader.split('Bearer ')[1];
    let decodedToken;
    try {
      decodedToken = await auth.verifyIdToken(token);
    } catch (e) {
      return reply.status(401).send({ error: 'Invalid token' });
    }

    try {
      const userManuals = await db.select().from(manuals)
        .where(eq(manuals.userId, decodedToken.uid))
        .orderBy(desc(manuals.createdAt));
      
      return reply.send(userManuals);
    } catch (error) {
      request.log.error({ err: error }, 'Failed to fetch manuals');
      return reply.status(500).send({ error: 'Failed to fetch manuals' });
    }
  });

  fastify.delete('/:id', async (request, reply) => {
    const authHeader = request.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }
    const token = authHeader.split('Bearer ')[1];
    let decodedToken;
    try {
      decodedToken = await auth.verifyIdToken(token);
    } catch (e) {
      return reply.status(401).send({ error: 'Invalid token' });
    }

    const { id } = request.params as { id: string };

    try {
      await db.delete(manuals).where(
        and(
          eq(manuals.id, id),
          eq(manuals.userId, decodedToken.uid)
        )
      );
      return reply.send({ success: true });
    } catch (error) {
      request.log.error({ err: error }, 'Failed to delete manual');
      return reply.status(500).send({ error: 'Failed to delete manual' });
    }
  });
}
