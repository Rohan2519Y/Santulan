/*
 * Audit writer (BUILD 08 section 6). Ported to the store: writeAudit(tx, ...) inserts an audit_logs document inside the
 * CALLER'S transaction and throws AUDIT_UNAVAILABLE on any failure so the whole action aborts. Implementation lives in
 * store/repositories/audit.js.
 */
module.exports = require('../../models/repositories/audit');
