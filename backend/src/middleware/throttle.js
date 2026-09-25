/*
 * OPEN-registration abuse throttle (BUILD 09 §7, research R-13): per-IP and per-device limits, SEPARATE from the OTP
 * throttle inside the identity provider. Limits come from configuration (never hard-coded). The default store is an
 * in-memory sliding window - acceptable for development only; production needs a shared store behind ThrottleStore.
 * Institutional sign-in, roster import and admin routes are NOT behind this middleware.
 */
const crypto = require('crypto');
const { HttpError } = require('../errors');

class MemoryThrottleStore {
  constructor() { this.hits = new Map(); }

  /** Records a hit and returns how many hits fall inside the window (including this one). */
  hit(key, windowMs, now = Date.now()) {
    const cutoff = now - windowMs;
    const list = (this.hits.get(key) || []).filter((t) => t > cutoff);
    list.push(now);
    this.hits.set(key, list);
    return list.length;
  }
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map((p) => p.trim().split('=')).filter((p) => p[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
}

function createRegistrationThrottle({ windowSeconds, maxPerIp, maxPerDevice }, store = new MemoryThrottleStore()) {
  const windowMs = windowSeconds * 1000;
  return function registrationThrottle(req, res, next) {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    let device = parseCookies(req.headers.cookie).sn_device;
    if (!device || !/^[A-Za-z0-9_-]{16,64}$/.test(device)) {
      device = crypto.randomBytes(18).toString('base64url');
      res.append('Set-Cookie', `sn_device=${device}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
    }
    const byIp = store.hit(`ip:${ip}`, windowMs);
    const byDevice = store.hit(`dev:${device}`, windowMs);
    if (byIp > maxPerIp || byDevice > maxPerDevice) {
      res.setHeader('Retry-After', String(windowSeconds));
      return next(new HttpError(429, 'TOO_MANY_REQUESTS', 'Too many registration attempts. Please try again later.'));
    }
    return next();
  };
}

module.exports = { createRegistrationThrottle, MemoryThrottleStore };
