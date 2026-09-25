/*
 * Scoped data-access layer (row-level-security replacement, database-contract section 5).
 *
 *   withScope(scope, async (tx) => { ... }, { transaction: true })
 *
 * `tx.c.<collection>` are ScopedCollection objects: every read ANDs the scope filter, every write checks the scope, updates
 * are limited to the fields named in access.js, and there is NO remove anywhere. No scope (or an unknown scope) means every
 * read returns nothing and every write is refused. Scope is passed explicitly per call - there is no module-level state, so
 * two interleaved requests can never see each other's scope (G-26). Repositories (store/repositories) are built on tx.c.
 */
const { getDb } = require('./client');
const { withTransaction } = require('./transactions');
const { mapStoreError } = require('./errors');
const { ACCESS, RESEARCH_VIEWS } = require('./access');
const { isScope, isPrivileged, SCOPES } = require('./scope');
const { HttpError } = require('../../errors');

const forbidden = (msg = 'Not permitted') => new HttpError(403, 'FORBIDDEN', msg);

/**
 * Tags a driver error with where it happened and rethrows it UNCHANGED: inside a transaction the driver must still see its
 * TransientTransactionError label to retry. The final mapping to HttpError happens at the withScope / withTransaction boundary.
 */
const tag = (err, collection, operation) => {
  if (err && typeof err === 'object' && !err.storeContext) err.storeContext = { collection, operation };
  return err;
};
const and = (...parts) => {
  const real = parts.filter((p) => p && Object.keys(p).length);
  if (!real.length) return {};
  return real.length === 1 ? real[0] : { $and: real };
};

/** Values an equality/$in filter on `field` selects, or null when the filter does not pin the field. */
function pinnedValues(filter, field) {
  const direct = filter && filter[field];
  if (typeof direct === 'string') return [direct];
  if (direct && typeof direct === 'object' && Array.isArray(direct.$in)) return direct.$in;
  if (filter && Array.isArray(filter.$and)) {
    for (const part of filter.$and) {
      const v = pinnedValues(part, field);
      if (v) return v;
    }
  }
  return null;
}

class ScopedCollection {
  constructor(ctx, name) {
    this.ctx = ctx;
    this.name = name;
    this.rule = ACCESS[name];
    if (!this.rule) throw new Error(`No access rule for collection ${name}`);
  }

  get scope() { return this.ctx.scope; }

  get col() { return this.ctx.db.collection(this.name); }

  opts(extra = {}) { return this.ctx.session ? { session: this.ctx.session, ...extra } : extra; }

  /** Scope filter for reads; `null` means nothing is visible. */
  async scopeFilter(userFilter = {}) {
    const s = this.scope;
    if (!isScope(s) || s.actorScope === SCOPES.NONE) return null;
    if (isPrivileged(s)) return {};
    const { kind, field } = this.rule;
    const participant = s.actorScope === SCOPES.PARTICIPANT;
    switch (kind) {
      case 'privileged': return null;
      case 'reference': return {};
      case 'participant': return participant ? { _id: s.participantId } : { institution_id: s.institutionId };
      case 'tenantSelf': return participant ? null : { _id: s.institutionId };
      case 'tenant': return participant ? null : { [field]: s.institutionId };
      case 'owned': {
        if (participant) return { [field]: s.participantId };
        const ids = await this.ctx.institutionParticipantIds();
        return { [field]: { $in: ids } };
      }
      case 'child': {
        const values = pinnedValues(userFilter, field);
        if (!values || !values.length) return null; // a non-privileged child read must pin its parent
        for (const v of values) {
          if (!(await this.ctx.canSee(this.rule.parent, v))) return null;
        }
        return participant && this.rule.participantFilter ? this.rule.participantFilter : {};
      }
      default: return null;
    }
  }

  async find(filter = {}, options = {}) {
    const scoped = await this.scopeFilter(filter);
    if (scoped === null) return [];
    let cursor = this.col.find(and(filter, scoped), this.opts());
    if (options.projection) cursor = cursor.project(options.projection);
    if (options.sort) cursor = cursor.sort(options.sort);
    if (options.skip) cursor = cursor.skip(options.skip);
    if (options.limit) cursor = cursor.limit(options.limit);
    try { return await cursor.toArray(); } catch (e) { throw tag(e, this.name, 'find'); }
  }

  async findOne(filter = {}, options = {}) {
    const rows = await this.find(filter, { ...options, limit: 1 });
    return rows[0] || null;
  }

  async count(filter = {}) {
    const scoped = await this.scopeFilter(filter);
    if (scoped === null) return 0;
    try { return await this.col.countDocuments(and(filter, scoped), this.opts()); } catch (e) { throw tag(e, this.name, 'count'); }
  }

  async exists(id) { return (await this.count({ _id: id })) > 0; }

  /** Write gate: the scope must be allowed to write this document into this collection. */
  async assertWritable(doc) {
    const s = this.scope;
    if (!isScope(s) || s.actorScope === SCOPES.NONE) throw forbidden('No scope');
    if (this.rule.anyoneMayInsert) return;
    if (isPrivileged(s)) return;
    if (s.actorScope !== SCOPES.PARTICIPANT || this.rule.writeBy === 'privileged') throw forbidden();
    const { kind, field } = this.rule;
    if (kind === 'owned' && doc[field] === s.participantId) return;
    if (kind === 'participant' && doc._id === s.participantId) return;
    if (kind === 'child' && (await this.ctx.canSee(this.rule.parent, doc[field]))) return;
    throw forbidden();
  }

