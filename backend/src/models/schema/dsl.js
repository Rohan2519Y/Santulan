/*
 * Tiny builder for MongoDB $jsonSchema validators (data-model section 1 / 4).
 * Conventions: _id is a UUID string; every declared field is required (a nullable field is present with value null);
 * undeclared fields are refused; enum values are listed explicitly. Same-document rules are added as $expr terms.
 */
const UUID_RE = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const HEX64_RE = '^[0-9a-f]{64}$';
const NONBLANK_RE = '\\S';

const withNull = (bson, nullable) => (nullable ? [bson, 'null'] : bson);

const uuid = (o = {}) => ({ bsonType: withNull('string', o.nullable), pattern: UUID_RE }); // pattern binds strings only, so null passes
const str = (o = {}) => {
  const s = { bsonType: withNull('string', o.nullable) };
  if (o.enum) s.enum = o.nullable ? [...o.enum, null] : o.enum;
  if (o.pattern) s.pattern = o.pattern;
  if (o.nonblank) s.pattern = NONBLANK_RE;
  if (o.minLength !== undefined) s.minLength = o.minLength;
  if (o.maxLength !== undefined) s.maxLength = o.maxLength;
  return s;
};
const int = (o = {}) => {
  const s = { bsonType: o.nullable ? ['int', 'long', 'null'] : ['int', 'long'] };
  if (o.min !== undefined) s.minimum = o.min;
  if (o.max !== undefined) s.maximum = o.max;
  return s;
};
const num = (o = {}) => {
  const s = { bsonType: o.nullable ? ['int', 'long', 'double', 'null'] : ['int', 'long', 'double'] };
  if (o.min !== undefined) s.minimum = o.min;
  if (o.max !== undefined) s.maximum = o.max;
  return s;
};
const bool = (o = {}) => ({ bsonType: withNull('bool', o.nullable) });
const date = (o = {}) => ({ bsonType: withNull('date', o.nullable) });
const obj = (o = {}) => ({ bsonType: withNull('object', o.nullable) });
const isoDate = (o = {}) => str({ nullable: o.nullable, pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' });
const hex64 = (o = {}) => str({ nullable: o.nullable, pattern: HEX64_RE });

/**
 * collection(name, tier, properties, exprs?) -> definition.
 * `properties` excludes _id (added automatically as a UUID string).
 */
function collection(name, tier, properties, exprs = [], extra = {}) {
  const props = { _id: uuid(), ...properties };
  const jsonSchema = {
    bsonType: 'object',
    required: Object.keys(props),
    additionalProperties: false,
    properties: props,
    ...extra,
  };
  const validator = exprs.length
    ? { $and: [{ $jsonSchema: jsonSchema }, ...exprs.map((e) => ({ $expr: e }))] }
    : { $jsonSchema: jsonSchema };
  return { name, tier, validator, fields: Object.keys(props) };
}

// $expr helpers -------------------------------------------------------------
const isNull = (f) => ({ $eq: [f, null] });
const notNull = (f) => ({ $ne: [f, null] });
/** a ⇒ b */
const implies = (a, b) => ({ $or: [{ $not: [a] }, b] });
const eq = (a, b) => ({ $eq: [a, b] });
const inList = (f, list) => ({ $in: [f, list] });
const and = (...t) => ({ $and: t });
const or = (...t) => ({ $or: t });
/** null-or-ordered: b is null OR a <= b (dates) */
const nullOrGte = (later, earlier) => ({ $or: [isNull(later), { $gte: [later, earlier] }] });

module.exports = {
  UUID_RE, HEX64_RE, NONBLANK_RE,
  uuid, str, int, num, bool, date, obj, isoDate, hex64,
  collection,
  isNull, notNull, implies, eq, inList, and, or, nullOrGte,
};
