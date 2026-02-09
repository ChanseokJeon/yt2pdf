import { serve } from '@hono/node-server';
import { app } from './app';

const port = parseInt(process.env.PORT || '3000', 10);

// eslint-disable-next-line no-console
console.log(`Starting yt2pdf API server on port ${port}...`);

const server = serve({
  fetch: app.fetch,
  port,
});

// eslint-disable-next-line no-console
console.log(`Server running at http://localhost:${port}`);
// eslint-disable-next-line no-console
console.log(`Health check: http://localhost:${port}/api/v1/health`);
// eslint-disable-next-line no-console
console.log(`API docs: http://localhost:${port}/docs`);

// Graceful shutdown handlers
let isShuttingDown = false;

const shutdown = (signal: string) => {
  if (isShuttingDown) {
    // eslint-disable-next-line no-console
    console.log('Shutdown already in progress...');
    return;
  }

  isShuttingDown = true;
  // eslint-disable-next-line no-console
  console.log(`Received ${signal}, shutting down gracefully...`);

  try {
    const forceShutdownTimer = setTimeout(() => {
      console.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);

    server.close(() => {
      clearTimeout(forceShutdownTimer);
      // eslint-disable-next-line no-console
      console.log('Server closed successfully');
      process.exit(0);
    });
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
});
