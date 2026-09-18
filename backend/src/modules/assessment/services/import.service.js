const { randomUUID } = require('crypto');
const XLSX = require('xlsx');
const db = require('../../../shared/db');
const { HttpError } = require('../../../shared/errors');
const { parseItemPoolRows, computeContentHash } = require('../utils/itemPoolParser');

const TOOL_BAND_BY_VERSION_LABEL = {
  'santulan-adolescent-pilot-v1.0': 'ADOLESCENT',
  'santulan-emergingadult-pilot-v1.0': 'EMERGING_ADULT',
};

const ITEM_COLUMNS = [
  'id',
  'assessment_version_id',
  'item_code',
  'domain_code',
  'subdomain_code',
  'domain_name',
  'subdomain_name',
  'item_text',
  'keying',
  'age_band',
  'context',
  'layer',
  'status',
  'display_order',
];

async function insertItems(tx, assessmentVersionId, validItems) {
  if (validItems.length === 0) return;

  const values = [];
  const placeholders = validItems.map((item, rowIndex) => {
    const rowValues = [
      randomUUID(),
      assessmentVersionId,
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
    ];
    values.push(...rowValues);
    const base = rowIndex * ITEM_COLUMNS.length;
    return `(${ITEM_COLUMNS.map((_, colIndex) => `$${base + colIndex + 1}`).join(', ')})`;
  });

  await tx.query(`INSERT INTO items (${ITEM_COLUMNS.join(', ')}) VALUES ${placeholders.join(', ')}`, values);
}

async function recordImport(executor, { filename, versionLabel, importedById, status, errorSummary = null }) {
  await executor.query(
    `INSERT INTO content_import_records (id, filename, version_label, imported_by, status, error_summary)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [randomUUID(), filename, versionLabel, importedById, status, errorSummary]
  );
}

/**
 * FR-013/SC-004: parse + validate the uploaded xlsx (contracts/item-pool-schema.md),
 * compute a content hash, and transactionally create a new FROZEN
 * AssessmentVersion + its items, flip it active, and retire the prior active
 * version. Re-importing an identical frozen version by its own label is a
 * no-op upsert (research.md §3) - it returns the existing version untouched.
 */
async function importItemPool({ buffer, originalFilename, adminUserId, responseScaleId }) {
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: 'buffer' });
  } catch (err) {
    throw new HttpError(415, 'INVALID_FILE_TYPE', 'File is not a readable .xlsx workbook');
  }

  const sheetName = workbook.SheetNames.includes('01_Items') ? '01_Items' : workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]);
  const { validItems, errors, versionLabel } = parseItemPoolRows(rows);

  if (validItems.length === 0) {
    await recordImport(db, {
      filename: originalFilename,
      versionLabel: versionLabel || 'unknown',
      importedById: adminUserId,
      status: 'rejected',
      errorSummary: JSON.stringify(errors).slice(0, 2000),
    });
    throw new HttpError(422, 'ITEM_POOL_VALIDATION_FAILED', 'No valid rows found in the uploaded file', { errors });
  }

  const contentHash = computeContentHash(validItems);
  const { rows: existingRows } = await db.query('SELECT * FROM assessment_versions WHERE version_label = $1', [versionLabel]);
  const existing = existingRows[0] || null;

  if (existing && existing.contentHash === contentHash) {
    // No-op upsert on content/items (research.md §3) - but importing it is
    // still the admin's signal to make THIS version the live one.
    let activated = existing;
    if (!existing.isActive) {
      activated = await db.withTransaction(async (tx) => {
        await tx.query(`UPDATE assessment_versions SET is_active = false, status = 'RETIRED' WHERE is_active = true`);
        const { rows: updatedRows } = await tx.query(
          `UPDATE assessment_versions SET is_active = true, status = 'FROZEN' WHERE id = $1 RETURNING *`,
          [existing.id]
        );
        return updatedRows[0];
      });
    }
    await recordImport(db, { filename: originalFilename, versionLabel, importedById: adminUserId, status: 'accepted', errorSummary: 'no-op: identical re-import' });
    return { version: activated, itemCount: validItems.length, reimported: true };
  }

  if (existing && existing.status === 'FROZEN' && existing.contentHash !== contentHash) {
    await recordImport(db, {
      filename: originalFilename,
      versionLabel,
      importedById: adminUserId,
      status: 'rejected',
      errorSummary: 'Version label already frozen with different content',
    });
    throw new HttpError(422, 'ITEM_POOL_VALIDATION_FAILED', 'This version label is already frozen with different content; cut a new version label instead');
  }

  const result = await db.withTransaction(async (tx) => {
    // Only the version actually being superseded as "live" is retired; other
    // frozen versions (a different label/tool pool untouched by this import)
    // keep their own status - RETIRED reflects "no longer the active
    // instrument", not "content invalidated" (FR-015: past submissions still
    // render their original frozen content unchanged).
    await tx.query(`UPDATE assessment_versions SET is_active = false, status = 'RETIRED' WHERE is_active = true`);

    const { rows: versionRows } = await tx.query(
      `INSERT INTO assessment_versions (id, version_label, response_scale_id, tool_band, source_file, content_hash, frozen_at, status, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'FROZEN', true)
       RETURNING *`,
      [randomUUID(), versionLabel, responseScaleId, TOOL_BAND_BY_VERSION_LABEL[versionLabel], originalFilename, contentHash, new Date()]
    );
    const version = versionRows[0];

    await insertItems(tx, version.id, validItems);
    await recordImport(tx, { filename: originalFilename, versionLabel, importedById: adminUserId, status: 'accepted' });

    return version;
  });

  return { version: result, itemCount: validItems.length, reimported: false };
}

module.exports = { importItemPool };
