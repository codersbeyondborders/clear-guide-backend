import { FastifyInstance } from 'fastify';
import { firestore } from '../lib/firebase';
import { verifyAuth, optionalAuth } from '../lib/auth';
import { FieldValue } from 'firebase-admin/firestore';

export default async function communityRoutes(fastify: FastifyInstance) {

  // GET /threads (by manualId)
  fastify.get('/threads', { preHandler: optionalAuth }, async (request, reply) => {
    try {
      const query = request.query as { manualId?: string };
      if (!query.manualId) {
        return reply.status(400).send({ error: 'manualId is required' });
      }

      const snapshot = await firestore.collection('forum_threads')
        .where('manualId', '==', query.manualId)
        .orderBy('createdAt', 'desc')
        .get();

      const threads = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
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

      const newThreadRef = firestore.collection('forum_threads').doc();
      const now = new Date().toISOString();
      const threadData = {
        manualId: body.manualId,
        userId: user.uid,
        title: body.title,
        body: body.body,
        isPinned: false,
        isSolved: false,
        replyCount: 0,
        createdAt: now,
        updatedAt: now,
        author: {
          name: user.name || user.email || 'Anonymous',
          image: user.picture || null
        }
      };

      const statsRef = firestore.collection('product_stats').doc(body.manualId);
      const batch = firestore.batch();
      batch.set(newThreadRef, threadData);
      batch.set(statsRef, {
        manualId: body.manualId,
        threadCount: FieldValue.increment(1),
        updatedAt: now
      }, { merge: true });
      await batch.commit();

      return reply.send({ data: { id: newThreadRef.id, ...threadData } });
    } catch (error) {
      request.log.error({ error }, 'Failed to create thread');
      return reply.status(500).send({ error: 'Failed to create thread' });
    }
  });

  // GET /threads/:threadId (and replies)
  fastify.get('/threads/:threadId', { preHandler: optionalAuth }, async (request, reply) => {
    try {
      const { threadId } = request.params as { threadId: string };
      
      const threadDoc = await firestore.collection('forum_threads').doc(threadId).get();
      if (!threadDoc.exists) {
        return reply.status(404).send({ error: 'Thread not found' });
      }

      const repliesSnapshot = await firestore.collection('forum_threads').doc(threadId).collection('replies').orderBy('createdAt', 'asc').get();
      const replies = repliesSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      return reply.send({
        data: {
          thread: { id: threadDoc.id, ...threadDoc.data() },
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

      const threadRef = firestore.collection('forum_threads').doc(threadId);
      const newReplyRef = threadRef.collection('replies').doc();
      const now = new Date().toISOString();

      const replyData = {
        threadId,
        userId: user.uid,
        body: body.body,
        isSolution: false,
        createdAt: now,
        updatedAt: now,
        author: {
          name: user.name || user.email || 'Anonymous',
          image: user.picture || null
        }
      };

      // Batch write to update thread replyCount and add reply
      const batch = firestore.batch();
      batch.set(newReplyRef, replyData);
      batch.update(threadRef, {
        replyCount: FieldValue.increment(1),
        updatedAt: now
      });

      await batch.commit();

      return reply.send({ data: { id: newReplyRef.id, ...replyData } });
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

      const threadRef = firestore.collection('forum_threads').doc(threadId);
      const threadDoc = await threadRef.get();

      if (!threadDoc.exists) {
        return reply.status(404).send({ error: 'Thread not found' });
      }

      // Check ownership
      if (threadDoc.data()?.userId !== user.uid) {
        return reply.status(403).send({ error: 'Only the thread owner can mark a solution' });
      }

      const replyRef = threadRef.collection('replies').doc(replyId);
      const replyDoc = await replyRef.get();

      if (!replyDoc.exists) {
        return reply.status(404).send({ error: 'Reply not found' });
      }

      const now = new Date().toISOString();
      const batch = firestore.batch();
      batch.update(replyRef, { isSolution: true, updatedAt: now });
      batch.update(threadRef, { isSolved: true, updatedAt: now });

      await batch.commit();

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
      const body = request.body as { manualId: string; title?: string | null; body: string; rating: number };

      if (!body.manualId || !body.body || !body.rating) {
        return reply.status(400).send({ error: 'Missing required fields' });
      }

      const newReviewRef = firestore.collection('product_reviews').doc();
      const now = new Date().toISOString();
      const reviewData = {
        manualId: body.manualId,
        userId: user.uid,
        title: body.title || null,
        body: body.body,
        rating: body.rating,
        helpfulCount: 0,
        createdAt: now,
        updatedAt: now,
        author: {
          name: user.name || user.email || 'Anonymous',
          image: user.picture || null
        }
      };

      const statsRef = firestore.collection('product_stats').doc(body.manualId);

      await firestore.runTransaction(async (transaction) => {
        const statsDoc = await transaction.get(statsRef);
        let newReviewCount = 1;
        let newTotalRating = body.rating;
        let newThreadCount = 0;

        if (statsDoc.exists) {
          const data = statsDoc.data()!;
          newReviewCount = (data.reviewCount || 0) + 1;
          newTotalRating = (data.totalRating || 0) + body.rating;
          newThreadCount = data.threadCount || 0;
        }

        const newAvgRating = newTotalRating / newReviewCount;

        transaction.set(statsRef, {
          manualId: body.manualId,
          reviewCount: newReviewCount,
          totalRating: newTotalRating,
          avgRating: newAvgRating,
          threadCount: newThreadCount,
          updatedAt: now
        }, { merge: true });

        transaction.set(newReviewRef, reviewData);
      });

      return reply.send({ data: { id: newReviewRef.id, ...reviewData } });
    } catch (error) {
      request.log.error({ error }, 'Failed to create review');
      return reply.status(500).send({ error: 'Failed to create review' });
    }
  });

  // POST /reviews/:reviewId/helpful
  fastify.post('/reviews/:reviewId/helpful', { preHandler: verifyAuth }, async (request, reply) => {
    try {
      const { reviewId } = request.params as { reviewId: string };
      const reviewRef = firestore.collection('product_reviews').doc(reviewId);
      
      await reviewRef.update({
        helpfulCount: FieldValue.increment(1)
      });

      return reply.send({ data: { success: true } });
    } catch (error) {
      request.log.error({ error }, 'Failed to mark review as helpful');
      return reply.status(500).send({ error: 'Failed to mark review as helpful' });
    }
  });
}
