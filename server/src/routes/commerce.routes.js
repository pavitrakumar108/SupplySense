import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { writeAudit } from '../services/audit.service.js';
import { addCartItem, addWishlistItem, clearCart, loadCart, loadWishlist, removeCartItem, removeWishlistItem, serializeCart, serializeWishlist, updateCartItem } from '../services/commerce.service.js';
import { asyncHandler } from '../utils/async-handler.js';
import { createdResponse, successResponse } from '../utils/response.js';
import { validate } from '../middleware/validate.js';

const itemBody = z.object({ variantId: z.string().uuid(), quantity: z.number().int().min(0).max(1000) });
const itemRequest = z.object({ body: itemBody });
const addItemRequest = z.object({ body: itemBody.extend({ quantity: z.number().int().min(1).max(1000) }) });
const variantRequest = z.object({ body: z.object({ variantId: z.string().uuid() }) });

export function createCommerceRouter({ db }) {
  const router = Router();
  const customer = [authenticate({ db }), requireRoles({ db, roles: ['CUSTOMER'] })];

  router.get('/cart', ...customer, asyncHandler(async (request, response) => {
    const cart = await loadCart(db, request.user.id);
    return successResponse(request, response, serializeCart(cart));
  }));

  router.post('/cart', ...customer, validate(addItemRequest), asyncHandler(async (request, response) => {
    const { variantId, quantity } = request.validated.body;
    const cart = await addCartItem(db, request.user.id, variantId, quantity);
    await writeAudit(db, { actorId: request.user.id, action: 'CART_ITEM_ADDED', resourceType: 'CART', resourceId: cart.id, correlationId: request.id, metadata: { variantId, quantity } });
    return createdResponse(request, response, serializeCart(cart));
  }));

  router.patch('/cart', ...customer, validate(itemRequest), asyncHandler(async (request, response) => {
    const { variantId, quantity } = request.validated.body;
    const cart = await updateCartItem(db, request.user.id, variantId, quantity);
    await writeAudit(db, { actorId: request.user.id, action: 'CART_ITEM_UPDATED', resourceType: 'CART', resourceId: cart.id, correlationId: request.id, metadata: { variantId, quantity } });
    return successResponse(request, response, serializeCart(cart));
  }));

  router.delete('/cart', ...customer, validate(variantRequest), asyncHandler(async (request, response) => {
    const { variantId } = request.validated.body;
    const cart = await removeCartItem(db, request.user.id, variantId);
    await writeAudit(db, { actorId: request.user.id, action: 'CART_ITEM_REMOVED', resourceType: 'CART', resourceId: cart.id, correlationId: request.id, metadata: { variantId } });
    return response.status(204).send();
  }));

  router.delete('/cart/clear', ...customer, asyncHandler(async (request, response) => {
    await clearCart(db, request.user.id);
    await writeAudit(db, { actorId: request.user.id, action: 'CART_CLEARED', resourceType: 'CART', correlationId: request.id });
    return response.status(204).send();
  }));

  router.get('/wishlist', ...customer, asyncHandler(async (request, response) => {
    const wishlist = await loadWishlist(db, request.user.id);
    return successResponse(request, response, serializeWishlist(wishlist));
  }));

  router.post('/wishlist', ...customer, validate(variantRequest), asyncHandler(async (request, response) => {
    const { variantId } = request.validated.body;
    const wishlist = await addWishlistItem(db, request.user.id, variantId);
    await writeAudit(db, { actorId: request.user.id, action: 'WISHLIST_ITEM_ADDED', resourceType: 'WISHLIST', resourceId: wishlist.id, correlationId: request.id, metadata: { variantId } });
    return createdResponse(request, response, serializeWishlist(wishlist));
  }));

  router.delete('/wishlist', ...customer, validate(variantRequest), asyncHandler(async (request, response) => {
    const { variantId } = request.validated.body;
    const wishlist = await removeWishlistItem(db, request.user.id, variantId);
    await writeAudit(db, { actorId: request.user.id, action: 'WISHLIST_ITEM_REMOVED', resourceType: 'WISHLIST', resourceId: wishlist.id, correlationId: request.id, metadata: { variantId } });
    return response.status(204).send();
  }));

  return router;
}
