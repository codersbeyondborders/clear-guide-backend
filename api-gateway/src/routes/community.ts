import { FastifyInstance } from 'fastify';
import { db } from '../lib/db';
import { forumThreads, forumPosts } from '../lib/schema';
import { verifyAuth, optionalAuth } from '../lib/auth';
import { eq, desc, asc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { firestore } from '../lib/firebase';

export default async function communityRoutes(fastify: FastifyInstance) {

  // GET /threads (by manualId)
  fastify.get('/threads', { preHandler: optionalAuth }, async (request, reply) => {
    try {
      const query = request.query as { manualId?: string };
      if (!query.manualId) {
        return reply.status(400).send({ error: 'manualId is required' });
      }

      // We use manualId to search via the linked product, but for simplicity assuming productId is manualId or similar in the query context for this MVP route
      const threads = await db.select().from(forumThreads)
        .where(eq(forumThreads.productId, query.manualId))
        .orderBy(desc(forumThreads.createdAt));

      return reply.send({ data: threads });
    } catch (error) {
      request.log.error({ error }, 'Failed to fetch threads');
      return reply.status(500).send({ error: 'Failed to fetch threads' });
    }
  });

  // POST /threads
  fastify.post('/threads', { preHandler: verifyAuth }, async (request, reply) => {
    try {
      const user = request.user!;
      const body = request.body as { manualId: string; title: string; body: string };

      if (!body.manualId || !body.title || !body.body) {
        return reply.status(400).send({ error: 'Missing required fields' });
      }

      const threadId = randomUUID();
      await db.insert(forumThreads).values({
        id: threadId,
        productId: body.manualId, // Mapping manualId directly for now
        authorId: user.uid,
        title: body.title,
        isSolved: false,
      });

      // Insert initial post
      const postId = randomUUID();
      await db.insert(forumPosts).values({
        id: postId,
        threadId: threadId,
        authorId: user.uid,
        content: body.body,
        upvotes: 0,
        isSolution: false,
      });

      return reply.send({ data: { id: threadId, title: body.title } });
    } catch (error) {
      request.log.error({ error }, 'Failed to create thread');
      return reply.status(500).send({ error: 'Failed to create thread' });
    }
  });

  // GET /threads/:threadId (and replies)
  fastify.get('/threads/:threadId', { preHandler: optionalAuth }, async (request, reply) => {
    try {
      const { threadId } = request.params as { threadId: string };
      
      const thread = await db.query.forumThreads.findFirst({
        where: eq(forumThreads.id, threadId)
      });

      if (!thread) {
        return reply.status(404).send({ error: 'Thread not found' });
      }

      const replies = await db.select().from(forumPosts)
        .where(eq(forumPosts.threadId, threadId))
        .orderBy(asc(forumPosts.createdAt));

      return reply.send({
        data: {
          thread,
          replies
        }
      });
    } catch (error) {
      request.log.error({ error }, 'Failed to fetch thread details');
      return reply.status(500).send({ error: 'Failed to fetch thread details' });
    }
  });

  // POST /threads/:threadId/replies
  fastify.post('/threads/:threadId/replies', { preHandler: verifyAuth }, async (request, reply) => {
    try {
      const user = request.user!;
      const { threadId } = request.params as { threadId: string };
      const body = request.body as { body: string };

      if (!body.body) {
        return reply.status(400).send({ error: 'Missing reply body' });
      }

      const newReplyId = randomUUID();
      const replyData = {
        id: newReplyId,
        threadId,
        authorId: user.uid,
        content: body.body,
        upvotes: 0,
        isSolution: false,
      };

      await db.insert(forumPosts).values(replyData);

      return reply.send({ data: replyData });
    } catch (error) {
      request.log.error({ error }, 'Failed to post reply');
      return reply.status(500).send({ error: 'Failed to post reply' });
    }
  });

  // PATCH /threads/:threadId/replies/:replyId/solution
  fastify.patch('/threads/:threadId/replies/:replyId/solution', { preHandler: verifyAuth }, async (request, reply) => {
    try {
      const user = request.user!;
      const { threadId, replyId } = request.params as { threadId: string; replyId: string };

      const thread = await db.query.forumThreads.findFirst({
        where: eq(forumThreads.id, threadId)
      });

      if (!thread) {
        return reply.status(404).send({ error: 'Thread not found' });
      }

      // Check ownership (Assuming the OP marks the solution)
      if (thread.authorId !== user.uid && user.role !== 'admin') {
        return reply.status(403).send({ error: 'Only the thread owner or admin can mark a solution' });
      }

      await db.update(forumPosts)
        .set({ isSolution: true })
        .where(eq(forumPosts.id, replyId));
        
      await db.update(forumThreads)
        .set({ isSolved: true })
        .where(eq(forumThreads.id, threadId));

      return reply.send({ data: { success: true } });
    } catch (error) {
      request.log.error({ error }, 'Failed to mark solution');
      return reply.status(500).send({ error: 'Failed to mark solution' });
    }
  });

  // GET /reviews
  fastify.get('/reviews', { preHandler: optionalAuth }, async (request, reply) => {
    try {
      const query = request.query as { manualId?: string };
      if (!query.manualId) {
        return reply.status(400).send({ error: 'manualId is required' });
      }

      const snapshot = await firestore.collection('product_reviews')
        .where('manualId', '==', query.manualId)
        .orderBy('createdAt', 'desc')
        .get();

      const reviews = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      return reply.send({ data: reviews });
    } catch (error) {
      request.log.error({ error }, 'Failed to fetch reviews');
      return reply.status(500).send({ error: 'Failed to fetch reviews' });
    }
  });

  // POST /reviews
  fastify.post('/reviews', { preHandler: verifyAuth }, async (request, reply) => {
    try {
      const user = request.user!;
      const body = request.body as { manualId: string; rating: number; title: string | null; body: string };

      if (!body.manualId || !body.rating || !body.body) {
        return reply.status(400).send({ error: 'Missing required fields' });
      }

      const reviewId = randomUUID();
      const userDoc = await firestore.collection('users').doc(user.uid).get();
      const userData = userDoc.data() || {};
      
      const reviewData = {
        id: reviewId,
        manualId: body.manualId,
        userId: user.uid,
        rating: body.rating,
        title: body.title,
        body: body.body,
        helpfulCount: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        author: {
          name: userData.displayName || user.name || 'Anonymous',
          image: userData.avatarUrl || user.picture || null,
        }
      };

      await firestore.collection('product_reviews').doc(reviewId).set(reviewData);

      // Update product_stats
      const statsRef = firestore.collection('product_stats').doc(body.manualId);
      await firestore.runTransaction(async (t) => {
        const statsDoc = await t.get(statsRef);
        const stats = statsDoc.exists ? statsDoc.data()! : { avgRating: 0, reviewCount: 0, threadCount: 0 };
        
        const newCount = stats.reviewCount + 1;
        const newTotal = (stats.avgRating * stats.reviewCount) + body.rating;
        const newAvg = newTotal / newCount;

        t.set(statsRef, { ...stats, avgRating: newAvg, reviewCount: newCount }, { merge: true });
      });

      return reply.send({ data: reviewData });
    } catch (error) {
      request.log.error({ error }, 'Failed to submit review');
      return reply.status(500).send({ error: 'Failed to submit review' });
    }
  });

  // POST /reviews/:id/helpful
  fastify.post('/reviews/:id/helpful', { preHandler: verifyAuth }, async (request, reply) => {
    try {
      const { id } = request.params as { id: string };
      const user = request.user!;
      const helpfulRef = firestore.collection('product_reviews').doc(id).collection('helpful').doc(user.uid);
      const reviewRef = firestore.collection('product_reviews').doc(id);

      await firestore.runTransaction(async (t) => {
        const helpfulDoc = await t.get(helpfulRef);
        if (!helpfulDoc.exists) {
          t.set(helpfulRef, { createdAt: new Date().toISOString() });
          const reviewDoc = await t.get(reviewRef);
          if (reviewDoc.exists) {
            t.update(reviewRef, { helpfulCount: (reviewDoc.data()?.helpfulCount || 0) + 1 });
          }
        }
      });

      return reply.send({ success: true });
    } catch (error) {
      request.log.error({ error }, 'Failed to mark review helpful');
      return reply.status(500).send({ error: 'Failed to mark review helpful' });
    }
  });
}
