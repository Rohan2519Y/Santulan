/*
 * T033 — the normalized catalog files are exactly what the BUILD 02 workbook generates, are internally consistent, and
 * differ from the on-disk v3_0 workbooks only in the four documented subdomain codes per form.
 */
const fs = require('fs');
const path = require('path');
const { buildFiles } = require('../../../scripts/catalog-generate-csv');
const { runOfflineVerify } = require('../../../scripts/catalog-offline-verify');
const { crossCheckV30, EXPECTED_SUBDOMAIN_CODE_DIFFS } = require('../../../scripts/lib/v30CrossCheck');
const { loadCatalogFiles, verifyCatalog, SEED_DIR, itemId } = require('../../../src/modules/santulan/catalog/catalogFiles');

describe('catalog CSV generation (T033, T-B02-001…008)', () => {
  test('regenerating from the workbook is byte-identical to the committed files (UTF-8, LF, no BOM)', () => {
    const files = buildFiles();
    expect(Object.keys(files).sort()).toEqual([
      'MANIFEST.json', 'adolescent_items_v3_1.csv', 'assessment_catalog_v3_1.csv', 'canonical_subdomain_reference_v3_1.csv',
      'emergingadult_items_v3_1.csv', 'response_scale_v3_1.json',
    ]);
    for (const [name, content] of Object.entries(files)) {
      const onDisk = fs.readFileSync(path.join(SEED_DIR, name));
      expect(onDisk.toString('utf8')).toBe(content);
      expect(onDisk.includes(Buffer.from('\r'))).toBe(false);                                   // LF only
      expect(onDisk.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))).toBe(false);        // no BOM
    }
  });

  test('the en dash in age bands is preserved and item text is untouched', () => {
    const f = loadCatalogFiles();
    const all = Object.values(f.items).flat();
    expect(new Set(all.map((r) => r.age_band))).toEqual(new Set(['13–25', '13–17', '18–25']));
    expect(all.find((r) => r.item_code === 'C1-02' && r.version_label.includes('adolescent')).item_text).toBe("I can usually tell when I'm starting to get tired.");
  });

  test('every offline check passes (counts, uniqueness, contiguity, coverage, legality, hashes, cross-check)', () => {
    const checks = runOfflineVerify();
    expect(checks.length).toBeGreaterThanOrEqual(40);
    expect(checks.filter((c) => c.result !== 'PASS')).toEqual([]);
  });

  test('each corruption is detected and named by item_code, never by dumping the bank', () => {
    const base = loadCatalogFiles();
    const clone = () => ({ ...base, items: Object.fromEntries(Object.entries(base.items).map(([k, v]) => [k, v.map((r) => ({ ...r }))])), subdomains: base.subdomains.map((s) => ({ ...s })), catalog: base.catalog.map((c) => ({ ...c })) });
    const failing = (files) => verifyCatalog(files).filter((c) => c.result === 'FAIL');
    const adol = 'santulan-adolescent-pilot-v3.1';

    const dup = clone(); dup.items[adol][5].item_code = dup.items[adol][4].item_code;
    expect(failing(dup).map((c) => c.name)).toContain('[adolescent] item_code unique');

    const gap = clone(); gap.items[adol][10].display_order = '99';
    const gapFail = failing(gap).find((c) => c.name.includes('display_order'));
    expect(gapFail.detail).toContain(gap.items[adol][10].item_code);

    const c46 = clone(); c46.items[adol][0].subdomain_code = 'C4.6';
    expect(failing(c46).length).toBeGreaterThan(0);

    const missing = clone(); missing.items[adol].pop();
    expect(failing(missing).map((c) => c.name)).toContain('[adolescent] 175 rows');

    const opened = clone(); opened.catalog[0].participation_state = 'OPEN';
    expect(failing(opened).map((c) => c.name)).toContain('versions are DRAFT / CLOSED and the scale is DRAFT');

    const keyed = clone(); keyed.items[adol][3].keying = 'REVERSE';
    expect(failing(keyed).map((c) => c.name)).toContain('[adolescent] keying POSITIVE only');

    const tampered = clone(); tampered.bytes = { ...base.bytes, 'adolescent_items_v3_1.csv': Buffer.from('x') };
    expect(failing(tampered).map((c) => c.name)).toContain('manifest hash adolescent_items_v3_1.csv');
  });

  test('the v3_0 cross-check finds exactly 4 differing rows per form, only in subdomain_code', () => {
    const diffs = crossCheckV30();
    for (const form of ['adolescent', 'emergingadult']) {
      expect(diffs[form].map((d) => d.item_code)).toEqual(EXPECTED_SUBDOMAIN_CODE_DIFFS[form]);
      expect(diffs[form].every((d) => d.fields.join() === 'subdomain_code')).toBe(true);
    }
  });

  test('item ids are deterministic UUIDv5 values derived from version id and item code (D-08)', () => {
    const f = loadCatalogFiles();
    const vid = f.catalog[0].assessment_version_id;
    expect(itemId(f.manifest, vid, 'C1-01')).toBe(itemId(f.manifest, vid, 'C1-01'));
    expect(itemId(f.manifest, vid, 'C1-01')).not.toBe(itemId(f.manifest, f.catalog[1].assessment_version_id, 'C1-01'));
    expect(itemId(f.manifest, vid, 'C1-01')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
