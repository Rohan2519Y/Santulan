const express = require('express');
const cors = require('cors');
const config = require('./config');
const { errorHandler } = require('./errors');
const santulanRoutes = require('./routes/v1/santulan.routes');
const store = require('./models/db');

const app = express();

app.use(
  cors({
    origin: config.corsOrigins,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Correlation-Id'],
    exposedHeaders: ['X-Correlation-Id'],
    credentials: true,
  })
);
app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));
// Store health (G-17): `ok` only when the runtime user, the replica set and the data-model version all check out. No detail is
// returned to callers; the reason is available to operators through `npm run db:local:status` and the server log.
app.get('/api/v1/health', async (req, res) => {
  const h = await store.health();
  res.status(h.store === 'ok' ? 200 : 503).json({ store: h.store });
});

app.use('/api/v1', santulanRoutes);

app.use((req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found', details: {} } });
});

app.use(errorHandler);

module.exports = app;
