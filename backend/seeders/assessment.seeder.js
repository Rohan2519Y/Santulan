/*
 * Seeds: ResponseScale (frozen 5-point Likert), both frozen AssessmentVersions
 * with their imported items (from the committed JSON fixtures under
 * seeders/seeds/), one admin User, and stem InterpretationRule rows.
 * Run via `npm run db:seed`.
 */
const path = require('path');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
require('dotenv').config();

const { computeContentHash, DOMAINS } = require('../src/modules/assessment/utils/itemPoolParser');
const { EVIDENCE_STATES, DEVELOPMENTAL_BANDS, buildStemTemplate } = require('../src/modules/assessment/engine/interpretationStems');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const SCORING_VERSION = 'scoring-v1.0';
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
  return prisma.responseScale.upsert({
    where: { version: RESPONSE_SCALE_VERSION },
    update: {},
    create: {
      version: RESPONSE_SCALE_VERSION,
      scalePoints: 5,
      anchorLabels: { 1: 'Almost never', 2: 'Rarely', 3: 'Sometimes', 4: 'Often', 5: 'Almost always' },
      keyingDefinition: { positive: 'higher is higher', reverse: 'higher raw value is lower construct standing' },
      frozenAt: new Date(),
      status: 'FROZEN',
    },
  });
}

async function seedAdminUser() {
  const email = 'admin@santulan.local';
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  const passwordHash = await bcrypt.hash('ChangeMe123!', 10);
  return prisma.user.create({ data: { email, passwordHash, role: 'admin' } });
}

async function seedVersion(responseScaleId, pool) {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const fixture = require(path.join(__dirname, pool.fixture.replace('../seeders/', '')));
  const contentHash = computeContentHash(fixture.items);

  const existing = await prisma.assessmentVersion.findUnique({ where: { versionLabel: fixture.versionLabel } });
  if (existing) {
    return { version: existing, items: await prisma.item.findMany({ where: { assessmentVersionId: existing.id } }) };
  }

  const version = await prisma.assessmentVersion.create({
    data: {
      versionLabel: fixture.versionLabel,
      responseScaleId,
      toolBand: pool.toolBand,
      sourceFile: fixture.sourceFile,
      contentHash,
      frozenAt: new Date(),
      status: 'FROZEN',
      isActive: false, // flipped after all versions exist, to respect the one-active partial index
    },
  });

  await prisma.item.createMany({
    data: fixture.items.map((item) => ({
      assessmentVersionId: version.id,
      itemCode: item.itemCode,
      domainCode: item.domainCode,
      subdomainCode: item.subdomainCode,
      domainName: item.domainName,
      subdomainName: item.subdomainName,
      itemText: item.itemText,
      keying: item.keying,
      ageBand: item.ageBand,
      context: item.context,
      layer: item.layer,
      status: item.status,
      displayOrder: item.displayOrder,
    })),
  });

  const items = await prisma.item.findMany({ where: { assessmentVersionId: version.id } });
  return { version, items };
}

async function seedInterpretationRules(version) {
  const domainCodes = Object.keys(DOMAINS);
  const rows = [];
  for (const domainCode of domainCodes) {
    for (const developmentalBand of DEVELOPMENTAL_BANDS) {
      for (const evidenceState of EVIDENCE_STATES) {
        rows.push({
          assessmentVersionId: version.id,
          domainCode,
          developmentalBand,
          evidenceState,
          locale: 'en',
          ruleCode: `${domainCode}-${developmentalBand}-${evidenceState}-en`,
          approvedTextTemplate: buildStemTemplate(domainCode, DOMAINS[domainCode], evidenceState),
          version: INTERPRETATION_RULE_VERSION,
          status: 'FROZEN',
        });
      }
    }
  }

  for (const row of rows) {
    await prisma.interpretationRule.upsert({
      where: {
        assessmentVersionId_domainCode_developmentalBand_evidenceState_locale: {
          assessmentVersionId: row.assessmentVersionId,
          domainCode: row.domainCode,
          developmentalBand: row.developmentalBand,
          evidenceState: row.evidenceState,
          locale: row.locale,
        },
      },
      update: {},
      create: row,
    });
  }
  return rows.length;
}

async function main() {
  const scale = await seedResponseScale();
  const admin = await seedAdminUser();

  const results = [];
  for (const pool of POOLS) {
    // eslint-disable-next-line no-await-in-loop
    const { version, items } = await seedVersion(scale.id, pool);
    // eslint-disable-next-line no-await-in-loop
    const ruleCount = await seedInterpretationRules(version);
    results.push({ pool, version, itemCount: items.length, ruleCount });
  }

  // Flip exactly one active version (adolescent), honoring the partial unique index.
  await prisma.assessmentVersion.updateMany({ data: { isActive: false }, where: {} });
  const activePool = results.find((r) => r.pool.isActive);
  await prisma.assessmentVersion.update({ where: { id: activePool.version.id }, data: { isActive: true } });

  console.log('Seed complete:'); // eslint-disable-line no-console
  console.log('  Admin user:', admin.email, '(password: ChangeMe123!)'); // eslint-disable-line no-console
  console.log('  Response scale:', scale.version, 'scale_points =', scale.scalePoints); // eslint-disable-line no-console
  for (const r of results) {
    console.log(`  ${r.version.versionLabel}: ${r.itemCount} items, ${r.ruleCount} interpretation rules, active=${r.pool.isActive}`); // eslint-disable-line no-console
  }
}

main()
  .catch((err) => {
    console.error(err); // eslint-disable-line no-console
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
