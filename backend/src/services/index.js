/*
 * Canonical Santulan module entry point (specs/005-v3-1-canonical-alignment).
 * The module composes one router for the canonical API; it only reads trusted server context
 * (never request input) and never accepts client-supplied scores, versions, Santulan IDs or ids.
 */
const createSantulanRouter = require('../routes/v1/santulan.routes');

module.exports = { createSantulanRouter };