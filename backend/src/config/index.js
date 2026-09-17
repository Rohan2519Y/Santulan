require('dotenv').config();

module.exports = {
  port: parseInt(process.env.APP_PORT, 10) || 8000,
  env: process.env.APP_ENV || 'development',
  databaseUrl: process.env.RUNTIME_DATABASE_URL || process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
};
