import Fastify from 'fastify';
import cors from '@fastify/cors';
import uploadRoutes from './routes/upload';
import taskRoutes from './routes/tasks';
import manualsRoutes from './routes/manuals';

const fastify = Fastify({
  logger: true
});

// Configure CORS
fastify.register(cors, {
  origin: '*', // For production, replace with frontend URL
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
});

fastify.get('/health', async () => {
  return { status: 'ok', service: 'api-gateway' };
});

// Register routes
fastify.register(uploadRoutes, { prefix: '/upload' });
fastify.register(taskRoutes, { prefix: '/tasks' });
fastify.register(manualsRoutes, { prefix: '/manuals' });

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
