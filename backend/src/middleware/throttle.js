/*
 * OPEN-registration abuse throttle (BUILD 09 §7, research R-13): per-IP and per-device limits, SEPARATE from the OTP
 * throttle inside the identity provider. Limits come from configuration (never hard-coded). The default store is an
 * in-memory sliding window - acceptable for development only; production needs a shared store behind ThrottleStore.
 * Institutional sign-in, roster import and admin routes are NOT behind this middleware.
 */
const crypto = require('crypto');
const { HttpError } = require('../errors');

/*
 * ThrottleStore interface (the extension point mentioned above): any object with a same-signature `hit(key, windowMs,
 * now?)` method works here - `createRegistrationThrottle(limits, store)` takes one as its second argument. To scale past
 * one process, write a store backed by Redis (INCR + PEXPIRE, or a sorted set for a true sliding window) implementing
 * this same method and pass it in; nothing else in this file or its callers needs to change. `MemoryThrottleStore` below
 * is the default and remains correct for a single process.
 */
class MemoryThrottleStore {
  constructor() { this.hits = new Map(); }

  /** Returns the number of hits currently inside the window. */
  count(key, windowMs, now = Date.now()) {
    const cutoff = now - windowMs;
    const list = (this.hits.get(key) || []).filter((t) => t > cutoff);
    if (list.length) this.hits.set(key, list);
    else this.hits.delete(key);
    return list.length;
  }

  /** Records a hit and returns how many hits fall inside the window (including this one). */
  hit(key, windowMs, now = Date.now()) {
    const cutoff = now - windowMs;
    const list = (this.hits.get(key) || []).filter((t) => t > cutoff);
    list.push(now);
    this.hits.set(key, list);
    return list.length;
  }

  clear(key) { this.hits.delete(key); }
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

function createLoginThrottle({ windowSeconds, maxPerIp, maxPerSubject }, store = new MemoryThrottleStore()) {
  const windowMs = windowSeconds * 1000;

  return function loginThrottle(req, res, next) {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    const subject = String(req.body?.subject || '').trim().toLowerCase();
    const ipKey = `login:ip:${ip}`;
    const subjectKey = subject ? `login:subject:${subject}` : null;
    const blocked = store.count(ipKey, windowMs) >= maxPerIp
      || (subjectKey && store.count(subjectKey, windowMs) >= maxPerSubject);

    if (blocked) {
      res.setHeader('Retry-After', String(windowSeconds));
      return next(new HttpError(429, 'TOO_MANY_REQUESTS', 'Too many sign-in attempts. Please try again later.'));
    }

    req.loginThrottle = {
      fail() {
        store.hit(ipKey, windowMs);
        if (subjectKey) store.hit(subjectKey, windowMs);
      },
      succeed() {
        if (subjectKey) store.clear(subjectKey);
      },
    };
    return next();
  };
}

module.exports = { createRegistrationThrottle, createLoginThrottle, MemoryThrottleStore };
