import { env } from '../config/env.js';
import { writeAudit } from '../services/audit.service.js';
import { findActiveUserWithRoles, hasRole, roleCodes } from '../services/user.service.js';
import { AppError } from '../utils/app-error.js';
import { asyncHandler } from '../utils/async-handler.js';
import { verifyAccessToken } from '../utils/jwt.js';

export function authenticate({ db }) {
  return asyncHandler(async (request, response, next) => {
    const header = request.get('authorization') ?? '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return next(new AppError('Authentication required.', { statusCode: 401, code: 'UNAUTHORIZED' }));
    }

    try {
      const payload = verifyAccessToken(token, env.JWT_ACCESS_SECRET);
      const user = await findActiveUserWithRoles(db, payload.sub);
      request.user = { ...user, roleCodes: roleCodes(user) };
      return next();
    } catch (error) {
      if (error instanceof AppError && error.statusCode === 401) return next(error);
      return next(new AppError('Authentication required.', { statusCode: 401, code: 'UNAUTHORIZED' }));
    }
  });
}

export function requireRoles({ db, roles }) {
  return asyncHandler(async (request, response, next) => {
    if (hasRole(request.user, roles)) return next();

    await writeAudit(db, {
      actorId: request.user?.id,
      action: 'PERMISSION_DENIED',
      resourceType: 'HTTP_ENDPOINT',
      outcome: 'DENIED',
      correlationId: request.id,
      metadata: { method: request.method, path: request.originalUrl, requiredRoles: roles },
    });
    return next(new AppError('You are not authorized to perform this action.', {
      statusCode: 403,
      code: 'FORBIDDEN',
    }));
  });
}

export function requireWarehouseAccess({ db, param = 'warehouseId' }) {
  return asyncHandler(async (request, response, next) => {
    const warehouseId = request.params[param];
    if (!warehouseId || request.user.roleCodes.includes('ADMIN') || request.user.roleCodes.includes('AUDITOR')) return next();
    if (!request.user.roleCodes.includes('WAREHOUSE_MANAGER')) {
      return next(new AppError('You are not authorized to access this warehouse.', { statusCode: 403, code: 'FORBIDDEN' }));
    }

    const assignment = await db.managerWarehouse.findUnique({
      where: { managerId_warehouseId: { managerId: request.user.id, warehouseId } },
    });
    if (assignment) return next();

    await writeAudit(db, {
      actorId: request.user.id,
      action: 'PERMISSION_DENIED',
      resourceType: 'WAREHOUSE',
      resourceId: warehouseId,
      outcome: 'DENIED',
      correlationId: request.id,
      metadata: { method: request.method, path: request.originalUrl },
    });
    return next(new AppError('You are not authorized to access this warehouse.', { statusCode: 403, code: 'FORBIDDEN' }));
  });
}
