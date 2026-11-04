import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { OAuth2Client } from 'google-auth-library';
import { Router } from 'express';
import { z } from 'zod';
import { env } from '../config/env.js';
import { authenticate } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.service.js';
import { assertEmailConfigured, sendVerificationCode } from '../services/email.service.js';
import { publicUserSelect, serializeUser } from '../services/user.service.js';
import { AppError } from '../utils/app-error.js';
import { asyncHandler } from '../utils/async-handler.js';
import { clearRefreshCookie, parseCookies, setRefreshCookie } from '../utils/cookies.js';
import { validate } from '../middleware/validate.js';
import { signAccessToken } from '../utils/jwt.js';
import { successResponse } from '../utils/response.js';

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
const verifyEmailRequest = z.object({ body: z.object({ email: emailSchema, code: z.string().trim().regex(/^\d{6}$/) }) });
const resendVerificationRequest = z.object({ body: z.object({ email: emailSchema }) });
const googleRequest = z.object({ body: z.object({ credential: z.string().min(20).max(8192) }) });
const googleClient = env.GOOGLE_CLIENT_ID ? new OAuth2Client(env.GOOGLE_CLIENT_ID) : null;

function hashRefreshToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

function newRefreshToken() {
  return randomBytes(48).toString('base64url');
}

function verificationCodeHash(userId, code) {
  return createHmac('sha256', env.OTP_SECRET).update(`${userId}:${code}`).digest('hex');
}

