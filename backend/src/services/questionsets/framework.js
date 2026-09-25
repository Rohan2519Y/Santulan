/*
 * The canonical framework (seven domains, 72 subdomains) loaded from seeders/santulan/reference/framework.json - the only
 * framework source the upload validator reads (contracts/upload-format.md section 5).
 */
const framework = require('../../../seeders/santulan/reference/framework.json');

const DOMAIN_NAMES = Object.fromEntries(framework.domains.map((d) => [d.code, d.name]));
const SUBDOMAINS = new Map(framework.subdomains.map((s) => [s.code, s]));
const DOMAIN_CODES = framework.domains.map((d) => d.code);

const subdomain = (code) => SUBDOMAINS.get(code) || null;

/** True when the subdomain code exists and belongs to the domain. */
const subdomainBelongsToDomain = (domainCode, subdomainCode) => {
  const s = SUBDOMAINS.get(subdomainCode);
  return !!s && s.domain === domainCode;
};

module.exports = { DOMAIN_CODES, DOMAIN_NAMES, subdomain, subdomainBelongsToDomain };
