/*
 * Start-up safety checks (audit gap G-14): the shipped defaults must not run a real deployment. Called once by server.js before
 * anything listens; a failure stops the process with every problem listed. It is a pure function of (env, config) so it can be tested.
 *
 *  - APP_ENV must be set on purpose (development | test | staging | production). A missing value used to fall back to
 *    "development", which silently turned on the dev login and the code/link logging.
 *  - Outside development and test (that is staging and production) the JWT secret must be set explicitly, at least 32 characters and
 *    not one of the known placeholder values, and the internal API key must be set (at least 24 characters).
 *  - In development and test the same weaknesses are only reported as warnings, so local work is not blocked.
 */
const KNOWN_ENVS = ['development', 'test', 'staging', 'production'];
const PLACEHOLDER_SECRETS = ['dev-secret-change-me', 'change-me-in-production', 'change-me', 'changeme', 'secret'];
const MIN_JWT_SECRET = 32;
const MIN_INTERNAL_KEY = 24;

/** @returns {{ errors: string[], warnings: string[] }} */
function checkConfig(env, config) {
  const errors = []; const warnings = [];
  const explicit = (env.APP_ENV || '').trim();
  if (!explicit) errors.push('APP_ENV is not set. Set it to development, test, staging or production (it is no longer assumed).');
  else if (!KNOWN_ENVS.includes(explicit)) errors.push(`APP_ENV "${explicit}" is not one of ${KNOWN_ENVS.join(', ')}.`);

  const strict = Boolean(explicit) && !['development', 'test'].includes(explicit); // staging, production, or anything unrecognised
  const sink = strict ? errors : warnings;
  const secret = env.JWT_SECRET || '';
  if (!secret) sink.push('JWT_SECRET is not set (the built-in placeholder would be used).');
  else if (PLACEHOLDER_SECRETS.includes(secret.trim().toLowerCase())) sink.push('JWT_SECRET is a known placeholder value.');
  else if (secret.length < MIN_JWT_SECRET) sink.push(`JWT_SECRET is shorter than ${MIN_JWT_SECRET} characters.`);
  if (!config.internalApiKey) sink.push('INTERNAL_API_KEY is empty, so the internal worker endpoints are unusable.');
  else if (config.internalApiKey.length < MIN_INTERNAL_KEY) sink.push(`INTERNAL_API_KEY is shorter than ${MIN_INTERNAL_KEY} characters.`);
  if (explicit === 'production' && config.identityProvider === 'dev') errors.push('IDENTITY_PROVIDER is "dev" in production. Supply the managed identity provider.');
  return { errors, warnings };
}

/** Throws one Error listing every problem; returns the warnings for the caller to log. */
function assertSafeConfig(env, config) {
  const { errors, warnings } = checkConfig(env, config);
  if (errors.length) throw new Error(`Unsafe configuration - refusing to start:\n - ${errors.join('\n - ')}`);
  return warnings;
}

module.exports = { checkConfig, assertSafeConfig, PLACEHOLDER_SECRETS, MIN_JWT_SECRET, MIN_INTERNAL_KEY };
