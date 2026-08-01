"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fastify_1 = __importDefault(require("fastify"));
const cors_1 = __importDefault(require("@fastify/cors"));
const multipart_1 = __importDefault(require("@fastify/multipart"));
const auth_1 = __importDefault(require("./routes/auth"));
const upload_1 = __importDefault(require("./routes/upload"));
const tasks_1 = __importDefault(require("./routes/tasks"));
const manuals_1 = __importDefault(require("./routes/manuals"));
const hub_1 = __importDefault(require("./routes/hub"));
const ifixit_1 = __importDefault(require("./routes/ifixit"));
const fixbot_1 = __importDefault(require("./routes/fixbot"));
const community_1 = __importDefault(require("./routes/community"));
const rate_limit_1 = __importDefault(require("@fastify/rate-limit"));
const fastify = (0, fastify_1.default)({
    logger: true
});
// Configure CORS
fastify.register(cors_1.default, {
    origin: '*', // For production, replace with frontend URL
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
});
// Configure Multipart
fastify.register(multipart_1.default, {
    limits: {
        fileSize: 20 * 1024 * 1024, // 20MB limit for PDFs and Images
    }
});
fastify.get('/health', async () => {
    return { status: 'ok', service: 'api-gateway' };
});
fastify.register(rate_limit_1.default, {
    global: true,
    max: 100,
    timeWindow: '1 minute'
});
// Register routes cleanly
fastify.register(auth_1.default, { prefix: '/api/auth' });
fastify.register(upload_1.default, { prefix: '/api/upload' });
fastify.register(tasks_1.default, { prefix: '/api/tasks' });
fastify.register(manuals_1.default, { prefix: '/api/manuals' });
fastify.register(hub_1.default, { prefix: '/api/hub' });
fastify.register(ifixit_1.default, { prefix: '/api/ifixit' });
fastify.register(fixbot_1.default, { prefix: '/api/fixbot' });
fastify.register(community_1.default, { prefix: '/api/community' });
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
