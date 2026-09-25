/*
 * Identity provider selection. The dev adapter is refused in production: real deployments must supply the managed
 * provider (spec 005 D-17 / BUILD 00 §7).
 */
const config = require('../../config');
const { createDevProvider } = require('./devProvider');

let provider = null;

function getProvider() {
  if (provider) return provider;
  if (config.identityProvider === 'dev') {
    if (config.env === 'production') throw new Error('The dev identity provider must not be used in production');
    provider = createDevProvider({
      log: (channel, code) => { if (config.env === 'development') console.log(`[dev identity] OTP for ${channel}: ${code}`); }, // eslint-disable-line no-console
    });
    return provider;
  }
  throw new Error(`Unsupported IDENTITY_PROVIDER "${config.identityProvider}" (supply the managed provider adapter)`);
}

module.exports = { getProvider };
