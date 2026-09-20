require('dotenv').config();

module.exports = {
  port: parseInt(process.env.APP_PORT, 10) || 8000,
  env: process.env.APP_ENV || 'development',
  // Runtime connection: the non-superuser, NOBYPASSRLS role `app_runtime` (never the table owner).
  databaseUrl: process.env.RUNTIME_DATABASE_URL || process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET || 'dev-secret-change-me',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '2h',
  // Comma-separated list of allowed browser origins for the frontend dev
  // server (default covers CRA's default port). Supertest/API-client callers
  // are unaffected - CORS is a browser-enforced preflight check only.
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map((o) => o.trim()),
  // Worker/verifier endpoints (never reachable with a browser token).
  internalApiKey: process.env.INTERNAL_API_KEY || '',
  // 'dev' adapter is refused in production (see identity/index.js).
  identityProvider: process.env.IDENTITY_PROVIDER || 'dev',
  // Governed configuration paths; a missing file fails closed (nothing approved).
  consentProtocolsPath: process.env.CONSENT_PROTOCOLS_PATH || '',
  qualityPolicyPath: process.env.QUALITY_POLICY_PATH || '',
  evidenceConfigPath: process.env.EVIDENCE_CONFIG_PATH || '',
  exportDir: process.env.EXPORT_DIR || '',
  // Governed scoring version stamped on every score row (ASSUMED label, D-11: the sources require a governed value but do not name one).
  scoringVersion: process.env.SCORING_VERSION || 'domain-mean-v1',
  // The submit -> quality -> score worker runs only when explicitly switched on.
  scoringPipeline: process.env.SCORING_PIPELINE === 'on',
  // Unset => the inactivity timeout is disabled (the duration is an unfrozen UX decision; never invented).
  sessionInactivityMinutes: process.env.SESSION_INACTIVITY_MINUTES ? Number(process.env.SESSION_INACTIVITY_MINUTES) : null,
  // Registration throttle (per IP and per device), separate from OTP throttling. Limits are configuration, never hard-coded.
  registrationThrottle: {
    windowSeconds: Number(process.env.REGISTRATION_THROTTLE_WINDOW_SECONDS) || 3600,
    maxPerIp: Number(process.env.REGISTRATION_THROTTLE_MAX_PER_IP) || 20,
    maxPerDevice: Number(process.env.REGISTRATION_THROTTLE_MAX_PER_DEVICE) || 10,
  },
};
