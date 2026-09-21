/* Start-up check (G-17): the API refuses to start unless it is the runtime user on a replica set at the expected data-model version. */
const H = require('../helpers/mongoHarness');

let client;

const freshStore = (env) => {
  jest.resetModules();
  Object.assign(process.env, env);
  return require('../../../src/modules/santulan/store/client');
};

const saved = { ...process.env };
afterEach(async () => {
  if (client) { await client.closeClient(); client = null; }
  Object.assign(process.env, saved);
  for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
});
afterAll(async () => { await H.closeAll(); });

describe('G-17 the API cannot start with the wrong credential or server', () => {
  test('G-17 the runtime credential on the replica set passes and reports the data-model version', async () => {
    client = freshStore({});
    const r = await client.assertStoreReady();
    expect(r).toMatchObject({ user: 'santulan_runtime', replicaSet: 'rs0' });
    expect((await client.health()).store).toBe('ok');
  });

  test('G-17 refuses when MONGODB_URI_RUNTIME is missing', async () => {
    client = freshStore({ MONGODB_URI_RUNTIME: '' });
    await expect(client.assertStoreReady()).rejects.toMatchObject({ status: 503, code: 'STORE_UNAVAILABLE' });
    expect((await client.health()).store).toBe('unavailable');
  });

  test('G-17 refuses the migrator credential', async () => {
    client = freshStore({ MONGODB_URI_RUNTIME: saved.MONGODB_URI_ADMIN });
    await expect(client.assertStoreReady()).rejects.toMatchObject({ code: 'STORE_UNAVAILABLE', message: expect.stringContaining('santulan_runtime') });
  });

  test('G-17 refuses a standalone server (the shared service on 27017 has no replica set)', async () => {
    client = freshStore({ MONGODB_URI_RUNTIME: 'mongodb://127.0.0.1:27017/santulan?directConnection=true' });
    await expect(client.assertStoreReady()).rejects.toMatchObject({ code: 'STORE_UNAVAILABLE' });
  });

  test('G-17 refuses when the data-model version marker differs from the code', async () => {
    const admin = await H.admin();
    const marker = await admin.collection('_data_migrations').findOne({ _id: 'dataModelVersion' });
    await admin.collection('_data_migrations').updateOne({ _id: 'dataModelVersion' }, { $set: { value: '000.0' } });
    try {
      client = freshStore({});
      await expect(client.assertStoreReady()).rejects.toMatchObject({ code: 'STORE_UNAVAILABLE', message: expect.stringContaining('Data-model version mismatch') });
    } finally {
      await admin.collection('_data_migrations').updateOne({ _id: 'dataModelVersion' }, { $set: { value: marker.value } });
    }
  });
});
