/* Repository scan (G-27): only store/ touches the driver; nothing outside the legacy files uses pg; responses have one update path. */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', '..', '..', 'src');
const STORE_DIR = path.join(SRC, 'models', 'db') + path.sep;
const REPOS_DIR = path.join(SRC, 'models', 'repositories') + path.sep;
const isStore = (f) => f.startsWith(STORE_DIR) || f.startsWith(REPOS_DIR);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.js$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = walk(SRC);
const read = (f) => fs.readFileSync(f, 'utf8');
const rel = (f) => path.relative(SRC, f).replace(/\\/g, '/');

// PostgreSQL was removed completely (feature 006); nothing is allowed to require `pg`.
const LEGACY_PG = new Set();

describe('G-27 only the store touches the driver', () => {
  test('G-27 no file outside models/db/ or models/repositories/ requires mongodb', () => {
    const offenders = files.filter((f) => !isStore(f) && /require\(['"]mongodb['"]\)|from ['"]mongodb['"]/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  test('G-27 no file outside the store calls .collection( (a driver call)', () => {
    const offenders = files.filter((f) => !isStore(f) && /\.collection\(/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });

  test('G-27 no file outside the store uses the data-model schema or ObjectId', () => {
    const offenders = files.filter((f) => !isStore(f) && /ObjectId|MongoClient/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
  });
});

describe('no new relational code', () => {
  test('SEC-30 no file requires pg except the legacy files listed for removal in US7', () => {
    const offenders = files.filter((f) => /require\(['"]pg['"]\)/.test(read(f))).map(rel).filter((r) => !LEGACY_PG.has(r));
    expect(offenders).toEqual([]);
  });

  test('SEC-30 the migrator credential is never read by src/', () => {
    const offenders = files.filter((f) => /mongodbUriAdmin|MONGODB_URI_ADMIN/.test(read(f)) && rel(f) !== 'config/index.js').map(rel);
    expect(offenders).toEqual([]);
  });
});

describe('B08-055 responses have a single update path', () => {
  test('B08-055 only repositories/responses.js may update the responses collection, and only retireCurrent does', () => {
    const responsesRepo = path.join(REPOS_DIR, 'responses.js');
    const offenders = files.filter((f) => f !== responsesRepo && f !== path.join(STORE_DIR, 'dal.js') && /c\.responses\.(updateOne|transition)\(/.test(read(f))).map(rel);
    expect(offenders).toEqual([]);
    if (fs.existsSync(responsesRepo)) {
      const src = read(responsesRepo);
      const updates = src.match(/c\.responses\.(updateOne|transition)\(/g) || [];
      expect(updates.length).toBeLessThanOrEqual(1);
      if (updates.length === 1) expect(src).toMatch(/retireCurrent[\s\S]*c\.responses\.updateOne\(/);
    }
  });

  test('G-13 no repository exposes a remove or delete', () => {
    const offenders = files.filter((f) => isStore(f) && /\b(deleteOne|deleteMany|findOneAndDelete|bulkWrite|drop\()\b/.test(read(f)) && !/scripts/.test(f)).map(rel);
    expect(offenders).toEqual([]);
  });
});
