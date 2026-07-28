import { FastifyInstance } from 'fastify';
import { db } from '../lib/db';
import { manuals, manualChunks } from '../lib/schema';
import { verifyAuth, optionalAuth } from '../lib/auth';
import { hybridSearch } from '../lib/vector';
import { eq, desc, and } from 'drizzle-orm';

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

      const response = await fetch(aiWorkerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, category }),
      });

      if (!response.ok) {
        throw new Error(`AI Agent Mesh returned HTTP ${response.status}`);
      }

      const result = await response.json();
      return reply.send(result);
    } catch (error) {
      request.log.error({ err: error }, 'Failed to execute visual search');
      return reply.status(500).send({ error: 'Failed to execute visual search' });
    }
  });

  /**
   * POST /generate-video
   * Triggers Dynamic-Video-Generator AI Agent.
   */
  fastify.post('/generate-video', { preHandler: [optionalAuth] }, async (request, reply) => {
    const { manualId, procedureTitle, repairSteps } = request.body as {
      manualId?: string;
      procedureTitle?: string;
      repairSteps?: string[];
    };

    try {
      const aiWorkerUrl = process.env.AGENT_VIDEO_GENERATOR_URL || (process.env.AI_AGENT_URL 
        ? process.env.AI_AGENT_URL.replace('/process-manual', '/generate-video')
        : 'http://localhost:8000/generate-video');

      const response = await fetch(aiWorkerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manualId, procedureTitle, repairSteps }),
      });

      if (!response.ok) {
        throw new Error(`AI Agent Mesh returned HTTP ${response.status}`);
      }

      const result = await response.json();
      return reply.send(result);
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

      const response = await fetch(aiWorkerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, targetLanguage, readingLevel }),
      });

      if (!response.ok) {
        throw new Error(`AI Agent Mesh returned HTTP ${response.status}`);
      }

      const result = await response.json();
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

      const response = await fetch(aiWorkerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, targetLanguage, sourceLanguage }),
      });


      if (!response.ok) {
        throw new Error(`AI Agent Mesh returned HTTP ${response.status}`);
      }

      const result = await response.json();
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

      return reply.send({
        ...manual,
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
      return reply.send({
        id: manual.id,
        status: manual.status,
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
}




