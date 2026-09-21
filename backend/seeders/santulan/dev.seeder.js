/*
 * DEV-ONLY seeder (spec 005 T077, ported to MongoDB by feature 006 T066). Creates SYNTHETIC identities so the local system
 * can be used without a managed identity provider: one SUPER_ADMIN and one OPEN participant per assessment track, each with
 * a dev password. No names, contact details or real data. Refuses production. Re-running is safe: existing rows are kept and
 * the passwords are printed only when they are (re)generated (pass --reset to re-issue them).
 *
 * Passwords are FIXED, documented dev-only values (also listed in the README "Dev login credentials" section), so a
 * freshly seeded local database always accepts the same credentials. Reset only overwrites a changed password back.
 *
 *   node seeders/santulan/dev.seeder.js [--reset]
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '.env') });
const { seedDev, print } = require('./devSeed');
const store = require('../../src/modules/santulan/store');

const ADMIN_SUBJECT = 'dev-super-admin';
const PARTICIPANTS = [
  { subject: 'dev-participant-adolescent', age: 15 },
  { subject: 'dev-participant-emerging-adult', age: 21 },
];
const DEV_PASSWORDS = {
  [ADMIN_SUBJECT]: 'Dev-Admin-Pass-7',
  'dev-participant-adolescent': 'Dev-Adolescent-7',
  'dev-participant-emerging-adult': 'Dev-Emerging-7',
};

async function main() {
  const rows = await seedDev({ adminSubject: ADMIN_SUBJECT, participants: PARTICIPANTS, passwords: DEV_PASSWORDS, reset: process.argv.includes('--reset') });
  print('Dev identities (synthetic, local only):', rows, 26);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err); // eslint-disable-line no-console
    process.exitCode = 1;
  }).finally(() => store.closeClient());
}

module.exports = { main, ADMIN_SUBJECT, PARTICIPANTS, DEV_PASSWORDS };
