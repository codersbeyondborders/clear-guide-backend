import { FastifyInstance } from 'fastify';

export default async function fixbotRoutes(fastify: FastifyInstance) {
  // POST /api/fixbot/chat
  fastify.post('/chat', async (request, reply) => {
    try {
      let message = '';
      let fileUrl = null;
      let mimeType = null;
      let deviceContext = null;

      // Handle standard JSON payload
      const body = request.body as any;
      message = body?.message || '';
      fileUrl = body?.fileUrl || null;
      mimeType = body?.mimeType || null;
      deviceContext = body?.deviceContext || null;

      if (!message && !fileUrl) {
        return reply.status(400).send({ error: 'Missing input (message or fileUrl required)' });
      }

      // Forward request to AI Agent Mesh
      const aiMeshUrl = process.env.AGENT_FIXBOT_URL || 'http://localhost:8008/fixbot/chat';
      
      const secret = process.env.AGENT_MESH_SECRET || '';

      const response = await fetch(aiMeshUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${secret}`
        },
        body: JSON.stringify({
          message,
          file_url: fileUrl,
          mime_type: mimeType,
          device_context: deviceContext
        })
      });

      if (!response.ok) {
        throw new Error(`AI Agent Mesh returned status ${response.status}`);
      }

      const data = await response.json();

      return reply.send({
        status: 'success',
        reply: data.data,
      });

    } catch (error) {
      request.log.error({ error }, 'Failed to process FixBot chat');
      return reply.status(500).send({ error: 'Failed to process FixBot chat' });
    }
  });
}
