import { FastifyInstance } from 'fastify';
import { CloudTasksClient } from '@google-cloud/tasks';
import { db } from '../lib/db';
import { manuals } from '../lib/schema';
import { verifyAuth, requireRole } from '../lib/auth';
import { dispatchToAgent } from '../lib/agentClient';

let tasksClient: CloudTasksClient | null = null;
try {
  tasksClient = new CloudTasksClient();
} catch (e) {
  // CloudTasksClient requires GCP credentials; will fallback to direct HTTP in dev
}

const project = process.env.GOOGLE_CLOUD_PROJECT || 'clear-guide';
const queue = process.env.CLOUD_TASKS_QUEUE || 'pdf-processing-queue';
const location = process.env.CLOUD_TASKS_LOCATION || 'us-central1';
const aiWorkerUrl = process.env.AGENT_PDF_PARSER_URL || process.env.AI_AGENT_URL || 'http://localhost:8001/process-manual';


export default async function (fastify: FastifyInstance) {
  fastify.post(
    '/process-manual',
    { preHandler: [verifyAuth, requireRole(['enterprise_author', 'admin'])] },
    async (request, reply) => {
      const user = request.user!;
      const { manualId, storageUrl, title } = request.body as {
        manualId: string;
        storageUrl: string;
        title: string;
      };

      if (!manualId || !storageUrl || !title) {
        return reply.status(400).send({ error: 'Missing required fields: manualId, storageUrl, title' });
      }

      try {
        // 1. Save or update manual record in DB as 'pending'
        await db.insert(manuals).values({
          id: manualId,
          userId: user.uid,
          title,
          storageUrl,
          status: 'pending',
          createdAt: new Date(),
        }).onConflictDoUpdate({
          target: manuals.id,
          set: {
            storageUrl,
            title,
            status: 'pending',
          },
        });

        // 2. Enqueue task via Google Cloud Tasks with fallback to direct HTTP POST
        let dispatchedVia = 'local_fallback';
        let taskName = `local-${Date.now()}`;

        if (tasksClient && process.env.NODE_ENV === 'production') {
          try {
            const parent = tasksClient.queuePath(project, location, queue);
            const task = {
              httpRequest: {
                httpMethod: 'POST' as const,
                url: aiWorkerUrl,
                headers: {
                  'Content-Type': 'application/json',
                  ...(process.env.AGENT_MESH_SECRET ? { 'Authorization': `Bearer ${process.env.AGENT_MESH_SECRET}` } : {}),
                },
                body: Buffer.from(JSON.stringify({ manualId, storageUrl })).toString('base64'),
              },
            };
            const [response] = await tasksClient.createTask({ parent, task });
            taskName = response.name || taskName;
            dispatchedVia = 'cloud_tasks';
          } catch (cloudErr) {
            request.log.warn({ err: cloudErr }, 'Cloud Tasks failed, falling back to HTTP dispatch');
          }
        }

        // Fallback: Trigger direct HTTP POST to AI worker (non-blocking)
        if (dispatchedVia === 'local_fallback') {
          dispatchToAgent(aiWorkerUrl, { manualId, storageUrl }, 3, { 'X-CloudTasks-TaskName': taskName })
            .catch((err) => {
              request.log.error({ err, aiWorkerUrl }, 'Failed to dispatch direct HTTP request to AI Agent Mesh');
            });
        }

        return reply.send({
          success: true,
          manualId,
          status: 'pending',
          dispatchedVia,
          taskName,
        });
      } catch (error) {
        request.log.error({ err: error }, 'Failed to process manual ingestion');
        return reply.status(500).send({ error: 'Failed to process manual ingestion' });
      }
    }
  );
}

