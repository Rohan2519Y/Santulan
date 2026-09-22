/*
 * Repository cleanliness on the MongoDB store (T163; FR-002, FR-041, SC-001): no `pg` anywhere in the dependency graph, no
 * relational connection strings under the backend, the SQL-era artefacts deleted by T166 stay gone, not a single
 * `withCanonicalTx` reference remains, and the operator documentation no longer instructs anyone to install or use a
 * relational database (historical lines excepted).
 */
const fs = require('fs');
const path = require('path');

const BACKEND = path.resolve(__dirname, '..', '..', '..'); // backend/
const ROOT = path.resolve(BACKEND, '..'); // repository root

let pkg;
let lock;
beforeAll(() => {
  pkg = JSON.parse(fs.readFileSync(path.join(BACKEND, 'package.json'), 'utf8'));
  lock = JSON.parse(fs.readFileSync(path.join(BACKEND, 'package-lock.json'), 'utf8'));
});

describe('no SQL driver or connection strings remain (SC-001)', () => {
  test('pg is not a dependency in package.json', () => {
    for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
      if (pkg[section]) expect(pkg[section].pg).toBeUndefined();
    }
  });

  test('pg appears nowhere in package-lock.json', () => {
    const text = JSON.stringify(lock.packages || {}, null, 0);
    expect(/"(node_modules\/)?pg"/.test(text)).toBe(false);
    expect(JSON.stringify(lock.dependencies || {}).includes('"pg"')).toBe(false);
  });

  test('no npm script is left behind from the PostgreSQL era', () => {
    for (const name of Object.keys(pkg.scripts || {})) {
      expect(name.startsWith('legacy:')).toBe(false);
    }
    expect(Object.keys(pkg.scripts)).toContain('db:migrate');
    expect(Object.keys(pkg.scripts)).not.toContain('legacy:pg:migrate');
  });

  test('no DATABASE_URL variant is referenced anywhere under src, scripts, tests and .env.example', () => {
    const roots = ['src', 'scripts', 'tests'];
    // the verification files intentionally name the forbidden strings; they are the scan, not the scanned surface
    const SELF = ['/unit/repoClean.test.js', '/integration/setupFromScratch.test.js'];
    const files = roots.flatMap((d) => walk(path.join(BACKEND, d))).filter((p) => {
      const n = p.replace(/\\/g, '/');
      return !n.includes('register.postgresql') && !n.includes('register.json') && !SELF.some((s) => n.includes(s));
    });
    const example = path.join(BACKEND, '.env.example');
    const texts = [...files.map((p) => fs.readFileSync(p, 'utf8')), fs.existsSync(example) ? fs.readFileSync(example, 'utf8') : ''];
    const re = /\b(DATABASE_URL|RUNTIME_DATABASE_URL|PLATFORM_DATABASE_URL)\b/;
    for (const text of texts) expect(re.test(text)).toBe(false);
  });

  test('no require/import of pg or withCanonicalTx remains under the backend', () => {
    const files = walk(BACKEND).filter((p) => /\.(js|json|mjs|cjs)$/.test(p) && p.replace(/\\/g, '/').indexOf('/unit/repoClean.test.js') === -1);
    const re = /require\(['"]pg['"]\)|from ['"]pg['"]|withCanonicalTx/;
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8');
      expect(re.test(text)).toBe(false, `legacy reference in ${path.relative(BACKEND, file)}`);
    }
  });
});

describe('the removed SQL artefacts stay deleted (T166, FR-041)', () => {
  const DELETED = [
    'migrations',
    'scripts/migrate.js',
    'scripts/santulan-grant-roles.js',
    'scripts/santulan-scratch-db.js',
    'scripts/santulan-generate-seed-sql.js',
    'scripts/catalog-generate-csv.js',
    'scripts/catalog-offline-verify.js',
    'scripts/catalog-reconcile.js',
    'scripts/santulan-freeze.js',
    'scripts/dev-identity-setup.js',
    'scripts/lib/catalogSource.js',
    'scripts/lib/v30CrossCheck.js',
    'seeders/santulan/MANIFEST.json',
    'seeders/santulan/adolescent_items_v3_1.csv',
    'seeders/santulan/assessment_catalog_v3_1.csv',
    'seeders/santulan/emergingadult_items_v3_1.csv',
    'seeders/santulan/response_scale_v3_1.json',
    'seeders/santulan/canonical_subdomain_reference_v3_1.csv',
    'src/modules/santulan/catalog',
    'src/modules/santulan/context/canonicalTx.js',
    'src/modules/santulan/shared/dbErrors.js',
    'src/shared/db.js',
    'docker',
    'docker-compose.yml',
  ];
  test.each(DELETED)('%s does not exist', (rel) => {
    expect(fs.existsSync(path.join(BACKEND, rel))).toBe(false);
  });

  test('no stray SQL file exists outside the owner-kept backups directory', () => {
    const files = walk(BACKEND).filter((p) => /\.(sql|psql)$/.test(p) && !p.replace(/\\/g, '/').includes('/backups/'));
    expect(files).toEqual([]);
  });
});

describe('the operator documentation describes the document store (FR-002)', () => {
  const DOCS = [
    path.join(ROOT, 'README.md'),
    path.join(ROOT, 'SECURITY.md'),
    path.join(ROOT, 'FLOWCHART.md'),
    path.join(BACKEND, 'README.md'),
  ];
  const RELATIONAL = /\b(postgres|postgresql|psql\b|pg_dump|pg_restore)\b|DATABASE_URL|withCanonicalTx| knex\b|sequelize\b/i;

  test('none of the README/SECURITY/FLOWCHART lines instructs the reader to use a relational database (unless marked historical)', () => {
    for (const doc of DOCS) {
      expect(fs.existsSync(doc)).toBe(true, `missing ${doc}`);
      const lines = fs.readFileSync(doc, 'utf8').split(/\r?\n/);
      for (const line of lines) {
        if (RELATIONAL.test(line)) {
          const ok = line.includes('historical') || line.includes('superseded') || line.includes('MongoDB') || line.includes('006') || line.includes('removed');
          expect(ok).toBe(true, `${path.relative(ROOT, doc)}: unstale relational instruction: ${line.trim()}`);
        }
      }
    }
  });
});

function walk(dir) {
  const out = [];
  const read = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', '.git', 'coverage', 'backups'].includes(entry.name)) read(full);
      } else out.push(full);
    }
  };
  read(dir);
  return out;
}