  async insertOne(doc) {
    await this.assertWritable(doc);
    try { await this.col.insertOne(doc, this.opts()); } catch (e) { throw tag(e, this.name, 'insert'); }
    return doc;
  }

  async insertMany(docs) {
    for (const d of docs) await this.assertWritable(d);
    if (!docs.length) return docs;
    try { await this.col.insertMany(docs, this.opts({ ordered: true })); } catch (e) { throw tag(e, this.name, 'insert'); }
    return docs;
  }

  /** Update fields named in `access.js` only. Returns { matched, modified }. There is no upsert and no replace. */
  async updateOne(filter, update) {
    const s = this.scope;
    if (!isScope(s) || s.actorScope === SCOPES.NONE) throw forbidden('No scope');
    const allowed = this.rule.update;
    if (!allowed) throw forbidden(`${this.name} is append-only`);
    if (!isPrivileged(s) && this.rule.kind === 'privileged') throw forbidden();
    for (const [op, body] of Object.entries(update)) {
      if (op !== '$set' && op !== '$inc') throw forbidden(`Update operator ${op} is not permitted`);
      for (const f of Object.keys(body)) if (!allowed.includes(f)) throw forbidden(`Field ${f} of ${this.name} cannot be updated`);
    }
    const scoped = await this.scopeFilter(filter);
    if (scoped === null) return { matched: 0, modified: 0 };
    if (!isPrivileged(s) && this.rule.kind === 'reference') throw forbidden();
    try {
      const r = await this.col.updateOne(and(filter, scoped), update, this.opts());
      return { matched: r.matchedCount, modified: r.modifiedCount };
    } catch (e) { throw tag(e, this.name, 'update'); }
  }

  /** Compare-and-set: `from` is the required current state (e.g. { status: 'PAUSED' }). True when one document changed. */
  async transition(id, from, patch, extra = {}) {
    const update = { $set: patch, ...extra };
    const r = await this.updateOne({ _id: id, ...from }, update);
    return r.modified === 1;
  }

  /** Aggregation for privileged scopes only (monitoring, exports). */
  async aggregate(pipeline) {
    if (!isPrivileged(this.scope)) throw forbidden();
    try { return await this.col.aggregate(pipeline, this.opts()).toArray(); } catch (e) { throw tag(e, this.name, 'aggregate'); }
  }
}

class ReadOnlyView {
  constructor(ctx, name) { this.ctx = ctx; this.name = name; }

  async find(filter = {}, options = {}) {
    if (!isPrivileged(this.ctx.scope)) return [];
    let cursor = this.ctx.db.collection(this.name).find(filter, this.ctx.session ? { session: this.ctx.session } : {});
    if (options.sort) cursor = cursor.sort(options.sort);
    if (options.limit) cursor = cursor.limit(options.limit);
    try { return await cursor.toArray(); } catch (e) { throw tag(e, this.name, 'find'); }
  }

  /** Streams documents in batches (used by the research export; the caller never holds the full set in memory). */
  cursor(filter = {}) {
    if (!isPrivileged(this.ctx.scope)) throw forbidden();
    return this.ctx.db.collection(this.name).find(filter, this.ctx.session ? { session: this.ctx.session } : {}).batchSize(1000);
  }
}

class StoreContext {
  constructor(db, scope, session) {
    this.db = db;
    this.scope = scope;
    this.session = session || null;
    this.c = {};
    this.v = {};
    for (const name of Object.keys(ACCESS)) this.c[name] = new ScopedCollection(this, name);
    for (const name of RESEARCH_VIEWS) this.v[name] = new ReadOnlyView(this, name);
    this._instIds = null;
    this._repos = {};
  }

  /** Participant ids of the institution (institution scope only), cached per context. */
  async institutionParticipantIds() {
    if (this._instIds) return this._instIds;
    const s = this.scope;
    if (s.actorScope !== SCOPES.INSTITUTION_ADMIN || typeof s.institutionId !== 'string' || !s.institutionId) { this._instIds = []; return this._instIds; }
    const rows = await this.db.collection('participants').find({ institution_id: s.institutionId }, this.session ? { session: this.session, projection: { _id: 1 } } : { projection: { _id: 1 } }).toArray();
    this._instIds = rows.map((r) => r._id);
    return this._instIds;
  }

  /** Can this scope see the document `id` of `collection`? (used to authorise child reads and writes). */
  async canSee(collection, id) {
    if (typeof id !== 'string') return false;
    const s = this.scope;
    if (isPrivileged(s)) return true;
    const rule = ACCESS[collection];
    if (!rule) return false;
    if (rule.kind === 'child') {
      const doc = await this.db.collection(collection).findOne({ _id: id }, this.session ? { session: this.session, projection: { [rule.field]: 1 } } : { projection: { [rule.field]: 1 } });
      return !!doc && this.canSee(rule.parent, doc[rule.field]);
    }
    const scoped = await this.c[collection].scopeFilter({});
    if (scoped === null) return false;
    return (await this.db.collection(collection).countDocuments(and({ _id: id }, scoped), this.session ? { session: this.session } : {})) > 0;
  }

  /** Repository instances, built lazily on this context. */
  repo(name, factory) {
    if (!this._repos[name]) this._repos[name] = factory(this);
    return this._repos[name];
  }
}

async function withScope(scope, fn, { transaction = false } = {}) {
  const db = await getDb();
  try {
    if (!transaction) return await fn(new StoreContext(db, scope, null));
    return await withTransaction((session) => fn(new StoreContext(db, scope, session)));
  } catch (err) {
    throw mapStoreError(err);
  }
}

module.exports = { withScope, StoreContext, ScopedCollection, pinnedValues };
