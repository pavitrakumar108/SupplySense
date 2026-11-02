export function successResponse(request, response, data, statusCode = 200, meta = {}) {
  response.status(statusCode).json({
    success: true,
    data,
    meta: { requestId: request.id, ...meta },
  });
}

export function paginatedResponse(request, response, data, { page, pageSize, totalItems }) {
  successResponse(request, response, data, 200, {
    page,
    pageSize,
    totalItems,
    totalPages: Math.ceil(totalItems / pageSize),
  });
}

export function createdResponse(request, response, data) {
  successResponse(request, response, data, 201);
}
