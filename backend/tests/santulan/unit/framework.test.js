const framework = require('../../../seeders/santulan/reference/framework.json');

describe('framework map (T039)', () => {
  test('seven domains C1..C7 in order', () => {
    expect(framework.domains.map((d) => d.code)).toEqual(['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C7']);
    expect(framework.domains[0].name).toBe('Body & Self-Regulation');
    expect(framework.domains[6].name).toBe('Self-Directed Learning & Executive Capability');
  });

  test('72 subdomain codes with a name and a valid domain', () => {
    expect(framework.subdomains).toHaveLength(72);
    const domains = new Set(framework.domains.map((d) => d.code));
    for (const s of framework.subdomains) {
      expect(domains.has(s.domain)).toBe(true);
      expect(s.name.length).toBeGreaterThan(0);
    }
    expect(new Set(framework.subdomains.map((s) => s.code)).size).toBe(72);
  });

  test('C4 has C4.1-C4.5 only (no C4.6); C5 has 7; C7 uses C7A/C7B/C7C', () => {
    const codes = framework.subdomains.map((s) => s.code);
    expect(codes.filter((c) => c.startsWith('C4.'))).toEqual(['C4.1', 'C4.2', 'C4.3', 'C4.4', 'C4.5']);
    expect(codes).not.toContain('C4.6');
    expect(codes.filter((c) => c.startsWith('C5.'))).toHaveLength(7);
    const c7 = framework.subdomains.filter((s) => s.domain === 'C7').map((s) => s.code);
    expect(c7.every((c) => /^C7[ABC]\.\d+$/.test(c))).toBe(true);
    expect(c7).toHaveLength(6 + 7 + 7);
    expect(codes).not.toContain('C7.1');
  });
});
