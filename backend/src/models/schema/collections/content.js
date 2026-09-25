/*
 * Assessment content collections (BUILD 01 section 6.6-6.16 as changed by CR-006; data-model section 3).
 * `response_scales` is retired (CR-006-3): the answer options are embedded in each question (`items.options`).
 */
const E = require('../enums');
const D = require('../dsl');

const { uuid, str, int, bool, date, obj, hex64, collection, isNull, notNull, implies, eq, inList, and, or } = D;

const assessmentVersions = collection('assessment_versions', 'B', {
  version_label: str({ pattern: '^[a-z0-9][a-z0-9._-]{2,63}$' }),
  revision: int({ min: 1 }),
  configuration: str({ enum: E.TRACK }),
  participant_min_age: int({ min: 13, max: 25 }),
  participant_max_age: int({ min: 13, max: 25 }),
  content_hash: hex64(),
  source_file_hash: hex64(),
  frozen_at: date({ nullable: true }),
  status: str({ enum: E.CONTENT_STATUS }),
  participation_state: str({ enum: E.PARTICIPATION_STATE }),
  created_at: date(),
}, [
  { $lte: ['$participant_min_age', '$participant_max_age'] },
  // assessment_configuration_age_ck
  or(
    and(eq('$configuration', 'ADOLESCENT'), eq('$participant_min_age', 13), eq('$participant_max_age', 17)),
    and(eq('$configuration', 'EMERGING_ADULT'), eq('$participant_min_age', 18), eq('$participant_max_age', 25)),
  ),
  implies(eq('$status', 'FROZEN'), notNull('$frozen_at')), // assessment_frozen_ck
  implies(eq('$participation_state', 'OPEN'), eq('$status', 'FROZEN')), // an open set must be frozen
]);

const subdomainDomainOk = {
  $or: [
    { $and: [{ $eq: ['$domain_code', 'C7'] }, { $regexMatch: { input: '$subdomain_code', regex: '^C7[ABC]\\.' } }] },
    { $and: [{ $ne: ['$domain_code', 'C7'] }, { $regexMatch: { input: '$subdomain_code', regex: { $concat: ['^', '$domain_code', '\\.'] } } }] },
  ],
};

const optionSchema = {
  bsonType: 'object',
  required: ['position', 'text'],
  additionalProperties: false,
  properties: {
    position: { bsonType: ['int', 'long'], minimum: 1, maximum: 20 },
    text: { bsonType: 'string', minLength: 1, maxLength: 200 },
  },
};

const items = collection('items', 'A', {
  assessment_version_id: uuid(),
  item_code: str({ pattern: '^C[1-7]-[0-9]{2}$' }),
  domain_code: str({ enum: E.DOMAIN }),
  subdomain_code: str({ enum: E.SUBDOMAIN }),
  subdomain_name: str({ nonblank: true }),
  item_text: str({ nonblank: true, maxLength: 500 }),
  keying: str({ enum: E.KEYING }),
  age_band: str({ enum: E.AGE_BAND }),
  context: str({ enum: E.CONTEXT }),
  layer: str({ enum: E.ITEM_LAYER }),
  pilot_status: str({ nonblank: true }),
  display_order: int({ min: 1 }),
  status: str({ enum: E.ITEM_STATUS }),
  item_content_hash: hex64(),
  created_at: date(),
  options: { bsonType: 'array', minItems: 2, maxItems: 20, items: optionSchema },
}, [
  subdomainDomainOk, // item_subdomain_domain_ck
  // option texts distinct; positions run 1..n in order (CR-006-2)
  { $eq: [{ $size: { $setUnion: ['$options.text', []] } }, { $size: '$options' }] },
  { $eq: ['$options.position', { $range: [1, { $add: [{ $size: '$options' }, 1] }] }] },
]);

const interpretationRules = collection('interpretation_rules', 'B', {
  assessment_version_id: uuid(),
  domain_code: str({ enum: E.DOMAIN }),
  developmental_band: str({ enum: E.BAND, nullable: true }),
  evidence_state: str({ enum: E.EVIDENCE }),
  locale: str({ nonblank: true }),
  layer: str({ enum: E.RULE_LAYER }),
  rule_code: str({ nonblank: true }),
  approved_text_template: str({ nonblank: true }),
  version: str({ nonblank: true }),
  status: str({ enum: E.CONTROLLED_STATUS }),
  created_at: date(),
});

const developmentActions = collection('development_actions', 'B', {
  action_code: str({ nonblank: true }),
  library_version: str({ nonblank: true }),
  domain_code: str({ enum: E.DOMAIN }),
  subdomain_code: str({ enum: E.SUBDOMAIN }),
  progression_level: str({ enum: E.PROGRESSION }),
  action_text: str({ nonblank: true }),
  age_band: str({ nonblank: true }),
  action_type: str({ nullable: true }),
  duration_minutes: int({ min: 0, nullable: true }),
  practice_window: str({ nullable: true }),
  evidence_status: str({ nonblank: true }),
  control_flags: obj(),
  active: bool(),
  created_at: date(),
}, [subdomainDomainOk]);

const reflectionPrompts = collection('reflection_prompts', 'B', {
  prompt_code: str({ nonblank: true }),
  domain_code: str({ enum: E.DOMAIN }),
  subdomain_code: str({ enum: E.SUBDOMAIN, nullable: true }),
  prompt_text: str({ nonblank: true }),
  age_band: str({ nonblank: true }),
  sequence: int({ min: 1 }),
  version: str({ nonblank: true }),
  status: str({ enum: E.CONTROLLED_STATUS }),
  created_at: date(),
}, [or(isNull('$subdomain_code'), subdomainDomainOk)]);

module.exports = [assessmentVersions, items, interpretationRules, developmentActions, reflectionPrompts];
