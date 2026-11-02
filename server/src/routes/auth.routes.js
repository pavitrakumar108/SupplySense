import { createHash, randomBytes, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { authenticate } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.service.js';
import { publicUserSelect, serializeUser } from '../services/user.service.js';
import { AppError } from '../utils/app-error.js';
import { asyncHandler } from '../utils/async-handler.js';
import { clearRefreshCookie, parseCookies, setRefreshCookie } from '../utils/cookies.js';
import { validate } from '../middleware/validate.js';
import { signAccessToken } from '../utils/jwt.js';
import { createdResponse, successResponse } from '../utils/response.js';

const emailSchema = z.string().trim().email().max(320).transform((value) => value.toLowerCase());
const passwordSchema = z.string().min(12).max(128);

const registerRequest = z.object({
  body: z.object({
    email: emailSchema,
    password: passwordSchema,
    fullName: z.string().trim().min(2).max(160),
  }),
});

const loginRequest = z.object({
  body: z.object({ email: emailSchema, password: passwordSchema }),
});

const emptyRequest = z.object({ body: z.object({}).optional() });

function hashRefreshToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function newRefreshToken() {
  return randomBytes(48).toString('base64url');
}

async function createRefreshSession(db, userId) {
  const token = newRefreshToken();
  await db.refreshToken.create({
    data: {
      userId,
      tokenHash: hashRefreshToken(token),
      expiresAt: new Date(Date.now() + env.JWT_REFRESH_TTL_SECONDS * 1000),
    },
  });
  return token;
}

async function issueTokens(db, user) {
  const refreshToken = await createRefreshSession(db, user.id);
  const accessToken = signAccessToken(
    { sub: user.id, jti: randomUUID() },
    env.JWT_ACCESS_SECRET,
    env.JWT_ACCESS_TTL_SECONDS,
  );
  return { accessToken, refreshToken, user: serializeUser(user) };
}

async function loadUserForToken(db, userId) {
  return db.user.findUnique({
    where: { id: userId },
    select: { ...publicUserSelect, passwordHash: true },
  });
}

async function loadUserByEmail(db, email) {
  return db.user.findUnique({
    where: { email },
    select: { ...publicUserSelect, passwordHash: true },
  });
}

function userHasRole(user, role) {
  return user.roles.some(({ role: assignedRole }) => assignedRole.code === role);
}

async function loginUser({ db, request, response, requiredRole }) {
  const { email, password } = request.validated.body;
  const user = await loadUserByEmail(db, email);
  const passwordMatches = user ? await bcrypt.compare(password, user.passwordHash) : false;

  if (!user || !user.isActive || !passwordMatches) {
    await writeAudit(db, {
      action: 'LOGIN_FAILURE',
      resourceType: 'USER',
      outcome: 'DENIED',
      correlationId: request.id,
      metadata: { email, requiredRole },
    });
    throw new AppError('Invalid email or password.', { statusCode: 401, code: 'INVALID_CREDENTIALS' });
  }

  if (requiredRole && !userHasRole(user, requiredRole)) {
    await writeAudit(db, {
      actorId: user.id,
      action: 'LOGIN_FAILURE',
      resourceType: 'USER',
      resourceId: user.id,
      outcome: 'DENIED',
      correlationId: request.id,
      metadata: { email, requiredRole, reason: 'ROLE_MISMATCH' },
    });
    throw new AppError(`This account does not have ${requiredRole.toLowerCase().replace('_', ' ')} access.`, { statusCode: 403, code: 'ROLE_MISMATCH' });
  }

  const tokens = await issueTokens(db, user);
  setRefreshCookie(response, tokens.refreshToken, { maxAge: env.JWT_REFRESH_TTL_SECONDS * 1000 });
  await writeAudit(db, {
    actorId: user.id,
    action: 'LOGIN_SUCCESS',
    resourceType: 'USER',
    resourceId: user.id,
    correlationId: request.id,
    metadata: { requiredRole },
  });
  return successResponse(request, response, { accessToken: tokens.accessToken, user: tokens.user });
}

export function createAuthRouter({ db }) {
  const router = Router();

  router.post('/register', validate(registerRequest), asyncHandler(async (request, response) => {
    const { email, password, fullName } = request.validated.body;
    const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new AppError('An account with this email already exists.', { statusCode: 409, code: 'EMAIL_ALREADY_EXISTS' });

    const user = await db.$transaction(async (tx) => {
      const customerRole = await tx.role.upsert({
        where: { code: 'CUSTOMER' },
        update: {},
        create: { code: 'CUSTOMER', name: 'CUSTOMER' },
      });
      const createdUser = await tx.user.create({
        data: {
          email,
          fullName,
          passwordHash: await bcrypt.hash(password, 12),
        },
      });
      await tx.userRole.create({ data: { userId: createdUser.id, roleId: customerRole.id } });
      await tx.cart.create({ data: { userId: createdUser.id } });
      await tx.wishlist.create({ data: { userId: createdUser.id } });
      return tx.user.findUnique({ where: { id: createdUser.id, }, select: publicUserSelect });
    });

    const tokens = await issueTokens(db, user);
    setRefreshCookie(response, tokens.refreshToken, { maxAge: env.JWT_REFRESH_TTL_SECONDS * 1000 });
    await writeAudit(db, {
      actorId: user.id,
      action: 'REGISTER',
      resourceType: 'USER',
      resourceId: user.id,
      correlationId: request.id,
      metadata: { role: 'CUSTOMER' },
    });
    return createdResponse(request, response, { accessToken: tokens.accessToken, user: tokens.user });
  }));

  router.post('/login', validate(loginRequest), asyncHandler((request, response) => loginUser({ db, request, response })));
  router.post('/customer/login', validate(loginRequest), asyncHandler((request, response) => loginUser({ db, request, response, requiredRole: 'CUSTOMER' })));
  router.post('/manager/login', validate(loginRequest), asyncHandler((request, response) => loginUser({ db, request, response, requiredRole: 'WAREHOUSE_MANAGER' })));

  router.post('/refresh', validate(emptyRequest), asyncHandler(async (request, response) => {
    const rawToken = parseCookies(request).refreshToken;
    if (!rawToken) throw new AppError('Refresh session required.', { statusCode: 401, code: 'UNAUTHORIZED' });

    const tokenHash = hashRefreshToken(rawToken);
    const stored = await db.refreshToken.findUnique({ where: { tokenHash } });
    if (!stored || stored.revokedAt || stored.expiresAt <= new Date()) {
      clearRefreshCookie(response);
      throw new AppError('Refresh session is invalid or expired.', { statusCode: 401, code: 'UNAUTHORIZED' });
    }

    const user = await loadUserForToken(db, stored.userId);
    if (!user || !user.isActive) {
      clearRefreshCookie(response);
      throw new AppError('Refresh session is invalid or expired.', { statusCode: 401, code: 'UNAUTHORIZED' });
    }

    const tokens = await db.$transaction(async (tx) => {
      await tx.refreshToken.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
      const nextRefreshToken = newRefreshToken();
      await tx.refreshToken.create({
        data: {
          userId: user.id,
          tokenHash: hashRefreshToken(nextRefreshToken),
          expiresAt: new Date(Date.now() + env.JWT_REFRESH_TTL_SECONDS * 1000),
        },
      });
      return {
        accessToken: signAccessToken({ sub: user.id, jti: randomUUID() }, env.JWT_ACCESS_SECRET, env.JWT_ACCESS_TTL_SECONDS),
        refreshToken: nextRefreshToken,
      };
    });
    setRefreshCookie(response, tokens.refreshToken, { maxAge: env.JWT_REFRESH_TTL_SECONDS * 1000 });
    await writeAudit(db, {
      actorId: user.id,
      action: 'REFRESH_TOKEN_ROTATED',
      resourceType: 'REFRESH_SESSION',
      resourceId: stored.id,
      correlationId: request.id,
    });
    return successResponse(request, response, { accessToken: tokens.accessToken, user: serializeUser(user) });
  }));

  router.post('/logout', authenticate({ db }), asyncHandler(async (request, response) => {
    const rawToken = parseCookies(request).refreshToken;
    if (rawToken) {
      await db.refreshToken.updateMany({
        where: { userId: request.user.id, tokenHash: hashRefreshToken(rawToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    clearRefreshCookie(response);
    await writeAudit(db, {
      actorId: request.user.id,
      action: 'LOGOUT',
      resourceType: 'REFRESH_SESSION',
      correlationId: request.id,
    });
    return response.status(204).send();
  }));

  router.get('/me', authenticate({ db }), (request, response) => successResponse(request, response, serializeUser(request.user)));

  return router;
}
