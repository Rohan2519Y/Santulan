/*
 * Canonical form and hashes of a question set (contracts/upload-format.md section 6).
 *   content_hash = SHA-256 of the canonical JSON of
 *     [ { item_code, domain_code, subdomain_code, item_text, keying, age_band, context, layer, display_order, options:[{position,text}] } ]
 *   sorted by display_order then item_code, keys sorted, UTF-8 - independent of column order, spacing and file bytes.
 * Item ids are UUIDv5 over `assessment_version_id:item_code`, so an identical re-upload yields identical ids.
 */
const crypto = require('crypto');
const { v5: uuidv5 } = require('uuid');

const ITEM_ID_NAMESPACE = 'a3f0f3c2-2a6c-4d3e-9d52-7c1f4b8e6a10'; // fixed; never change
const SET_ID_NAMESPACE = 'c9d2e8a1-51f4-4a7b-b2c3-3e6d9f0a1b24'; // fixed; never change

const sha256 = (input) => crypto.createHash('sha256').update(input, 'utf8').digest('hex');

/** JSON with recursively sorted object keys (arrays keep their order). */
function canonicalJson(value) {
  const sort = (v) => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sort(v[k])]));
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

/** Question view used for hashing; accepts stored item documents or parsed rows (snake_case). */
function canonicalQuestion(q) {
  return {
    item_code: q.item_code,
    domain_code: q.domain_code,
    subdomain_code: q.subdomain_code,
    item_text: q.item_text,
    keying: q.keying,
    age_band: q.age_band,
    context: q.context,
    layer: q.layer,
    display_order: q.display_order,
    options: [...q.options].sort((a, b) => a.position - b.position).map((o) => ({ position: o.position, text: o.text })),
  };
}

function canonicalQuestions(questions) {
  return questions
    .map(canonicalQuestion)
    .sort((a, b) => (a.display_order - b.display_order) || (a.item_code < b.item_code ? -1 : a.item_code > b.item_code ? 1 : 0));
}

const contentHash = (questions) => sha256(canonicalJson(canonicalQuestions(questions)));

/** item_content_hash covers the question text and its options. */
const itemContentHash = (q) => sha256(canonicalJson({ item_text: q.item_text, options: canonicalQuestion(q).options }));

const itemId = (versionId, itemCode) => uuidv5(`${versionId}:${itemCode}`, ITEM_ID_NAMESPACE);
const setId = (label, revision) => uuidv5(`${label}:${revision}`, SET_ID_NAMESPACE);
const fileHash = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

module.exports = { canonicalJson, canonicalQuestion, canonicalQuestions, contentHash, itemContentHash, itemId, setId, fileHash, sha256 };
