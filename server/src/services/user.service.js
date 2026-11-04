import { AppError } from '../utils/app-error.js';

export const publicUserSelect = {
  id: true,
  email: true,
  fullName: true,
  isActive: true,
  createdAt: true,
  emailVerifiedAt: true,
  roles: { select: { role: { select: { code: true, name: true } } } },
};

export function serializeUser(user) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    isActive: user.isActive,
    createdAt: user.createdAt,
    emailVerifiedAt: user.emailVerifiedAt,
    roles: user.roles.map(({ role }) => ({ code: role.code, name: role.name })),
  };
}

export async function findActiveUserWithRoles(db, userId) {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { ...publicUserSelect, passwordHash: true },
  });
  if (!user || !user.isActive) throw new AppError('Authentication required.', { statusCode: 401, code: 'UNAUTHORIZED' });
  return user;
}

export function hasRole(user, roles) {
  return user.roles.some(({ role }) => roles.includes(role.code));
}

export function roleCodes(user) {
  return user.roles.map(({ role }) => role.code);
}
