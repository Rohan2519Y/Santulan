/*
 * HTTP security headers and cache control (audit gaps G-45, G-43, G-37).
 *  - helmet: X-Content-Type-Options, X-Frame-Options (deny), Strict-Transport-Security, a locked-down Content-Security-Policy for the
 *    API, and Referrer-Policy: no-referrer so a link carrying a token never leaks through a Referer header. `x-powered-by` is removed.
 *  - Cache-Control: no-store on every API response: the API returns personal data, reports, PDFs and temporary credentials, none
 *    of which a browser or proxy may keep.
 * The API serves JSON and files only, so the CSP forbids everything (default-src 'none').
 */
const helmet = require('helmet');

const securityHeaders = () => helmet({
  contentSecurityPolicy: { useDefaults: false, directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'no-referrer' },
  crossOriginResourcePolicy: { policy: 'same-site' },
  hsts: { maxAge: 15552000, includeSubDomains: true },
});

const noStore = (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); };

module.exports = { securityHeaders, noStore };
