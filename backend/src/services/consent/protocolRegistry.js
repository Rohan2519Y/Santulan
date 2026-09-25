/*
 * Approved consent protocols (BUILD 04 §5-§6). The frozen schema has no consent-content table and the project has no
 * approved legal copy, so approved protocol versions come from governed configuration: a JSON file at
 * CONSENT_PROTOCOLS_PATH holding [{ protocolVersion, consentType, contentHash, allowedVerificationMethods: [code, ...] }].
 * A missing, unreadable, empty or malformed file approves NOTHING (fail closed). No legal wording lives here.
 */
const fs = require('fs');
const config = require('../../config');
const { HttpError } = require('../../errors');

const TYPES = new Set(['PARENT_GUARDIAN_CONSENT', 'STUDENT_ASSENT', 'ADULT_SELF_CONSENT']);
const METHOD_CODE = /^[A-Z][A-Z0-9_]{1,63}$/;

let cache = { path: null, mtimeMs: -1, entries: [] };

function load(path = config.consentProtocolsPath) {
  if (!path) return [];
  try {
    const { mtimeMs } = fs.statSync(path);
    if (cache.path === path && cache.mtimeMs === mtimeMs) return cache.entries;
    const parsed = JSON.parse(fs.readFileSync(path, 'utf8'));
    const entries = (Array.isArray(parsed) ? parsed : []).filter((e) => e
      && typeof e.protocolVersion === 'string' && e.protocolVersion.trim() !== ''
      && TYPES.has(e.consentType)
      && typeof e.contentHash === 'string' && /^[a-f0-9]{64}$/i.test(e.contentHash)
      && Array.isArray(e.allowedVerificationMethods) && e.allowedVerificationMethods.every((m) => METHOD_CODE.test(m)));
    cache = { path, mtimeMs, entries };
    return entries;
  } catch (err) {
    return [];
  }
}

/** Returns the approved protocol for (version, type) or throws PROTOCOL_UNAPPROVED. */
function requireApproved(protocolVersion, consentType, path) {
  const found = load(path).find((e) => e.protocolVersion === protocolVersion && e.consentType === consentType);
  if (!found) throw new HttpError(422, 'PROTOCOL_UNAPPROVED', 'That consent protocol version is not approved');
  return found;
}

/** A method is accepted only if it is an approved CODE for the protocol; contact details, OTPs and free text never are. */
function requireApprovedMethod(protocol, method) {
  const looksSensitive = typeof method !== 'string' || /@|[0-9]{6}|\+?[0-9][0-9 ()-]{7,}/.test(method) || !METHOD_CODE.test(method);
  if (looksSensitive || !protocol.allowedVerificationMethods.includes(method)) {
    throw new HttpError(422, 'VALIDATION_ERROR', 'verificationMethod must be an approved method code for the protocol');
  }
}

/** The approved protocol version for a consent type (the first entry on file), or throws PROTOCOL_UNAPPROVED if none is configured. */
function currentApprovedVersion(consentType, path) {
  const found = load(path).find((e) => e.consentType === consentType);
  if (!found) throw new HttpError(422, 'PROTOCOL_UNAPPROVED', `No approved protocol is configured for ${consentType}`);
  return found.protocolVersion;
}

module.exports = { requireApproved, requireApprovedMethod, currentApprovedVersion };
