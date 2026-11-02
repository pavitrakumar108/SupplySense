import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.service.js';
import { publicUserSelect, serializeUser } from '../services/user.service.js';
import { AppError } from '../utils/app-error.js';
import { asyncHandler } from '../utils/async-handler.js';
import { getPagination } from '../utils/pagination.js';
import { createdResponse, paginatedResponse, successResponse } from '../utils/response.js';
import { validate } from '../middleware/validate.js';

const roleCode = z.enum(['CUSTOMER', 'SUPPLIER', 'WAREHOUSE_MANAGER', 'ADMIN', 'AUDITOR']);
const userIdParams = z.object({ params: z.object({ userId: z.string().uuid() }) });
const createUserRequest = z.object({
  body: z.object({
    email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
    password: z.string().min(12).max(128),
    fullName: z.string().trim().min(2).max(160),
    roleCodes: z.array(roleCode).min(1).default(['CUSTOMER']),
    warehouseIds: z.array(z.string().uuid()).default([]),
  }),
});
const updateUserRequest = z.object({
  params: z.object({ userId: z.string().uuid() }),
  body: z.object({
    email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()).optional(),
    fullName: z.string().trim().min(2).max(160).optional(),
    isActive: z.boolean().optional(),
  }).refine((body) => Object.keys(body).length > 0, 'At least one field is required.'),
});
const rolesRequest = z.object({
  params: z.object({ userId: z.string().uuid() }),
  body: z.object({ roleCodes: z.array(roleCode).min(1) }),
});
const warehousesRequest = z.object({
  params: z.object({ userId: z.string().uuid() }),
  body: z.object({ warehouseIds: z.array(z.string().uuid()) }),
});
const listUsersRequest = z.object({ query: z.object({ page: z.string().optional(), pageSize: z.string().optional(), search: z.string().trim().max(100).optional() }) });

export function createUsersRouter({ db }) {
  const router = Router();
  router.use(authenticate({ db }), requireRoles({ db, roles: ['ADMIN'] }));

  router.get('/', validate(listUsersRequest), asyncHandler(async (request, response) => {
    const { page, pageSize, skip, take } = getPagination(request.validated.query);
    const search = request.validated.query.search;
    const where = search ? {
      OR: [
        { email: { contains: search, mode: 'insensitive' } },
        { fullName: { contains: search, mode: 'insensitive' } },
      ],
    } : {};
    const [users, totalItems] = await db.$transaction([
      db.user.findMany({ where, select: publicUserSelect, orderBy: { createdAt: 'desc' }, skip, take }),
      db.user.count({ where }),
    ]);
    return paginatedResponse(request, response, users.map(serializeUser), { page, pageSize, totalItems });
  }));

  router.post('/', validate(createUserRequest), asyncHandler(async (request, response) => {
    const { email, password, fullName, roleCodes, warehouseIds } = request.validated.body;
    const existing = await db.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw new AppError('An account with this email already exists.', { statusCode: 409, code: 'EMAIL_ALREADY_EXISTS' });

    const user = await db.$transaction(async (tx) => {
      const createdUser = await tx.user.create({
        data: { email, fullName, passwordHash: await bcrypt.hash(password, 12) },
      });
      for (const code of roleCodes) {
        const role = await tx.role.upsert({
          where: { code },
          update: {},
          create: { code, name: code.replaceAll('_', ' ') },
        });
        await tx.userRole.create({ data: { userId: createdUser.id, roleId: role.id } });
      }
      if (roleCodes.includes('CUSTOMER')) {
        await tx.cart.create({ data: { userId: createdUser.id } });
        await tx.wishlist.create({ data: { userId: createdUser.id } });
      }
      if (roleCodes.includes('WAREHOUSE_MANAGER') && warehouseIds.length > 0) {
        const warehouses = await tx.warehouse.count({ where: { id: { in: warehouseIds }, isActive: true } });
        if (warehouses !== warehouseIds.length) throw new AppError('One or more warehouses are invalid.', { statusCode: 422, code: 'INVALID_WAREHOUSE_SCOPE' });
        await tx.managerWarehouse.createMany({ data: warehouseIds.map((warehouseId) => ({ managerId: createdUser.id, warehouseId })) });
      }
      return tx.user.findUnique({ where: { id: createdUser.id }, select: publicUserSelect });
    });
    await writeAudit(db, { actorId: request.user.id, action: 'USER_CREATED', resourceType: 'USER', resourceId: user.id, correlationId: request.id, metadata: { roleCodes } });
    return createdResponse(request, response, serializeUser(user));
  }));

  router.patch('/:userId', validate(updateUserRequest), asyncHandler(async (request, response) => {
    const { userId } = request.validated.params;
    const user = await db.user.update({ where: { id: userId }, data: request.validated.body, select: publicUserSelect });
    await writeAudit(db, { actorId: request.user.id, action: 'USER_UPDATED', resourceType: 'USER', resourceId: user.id, correlationId: request.id, metadata: { fields: Object.keys(request.validated.body) } });
    return successResponse(request, response, serializeUser(user));
  }));

  router.patch('/:userId/roles', validate(rolesRequest), asyncHandler(async (request, response) => {
    const { userId } = request.validated.params;
    const { roleCodes } = request.validated.body;
    const user = await db.$transaction(async (tx) => {
      await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true } });
      const roles = await Promise.all(roleCodes.map((code) => tx.role.upsert({ where: { code }, update: {}, create: { code, name: code.replaceAll('_', ' ') } })));
      await tx.userRole.deleteMany({ where: { userId } });
      await tx.userRole.createMany({ data: roles.map((role) => ({ userId, roleId: role.id })) });
      return tx.user.findUnique({ where: { id: userId }, select: publicUserSelect });
    });
    await writeAudit(db, { actorId: request.user.id, action: 'USER_ROLES_UPDATED', resourceType: 'USER', resourceId: userId, correlationId: request.id, metadata: { roleCodes } });
    return successResponse(request, response, serializeUser(user));
  }));

  router.patch('/:userId/warehouses', validate(warehousesRequest), asyncHandler(async (request, response) => {
    const { userId } = request.validated.params;
    const { warehouseIds } = request.validated.body;
    const user = await db.$transaction(async (tx) => {
      const manager = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, roles: { select: { role: { select: { code: true } } } } } });
      if (!manager.roles.some(({ role }) => role.code === 'WAREHOUSE_MANAGER')) throw new AppError('User must have the warehouse manager role.', { statusCode: 422, code: 'INVALID_MANAGER_SCOPE' });
      const warehouses = await tx.warehouse.count({ where: { id: { in: warehouseIds }, isActive: true } });
      if (warehouses !== warehouseIds.length) throw new AppError('One or more warehouses are invalid.', { statusCode: 422, code: 'INVALID_WAREHOUSE_SCOPE' });
      await tx.managerWarehouse.deleteMany({ where: { managerId: userId } });
      if (warehouseIds.length > 0) await tx.managerWarehouse.createMany({ data: warehouseIds.map((warehouseId) => ({ managerId: userId, warehouseId })) });
      return tx.user.findUnique({ where: { id: userId }, select: publicUserSelect });
    });
    await writeAudit(db, { actorId: request.user.id, action: 'MANAGER_WAREHOUSE_SCOPE_UPDATED', resourceType: 'USER', resourceId: userId, correlationId: request.id, metadata: { warehouseIds } });
    return successResponse(request, response, serializeUser(user));
  }));

  return router;
}
