/*
 * Security event log for the store (database-contract section 6): a store error `Unauthorized (13)` means code tried something
 * the credential forbids. Entries never carry secrets, documents or stack traces. The last entries are kept in memory so
 * tests can assert on them; they are also written as one JSON line to the process log.
 */
const recent = [];
const LIMIT = 200;

function record(event) {
  const entry = { at: new Date().toISOString(), type: 'STORE_SECURITY', ...event };
  recent.push(entry);
  if (recent.length > LIMIT) recent.shift();
  if (process.env.APP_ENV !== 'test') console.warn(JSON.stringify(entry)); // eslint-disable-line no-console
  return entry;
}

module.exports = { record, recent: () => recent.slice(), clear: () => { recent.length = 0; } };
