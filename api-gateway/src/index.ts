import Fastify from 'fastify';
import cors from '@fastify/cors';
import authRoutes from './routes/auth';
import uploadRoutes from './routes/upload';
import taskRoutes from './routes/tasks';
import manualsRoutes from './routes/manuals';
import hubRoutes from './routes/hub';
import ifixitRoutes from './routes/ifixit';

const fastify = Fastify({
  logger: true
});

// Configure CORS
fastify.register(cors, {
  origin: '*', // For production, replace with frontend URL
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
});

fastify.get('/health', async () => {
  return { status: 'ok', service: 'api-gateway' };
});

// Register routes cleanly
fastify.register(authRoutes, { prefix: '/api/auth' });
fastify.register(uploadRoutes, { prefix: '/api/upload' });
fastify.register(taskRoutes, { prefix: '/api/tasks' });
fastify.register(manualsRoutes, { prefix: '/api/manuals' });
fastify.register(hubRoutes, { prefix: '/api/hub' });
fastify.register(ifixitRoutes, { prefix: '/api/ifixit' });





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
