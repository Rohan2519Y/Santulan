/* snake_case document -> camelCase object (shallow, plus the given id name). The store keeps BUILD 01 snake_case field names. */
const toCamelKey = (key) => key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

/** camel(doc, 'participantId') renames `_id` to the entity's API id name. */
function camel(doc, idName = 'id') {
  if (!doc) return doc;
  const out = {};
  for (const [k, v] of Object.entries(doc)) out[k === '_id' ? idName : toCamelKey(k)] = v;
  return out;
}

const camelList = (docs, idName) => docs.map((d) => camel(d, idName));

module.exports = { camel, camelList, toCamelKey };
