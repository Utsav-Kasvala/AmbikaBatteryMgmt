import express from 'express';
import cors from 'cors';
import { checkDb, closeDb } from './db';

const app = express();
const PORT = Number(process.env.PORT) || 3000;

app.use(cors());
app.use(express.json());

app.get('/', (_req, res) => {
  res.json({
    name: 'Battery Production & Inventory API',
    version: '0.1.0',
    docs: 'See /health',
  });
});

app.get('/health', async (_req, res) => {
  try {
    await checkDb();
    res.status(200).json({
      status: 'ok',
      db: 'ok',
      service: 'battery-backend',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[health] db check failed:', err);
    res.status(503).json({
      status: 'error',
      db: 'error',
      service: 'battery-backend',
      timestamp: new Date().toISOString(),
    });
  }
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`[backend] listening on http://0.0.0.0:${PORT}`);
});

// Graceful shutdown
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    console.log(`[backend] received ${sig}, shutting down`);
    server.close();
    await closeDb();
    process.exit(0);
  });
}
