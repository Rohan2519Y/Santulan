const crypto = require('crypto');

// Domain reference (contracts/item-pool-schema.md)
const DOMAINS = {
  C1: 'Body & Self-Regulation',
  C2: 'Emotional Capability',
  C3: 'Relational & Social Capability',
  C4: 'Identity & Self-Concept',
  C5: 'Values, Purpose & Future Agency',
  C6: 'Adaptability & Resilience',
  C7: 'Self-Directed Learning & Executive Capability',
};

const PILOT_VERSION_LABELS = new Set([
  'santulan-adolescent-pilot-v1.0',
  'santulan-emergingadult-pilot-v1.0',
]);

// Contract enums, extended to match the actual TECH_READY source files:
// the pools carry a `Digital` context (2 C3 items per pool, not in the
// original contract enum) and `status` values that start with "READY"
// but carry a post-pilot/gate qualifier suffix — both are frozen source
// data (docs/*.xlsx, source of truth per research.md) and must import as
// ACTIVE, not be rejected.
const VALID_CONTEXTS = new Set(['General', 'School', 'College/Work', 'Digital']);
const VALID_AGE_BANDS = new Set(['13–25', '13–18', '18–25']);
const VALID_LAYERS = new Set(['CORE', 'V', 'SJT', 'O']);

function isReadyStatus(status) {
  return typeof status === 'string' && status.trim().toUpperCase().startsWith('READY');
}

/**
 * Validates and normalizes raw item-pool rows (as returned by
 * `XLSX.utils.sheet_to_json`) per contracts/item-pool-schema.md.
 * Returns { validItems, errors, versionLabel }. Row-level errors are
 * collected with 1-based row numbers (row 1 = header, so data starts at row 2).
 */
function parseItemPoolRows(rows) {
  const errors = [];
  const validItems = [];
  const seenCodes = new Set();
  const seenOrders = new Set();
  let versionLabel = null;

  rows.forEach((row, idx) => {
    const rowNumber = idx + 2; // header is row 1
    const pushError = (column, message) => errors.push({ row: rowNumber, column, message });

    const itemCode = row.item_code != null ? String(row.item_code).trim() : '';
    if (!itemCode) {
      pushError('item_code', 'item_code is required');
      return;
    }
    if (seenCodes.has(itemCode)) {
      pushError('item_code', 'Duplicate item_code within file');
      return;
    }

    const assessmentVersion = row.assessment_version != null ? String(row.assessment_version).trim() : '';
    if (!PILOT_VERSION_LABELS.has(assessmentVersion)) {
      pushError('assessment_version', 'Unsupported version; expected one of the two pilot labels');
      return;
    }
    if (versionLabel && versionLabel !== assessmentVersion) {
      pushError('assessment_version', 'Adolescent and emerging-adult pools MUST NOT be mixed in one file');
      return;
    }

    const domainCode = row.domain_code != null ? String(row.domain_code).trim() : '';
    if (!DOMAINS[domainCode]) {
      pushError('domain_code', `Unknown domain code '${domainCode}'`);
      return;
    }

    const domainName = row.domain_name != null ? String(row.domain_name).trim() : '';
    const subdomainCode = row.subdomain_code != null ? String(row.subdomain_code).trim() : '';
    const subdomainName = row.subdomain_name != null ? String(row.subdomain_name).trim() : '';
    if (!subdomainCode) {
      pushError('subdomain_code', 'subdomain_code is required');
      return;
    }
    if (!subdomainName) {
      pushError('subdomain_name', 'subdomain_name is required');
      return;
    }

    const itemText = row.item_text != null ? String(row.item_text).trim() : '';
    if (!itemText) {
      pushError('item_text', 'Item text is required');
      return;
    }
    if (itemText.length > 500) {
      pushError('item_text', 'Item text exceeds 500 characters');
      return;
    }

    const keyingRaw = row.keying != null ? String(row.keying).trim().toUpperCase() : '';
    if (keyingRaw !== 'POSITIVE' && keyingRaw !== 'REVERSE') {
      pushError('keying', "keying must be 'Positive' or 'REVERSE'");
      return;
    }

    const ageBand = row.age_band != null ? String(row.age_band).trim() : '';
    if (!VALID_AGE_BANDS.has(ageBand)) {
      pushError('age_band', `Unknown age_band '${ageBand}'`);
      return;
    }

    const context = row.context != null ? String(row.context).trim() : '';
    if (!VALID_CONTEXTS.has(context)) {
      pushError('context', `Unknown context '${context}'`);
      return;
    }

    const layer = row.layer != null ? String(row.layer).trim().toUpperCase() : '';
    if (!VALID_LAYERS.has(layer)) {
      pushError('layer', `Unknown layer '${layer}'`);
      return;
    }

    const status = row.status != null ? String(row.status).trim() : '';
    if (!isReadyStatus(status)) {
      pushError('status', 'Item status must be READY to import');
      return;
    }

    const displayOrder = Number(row.display_order);
    if (!Number.isInteger(displayOrder) || displayOrder < 1) {
      pushError('display_order', 'display_order must be a positive integer');
      return;
    }
    if (seenOrders.has(displayOrder)) {
      pushError('display_order', 'Duplicate display_order within file');
      return;
    }

    seenCodes.add(itemCode);
    seenOrders.add(displayOrder);
    versionLabel = assessmentVersion;

    validItems.push({
      itemCode,
      domainCode,
      domainName: domainName || DOMAINS[domainCode],
      subdomainCode,
      subdomainName,
      itemText,
      keying: keyingRaw,
      ageBand,
      context,
      layer,
      status: 'ACTIVE',
      displayOrder,
    });
  });

  return { validItems, errors, versionLabel };
}

/**
 * Deterministic content hash over the normalized, sorted item set - used for
 * AssessmentVersion.content_hash integrity checks (data-model.md #2) and to
 * detect a byte-identical re-import of the same frozen version (research.md §3).
 */
function computeContentHash(validItems) {
  const sorted = [...validItems].sort((a, b) => a.itemCode.localeCompare(b.itemCode));
  const canonical = JSON.stringify(sorted);
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

module.exports = { DOMAINS, PILOT_VERSION_LABELS, parseItemPoolRows, computeContentHash, isReadyStatus };
