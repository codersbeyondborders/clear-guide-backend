import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import authRoutes from './routes/auth';
import uploadRoutes from './routes/upload';
import taskRoutes from './routes/tasks';
import manualsRoutes from './routes/manuals';
import hubRoutes from './routes/hub';
import ifixitRoutes from './routes/ifixit';
import fixbotRoutes from './routes/fixbot';
import communityRoutes from './routes/community';
import rateLimit from '@fastify/rate-limit';
const fastify = Fastify({
  logger: true
});

// Configure CORS
fastify.register(cors, {
  origin: '*', // For production, replace with frontend URL
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
});

// Configure Multipart
fastify.register(multipart, {
  limits: {
    fileSize: 20 * 1024 * 1024, // 20MB limit for PDFs and Images
  }
});

fastify.get('/health', async () => {
  return { status: 'ok', service: 'api-gateway' };
});

fastify.register(rateLimit, {
  global: true,
  max: 100,
  timeWindow: '1 minute'
});

// Register routes cleanly
fastify.register(authRoutes, { prefix: '/api/auth' });
fastify.register(uploadRoutes, { prefix: '/api/upload' });
fastify.register(taskRoutes, { prefix: '/api/tasks' });
fastify.register(manualsRoutes, { prefix: '/api/manuals' });
fastify.register(hubRoutes, { prefix: '/api/hub' });
fastify.register(ifixitRoutes, { prefix: '/api/ifixit' });
fastify.register(fixbotRoutes, { prefix: '/api/fixbot' });
fastify.register(communityRoutes, { prefix: '/api/community' });




const start = async () => {
  try {
    const port = parseInt(process.env.PORT || '8080');
    await fastify.listen({ port, host: '0.0.0.0' });
    console.log(`🚀 API Gateway running on port ${port}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
