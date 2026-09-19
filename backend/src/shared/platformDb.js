const { Pool } = require('pg');
const config = require('../config');
const { camelRows } = require('./db');

/*
 * Platform-scope pool: connects as app_platform, the role that bypasses row-level security
 * (docs/SQL-Database-Schema.md section 4). Only for lookups that happen before a school is
 * known - today, the login lookup. Everything else uses shared/db.js (app_runtime).
 */
const pool = new Pool({ connectionString: config.platformDatabaseUrl });

async function query(text, params) {
  const result = await pool.query(text, params);
  return { rows: camelRows(result.rows), rowCount: result.rowCount };
}

module.exports = { pool, query };
