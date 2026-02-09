import { OpenAPIHono } from '@hono/zod-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';
import { jobs, analyze, health } from './routes';

// Create the main app with OpenAPI support
const app = new OpenAPIHono();

// Global middleware
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

// OpenAPI spec endpoint
app.doc('/openapi.json', {
  openapi: '3.0.0',
  info: {
    title: 'yt2pdf API',
    version: process.env.npm_package_version || '1.0.0',
    description:
      'Convert YouTube videos to PDF, Markdown, or HTML. Extract subtitles and screenshots, with optional AI-powered translation and summarization.',
    license: {
      name: 'MIT',
    },
  },
  servers: [
    {
      url: 'http://localhost:3000',
      description: 'Local development',
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
});

// Scalar API documentation UI
app.get(
  '/docs',
  Scalar({
    url: '/openapi.json',
    pageTitle: 'yt2pdf API Documentation',
  })
);

// Root endpoint
app.get('/', (c) => {
  return c.json({
    name: 'yt2pdf API',
    version: process.env.npm_package_version || '1.0.0',
    docs: '/docs',
    openapi: '/openapi.json',
  });
});

export { app };
export default app;
