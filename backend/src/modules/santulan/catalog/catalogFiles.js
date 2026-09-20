/*
 * Reads and verifies the normalized catalog files (contracts/catalog-import.md §2-§4, mode "verify"). Pure file work:
 * no database, no participant data. Failure messages name the item_code and field, never the item bank itself.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v5: uuidv5 } = require('uuid');

const SEED_DIR = path.join(__dirname, '..', '..', '..', '..', 'seeders', 'santulan');
// pilot_status is stored verbatim (contracts/catalog-import.md §3): the READY-family labels keep their full source wording
const POST_PILOT = 'READY — POST-PILOT PRIORITY';
const FIRST_DRAFT = 'READY — FIRST DRAFT (prioritise in Gate 2)';
const FORMS = {
  'santulan-adolescent-pilot-v3.1': {
    key: 'adolescent', file: 'adolescent_items_v3_1.csv', items: 175, domains: { C1: 24, C2: 24, C3: 24, C4: 10, C5: 14, C6: 20, C7: 59 },
    ageBands: { '13–25': 124, '13–17': 51 }, contexts: { General: 123, School: 50, Digital: 2 },
    pilot: { READY: 152, [POST_PILOT]: 21, [FIRST_DRAFT]: 2 },
  },
  'santulan-emergingadult-pilot-v3.1': {
    key: 'emergingadult', file: 'emergingadult_items_v3_1.csv', items: 171, domains: { C1: 23, C2: 21, C3: 24, C4: 10, C5: 14, C6: 20, C7: 59 },
    ageBands: { '13–25': 124, '18–25': 47 }, contexts: { General: 123, 'College/Work': 46, Digital: 2 },
    pilot: { READY: 146, [POST_PILOT]: 23, [FIRST_DRAFT]: 2 },
  },
};
const HEX64 = /^[a-f0-9]{64}$/i;

const parseCsv = (text) => {
  const out = []; let row = []; let field = ''; let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = false; } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { row.push(field); field = ''; } else if (ch === '\n') { row.push(field); out.push(row); row = []; field = ''; } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); out.push(row); }
  const [header, ...body] = out;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
};

/** Loads every catalog file from `dir`; hashes are computed over the raw bytes. */
function loadCatalogFiles(dir = SEED_DIR) {
  const read = (name) => fs.readFileSync(path.join(dir, name));
  const manifest = JSON.parse(read('MANIFEST.json').toString('utf8'));
  const bytes = {};
  for (const name of Object.keys(manifest.files)) bytes[name] = read(name);
  const text = (name) => bytes[name].toString('utf8');
  const items = {};
  for (const [label, form] of Object.entries(FORMS)) items[label] = parseCsv(text(form.file));
  return {
    dir, manifest, bytes,
    manifestSha256: crypto.createHash('sha256').update(read('MANIFEST.json')).digest('hex'),
    catalog: parseCsv(text('assessment_catalog_v3_1.csv')),
    items,
    subdomains: parseCsv(text('canonical_subdomain_reference_v3_1.csv')),
    scale: JSON.parse(text('response_scale_v3_1.json')),
  };
}

const tally = (list, key) => list.reduce((acc, r) => { acc[r[key]] = (acc[r[key]] || 0) + 1; return acc; }, {});
const sameCounts = (actual, expected) => JSON.stringify(Object.entries(actual).sort()) === JSON.stringify(Object.entries(expected).sort());

/** The deterministic item_id of a row (decision D-08). */
const itemId = (manifest, versionId, itemCode) => uuidv5(`${versionId}:${itemCode}`, manifest.itemIdNamespace);

