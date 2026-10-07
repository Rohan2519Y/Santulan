#!/usr/bin/env node
/*
 * Read-only check for leftover development accounts in a database (audit gap G-15): lists admins and participants whose login
 * subject starts with the dev seeders' prefixes (dev-, ps-dev-). Run it against a deployed database before going live. Exit code 1 when
 * any are found. It changes nothing; accounts cannot be deleted through the app, so what to do with a finding is your decision
 * (for admins: suspend through the admin API after the real admin exists).
 *
 *   node scripts/check-dev-accounts.js
 */
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
const store = require('../src/models/db');

async function main() {
  const rows = await store.withScope(store.systemScope(), async (tx) => {
    const re = /^(ps-)?dev-/;
    const admins = (await tx.c.admin_users.find({})).filter((a) => re.test(a.auth_provider_subject_id || ''));
    const people = (await tx.c.participants.find({})).filter((p) => re.test(p.auth_provider_subject_id || ''));
    return [...admins.map((a) => ({ kind: 'admin', id: a._id, subject: a.auth_provider_subject_id, status: a.status })),
      ...people.map((p) => ({ kind: 'participant', id: p._id, subject: p.auth_provider_subject_id, status: p.status }))];
  });
  if (!rows.length) { console.log('No development accounts found.'); return; } // eslint-disable-line no-console
  console.log(`${rows.length} development account(s) found:`); // eslint-disable-line no-console
  rows.forEach((r) => console.log(`  ${r.kind.padEnd(11)} ${r.subject.padEnd(34)} ${r.status}  ${r.id}`)); // eslint-disable-line no-console
  process.exitCode = 1;
}

main().catch((err) => { console.error(err.message || err); process.exitCode = 1; }).finally(() => store.closeClient());
