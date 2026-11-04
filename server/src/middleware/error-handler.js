import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../utils/app-error.js';

export function errorHandler(error, request, response, next) {
  if (response.headersSent) return next(error);

  const isValidationError = error instanceof ZodError;
  const isUniqueConflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  const isMissingRecord = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
  const isForeignKeyError = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003';
  const isDatabaseUnavailable = error instanceof Prisma.PrismaClientInitializationError
    || (error instanceof Prisma.PrismaClientKnownRequestError && ['P1001', 'P1002', 'P2024'].includes(error.code));
  const isDemandModelError = error instanceof AppError && ['MODEL_TIMEOUT', 'MODEL_UNAVAILABLE', 'MODEL_EXECUTION_FAILED', 'MODEL_PREDICTION_FAILED', 'MODEL_INVALID_OUTPUT'].includes(error.code);
  const isEmailConfigurationError = error instanceof AppError && ['EMAIL_NOT_CONFIGURED', 'EMAIL_DELIVERY_FAILED', 'EMAIL_AUTH_FAILED'].includes(error.code);
  const statusCode = isDatabaseUnavailable ? 503 : isValidationError ? 422 : isUniqueConflict ? 409 : isMissingRecord ? 404 : isForeignKeyError ? 422 : error.statusCode ?? 500;
  const code = isDatabaseUnavailable ? 'SERVICE_UNAVAILABLE' : isValidationError ? 'VALIDATION_ERROR' : isUniqueConflict ? 'CONFLICT' : isMissingRecord ? 'NOT_FOUND' : isForeignKeyError ? 'INVALID_REFERENCE' : error.code ?? 'INTERNAL_ERROR';
  const message = isDatabaseUnavailable ? 'Sign-in and shopping are temporarily unavailable. Please try again shortly.' : isDemandModelError || isEmailConfigurationError ? error.message : statusCode >= 500 ? 'An unexpected server error occurred.' : error.message;
  const details = isValidationError ? error.flatten() : error.details;

  request.log?.error({
    err: error,
    requestId: request.id,
    statusCode,
    code,
  }, 'request failed');

  response.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      ...(details ? { details } : {}),
      requestId: request.id,
    },
  });
}

export function ensureAppError(error) {
  if (error instanceof AppError) return error;
  return new AppError(error.message, { cause: error });
}