/** Runs every offline check; returns [{ name, result: 'PASS'|'FAIL', detail? }]. Never throws on a data problem. */
function verifyCatalog(files) {
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, result: ok ? 'PASS' : 'FAIL', ...(ok || !detail ? {} : { detail }) });
  const firstBad = (list, pred) => list.find((r) => !pred(r));

  for (const [name, hash] of Object.entries(files.manifest.files)) {
    check(`manifest hash ${name}`, crypto.createHash('sha256').update(files.bytes[name]).digest('hex') === hash, `${name} differs from MANIFEST.json`);
  }
  check('catalog has the two frozen forms', files.catalog.length === 2 && files.catalog.every((c) => FORMS[c.version_label]), 'unexpected catalog rows');
  check('versions are DRAFT / CLOSED and the scale is DRAFT',
    files.catalog.every((c) => c.status === 'DRAFT' && c.participation_state === 'CLOSED') && files.scale.status === 'DRAFT',
    'a version or the scale is not in its fail-closed state');
  check('catalog references the candidate scale', files.catalog.every((c) => c.response_scale_version === files.scale.version), 'response scale version mismatch');
  check('content hashes are 64 hex characters', files.catalog.every((c) => HEX64.test(c.content_hash) && HEX64.test(c.source_file_hash)), 'catalog hash format');

  const refByCode = new Map(files.subdomains.map((s) => [s.subdomain_code, s]));
  check('72 canonical subdomains', files.subdomains.length === 72 && refByCode.size === 72, `found ${files.subdomains.length}`);
  check('no C4.6; C4 only C4.1-C4.5; C5 only C5.1-C5.7',
    !refByCode.has('C4.6') && [...refByCode.keys()].filter((c) => c.startsWith('C4.')).length === 5 && [...refByCode.keys()].filter((c) => c.startsWith('C5.')).length === 7,
    'canonical subdomain list is not the v3.1 list');
  const domainNames = {};
  const domainNameOk = Object.values(files.items).flat().every((r) => (domainNames[r.domain_code] = domainNames[r.domain_code] || r.domain_name) === r.domain_name);
  check('seven domains with one name each', domainNameOk && Object.keys(domainNames).length === 7, 'domain dictionary is inconsistent');

  for (const [label, form] of Object.entries(FORMS)) {
    const list = files.items[label];
    const id = `[${form.key}]`;
    check(`${id} ${form.items} rows`, list.length === form.items, `found ${list.length}`);
    check(`${id} item_code unique`, new Set(list.map((r) => r.item_code)).size === list.length, 'duplicate item_code');
    const gap = list.find((r, i) => Number(r.display_order) !== i + 1);
    check(`${id} display_order contiguous 1..N`, !gap, gap && `gap at ${gap.item_code}`);
    const bad = (pred) => { const r = firstBad(list, pred); return r ? `${r.item_code}` : undefined; };
    check(`${id} version label on every row`, !bad((r) => r.version_label === label), bad((r) => r.version_label === label));
    check(`${id} 72 subdomains covered`, new Set(list.map((r) => r.subdomain_code)).size === 72, 'subdomain coverage');
    check(`${id} subdomain codes are canonical and named`, !bad((r) => refByCode.has(r.subdomain_code) && refByCode.get(r.subdomain_code).subdomain_name === r.subdomain_name && refByCode.get(r.subdomain_code).domain_code === r.domain_code), bad((r) => refByCode.has(r.subdomain_code) && refByCode.get(r.subdomain_code).subdomain_name === r.subdomain_name && refByCode.get(r.subdomain_code).domain_code === r.domain_code));
    check(`${id} no C4.6 and no C5 item on a C4 subdomain`, !bad((r) => r.subdomain_code !== 'C4.6' && !(r.domain_code === 'C5' && !r.subdomain_code.startsWith('C5.'))), bad((r) => r.subdomain_code !== 'C4.6'));
    check(`${id} keying POSITIVE only`, !bad((r) => r.source_keying === 'Positive' && r.keying === 'POSITIVE'), bad((r) => r.keying === 'POSITIVE'));
    check(`${id} layer CORE only`, !bad((r) => r.layer === 'CORE'), bad((r) => r.layer === 'CORE'));
    check(`${id} item_content_hash is 64 hex`, !bad((r) => HEX64.test(r.item_content_hash)), bad((r) => HEX64.test(r.item_content_hash)));
    check(`${id} item_text is non-empty`, !bad((r) => r.item_text.length > 0), bad((r) => r.item_text.length > 0));
    check(`${id} domain counts`, sameCounts(tally(list, 'domain_code'), form.domains), JSON.stringify(tally(list, 'domain_code')));
    check(`${id} age-band split`, sameCounts(tally(list, 'age_band'), form.ageBands), JSON.stringify(tally(list, 'age_band')));
    check(`${id} context split`, sameCounts(tally(list, 'context'), form.contexts), JSON.stringify(tally(list, 'context')));
    check(`${id} pilot status split`, sameCounts(tally(list, 'pilot_status'), form.pilot), JSON.stringify(tally(list, 'pilot_status')));
  }

  const [a, b] = Object.keys(FORMS).map((l) => new Map(files.items[l].map((r) => [r.item_code, r])));
  const shared = [...a.keys()].filter((c) => b.has(c));
  check('124 shared item codes with identical text and subdomain',
    shared.length === 124 && shared.every((c) => a.get(c).item_text === b.get(c).item_text && a.get(c).subdomain_code === b.get(c).subdomain_code), `shared: ${shared.length}`);
  check('222 unique item codes across both forms', new Set([...a.keys(), ...b.keys()]).size === 222, 'combined count');
  return checks;
}

module.exports = { SEED_DIR, FORMS, loadCatalogFiles, verifyCatalog, itemId, parseCsv };
