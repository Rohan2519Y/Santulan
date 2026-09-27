/*
 * 005 - re-grants the `santulan_runtime` role with its now-updated privilege set (schema/roles.js): `items` gains
 * `update`, the one Tier A exception, so a Super Admin can show/hide a question from participants (items.status).
 * Everything else about the role is unchanged. Same replace-the-role approach as 004 (roles are not user data, so
 * drop + recreate is safe and is what dbOwner can actually run). Records the bumped data-model version marker.
 */
const { ROLE_NAME, runtimePrivileges, DATA_MODEL_VERSION } = require('../../src/models/schema');

const USER_HOME_DB = 'santulan';

module.exports = {
  name: '005_items_status_role',
  async up(db, { client }) {
    const privileges = runtimePrivileges(db.databaseName);
    const info = await db.command({ rolesInfo: ROLE_NAME });
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
