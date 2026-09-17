const { randomUUID } = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../../src/shared/prisma');
const config = require('../../src/config');

async function createUserWithToken(role = 'participant') {
  const email = `${role}-${randomUUID()}@test.local`;
  const passwordHash = await bcrypt.hash('Test1234!', 4);
  const user = await prisma.user.create({ data: { email, passwordHash, role } });
  const token = jwt.sign({ sub: user.id, role: user.role, email: user.email }, config.jwtSecret, { expiresIn: '1h' });
  return { user, token };
}

async function getAdminToken() {
  const admin = await prisma.user.findUnique({ where: { email: 'admin@santulan.local' } });
  if (!admin) throw new Error('Seed the database first: npm run db:seed');
  const token = jwt.sign({ sub: admin.id, role: admin.role, email: admin.email }, config.jwtSecret, { expiresIn: '1h' });
  return { user: admin, token };
}

module.exports = { createUserWithToken, getAdminToken };
