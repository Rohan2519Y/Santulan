/*
 * DEV-ONLY participants seeder (spec 005 T077, ported to MongoDB by feature 006 T066). Creates one synthetic SUPER_ADMIN row
 * and one synthetic OPEN participant per assessment track (adolescent + emerging adult), each with a dev password in the
 * dev-only credential collection. No names, contact details or real data. Refuses production; safe to re-run (--reset
 * re-issues the passwords).
 *
 * Passwords are FIXED, documented dev-only values (also listed in the README "Dev login credentials" section).
 *
 *   node seeders/santulan/participants.seeder.js [--reset]
 *
 * Uses distinct provider subjects from dev.seeder.js so the two seeds do not collide.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', '..', '.env') });
const { seedDev, print } = require('./devSeed');
const store = require('../../src/models/db');

const ADMIN_SUBJECT = 'ps-dev-super-admin';
const PARTICIPANTS = [
  { subject: 'ps-dev-participant-adolescent', age: 15 },
  { subject: 'ps-dev-participant-emerging-adult', age: 21 },
];
const DEV_PASSWORDS = {
  [ADMIN_SUBJECT]: 'PsDev-Admin-Pass-5',
  'ps-dev-participant-adolescent': 'PsDev-Adolescent-5',
  'ps-dev-participant-emerging-adult': 'PsDev-Emerging-5',
};

async function main() {
  const rows = await seedDev({ adminSubject: ADMIN_SUBJECT, participants: PARTICIPANTS, passwords: DEV_PASSWORDS, reset: process.argv.includes('--reset') });
  print('Participants (synthetic, local only):', rows, 28);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message || err); // eslint-disable-line no-console
    process.exitCode = 1;
  }).finally(() => store.closeClient());
}

module.exports = { main, ADMIN_SUBJECT, PARTICIPANTS, DEV_PASSWORDS };
