/*
 * Release-switch endpoints (contracts/api-delta.md section 1b), active SUPER_ADMIN only. The switches are read and changed only
 * here (no deployment, no restart, no frontend-local toggle). Every change is audited in the same transaction.
 */
const { z } = require('zod');
const { HttpError } = require('../errors');
const store = require('../models/db');
const { strictObject } = require('../middleware/http');
const flags = require('../services/domain/releaseFlags');

const setSchema = strictObject({ value: z.boolean(), reason: z.string().trim().min(3).max(300) });

const wrap = (fn) => async (req, res, next) => { try { res.json(await fn(req)); } catch (err) { next(err); } };

const shape = (f) => ({ value: f.value, changedAt: f.changedAt, ...(f.changedBy ? { changedBy: f.changedBy } : {}), ...(f.reason ? { reason: f.reason } : {}) });

module.exports = {
  setSchema,
  list: wrap(async (req) => store.withScope(store.superAdminScope(req.actor.adminUserId), async (tx) => {
    const all = await flags.getFlags(tx);
    return Object.fromEntries(flags.FLAGS.map((f) => [f, shape(all[f])]));
  })),
  set: wrap(async (req) => {
    const flag = req.params.flag;
    if (!flags.isFlag(flag)) throw new HttpError(404, 'NOT_FOUND', 'Unknown release switch');
    return store.withScope(store.superAdminScope(req.actor.adminUserId), async (tx) => {
      const changed = await flags.setFlag(tx, flag, req.body.value, req.body.reason, { adminUserId: req.actor.adminUserId, correlationId: req.correlationId });
      return { flag, ...shape(changed) };
    }, { transaction: true });
  }),
};
