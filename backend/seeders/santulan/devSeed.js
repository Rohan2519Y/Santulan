/*
 * Shared implementation of the DEV-ONLY seeders (dev.seeder.js, participants.seeder.js). Creates SYNTHETIC identities so the
 * local system can be used without a managed identity provider: one SUPER_ADMIN and one OPEN participant per assessment
 * track, each with a fixed documented dev password. No names, contact details or real data. Refuses production.
 * Runs through the store with the least-privilege runtime credential (the same access the API has); safe to re-run.
 */
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const store = require('../../src/modules/santulan/store');
const identity = require('../../src/modules/santulan/store/repositories/identity');
const devIdentity = require('../../src/modules/santulan/store/repositories/devIdentity');
const rules = require('../../src/modules/santulan/domain/registrationRules');

const PROVIDER = 'santulan-dev';

async function ensureCredential(tx, subject, password, reset) {
  const existing = await devIdentity.findCredential(tx, PROVIDER, subject);
  if (existing && !reset) return null;
  await devIdentity.upsertPermanent(tx, PROVIDER, subject, await bcrypt.hash(password, 10));
  return password;
}

/**
 * @param {{adminSubject:string, participants:{subject:string, age:number}[], passwords:Object<string,string>, reset?:boolean}} plan
 * @returns {Promise<Array<{who:string, login:string, password:string|null}>>}
 */
async function seedDev({ adminSubject, participants, passwords, reset = false }) {
  if ((process.env.APP_ENV || 'development') === 'production') throw new Error('The dev seeders must never run in production');
  const out = [];
  await store.withScope(store.systemScope(), async (tx) => {
    let admin = await identity.findAdminByAuthSubject(tx, PROVIDER, adminSubject);
    if (!admin) {
      const now = new Date();
      admin = await identity.insertAdmin(tx, { _id: uuidv4(), role: 'SUPER_ADMIN', auth_provider: PROVIDER, auth_provider_subject_id: adminSubject, status: 'ACTIVE', created_at: now, updated_at: now });
    }
    out.push({ who: 'SUPER_ADMIN', login: adminSubject, password: await ensureCredential(tx, adminSubject, passwords[adminSubject], reset), id: admin.adminUserId });

    for (const p of participants) {
      let participant = await identity.findParticipantByAuthSubject(tx, PROVIDER, p.subject);
      if (!participant) {
        participant = await identity.insertParticipant(tx, rules.buildParticipant({ _id: uuidv4(), route: 'OPEN', age: p.age, authProvider: PROVIDER, authProviderSubjectId: p.subject }));
      }
      out.push({ who: `participant (age ${p.age})`, login: participant.santulanId, password: await ensureCredential(tx, p.subject, passwords[p.subject], reset) });
    }
  }, { transaction: true });
  return out;
}

function print(title, rows, width) {
  console.log(title); // eslint-disable-line no-console
  for (const r of rows) console.log(`  ${r.who.padEnd(width)} login: ${r.login}  password: ${r.password || '(unchanged; use --reset to issue a new one)'}`); // eslint-disable-line no-console
}

module.exports = { seedDev, print, PROVIDER };
