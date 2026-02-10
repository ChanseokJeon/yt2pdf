import { OpenAPIHono } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { jobs, analyze, health } from './routes';
import type { AppEnv } from './types.js';
import { apiKeyAuth, getAuthMode } from './middleware/api-key-auth.js';
import { globalRateLimit, perKeyRateLimit } from './middleware/rate-limit.js';

// Create the main app with OpenAPI support
const app = new OpenAPIHono<AppEnv>();

// Global middleware (applied to all routes)
app.use('*', logger());
app.use('*', prettyJSON());
app.use(
  '*',
  cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'X-User-Id', 'X-API-Key'],
  })
);

// Rate limiting (before auth to reject DoS early)
app.use('*', globalRateLimit());

// Authentication (exempts /health, /docs, /openapi.json, /)
app.use('*', apiKeyAuth({ mode: getAuthMode() }));

// Per-key rate limiting (after auth so we have userId)
app.use('*', perKeyRateLimit());

// Error handler
app.onError((err, c) => {
  console.error('Unhandled error:', err);
  return c.json(
    {
      error: 'Internal Server Error',
      message: process.env.NODE_ENV === 'development' ? err.message : undefined,
    },
    500
  );
});

// Not found handler
app.notFound((c) => {
  return c.json({ error: 'Not Found' }, 404);
});

// Mount routes
app.route('/api/v1/jobs', jobs);
app.route('/api/v1/analyze', analyze);
app.route('/api/v1/health', health);

// OpenAPI spec endpoint (dynamic)
app.get('/openapi.json', (c) => {
  // Construct server URL from request
  const host = c.req.header('host');
  const proto = c.req.header('x-forwarded-proto') ||
                (c.req.url.startsWith('https://') ? 'https' : 'http');
  const serverUrl = host ? `${proto}://${host}` : 'http://localhost:3000';

  // Get the base OpenAPI document from Hono
  const baseDoc = app.getOpenAPIDocument({
    openapi: '3.0.0',
    info: {
      title: 'v2doc API',
      version: process.env.npm_package_version || '1.0.0',
      description:
        'Convert YouTube videos to PDF, Markdown, or HTML. Extract subtitles and screenshots, with optional AI-powered translation and summarization.',
      license: {
        name: 'MIT',
      },
    },
    servers: [
      {
        url: serverUrl,
        description: host ? 'Current server' : 'Local development',
      },
    ],
    tags: [
      {
        name: 'Conversion',
        description: 'YouTube video conversion endpoints',
      },
      {
        name: 'Analysis',
        description: 'Video analysis and metadata extraction',
      },
      {
        name: 'Health',
        description: 'Service health and readiness checks',
      },
    ],
    security: [{ bearerAuth: [] }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'API Key',
          description: 'API key authentication. Format: `Authorization: Bearer v2d_...`',
        },
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  return c.json(baseDoc);
});

// Scalar API documentation UI
app.get(
  '/docs',
  Scalar({
    url: '/openapi.json',
    pageTitle: 'v2doc API Documentation',
  })
);

// Root endpoint
app.get('/', (c) => {
  return c.json({
    name: 'v2doc API',
    version: process.env.npm_package_version || '1.0.0',
    docs: '/docs',
    openapi: '/openapi.json',
  });
});

export { app };
export default app;