function hashesMatch(left, right) {
  const a = Buffer.from(left, 'hex');
  const b = Buffer.from(right, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

async function issueEmailVerification(db, user) {
  assertEmailConfigured();
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  await db.emailVerification.updateMany({
    where: { userId: user.id, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  await db.emailVerification.create({
    data: {
      userId: user.id,
      codeHash: verificationCodeHash(user.id, code),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
  });
    return sendVerificationCode({ email: user.email, code });
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
  const passwordMatches = user?.passwordHash ? await bcrypt.compare(password, user.passwordHash) : false;

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

  if (user.emailVerifiedAt === null) {
    await issueEmailVerification(db, user);
    throw new AppError('Verify your email address before signing in. You can request a new code.', { statusCode: 403, code: 'EMAIL_NOT_VERIFIED' });
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
    assertEmailConfigured();
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
          emailVerifiedAt: null,
        },
      });
      await tx.userRole.create({ data: { userId: createdUser.id, roleId: customerRole.id } });
      await tx.cart.create({ data: { userId: createdUser.id } });
      await tx.wishlist.create({ data: { userId: createdUser.id } });
      return tx.user.findUnique({ where: { id: createdUser.id, }, select: publicUserSelect });
    });

    const delivery = await issueEmailVerification(db, user);
    await writeAudit(db, {
      actorId: user.id,
      action: 'REGISTER',
      resourceType: 'USER',
      resourceId: user.id,
      correlationId: request.id,
      metadata: { role: 'CUSTOMER' },
    });
    return successResponse(request, response, {
      email: user.email,
      verificationRequired: true,
      deliveryMode: delivery.deliveryMode,
    }, 202);
  }));

  router.post('/login', validate(loginRequest), asyncHandler((request, response) => loginUser({ db, request, response })));
  router.post('/customer/login', validate(loginRequest), asyncHandler((request, response) => loginUser({ db, request, response, requiredRole: 'CUSTOMER' })));
  router.post('/manager/login', validate(loginRequest), asyncHandler((request, response) => loginUser({ db, request, response, requiredRole: 'WAREHOUSE_MANAGER' })));

  router.post('/verify-email', validate(verifyEmailRequest), asyncHandler(async (request, response) => {
    const { email, code } = request.validated.body;
    const user = await db.user.findUnique({ where: { email }, select: publicUserSelect });
    const now = new Date();
    const verification = user?.emailVerifiedAt === null ? await db.emailVerification.findFirst({
      where: { userId: user.id, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: 5 } },
      orderBy: { createdAt: 'desc' },
    }) : null;
    if (!user || !verification) throw new AppError('That code is invalid or expired. Request a new code and try again.', { statusCode: 400, code: 'INVALID_VERIFICATION_CODE' });

    const valid = hashesMatch(verification.codeHash, verificationCodeHash(user.id, code));
    if (!valid) {
      await db.emailVerification.updateMany({
        where: { id: verification.id, consumedAt: null, attempts: verification.attempts },
        data: { attempts: { increment: 1 } },
      });
      throw new AppError('That code is invalid or expired. Request a new code and try again.', { statusCode: 400, code: 'INVALID_VERIFICATION_CODE' });
    }

    const verifiedUser = await db.$transaction(async (tx) => {
      const consumed = await tx.emailVerification.updateMany({
        where: { id: verification.id, consumedAt: null, attempts: verification.attempts, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw new AppError('That code is invalid or expired. Request a new code and try again.', { statusCode: 400, code: 'INVALID_VERIFICATION_CODE' });
      return tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: now }, select: publicUserSelect });
    });

    const tokens = await issueTokens(db, verifiedUser);
    setRefreshCookie(response, tokens.refreshToken, { maxAge: env.JWT_REFRESH_TTL_SECONDS * 1000 });
    await writeAudit(db, { actorId: user.id, action: 'EMAIL_VERIFIED', resourceType: 'USER', resourceId: user.id, correlationId: request.id });
    return successResponse(request, response, { accessToken: tokens.accessToken, user: tokens.user });
  }));

  router.post('/verification/resend', rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: 'Please wait before requesting another verification code.',
  }), validate(resendVerificationRequest), asyncHandler(async (request, response) => {
    const { email } = request.validated.body;
    const user = await db.user.findUnique({ where: { email }, select: publicUserSelect });
    const delivery = user && user.emailVerifiedAt === null && user.isActive
      ? await issueEmailVerification(db, user)
      : null;
    return successResponse(request, response, {
      message: 'If this address needs verification, a new code has been sent.',
      ...(delivery ? {
        deliveryMode: delivery.deliveryMode,
      } : {}),
    });
  }));

  router.post('/google', validate(googleRequest), asyncHandler(async (request, response) => {
    if (!googleClient) throw new AppError('Google sign-in is not configured yet.', { statusCode: 503, code: 'GOOGLE_NOT_CONFIGURED' });
    let payload;
    try {
      const ticket = await googleClient.verifyIdToken({ idToken: request.validated.body.credential, audience: env.GOOGLE_CLIENT_ID });
      payload = ticket.getPayload();
    } catch {
      throw new AppError('Google sign-in could not be verified. Please try again.', { statusCode: 401, code: 'INVALID_GOOGLE_CREDENTIAL' });
    }
    if (!payload?.sub || !payload.email || payload.email_verified !== true) {
      throw new AppError('Google must confirm this email address before it can be used.', { statusCode: 401, code: 'GOOGLE_EMAIL_UNVERIFIED' });
    }
    const email = payload.email.toLowerCase();
    let user = await db.user.findUnique({ where: { googleSub: payload.sub }, select: publicUserSelect });
    if (!user) {
      const existingEmail = await db.user.findUnique({ where: { email }, select: { id: true } });
      if (existingEmail) throw new AppError('This email already has an account. Sign in with its existing method first.', { statusCode: 409, code: 'GOOGLE_ACCOUNT_LINK_REQUIRED' });
      user = await db.$transaction(async (tx) => {
        const customerRole = await tx.role.upsert({ where: { code: 'CUSTOMER' }, update: {}, create: { code: 'CUSTOMER', name: 'CUSTOMER' } });
        const createdUser = await tx.user.create({
          data: {
            email,
            fullName: payload.name?.trim().slice(0, 160) || email,
            passwordHash: null,
            googleSub: payload.sub,
            emailVerifiedAt: new Date(),
          },
        });
        await tx.userRole.create({ data: { userId: createdUser.id, roleId: customerRole.id } });
        await tx.cart.create({ data: { userId: createdUser.id } });
        await tx.wishlist.create({ data: { userId: createdUser.id } });
        return tx.user.findUnique({ where: { id: createdUser.id }, select: publicUserSelect });
      });
      await writeAudit(db, { actorId: user.id, action: 'GOOGLE_REGISTER', resourceType: 'USER', resourceId: user.id, correlationId: request.id });
    }
    if (!user.isActive) throw new AppError('This account is inactive. Contact support for help.', { statusCode: 403, code: 'ACCOUNT_INACTIVE' });
    const tokens = await issueTokens(db, user);
    setRefreshCookie(response, tokens.refreshToken, { maxAge: env.JWT_REFRESH_TTL_SECONDS * 1000 });
    return successResponse(request, response, { accessToken: tokens.accessToken, user: tokens.user });
  }));

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
