process.env.INTERNAL_API_KEY = process.env.INTERNAL_API_KEY || 'scratch-internal-key-advance';
require('dotenv').config();
const request = require('supertest');
const app = require('./src/app');

const ATTEMPT_ID = '5ded1145-ddd4-4e4a-ad30-de369136907b';
const INTERNAL = { 'X-Internal-Api-Key': process.env.INTERNAL_API_KEY };
const call = (method, p, body = {}) => request(app)[method](`/api/v1${p}`).set(INTERNAL).send(body);

(async () => {
  const q = await call('post', `/internal/attempts/${ATTEMPT_ID}/quality`, {});
  console.log('quality', q.status, q.body);
  if (q.body.outcome !== 'CLEAR') { console.log('not CLEAR, stopping'); process.exit(0); }

  const s = await call('post', `/internal/attempts/${ATTEMPT_ID}/score`, { scoringVersion: 'domain-mean-v1' });
  console.log('score', s.status, s.body);
  if (s.body.outcome !== 'SCORED') { console.log('not SCORED, stopping'); process.exit(0); }

  const r = await call('post', `/internal/attempts/${ATTEMPT_ID}/report`, {});
  console.log('report', r.status, r.body);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
