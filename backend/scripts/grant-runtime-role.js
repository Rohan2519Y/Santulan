/*
 * Runs after `prisma migrate deploy`: grants the non-superuser app_runtime
 * role (docker/init-app-role.sql, T053) privileges on whatever tables/sequences
 * exist right now. ALTER DEFAULT PRIVILEGES in the init script only covers
 * objects created AFTER it ran within the same session grant map; re-granting
 * explicitly here is what actually makes a fresh `db:migrate` usable by the
 * runtime role - safe to re-run any time (idempotent GRANTs).
 */
require('dotenv').config();
const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO app_runtime');
    await client.query('GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO app_runtime');
    console.log('Granted app_runtime privileges on all current tables/sequences.'); // eslint-disable-line no-console
  } catch (err) {
    if (err.code === '42704') {
      // role "app_runtime" does not exist - only true for a DB created before docker/init-app-role.sql existed
      console.warn('app_runtime role not found; recreate the postgres volume (docker compose down -v && up) to pick up docker/init-app-role.sql.'); // eslint-disable-line no-console
    } else {
      throw err;
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err); // eslint-disable-line no-console
  process.exitCode = 1;
});
