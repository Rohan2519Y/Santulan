/*
 * Seeds: ResponseScale (frozen 5-point Likert), both frozen AssessmentVersions
 * with their imported items (from the committed JSON fixtures under
 * seeders/seeds/), and stem InterpretationRule rows.
 * Run via `npm run db:seed`. (Logins are `accounts` - see seeders/platform.seeder.js.)
 */
const path = require('path');
const { randomUUID } = require('crypto');
const { Client } = require('pg');
require('dotenv').config();

const { computeContentHash, DOMAINS } = require('../src/modules/assessment/utils/itemPoolParser');
const { EVIDENCE_STATES, DEVELOPMENTAL_BANDS, buildStemTemplate } = require('../src/modules/assessment/engine/interpretationStems');

const client = new Client({ connectionString: process.env.DATABASE_URL });

const SCORING_VERSION = 'scoring-v1.0'; // eslint-disable-line no-unused-vars
const RESPONSE_SCALE_VERSION = 'santulan-scale-v1.0';
const INTERPRETATION_RULE_VERSION = 'v1.0';

const POOLS = [
  {
    fixture: '../seeders/seeds/item-pool-adolescent/items.json',
    toolBand: 'ADOLESCENT',
    isActive: true,
  },
  {
    fixture: '../seeders/seeds/item-pool-emergingadult/items.json',
    toolBand: 'EMERGING_ADULT',
    isActive: false,
  },
];

async function seedResponseScale() {
  const { rows: existingRows } = await client.query('SELECT * FROM response_scales WHERE version = $1', [RESPONSE_SCALE_VERSION]);
  if (existingRows[0]) return existingRows[0];

  const { rows } = await client.query(
    `INSERT INTO response_scales (id, version, scale_points, anchor_labels, keying_definition, frozen_at, status)
     VALUES ($1, $2, 5, $3, $4, $5, 'FROZEN')
     RETURNING *`,
    [
      randomUUID(),
      RESPONSE_SCALE_VERSION,
      JSON.stringify({ 1: 'Almost never', 2: 'Rarely', 3: 'Sometimes', 4: 'Often', 5: 'Almost always' }),
      JSON.stringify({ positive: 'higher is higher', reverse: 'higher raw value is lower construct standing' }),
      new Date(),
    ]
  );
  return rows[0];
}

// Admin and student logins are no longer seeded here: the old `users` table is gone and people
// are `accounts` now - run `npm run db:seed:platform` for the demo admin and student.

async function seedVersion(responseScaleId, pool) {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const fixture = require(path.join(__dirname, pool.fixture.replace('../seeders/', '')));
  const contentHash = computeContentHash(fixture.items);

  const { rows: existingRows } = await client.query('SELECT * FROM assessment_versions WHERE version_label = $1', [fixture.versionLabel]);
  if (existingRows[0]) {
    const version = existingRows[0];
    const { rows: items } = await client.query('SELECT * FROM items WHERE assessment_version_id = $1', [version.id]);
    return { version, items };
  }

  const { rows: versionRows } = await client.query(
    `INSERT INTO assessment_versions (id, version_label, response_scale_id, tool_band, source_file, content_hash, frozen_at, status, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'FROZEN', false)
     RETURNING *`,
    [randomUUID(), fixture.versionLabel, responseScaleId, pool.toolBand, fixture.sourceFile, contentHash, new Date()]
  );
  const version = versionRows[0];

  for (const item of fixture.items) {
    // eslint-disable-next-line no-await-in-loop
    await client.query(
      `INSERT INTO items
         (id, assessment_version_id, item_code, domain_code, subdomain_code, domain_name, subdomain_name, item_text, keying, age_band, context, layer, status, display_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        randomUUID(),
        version.id,
        item.itemCode,
        item.domainCode,
        item.subdomainCode,
        item.domainName,
        item.subdomainName,
        item.itemText,
        item.keying,
        item.ageBand,
        item.context,
        item.layer,
        item.status,
        item.displayOrder,
      ]
    );
  }

  const { rows: items } = await client.query('SELECT * FROM items WHERE assessment_version_id = $1', [version.id]);
  return { version, items };
}

async function seedInterpretationRules(version) {
  const domainCodes = Object.keys(DOMAINS);
  let count = 0;

  for (const domainCode of domainCodes) {
    for (const developmentalBand of DEVELOPMENTAL_BANDS) {
      for (const evidenceState of EVIDENCE_STATES) {
        const ruleCode = `${domainCode}-${developmentalBand}-${evidenceState}-en`;
        const approvedTextTemplate = buildStemTemplate(domainCode, DOMAINS[domainCode], evidenceState);
        // eslint-disable-next-line no-await-in-loop
        await client.query(
          `INSERT INTO interpretation_rules
             (id, assessment_version_id, domain_code, developmental_band, evidence_state, locale, rule_code, approved_text_template, version, status)
           VALUES ($1, $2, $3, $4, $5, 'en', $6, $7, $8, 'FROZEN')
           ON CONFLICT (assessment_version_id, domain_code, developmental_band, evidence_state, locale) DO NOTHING`,
          [randomUUID(), version.id, domainCode, developmentalBand, evidenceState, ruleCode, approvedTextTemplate, INTERPRETATION_RULE_VERSION]
        );
        count += 1;
      }
    }
  }
  return count;
}

async function main() {
  await client.connect();

  const scale = await seedResponseScale();

  const results = [];
  for (const pool of POOLS) {
    // eslint-disable-next-line no-await-in-loop
    const { version, items } = await seedVersion(scale.id, pool);
    // eslint-disable-next-line no-await-in-loop
    const ruleCount = await seedInterpretationRules(version);
    results.push({ pool, version, itemCount: items.length, ruleCount });
  }

  // Flip exactly one active version (adolescent), honoring the partial unique index.
  await client.query('UPDATE assessment_versions SET is_active = false');
  const activePool = results.find((r) => r.pool.isActive);
  await client.query('UPDATE assessment_versions SET is_active = true WHERE id = $1', [activePool.version.id]);

  console.log('Seed complete:'); // eslint-disable-line no-console
  console.log('  Response scale:', scale.version, 'scale_points =', scale.scale_points); // eslint-disable-line no-console
  for (const r of results) {
    console.log(`  ${r.version.version_label}: ${r.itemCount} items, ${r.ruleCount} interpretation rules, active=${r.pool.isActive}`); // eslint-disable-line no-console
  }
}

main()
  .catch((err) => {
    console.error(err); // eslint-disable-line no-console
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
