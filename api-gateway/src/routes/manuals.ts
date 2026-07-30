import { FastifyInstance } from 'fastify';
import { db } from '../lib/db';
import { manuals, manualChunks } from '../lib/schema';
import { verifyAuth, optionalAuth } from '../lib/auth';
import { hybridSearch } from '../lib/vector';
import { eq, desc, and } from 'drizzle-orm';
import { dispatchToAgent } from '../lib/agentClient';
import { firestore } from '../lib/firebase';
import { randomUUID } from 'crypto';
import { publishToTopic } from '../lib/pubsub';

export default async function (fastify: FastifyInstance) {
  /**
   * GET /public (or /api/public/manuals)
   * Public endpoint to fetch published/completed manuals for landing page & guest users.
   */
  fastify.get('/public', async (request, reply) => {
    try {
      const publicManualsList = await db
        .select()
        .from(manuals)
        .where(eq(manuals.status, 'completed'))
        .orderBy(desc(manuals.createdAt));

      return reply.send(publicManualsList);
    } catch (error) {
      request.log.error({ err: error }, 'Failed to fetch public manuals');
      return reply.status(500).send({ error: 'Failed to fetch public manuals' });
    }
  });

  /**
   * GET /
   * User-scoped manuals fetch (or all manuals if admin).
   */
  fastify.get('/', { preHandler: [verifyAuth] }, async (request, reply) => {
    const user = request.user!;

    try {
      // Admins can view all manuals, other roles view their own manuals
      const query = user.role === 'admin' 
        ? db.select().from(manuals).orderBy(desc(manuals.createdAt))
        : db.select().from(manuals).where(eq(manuals.userId, user.uid)).orderBy(desc(manuals.createdAt));

      const result = await query;
      return reply.send(result);
    } catch (error) {
      request.log.error({ err: error }, 'Failed to fetch manuals');
      return reply.status(500).send({ error: 'Failed to fetch manuals' });
    }
  });

  /**
   * POST /
   * Create a new manual and optionally trigger AI PDF parser
   */
  fastify.post('/', { preHandler: [verifyAuth] }, async (request, reply) => {
    const user = request.user!;
    const body = request.body as any;
    const manualId = randomUUID();

    try {
      // 1. Save to PostgreSQL
      await db.insert(manuals).values({
        id: manualId,
        userId: user.uid,
        title: body.productName || 'Untitled Manual',
        storageUrl: body.originalFileUrl || '',
        status: body.status === 'published' ? 'published' : 'pending',
        createdAt: new Date(),
      });

      // 2. Save metadata to Firestore
      await firestore.collection('manuals').doc(manualId).set({
        ...body,
        userId: user.uid,
        createdAt: new Date(),
      });

      // 3. Trigger AI PDF Parser if a file was uploaded
      if (body.originalFileUrl && body.uploadMethod === 'upload') {
        publishToTopic('clearguide-events', {
          type: 'ManualUploadEvent',
          manualId,
          storageUrl: body.originalFileUrl
        }).catch((err) => request.log.error({ err }, 'Failed to dispatch AI PDF Parser to Pub/Sub'));
      }

      return reply.send({ success: true, id: manualId });
    } catch (error) {
      request.log.error({ err: error }, 'Failed to create manual');
      return reply.status(500).send({ error: 'Failed to create manual' });
    }
  });

  /**
   * PUT /:id
   * Update an existing manual
   */
  fastify.put('/:id', { preHandler: [verifyAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;
    const body = request.body as any;

    try {
      // Verify ownership
      const [existing] = await db.select().from(manuals).where(eq(manuals.id, id));
      if (!existing || existing.userId !== user.uid) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      await db.update(manuals).set({
        title: body.productName || existing.title,
        storageUrl: body.originalFileUrl || existing.storageUrl,
        status: body.status === 'published' ? 'published' : existing.status,
      }).where(eq(manuals.id, id));

      await firestore.collection('manuals').doc(id).update({
        ...body,
        updatedAt: new Date(),
      });

      // Re-trigger AI if a new file was uploaded
      if (body.originalFileUrl && body.originalFileUrl !== existing.storageUrl && body.uploadMethod === 'upload') {
        publishToTopic('clearguide-events', {
          type: 'ManualUploadEvent',
          manualId: id,
          storageUrl: body.originalFileUrl
        }).catch((err) => request.log.error({ err }, 'Failed to dispatch AI PDF Parser to Pub/Sub'));
      }

      return reply.send({ success: true, id });
    } catch (error) {
      request.log.error({ err: error }, 'Failed to update manual');
      return reply.status(500).send({ error: 'Failed to update manual' });
    }
  });

  /**
   * POST /search
   * Semantic vector and text search over manual chunks.
   */
  fastify.post('/search', { preHandler: [optionalAuth] }, async (request, reply) => {
    const { query, embedding, manualId, limit = 5 } = request.body as {
      query: string;
      embedding?: number[];
      manualId?: string;
      limit?: number;
    };

    if (!query && (!embedding || embedding.length !== 768)) {
      return reply.status(400).send({ error: 'Either query text or a 768-dim vector embedding is required' });
    }

    try {
      const results = await hybridSearch({
        queryText: query || '',
        embedding,
        manualId,
        limit,
      });

      return reply.send({
        query: query || null,
        count: results.length,
        results,
      });
    } catch (error) {
      request.log.error({ err: error }, 'Failed to execute manual search');
      return reply.status(500).send({ error: 'Failed to execute manual search' });
    }
  });

  /**
   * POST /visual-search
   * Forwards base64 camera images to Visual-Search-Agent in ai-agent-mesh.
   */
  fastify.post('/visual-search', { preHandler: [optionalAuth] }, async (request, reply) => {
    const { image, category } = request.body as { image: string; category?: string };

    if (!image) {
      return reply.status(400).send({ error: 'Missing camera image payload' });
    }

    try {
      const aiWorkerUrl = process.env.AGENT_VISUAL_SEARCH_URL || (process.env.AI_AGENT_URL 
        ? process.env.AI_AGENT_URL.replace('/process-manual', '/visual-search')
        : 'http://localhost:8000/visual-search');

      const result = await dispatchToAgent(aiWorkerUrl, { image, category });
      return reply.send(result);
    } catch (error) {
      request.log.error({ err: error }, 'Failed to execute visual search');
      return reply.status(500).send({ error: 'Failed to execute visual search' });
    }
  });

  /**
   * POST /generate-video
   * Triggers Dynamic-Video-Generator AI Agent via Pub/Sub.
   */
  fastify.post('/generate-video', { preHandler: [optionalAuth] }, async (request, reply) => {
    const { manualId, procedureTitle, repairSteps } = request.body as {
      manualId?: string;
      procedureTitle?: string;
      repairSteps?: string[];
    };

    if (!manualId) {
      return reply.status(400).send({ error: 'manualId is required' });
    }

    try {
      // Mark as pending in Firestore
      await firestore.collection('manuals').doc(manualId).set({
        videoGenerationStatus: 'pending'
      }, { merge: true });

      // Publish event
      await publishToTopic('clearguide-events', {
        type: 'VideoGenerationRequestedEvent',
        manualId,
        title: procedureTitle,
        steps: repairSteps
      });
      
      return reply.send({ success: true, status: 'pending' });
    } catch (error) {
      request.log.error({ err: error }, 'Failed to generate step-by-step video');
      return reply.status(500).send({ error: 'Failed to generate step-by-step video' });
    }
  });

  /**
   * POST /translate
   * Triggers Accessibility & Translation Agent.
   */
  fastify.post('/translate', { preHandler: [optionalAuth] }, async (request, reply) => {
    const { text, targetLanguage, readingLevel } = request.body as {
      text: string;
      targetLanguage?: string;
      readingLevel?: string;
    };

    if (!text) {
      return reply.status(400).send({ error: 'Missing text payload for translation' });
    }

    try {
      const aiWorkerUrl = process.env.AGENT_ACCESSIBILITY_URL || (process.env.AI_AGENT_URL 
        ? process.env.AI_AGENT_URL.replace('/process-manual', '/translate')
        : 'http://localhost:8000/translate');

      const result = await dispatchToAgent(aiWorkerUrl, { text, targetLanguage, readingLevel });
      return reply.send(result);
    } catch (error) {
      request.log.error({ err: error }, 'Failed to simplify and translate text');
      return reply.status(500).send({ error: 'Failed to simplify and translate text' });
    }
  });

  /**
   * POST /language/translate
   * Triggers Language-Translation-Agent.
   */
  fastify.post('/language/translate', { preHandler: [optionalAuth] }, async (request, reply) => {
    const { text, targetLanguage, sourceLanguage } = request.body as {
      text: string;
      targetLanguage?: string;
      sourceLanguage?: string;
    };

    if (!text) {
      return reply.status(400).send({ error: 'Missing text payload' });
    }

    try {
      const aiWorkerUrl = process.env.AGENT_TRANSLATOR_URL || (process.env.AI_AGENT_URL 
        ? process.env.AI_AGENT_URL.replace('/process-manual', '/language-translate')
        : 'http://localhost:8000/language-translate');

      const result = await dispatchToAgent(aiWorkerUrl, { text, targetLanguage, sourceLanguage });
      return reply.send(result);
    } catch (error) {
      request.log.error({ err: error }, 'Failed to translate content');
      return reply.status(500).send({ error: 'Failed to translate content' });
    }
  });





  /**
   * GET /:id
   * Detail view returning manual record + associated parsed chunks.
   */
  fastify.get('/:id', { preHandler: [optionalAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const [manual] = await db.select().from(manuals).where(eq(manuals.id, id));
      if (!manual) {
        return reply.status(404).send({ error: 'Manual not found' });
      }

      const chunks = await db
        .select({
          id: manualChunks.id,
          content: manualChunks.content,
        })
        .from(manualChunks)
        .where(eq(manualChunks.manualId, id));

      const firestoreDoc = await firestore.collection('manuals').doc(id).get();
      const fsData = firestoreDoc.exists ? firestoreDoc.data() : {};

      return reply.send({
        ...manual,
        ...fsData, // includes videoData if available
        chunks,
      });
    } catch (error) {
      request.log.error({ err: error }, 'Failed to fetch manual detail');
      return reply.status(500).send({ error: 'Failed to fetch manual detail' });
    }
  });

  fastify.get('/:id/status', { preHandler: [optionalAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    try {
      const [manual] = await db.select().from(manuals).where(eq(manuals.id, id));
      if (!manual) {
        return reply.status(404).send({ error: 'Manual not found' });
      }
      // Also fetch from Firestore for async statuses like videoGenerationStatus
      const firestoreDoc = await firestore.collection('manuals').doc(id).get();
      const fsData = firestoreDoc.exists ? firestoreDoc.data() : {};

      return reply.send({
        id: manual.id,
        status: manual.status,
        videoGenerationStatus: fsData?.videoGenerationStatus || 'none',
        updatedAt: manual.createdAt,
      });
    } catch (error) {
      request.log.error({ err: error }, 'Failed to fetch manual status');
      return reply.status(500).send({ error: 'Failed to fetch manual status' });
    }
  });

  fastify.delete('/:id', { preHandler: [verifyAuth] }, async (request, reply) => {
    const user = request.user!;
    const { id } = request.params as { id: string };

    try {
      // Admins can delete any manual; others can only delete their own
      const whereCondition = user.role === 'admin'
        ? eq(manuals.id, id)
        : and(eq(manuals.id, id), eq(manuals.userId, user.uid));

      const deleted = await db.delete(manuals).where(whereCondition).returning();
      if (!deleted || deleted.length === 0) {
        return reply.status(404).send({ error: 'Manual not found or unauthorized' });
      }

      return reply.send({ success: true, id });
    } catch (error) {
      request.log.error({ err: error }, 'Failed to delete manual');
      return reply.status(500).send({ error: 'Failed to delete manual' });
    }
  });

  /**
   * POST /:id/analytics/events
   * Track a view/interaction event for a manual
   */
  fastify.post('/:id/analytics/events', async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as any;

    try {
      const newEventRef = firestore.collection('manual_analytics_events').doc();
      const now = new Date().toISOString();
      await newEventRef.set({
        id: newEventRef.id,
        manualId: id,
        userSessionId: body.userSessionId || 'unknown',
        mode: body.mode || 'web',
        timeSpentSeconds: body.timeSpentSeconds || 0,
        country: body.country || 'Unknown',
        device: body.device || 'desktop',
        language: body.language || 'English',
        viewedAt: now,
        createdAt: now,
      });

      return reply.send({ success: true });
    } catch (error) {
      request.log.error({ err: error }, 'Failed to track analytics event');
      return reply.status(500).send({ error: 'Failed to track analytics event' });
    }
  });

  /**
   * GET /:id/analytics
   * Retrieve aggregated analytics for a manual
   */
  fastify.get('/:id/analytics', { preHandler: [verifyAuth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = request.user!;

    try {
      // 1. Verify ownership
      const [manual] = await db.select().from(manuals).where(eq(manuals.id, id));
      if (!manual || (manual.userId !== user.uid && user.role !== 'admin')) {
        return reply.status(403).send({ error: 'Forbidden' });
      }

      // 2. Fetch events
      const snapshot = await firestore.collection('manual_analytics_events')
        .where('manualId', '==', id)
        .get();

      const events = snapshot.docs.map(doc => doc.data());

      // 3. Aggregate
      const totalViews = events.length;
      const uniqueSessions = new Set(events.map(e => e.userSessionId));
      const activeUsers = uniqueSessions.size;

      let totalTime = 0;
      const deviceMap = new Map<string, number>();
      const countryMap = new Map<string, number>();
      const langMap = new Map<string, number>();
      const datesMap = new Map<string, number>();

      events.forEach(e => {
        totalTime += (e.timeSpentSeconds || 0);

        const d = (e.device || 'desktop').toLowerCase();
        deviceMap.set(d, (deviceMap.get(d) || 0) + 1);

        const c = e.country || 'Unknown';
        countryMap.set(c, (countryMap.get(c) || 0) + 1);

        const l = e.language || 'English';
        langMap.set(l, (langMap.get(l) || 0) + 1);

        const dateStr = (e.createdAt || new Date().toISOString()).split('T')[0];
        datesMap.set(dateStr, (datesMap.get(dateStr) || 0) + 1);
      });

      const avgTimeSpentRaw = totalViews > 0 ? Math.floor(totalTime / totalViews) : 0;
      const mins = Math.floor(avgTimeSpentRaw / 60);
      const secs = avgTimeSpentRaw % 60;
      const avgTimeSpent = avgTimeSpentRaw > 0 ? `${mins}m ${secs}s` : '0s';

      const viewsOverTime = Array.from(datesMap.entries())
        .map(([date, views]) => ({ date, views }))
        .sort((a, b) => a.date.localeCompare(b.date));

      const deviceBreakdown = Array.from(deviceMap.entries()).map(([device, count]) => ({ device, count }));
      const countryBreakdown = Array.from(countryMap.entries()).map(([country, views]) => ({ country, views }));
      const topLanguages = Array.from(langMap.entries()).map(([language, views]) => ({ language, views }));

      // Calculate percentages for deviceStats
      const mobileCount = deviceMap.get('mobile') || 0;
      const desktopCount = deviceMap.get('desktop') || 0;
      const tabletCount = deviceMap.get('tablet') || 0;
      const totalDevices = (mobileCount + desktopCount + tabletCount) || 1; // avoid / 0
      
      const deviceStats = {
        mobile: Math.round((mobileCount / totalDevices) * 100),
        desktop: Math.round((desktopCount / totalDevices) * 100),
        tablet: Math.round((tabletCount / totalDevices) * 100)
      };

      // Calculate language percentages
      const languageTotal = topLanguages.reduce((sum, item) => sum + item.views, 0) || 1;
      const formattedTopLanguages = topLanguages.map(l => ({
        language: l.language,
        views: l.views,
        percentage: Math.round((l.views / languageTotal) * 100)
      })).sort((a, b) => b.views - a.views);

      // Some static/empty lists for now for unsupported metrics without full pipeline
      const topAIQueries: { query: string; count: number }[] = [];
      const ageGroupBreakdown: { group: string; count: number }[] = [];
      const eventBreakdown: { type: string; count: number }[] = [
        { type: 'view', count: totalViews }
      ];
      const topSections: { title: string; views: number; avgScrollDepth: number }[] = [];
      
      // Calculate returning vs new based on frequency of session IDs
      const sessionCounts = new Map<string, number>();
      events.forEach(e => {
        const sid = e.userSessionId;
        sessionCounts.set(sid, (sessionCounts.get(sid) || 0) + 1);
      });
      let returning = 0;
      let newUsers = 0;
      sessionCounts.forEach(count => {
        if (count > 1) returning++;
        else newUsers++;
      });

      const responseData = {
        manualName: manual.title,
        totalViews,
        activeUsers,
        avgTimeSpent,
        trendViews: 0,
        trendUsers: 0,
        viewsOverTime,
        topAIQueries,
        deviceBreakdown,
        countryBreakdown,
        ageGroupBreakdown,
        eventBreakdown,
        topSections,
        returningVsNew: { returning, new: newUsers },
        deviceStats,
        topLanguages: formattedTopLanguages
      };

      return reply.send(responseData);
    } catch (error) {
      request.log.error({ err: error }, 'Failed to fetch analytics');
      return reply.status(500).send({ error: 'Failed to fetch analytics' });
    }
  });
}
