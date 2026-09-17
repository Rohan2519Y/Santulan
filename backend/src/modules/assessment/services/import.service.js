const XLSX = require('xlsx');
const prisma = require('../../../shared/prisma');
const { HttpError } = require('../../../shared/errors');
const { parseItemPoolRows, computeContentHash } = require('../utils/itemPoolParser');

const TOOL_BAND_BY_VERSION_LABEL = {
  'santulan-adolescent-pilot-v1.0': 'ADOLESCENT',
  'santulan-emergingadult-pilot-v1.0': 'EMERGING_ADULT',
};

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
    await prisma.contentImportRecord.create({
      data: {
        filename: originalFilename,
        versionLabel: versionLabel || 'unknown',
        importedById: adminUserId,
        status: 'rejected',
        errorSummary: JSON.stringify(errors).slice(0, 2000),
      },
    });
    throw new HttpError(422, 'ITEM_POOL_VALIDATION_FAILED', 'No valid rows found in the uploaded file', { errors });
  }

  const contentHash = computeContentHash(validItems);
  const existing = await prisma.assessmentVersion.findUnique({ where: { versionLabel } });

  if (existing && existing.contentHash === contentHash) {
    // No-op upsert on content/items (research.md §3) - but importing it is
    // still the admin's signal to make THIS version the live one.
    const activated = existing.isActive
      ? existing
      : await prisma.$transaction(async (tx) => {
          await tx.assessmentVersion.updateMany({ where: { isActive: true }, data: { isActive: false, status: 'RETIRED' } });
          return tx.assessmentVersion.update({ where: { id: existing.id }, data: { isActive: true, status: 'FROZEN' } });
        });
    await prisma.contentImportRecord.create({
      data: { filename: originalFilename, versionLabel, importedById: adminUserId, status: 'accepted', errorSummary: 'no-op: identical re-import' },
    });
    return { version: activated, itemCount: validItems.length, reimported: true };
  }

  if (existing && existing.status === 'FROZEN' && existing.contentHash !== contentHash) {
    await prisma.contentImportRecord.create({
      data: { filename: originalFilename, versionLabel, importedById: adminUserId, status: 'rejected', errorSummary: 'Version label already frozen with different content' },
    });
    throw new HttpError(422, 'ITEM_POOL_VALIDATION_FAILED', 'This version label is already frozen with different content; cut a new version label instead');
  }

  const result = await prisma.$transaction(async (tx) => {
    // Only the version actually being superseded as "live" is retired; other
    // frozen versions (a different label/tool pool untouched by this import)
    // keep their own status - RETIRED reflects "no longer the active
    // instrument", not "content invalidated" (FR-015: past submissions still
    // render their original frozen content unchanged).
    await tx.assessmentVersion.updateMany({ where: { isActive: true }, data: { isActive: false, status: 'RETIRED' } });

    const version = await tx.assessmentVersion.create({
      data: {
        versionLabel,
        responseScaleId,
        toolBand: TOOL_BAND_BY_VERSION_LABEL[versionLabel],
        sourceFile: originalFilename,
        contentHash,
        frozenAt: new Date(),
        status: 'FROZEN',
        isActive: true,
      },
    });

    await tx.item.createMany({
      data: validItems.map((item) => ({
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

    await tx.contentImportRecord.create({
      data: { filename: originalFilename, versionLabel, importedById: adminUserId, status: 'accepted' },
    });

    return version;
  });

  return { version: result, itemCount: validItems.length, reimported: false };
}

module.exports = { importItemPool };
