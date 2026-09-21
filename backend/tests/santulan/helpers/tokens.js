/*
 * Token minting for the supertest contract/security suites. Tokens carry exactly the claims the
 * server reads (sub, role, participantId / adminUserId); purpose-scoped tokens carry `purpose` and
 * are never accepted as sessions (backend/src/shared/middleware/auth.js).
 */
const config = require('../../../src/config');
const { signToken, verifyPurposeToken } = require('../../../src/shared/middleware/auth');

const participantToken = (participantId, extra = {}) => signToken({ sub: participantId, role: 'participant', participantId, ...extra });

const adminToken = (adminUserId, { role = 'SUPER_ADMIN' } = {}) => signToken({ sub: adminUserId, role: 'admin', adminUserId, adminRole: role });

const institutionalAdminToken = (adminUserId) => adminToken(adminUserId, { role: 'INSTITUTION_ADMIN' });

const purposeToken = (purpose, claims = {}, expiresIn = '10m') => signToken({ sub: 'x', purpose, ...claims }, expiresIn);

module.exports = { participantToken, adminToken, institutionalAdminToken, purposeToken, verifyPurposeToken, jwtSecret: config.jwtSecret };