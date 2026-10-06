// Canonical tests always run against a SCRATCH database (name contains test|qual|scratch), never the dev database.
process.env.APP_ENV = 'test';
// MongoDB (feature 006): tests always run against the SCRATCH database (name contains test|qual|scratch), never `santulan`.
// URIs come from the git-ignored backend/.env written by `npm run db:local:init`; SANTULAN_TEST_MONGODB_* override them.
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '.env') });
process.env.MONGODB_URI_RUNTIME = process.env.SANTULAN_TEST_MONGODB_URI_RUNTIME || process.env.MONGODB_URI_RUNTIME || '';
process.env.MONGODB_URI_ADMIN = process.env.SANTULAN_TEST_MONGODB_URI_ADMIN || process.env.MONGODB_URI_ADMIN || '';
process.env.MONGODB_DB = process.env.SANTULAN_TEST_MONGODB_DB || process.env.MONGODB_TEST_DB || 'santulan_qual';
process.env.MONGODB_TEST_DB = process.env.MONGODB_DB;

process.env.JWT_SECRET = 'test-secret';
process.env.INTERNAL_API_KEY = 'test-internal-key';
// High limits so the API suite is not throttled; the throttle itself is unit-tested with small limits.
process.env.REGISTRATION_THROTTLE_MAX_PER_IP = '100000';
process.env.REGISTRATION_THROTTLE_MAX_PER_DEVICE = '100000';
process.env.LOGIN_THROTTLE_MAX_PER_IP = '100000';
process.env.LOGIN_THROTTLE_MAX_PER_SUBJECT = '100000';
// Test-only approved consent protocols: identifiers and method codes, no legal text (the real file is governed config).
process.env.CONSENT_PROTOCOLS_PATH = require('path').resolve(__dirname, 'santulan/fixtures/consent-protocols.json');
