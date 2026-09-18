const db = require('../../../shared/db');
const { toolBandFromAgeBand, ITEM_CONTEXT_TO_PARTICIPANT_CONTEXT, DOMAIN_CODES } = require('../constants');

function isItemEligible(item, participantProfile) {
  if (item.toolBand !== toolBandFromAgeBand(participantProfile.ageBand)) return false;
  if (item.context === 'General') return true;
  return ITEM_CONTEXT_TO_PARTICIPANT_CONTEXT[item.context] === participantProfile.context;
}

/**
 * FR-002/003: General/universal items always eligible; variant items only for
 * the matching context. Returns items grouped into the 7 domain sections in
 * the version's provided display_order.
 */
async function getEligibleItems(assessmentVersionId, participantProfile) {
  const { rows: items } = await db.query(
    `SELECT i.*, av.tool_band
     FROM items i
     JOIN assessment_versions av ON av.id = i.assessment_version_id
     WHERE i.assessment_version_id = $1 AND i.status = 'ACTIVE'
     ORDER BY i.display_order ASC`,
    [assessmentVersionId]
  );

  return items.filter((item) => isItemEligible(item, participantProfile));
}

async function getEligibleItemsGroupedByDomain(assessmentVersionId, participantProfile) {
  const eligible = await getEligibleItems(assessmentVersionId, participantProfile);
  const byDomain = new Map();
  for (const item of eligible) {
    if (!byDomain.has(item.domainCode)) {
      byDomain.set(item.domainCode, { domainCode: item.domainCode, domainName: item.domainName, items: [] });
    }
    byDomain.get(item.domainCode).items.push(item);
  }
  return DOMAIN_CODES.filter((code) => byDomain.has(code)).map((code) => byDomain.get(code));
}

module.exports = { isItemEligible, getEligibleItems, getEligibleItemsGroupedByDomain };
