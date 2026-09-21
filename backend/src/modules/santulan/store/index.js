/* Public surface of the store. Everything outside store/ talks to the database only through this module. */
const client = require('./client');
const dal = require('./dal');
const scope = require('./scope');
const tx = require('./transactions');
const errors = require('./errors');
const naming = require('./naming');

module.exports = {
  withScope: dal.withScope,
  ...scope,
  assertStoreReady: client.assertStoreReady,
  health: client.health,
  closeClient: client.closeClient,
  transition: tx.transition,
  mapStoreError: errors.mapStoreError,
  camel: naming.camel,
  camelList: naming.camelList,
};
