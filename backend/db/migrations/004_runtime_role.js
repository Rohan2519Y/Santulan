/*
 * 004 - role `santulan_runtime` (least privilege, database-contract section 2.1), granted to the user `santulan_runtime`
 * that `scripts/mongo-local.js init` created in the `santulan` database with no roles. Records the data-model version marker.
 */
const { ROLE_NAME, runtimePrivileges, DATA_MODEL_VERSION } = require('../../src/models/schema');

const USER_HOME_DB = 'santulan';

module.exports = {
  name: '004_runtime_role',
  async up(db, { client }) {
    const privileges = runtimePrivileges(db.databaseName);
    const info = await db.command({ rolesInfo: ROLE_NAME });
    // Roles live in admin.system.roles and survive a dropDatabase; replace (drop + create) rather than update, which dbOwner may not run.
    if (info.roles.length) await db.command({ dropRole: ROLE_NAME });
    await db.command({ createRole: ROLE_NAME, privileges, roles: [] });
    await client.db(USER_HOME_DB).command({
      grantRolesToUser: ROLE_NAME,
      roles: [{ role: ROLE_NAME, db: db.databaseName }],
    });
    await db.collection('_data_migrations').updateOne(
      { _id: 'dataModelVersion' },
      { $set: { value: DATA_MODEL_VERSION, updatedAt: new Date() } },
      { upsert: true },
    );
  },
};
