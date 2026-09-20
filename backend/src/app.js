const express = require('express');
const cors = require('cors');
const config = require('./config');
const { errorHandler } = require('./shared/errors');
const santulanRoutes = require('./routes/v1/santulan.routes');

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

app.use('/api/v1', santulanRoutes);

app.use((req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found', details: {} } });
});

app.use(errorHandler);

module.exports = app;
