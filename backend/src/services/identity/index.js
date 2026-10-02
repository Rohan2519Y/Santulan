/*
 * Identity provider selection. The dev adapter is refused in production: real deployments must supply the managed
 * provider (spec 005 D-17 / BUILD 00 §7).
 */
const config = require('../../config');
const logger = require('../../utils/logger');
const { createDevProvider } = require('./devProvider');

let provider = null;

function getProvider() {
  if (provider) return provider;
  if (config.identityProvider === 'dev') {
    if (config.env === 'production') throw new Error('The dev identity provider must not be used in production');
    provider = createDevProvider({
      // logger.info (not debug): this must stay visible under the default log level, exactly as the console.log it replaces
      // was always visible - a local developer needs to see the OTP code or password-reset link to proceed without a
      // real email/SMS provider. Shared by requestOtp (code) and requestPasswordReset (link) - same reason, same gap.
      log: (channel, value) => { if (config.env === 'development') logger.info({ channel, value }, '[dev identity] code/link'); },
    });
    return provider;
  }
  throw new Error(`Unsupported IDENTITY_PROVIDER "${config.identityProvider}" (supply the managed provider adapter)`);
}

module.exports = { getProvider };
