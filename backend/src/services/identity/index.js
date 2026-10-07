/*
 * Identity provider selection. The dev adapter is refused in production: real deployments must supply the managed
 * provider (spec 005 D-17 / BUILD 00 §7).
 */
const config = require('../../config');
const logger = require('../../utils/logger');
const { createDevProvider } = require('./devProvider');
const { createKeycloakProvider } = require('./keycloakProvider');
const mailer = require('../mail/mailer');

let provider = null;

function getProvider() {
  if (provider) return provider;
  if (config.identityProvider === 'dev') {
    if (config.env === 'production') throw new Error('The dev identity provider must not be used in production');
    provider = createDevProvider({
      // Codes and reset links are secrets (G-14): they are logged only when APP_ENV is explicitly "development" AND real email is not
      // configured, so a local developer without a mailer can still proceed. With the mailer on, or in any other environment, nothing is logged.
      log: (channel, value) => { if (config.env === 'development' && !mailer.isConfigured()) logger.info({ channel, devSecret: value }, '[dev identity] code/link (local development only)'); },
    });
    return provider;
  }
  if (config.identityProvider === 'keycloak') {
    provider = createKeycloakProvider();
    return provider;
  }
  throw new Error(`Unsupported IDENTITY_PROVIDER "${config.identityProvider}" (supply the managed provider adapter)`);
}

module.exports = { getProvider };
