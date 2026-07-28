"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const upload_1 = __importDefault(require("./routes/upload"));
const tasks_1 = __importDefault(require("./routes/tasks"));
const manuals_1 = __importDefault(require("./routes/manuals"));
const hub_1 = __importDefault(require("./routes/hub"));
const fastify = (0, fastify_1.default)({
    logger: true
});
// Configure CORS
fastify.register(cors_1.default, {
    origin: '*', // For production, replace with frontend URL
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
});
fastify.get('/health', async () => {
    return { status: 'ok', service: 'api-gateway' };
});
// Register routes
fastify.register(upload_1.default, { prefix: '/upload' });
fastify.register(tasks_1.default, { prefix: '/tasks' });
fastify.register(manuals_1.default, { prefix: '/manuals' });
fastify.register(hub_1.default, { prefix: '/hub' });
fastify.register(hub_1.default, { prefix: '/api/hub' });
fastify.register(hub_1.default, { prefix: '/api' });
const start = async () => {
    try {
        const port = parseInt(process.env.PORT || '8080');
        await fastify.listen({ port, host: '0.0.0.0' });
        console.log(`🚀 API Gateway running on port ${port}`);
    }
    catch (err) {
        fastify.log.error(err);
        process.exit(1);
    }
};
start();
