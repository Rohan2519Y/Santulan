require('dotenv').config();

module.exports = {
  port: parseInt(process.env.APP_PORT, 10) || 8000,
  env: process.env.APP_ENV || 'development',
  databaseUrl: process.env.RUNTIME_DATABASE_URL || process.env.DATABASE_URL,
  // Platform-scope connection (bypasses row-level security). Login-lookup only.
  platformDatabaseUrl: process.env.PLATFORM_DATABASE_URL || process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  // Comma-separated list of allowed browser origins for the frontend dev
  // server (default covers CRA's default port). Supertest/API-client callers
  // are unaffected - CORS is a browser-enforced preflight check only.
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map((o) => o.trim()),
};
