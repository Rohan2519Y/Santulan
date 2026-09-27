/*
 * One-time bootstrap (run by entrypoint.sh, only on a genuinely empty data directory, via mongosh from inside the same
 * container). Initiates the single-node replica set and creates santulan_migrator / santulan_runtime with NO data-model
 * roles yet - exactly the same starting point backend/scripts/mongo-local.js's init() creates for local dev. Roles are
 * granted afterwards by running the SAME migrations local dev uses (npm run db:migrate, from the "migrate" compose
 * service), so the data model and privilege set can never drift between the two setups. Passwords come from this
 * container's own environment (docker-compose.yml), never baked into the image.
 *
 * Ordering matters, and mirrors mongo-local.js exactly: MongoDB's localhost exception (an unauthenticated connection
 * may act, but ONLY while zero users exist anywhere, and ONLY for a createUser targeting the admin database) is
 * narrower than it sounds - it does not cover createRole, and does not cover createUser on any other database. So a
 * throwaway root user is created on admin first (the one thing the exception actually permits), used to authenticate,
 * do everything else with real auth, then dropped - nothing later ever needs it.
 *
 * The replica set member's own host MUST be the Compose service name ("mongo"), not 127.0.0.1: every client that
 * connects with replicaSet=rs0 in its URI (every OTHER container - backend, migrate) does topology discovery and then
 * reconnects to whatever host this config names. 127.0.0.1 only means "the mongo container itself" to the container
 * that first resolved it - to every other container it means itself, so it would try to connect to its own port 27017.
 */
rs.initiate({ _id: 'rs0', members: [{ _id: 0, host: 'mongo:27017' }] });

let ready = false;
for (let i = 0; i < 60 && !ready; i += 1) {
  ready = db.hello().isWritablePrimary;
  if (!ready) sleep(1000);
}
if (!ready) {
  print('bootstrap.js: replica set did not become primary in time');
  quit(1);
}

const migratorPw = process.env.SANTULAN_MIGRATOR_PASSWORD;
const runtimePw = process.env.SANTULAN_RUNTIME_PASSWORD;
if (!migratorPw || !runtimePw) {
  print('bootstrap.js: SANTULAN_MIGRATOR_PASSWORD and SANTULAN_RUNTIME_PASSWORD must both be set');
  quit(1);
}

// Step 1 (localhost exception): a throwaway root user, on admin - the one createUser the exception actually permits.
const bootstrapPw = migratorPw + '-bootstrap'; // never reused, never printed, dropped at the end of this script
db.getSiblingDB('admin').createUser({ user: 'docker_bootstrap', pwd: bootstrapPw, roles: [{ role: 'root', db: 'admin' }] });

// Step 2: authenticate as that user on THIS connection. The exception no longer applies to anything after this line.
db.getSiblingDB('admin').auth('docker_bootstrap', bootstrapPw);

// Step 3: same reason as mongo-local.js - scripts/tests may target scratch-named databases the migrator has never
// seen before, and some operations (counting a research VIEW) resolve view definitions via that database's own
// system.views, which no ordinary any-database privilege set covers.
db.createRole({
  role: 'santulan_migrator_system_views',
  privileges: [{ resource: { db: '', collection: 'system.views' }, actions: ['find', 'listCollections', 'collStats'] }],
  roles: [],
});

const santulanDb = db.getSiblingDB('santulan');
santulanDb.createUser({
  user: 'santulan_migrator',
  pwd: migratorPw,
  roles: [
    { role: 'dbOwner', db: 'santulan' },
    { role: 'root', db: 'admin' },
    { role: 'santulan_migrator_system_views', db: 'admin' },
  ],
});
santulanDb.createUser({ user: 'santulan_runtime', pwd: runtimePw, roles: [] });

// Step 4: drop the throwaway - santulan_migrator already has root, nothing later ever needs docker_bootstrap.
db.getSiblingDB('admin').dropUser('docker_bootstrap');

print('bootstrap.js: replica set initiated; santulan_migrator and santulan_runtime created (no data-model roles yet).');
