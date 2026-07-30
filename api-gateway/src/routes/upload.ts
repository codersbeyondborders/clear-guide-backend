import { FastifyInstance } from 'fastify';
import { Storage } from '@google-cloud/storage';
import { verifyAuth, requireRole } from '../lib/auth';
import { getGcpServiceAccountCredentials } from '../lib/firebase';

const creds = getGcpServiceAccountCredentials();
const storage = creds
  ? new Storage({ credentials: creds, projectId: creds.project_id })
  : new Storage();

const bucketName = process.env.GOOGLE_CLOUD_PROJECT 
  ? `${process.env.GOOGLE_CLOUD_PROJECT}-media` 
  : 'clear-guide-media';


export default async function (fastify: FastifyInstance) {
  fastify.post(
    '/signed-url',
    { preHandler: [verifyAuth, requireRole(['enterprise_author', 'admin'])] },
    async (request, reply) => {
      const user = request.user!;
      const { fileName, contentType } = request.body as { fileName: string; contentType: string };

      if (!fileName || !contentType) {
        return reply.status(400).send({ error: 'Missing fileName or contentType' });
      }

      // Ensure the path is scoped to the user's ID for security
      const sanitizedFileName = `users/${user.uid}/${Date.now()}_${fileName.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

      const options = {
        version: 'v4' as const,
        action: 'write' as const,
        expires: Date.now() + 15 * 60 * 1000, // 15 minutes
        contentType,
      };

      try {
        const [url] = await storage
          .bucket(bucketName)
          .file(sanitizedFileName)
          .getSignedUrl(options);

        const publicUrl = `https://storage.googleapis.com/${bucketName}/${sanitizedFileName}`;

        return reply.send({
          signedUrl: url,
          publicUrl,
          path: sanitizedFileName,
        });
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Failed to generate signed URL' });
      }
    }
  );

  fastify.post(
    '/diagnostic-signed-url',
    { preHandler: [verifyAuth] },
    async (request, reply) => {
      const user = request.user!;
      const { fileName, contentType } = request.body as { fileName: string; contentType: string };

      if (!fileName || !contentType) {
        return reply.status(400).send({ error: 'Missing fileName or contentType' });
      }

      // Store in diagnostics prefix
      const sanitizedFileName = `diagnostics/${user.uid}/${Date.now()}_${fileName.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

      const options = {
        version: 'v4' as const,
        action: 'write' as const,
        expires: Date.now() + 15 * 60 * 1000, // 15 minutes
        contentType,
      };

      try {
        const [url] = await storage
          .bucket(bucketName)
          .file(sanitizedFileName)
          .getSignedUrl(options);

        const publicUrl = `https://storage.googleapis.com/${bucketName}/${sanitizedFileName}`;

        return reply.send({
          signedUrl: url,
          publicUrl,
          path: sanitizedFileName,
        });
      } catch (error) {
        request.log.error(error);
        return reply.status(500).send({ error: 'Failed to generate signed URL for diagnostic tool' });
      }
    }
  );
}

