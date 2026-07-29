import { FastifyInstance } from 'fastify';
import { firestore } from '../lib/firebase';


export default async function ifixitRoutes(fastify: FastifyInstance) {
  
  // GET /api/ifixit/search
  // For basic search, we proxy directly to iFixit (with a lightweight cache if needed)
  // as storing their entire DB just to search would violate the NonCommercial anti-scraping rules.
  fastify.get('/search', async (request, reply) => {
    try {
      const { q } = request.query as { q?: string };
      if (!q) {
        return reply.status(400).send({ error: 'Missing query parameter q' });
      }

      const response = await fetch(`https://www.ifixit.com/api/2.0/search/${encodeURIComponent(q)}`);
      const data = await response.json();
      return reply.send(data);
    } catch (error) {
      request.log.error({ error }, 'Failed to search iFixit');
      return reply.status(500).send({ error: 'Failed to search iFixit' });
    }
  });

  // GET /api/ifixit/guides/:guideid
  // Retrieves the transformed guide from Firestore. If missing or expired (30-day TTL),
  // it triggers the AI Mesh to ingest/transform it live.
  fastify.get('/guides/:guideid', async (request, reply) => {
    try {
      const { guideid } = request.params as { guideid: string };

      const docRef = firestore.collection('ifixit_cache').doc(guideid);
      const doc = await docRef.get();

      let needsRefresh = false;

      if (!doc.exists) {
        needsRefresh = true;
      } else {
        const data = doc.data();
        if (data?.expires_at) {
          const expiresAt = data.expires_at.toDate(); // Firestore Timestamp to Date
          if (new Date() > expiresAt) {
            needsRefresh = true;
          }
        } else {
          needsRefresh = true;
        }
      }

      if (needsRefresh) {
        // Trigger AI Agent Mesh to ingest and transform the guide
        const aiMeshUrl = process.env.AI_AGENT_URL 
            ? process.env.AI_AGENT_URL.replace('/process-manual', '/ifixit/ingest')
            : 'http://localhost:8004/ifixit/ingest';
            
        const secret = process.env.AGENT_MESH_SECRET || '';

        const ingestResponse = await fetch(aiMeshUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${secret}`
          },
          body: JSON.stringify({ guideId: guideid })
        });

        if (!ingestResponse.ok) {
          throw new Error('Failed to ingest guide via AI Mesh');
        }

        // Wait a small moment to ensure Firestore consistency (or just refetch)
        const newDoc = await docRef.get();
        if (newDoc.exists) {
          return reply.send({ data: newDoc.data() });
        } else {
          throw new Error('Ingestion succeeded but document not found in Firestore');
        }
      }

      // Return the cached document
      return reply.send({ data: doc.data() });

    } catch (error) {
      request.log.error({ error }, 'Failed to fetch iFixit guide');
      return reply.status(500).send({ error: 'Failed to fetch iFixit guide' });
    }
  });
}
