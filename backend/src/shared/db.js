const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({ connectionString: config.databaseUrl });

/** snake_case -> camelCase, one level (matches the flat rows this app selects). */
function toCamel(key) {
  return key.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());
}

function camelRow(row) {
  if (!row) return row;
  const out = {};
  for (const [key, value] of Object.entries(row)) {
    out[toCamel(key)] = value;
  }
  return out;
}

function camelRows(rows) {
  return rows.map(camelRow);
}

/** Runs a query against the pool (or a transaction client) and returns camelCased rows. */
async function query(executor, text, params) {
  const result = await executor.query(text, params);
  return { rows: camelRows(result.rows), rowCount: result.rowCount };
}

/** Top-level (non-transactional) query against the pool. */
async function poolQuery(text, params) {
  return query(pool, text, params);
}

/**
 * Runs `fn(tx)` inside a BEGIN/COMMIT transaction on a dedicated client from
 * the pool; `tx.query(text, params)` returns camelCased rows. Rolls back and
 * releases the client on any error.
 */
async function withTransaction(fn) {
  const client = await pool.connect();
  const tx = {
    query: (text, params) => query(client, text, params),
    raw: (text, params) => client.query(text, params),
  };
  try {
    await client.query('BEGIN');
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query: poolQuery, withTransaction, camelRow, camelRows };
