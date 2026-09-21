#!/usr/bin/env node
/**
 * Builds backend/seeders/santulan/reference/framework.json (feature 006, T039): the seven-domain dictionary and the
 * 72 canonical subdomain codes with names, from the BUILD 02 v3.1 reference CSV. Run once; the JSON is committed and is
 * the only framework source the upload validator and the collection validators read (the CSV is deleted in US7).
 */
const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '..', 'seeders', 'santulan', 'canonical_subdomain_reference_v3_1.csv');
const OUT = path.resolve(__dirname, '..', 'seeders', 'santulan', 'reference', 'framework.json');

const DOMAINS = {
  C1: 'Body & Self-Regulation',
  C2: 'Emotional Capability',
  C3: 'Relational & Social Capability',
  C4: 'Identity & Self-Concept',
  C5: 'Values, Purpose & Future Agency',
  C6: 'Adaptability & Resilience',
  C7: 'Self-Directed Learning & Executive Capability',
};

function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  const header = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const cells = [];
    let cur = '';
    let quoted = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') { cur += '"'; i += 1; } else if (ch === '"') quoted = false; else cur += ch;
      } else if (ch === '"') quoted = true;
      else if (ch === ',') { cells.push(cur); cur = ''; } else cur += ch;
    }
    cells.push(cur);
    return Object.fromEntries(header.map((h, i) => [h.trim(), (cells[i] || '').trim()]));
  });
}

function build() {
  const rows = parseCsv(fs.readFileSync(SRC, 'utf8'));
  const subdomains = rows.map((r) => ({ code: r.subdomain_code, domain: r.domain_code, name: r.subdomain_name }));
  return { version: 'v3.1', domains: Object.entries(DOMAINS).map(([code, name]) => ({ code, name })), subdomains };
}

if (require.main === module) {
  const map = build();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(map, null, 2)}\n`);
  console.log(`framework.json: ${map.domains.length} domains, ${map.subdomains.length} subdomains`);
}

module.exports = { build, DOMAINS };
