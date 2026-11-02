import { AppError } from '../utils/app-error.js';

export function validate(schema) {
  return function validateRequest(request, response, next) {
    const result = schema.safeParse({
      body: request.body,
      params: request.params,
      query: request.query,
    });

    if (!result.success) {
      return next(
        new AppError('The request is invalid.', {
          statusCode: 422,
          code: 'VALIDATION_ERROR',
          details: result.error.flatten(),
        }),
      );
    }

    request.validated = result.data;
    return next();
  };
}
