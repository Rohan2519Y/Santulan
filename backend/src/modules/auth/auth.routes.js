const { Router } = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const prisma = require('../../shared/prisma');
const config = require('../../config');
const { validate } = require('../../shared/utils/validate');
const { HttpError } = require('../../shared/errors');

const router = Router();

// Minimal login endpoint. This project's "existing auth module" (research.md §7)
// is out of scope for this feature; this stub only issues the JWT Bearer tokens
// the assessment module's endpoints require.
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
      throw new HttpError(401, 'UNAUTHENTICATED', 'Invalid email or password');
    }
    const token = jwt.sign({ sub: user.id, role: user.role, email: user.email }, config.jwtSecret, {
      expiresIn: '12h',
    });
    res.json({ token, user: { id: user.id, email: user.email, role: user.role } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
