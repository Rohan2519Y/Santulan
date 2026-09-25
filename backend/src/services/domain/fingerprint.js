/*
 * Report fingerprint (scoring-and-report contract section 9, CR-006-9): SHA-256 of the canonical JSON array of the ordered
 * section snapshots. Written in the same update that sets a terminal report state; `db-verify` recomputes it.
 */
const { canonicalJson, sha256 } = require('../questionsets/canonical');

function fingerprint(sections) {
  const ordered = [...sections]
    .sort((a, b) => (a.display_order !== undefined ? a.display_order : a.displayOrder) - (b.display_order !== undefined ? b.display_order : b.displayOrder))
    .map((s) => ({
      section_type: s.section_type !== undefined ? s.section_type : s.sectionType,
      domain_code: (s.domain_code !== undefined ? s.domain_code : s.domainCode) || null,
      content_version: s.content_version !== undefined ? s.content_version : s.contentVersion,
      locale: s.locale,
      display_order: s.display_order !== undefined ? s.display_order : s.displayOrder,
      content_snapshot: s.content_snapshot !== undefined ? s.content_snapshot : s.contentSnapshot,
    }));
  return sha256(canonicalJson(ordered));
}

module.exports = { fingerprint };
