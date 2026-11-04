import rateLimit from 'express-rate-limit';
import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { asyncHandler } from '../utils/async-handler.js';
import { createdResponse, successResponse } from '../utils/response.js';
import { getPagination } from '../utils/pagination.js';
import { validate } from '../middleware/validate.js';

const submitFeedback = z.object({
  body: z.object({
    name: z.string().trim().min(2).max(160),
    email: z.string().trim().email().max(320).transform((value) => value.toLowerCase()),
    subject: z.string().trim().min(3).max(160).default('Website feedback'),
    message: z.string().trim().min(5).max(3000),
    rating: z.number().int().min(1).max(5).optional(),
  }),
});
const listFeedback = z.object({ query: z.object({ page: z.string().optional(), pageSize: z.string().optional() }) });
const updateFeedback = z.object({
  params: z.object({ feedbackId: z.string().uuid() }),
  body: z.object({ isResolved: z.boolean() }),
});

export function createFeedbackRouter({ db }) {
  const router = Router();
  const admin = [authenticate({ db }), requireRoles({ db, roles: ['ADMIN'] })];

  router.post('/', rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: 'You’ve sent a lot of feedback recently. Please try again later.',
  }), validate(submitFeedback), asyncHandler(async (request, response) => {
    const feedback = await db.customerFeedback.create({ data: request.validated.body });
    return createdResponse(request, response, { id: feedback.id, message: 'Thanks for sharing your feedback.' });
  }));

  router.get('/', ...admin, validate(listFeedback), asyncHandler(async (request, response) => {
    const { page, pageSize, skip, take } = getPagination(request.validated.query);
    const [items, totalItems, unresolvedCount] = await db.$transaction([
      db.customerFeedback.findMany({ orderBy: { createdAt: 'desc' }, skip, take }),
      db.customerFeedback.count(),
      db.customerFeedback.count({ where: { isResolved: false } }),
    ]);
    return successResponse(request, response, items, 200, { page, pageSize, totalItems, totalPages: Math.ceil(totalItems / pageSize), unresolvedCount });
  }));

  router.patch('/:feedbackId', ...admin, validate(updateFeedback), asyncHandler(async (request, response) => {
    const { feedbackId } = request.validated.params;
    const feedback = await db.customerFeedback.update({ where: { id: feedbackId }, data: request.validated.body });
    return successResponse(request, response, feedback);
  }));

  return router;
}
