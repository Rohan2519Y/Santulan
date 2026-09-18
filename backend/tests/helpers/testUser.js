const { randomUUID } = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../../src/shared/db');
const config = require('../../src/config');

async function createUserWithToken(role = 'participant') {
  const email = `${role}-${randomUUID()}@test.local`;
  const passwordHash = await bcrypt.hash('Test1234!', 4);
  const { rows } = await db.query('INSERT INTO users (id, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING *', [
    randomUUID(),
    email,
    passwordHash,
    role,
  ]);
  const user = rows[0];
  const token = jwt.sign({ sub: user.id, role: user.role, email: user.email }, config.jwtSecret, { expiresIn: '1h' });
  return { user, token };
}

async function getAdminToken() {
  const { rows } = await db.query('SELECT * FROM users WHERE email = $1', ['admin@santulan.local']);
  const admin = rows[0];
  if (!admin) throw new Error('Seed the database first: npm run db:seed');
  const token = jwt.sign({ sub: admin.id, role: admin.role, email: admin.email }, config.jwtSecret, { expiresIn: '1h' });
  return { user: admin, token };
}

module.exports = { createUserWithToken, getAdminToken };
