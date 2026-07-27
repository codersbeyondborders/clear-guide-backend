import { FastifyInstance } from 'fastify';
import { CloudTasksClient } from '@google-cloud/tasks';
import { db } from '../lib/db';
import { manuals } from '../lib/schema';
import { auth } from '../lib/firebase';

const client = new CloudTasksClient();

const project = process.env.GOOGLE_CLOUD_PROJECT || 'clear-guide';
const queue = 'pdf-processing-queue';
const location = 'us-central1';
const aiWorkerUrl = process.env.AI_AGENT_URL || 'http://localhost:8000/process-manual';

export default async function (fastify: FastifyInstance) {
  fastify.post('/process-manual', async (request, reply) => {
    // 1. Verify Auth
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

    const { manualId, storageUrl, title } = request.body as any;

    // 2. Save manual record to DB as 'pending'
    await db.insert(manuals).values({
      id: manualId,
      userId: decodedToken.uid,
      title,
      storageUrl,
      status: 'pending'
    });

    // 3. Enqueue task to Cloud Tasks
    const parent = client.queuePath(project, location, queue);
    const task = {
      httpRequest: {
        httpMethod: 'POST' as const,
        url: aiWorkerUrl,
        headers: {
          'Content-Type': 'application/json',
        },
        body: Buffer.from(JSON.stringify({ manualId, storageUrl })).toString('base64'),
      },
    };

    try {
      const [response] = await client.createTask({ parent, task });
      return reply.send({ success: true, taskName: response.name });
    } catch (error) {
      request.log.error({ err: error }, 'Cloud Tasks error');
      return reply.status(500).send({ error: 'Failed to enqueue task' });
    }
  });
}
