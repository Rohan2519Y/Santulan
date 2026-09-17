const express = require('express');
const { errorHandler } = require('./shared/errors');
const authRoutes = require('./modules/auth/auth.routes');
const assessmentRoutes = require('./routes/v1/assessment.routes');

const app = express();

app.use(express.json());

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/v1/auth', authRoutes);
app.use('/api/v1', assessmentRoutes);

app.use((req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found', details: {} } });
});

app.use(errorHandler);

module.exports = app;
