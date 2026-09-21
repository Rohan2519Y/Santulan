/*
 * Jest custom reporter collecting canonical test evidence (T008).
 * A test contributes an evidence entry when its TITLE begins with the matrix id pattern
 *   ^(AT|RC|SEC|T03|T04|B05|B06|B07|B08|T-B02|AT-B00|G)-[0-9A-Z-]+  (G-nn = store guarantees, feature 006)
 * and its file lives under tests/santulan. Every matching test is written to
 * tests/santulan/evidence/register.json as { id, status, file, runAt }, merged with any existing
 * informational entries (e.g. the load-run in T089). Staging-only checks are recorded as
 * SKIPPED/NOT_EXECUTED by the suites themselves, never as PASS.
 */
const fs = require('fs');
const path = require('path');

const ID_PATTERN = /(AT|RC|SEC|T03|T04|B05|B06|B07|B08|T-B02|AT-B00|G)-[0-9A-Z-]+/;
const REGISTER = path.join(__dirname, 'register.json');

class EvidenceReporter {
  constructor(globalConfig) {
    this.globalConfig = globalConfig;
    this.entries = {};
  }

  onTestResult(test, testResult, aggregateResult) {
    if (!testResult.testFilePath || !testResult.testFilePath.replace(/\\/g, '/').includes('tests/santulan')) return;
    for (const t of testResult.testResults || []) {
      const m = t.fullName && t.fullName.match(ID_PATTERN);
      if (!m) continue;
      const status = t.status === 'passed' ? 'PASS' : t.status === 'failed' ? 'FAIL' : 'SKIPPED';
      const id = m[0];
      this.entries[id] = { id, status, file: testResult.testFilePath, runAt: new Date().toISOString() };
    }
  }

  onRunComplete(contexts, results) {
    let existing = {};
    try {
      existing = JSON.parse(fs.readFileSync(REGISTER, 'utf8'));
    } catch (err) { /* first run: no register yet */ }
    const merged = Object.assign({}, existing);
    for (const [id, entry] of Object.entries(this.entries)) merged[id] = entry;
    const pretty = `${JSON.stringify(merged, null, 2)}\n`;
    fs.writeFileSync(REGISTER, pretty);
    this.entryCount = Object.keys(this.entries).length;
  }

  print() {} // keep the default reporter's own output intact
}

module.exports = EvidenceReporter;