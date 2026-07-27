import { FastifyInstance } from 'fastify';
import { Storage } from '@google-cloud/storage';
import { auth } from '../lib/firebase';

const storage = new Storage();
const bucketName = process.env.GOOGLE_CLOUD_PROJECT 
  ? `${process.env.GOOGLE_CLOUD_PROJECT}-media` 
  : 'clear-guide-media';

export default async function (fastify: FastifyInstance) {
  fastify.post('/signed-url', async (request, reply) => {
    // 1. Verify Firebase Auth Token
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

    const { fileName, contentType } = request.body as { fileName: string; contentType: string };
    
    // Ensure the path is scoped to the user's ID for security
    const sanitizedFileName = `users/${decodedToken.uid}/${Date.now()}_${fileName.replace(/[^a-zA-Z0-9.-]/g, '_')}`;

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
        path: sanitizedFileName
      });
    } catch (error) {
      request.log.error(error);
      return reply.status(500).send({ error: 'Failed to generate signed URL' });
    }
  });
}
