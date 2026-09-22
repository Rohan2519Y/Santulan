require('dotenv').config();

module.exports = {
  port: parseInt(process.env.APP_PORT, 10) || 8000,
  env: process.env.APP_ENV || 'development',
  // MongoDB (feature 006). The API and workers connect as the least-privilege `santulan_runtime` user on the dedicated
  // instance (port 27018). The migrator URI is read ONLY by scripts and tests, never by src/ (SEC-30).
  mongodbUriRuntime: process.env.MONGODB_URI_RUNTIME || '',
  mongodbDb: process.env.MONGODB_DB || 'santulan',
  mongodbTestDb: process.env.MONGODB_TEST_DB || 'santulan_qual',
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
  // BUILD 07. Governed report version stamped on every report (ASSUMED label, D-11: BUILD 01 states only text NOT NULL).
  reportVersion: process.env.REPORT_VERSION || 'report-v3.1',
  // The SCORED -> report worker runs only when explicitly switched on (like the scoring pipeline).
  reportWorker: process.env.REPORT_WORKER === 'on',
  // The research export worker runs only when explicitly switched on (like the other workers).
  exportWorker: process.env.EXPORT_WORKER === 'on',
  // Research-stage growth-priority ranking weights (BUILD 07 PG-04): configuration, never validated cutoffs. Empty => neutral domain order.
  growthRankingPath: process.env.GROWTH_RANKING_PATH || '',
  // Pathway policy version recorded on every pathway decision (ASSUMED default, D-11: local support policy is a governance input).
  pathwayPolicyVersion: process.env.PATHWAY_POLICY_VERSION || 'policy-unconfigured',
  // Unset => the inactivity timeout is disabled (the duration is an unfrozen UX decision; never invented).
  sessionInactivityMinutes: process.env.SESSION_INACTIVITY_MINUTES ? Number(process.env.SESSION_INACTIVITY_MINUTES) : null,
  // Registration throttle (per IP and per device), separate from OTP throttling. Limits are configuration, never hard-coded.
  registrationThrottle: {
    windowSeconds: Number(process.env.REGISTRATION_THROTTLE_WINDOW_SECONDS) || 3600,
    maxPerIp: Number(process.env.REGISTRATION_THROTTLE_MAX_PER_IP) || 20,
    maxPerDevice: Number(process.env.REGISTRATION_THROTTLE_MAX_PER_DEVICE) || 10,
  },
};
