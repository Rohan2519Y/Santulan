// Canonical tests always run against a SCRATCH database (name contains test|qual|scratch), never the dev database.
process.env.APP_ENV = 'test';
process.env.DATABASE_URL = process.env.SANTULAN_TEST_DATABASE_URL || 'postgresql://postgres:1234@localhost:5432/santulan_qual';
process.env.RUNTIME_DATABASE_URL = process.env.SANTULAN_TEST_RUNTIME_DATABASE_URL || 'postgresql://app_runtime:app_runtime_dev_password@localhost:5432/santulan_qual';
process.env.JWT_SECRET = 'test-secret';
process.env.INTERNAL_API_KEY = 'test-internal-key';
// High limits so the API suite is not throttled; the throttle itself is unit-tested with small limits.
process.env.REGISTRATION_THROTTLE_MAX_PER_IP = '100000';
process.env.REGISTRATION_THROTTLE_MAX_PER_DEVICE = '100000';
// Test-only approved consent protocols: identifiers and method codes, no legal text (the real file is governed config).
process.env.CONSENT_PROTOCOLS_PATH = require('path').resolve(__dirname, 'santulan/fixtures/consent-protocols.json');
