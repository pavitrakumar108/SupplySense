import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { authenticate, requireRoles } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { writeAudit } from '../services/audit.service.js';
import { AppError } from '../utils/app-error.js';
import { asyncHandler } from '../utils/async-handler.js';
import { getPagination } from '../utils/pagination.js';
import { createdResponse, paginatedResponse, successResponse } from '../utils/response.js';

const marketplaceManifest = JSON.parse(await readFile(new URL('../../../client/src/product-photo-manifest.json', import.meta.url), 'utf8'));

const uuid = z.string().uuid();
const money = z.union([z.string(), z.number()]).transform(String).refine((value) => /^\d{1,10}(\.\d{1,2})?$/.test(value), 'Price must be a non-negative decimal with up to two decimal places.');
const imageInput = z.object({ imageUrl: z.string().trim().url().max(2048), altText: z.string().trim().max(240).optional(), sortOrder: z.number().int().min(0).default(0) });
const variantInput = z.object({
  sku: z.string().trim().min(1).max(80),
  barcode: z.string().trim().max(80).optional().nullable(),
  attributes: z.record(z.any()).default({}),
  price: money,
  currency: z.string().trim().length(3).toUpperCase().default('USD'),
  isActive: z.boolean().default(true),
});
const productFields = z.object({
  categoryId: uuid,
  name: z.string().trim().min(1).max(180),
  slug: z.string().trim().min(1).max(200).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().max(10000).optional().nullable(),
  isActive: z.boolean().default(true),
});
const createProductRequest = z.object({ body: productFields.extend({ variants: z.array(variantInput).default([]), images: z.array(imageInput).default([]) }) });
const updateProductRequest = z.object({
  params: z.object({ productId: uuid }),
  body: productFields.partial().refine((body) => Object.keys(body).length > 0, 'At least one field is required.'),
});
const collectionProductUpdateRequest = z.object({ body: productFields.partial().extend({ productId: uuid }).refine((body) => Object.keys(body).length > 1, 'At least one field is required.') });
const productIdBody = z.object({ body: z.object({ productId: uuid }) });
const variantParams = z.object({ params: z.object({ productId: uuid }) });
const productParams = variantParams;
const createVariantRequest = z.object({ params: z.object({ productId: uuid }), body: variantInput });
const updateVariantRequest = z.object({ params: z.object({ productId: uuid }), body: variantInput.partial().extend({ variantId: uuid }).refine((body) => Object.keys(body).length > 1, 'At least one field is required.') });
const deleteVariantRequest = z.object({ params: z.object({ productId: uuid }), body: z.object({ variantId: uuid }) });
const createImageRequest = z.object({ params: z.object({ productId: uuid }), body: imageInput.extend({ variantId: uuid.optional() }) });
const deleteImageRequest = z.object({ params: z.object({ productId: uuid }), body: z.object({ imageId: uuid }) });
const categoryCreateRequest = z.object({ body: z.object({ name: z.string().trim().min(1).max(120), slug: z.string().trim().min(1).max(140).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), isActive: z.boolean().default(true) }) });
const categoryUpdateRequest = z.object({ body: z.object({ categoryId: uuid, name: z.string().trim().min(1).max(120).optional(), slug: z.string().trim().min(1).max(140).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(), isActive: z.boolean().optional() }).refine((body) => Object.keys(body).length > 1, 'At least one field is required.') });
const categoryDeleteRequest = z.object({ body: z.object({ categoryId: uuid }) });
const productListRequest = z.object({ query: z.object({ page: z.string().optional(), pageSize: z.string().optional(), search: z.string().trim().max(180).optional(), marketplaceBrand: z.string().trim().max(100).optional(), categoryId: uuid.optional(), variantOption: z.string().trim().max(80).optional(), sort: z.enum(['name', 'createdAt', 'slug', 'random']).default('name'), direction: z.enum(['asc', 'desc']).default('asc'), minPrice: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(), maxPrice: z.string().regex(/^\d+(\.\d{1,2})?$/).optional() }) });

const variantInclude = {
  images: { orderBy: { sortOrder: 'asc' } },
  inventory: { where: { warehouse: { isActive: true } }, select: { warehouseId: true, onHandQuantity: true, reservedQuantity: true } },
};

function serializeVariant(variant) {
  const inventory = variant.inventory ?? [];
  const availableQuantity = inventory.reduce((total, row) => total + row.onHandQuantity - row.reservedQuantity, 0);
  return {
    id: variant.id,
    sku: variant.sku,
    barcode: variant.barcode,
    attributes: variant.attributes,
    price: variant.price.toString(),
    currency: variant.currency,
    isActive: variant.isActive,
    images: (variant.images ?? []).map((image) => ({ id: image.id, imageUrl: image.imageUrl, altText: image.altText, sortOrder: image.sortOrder })),
    availableQuantity,
    inStock: availableQuantity > 0,
  };
}

function serializeProduct(product) {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    isActive: product.isActive,
    category: product.category ? { id: product.category.id, name: product.category.name, slug: product.category.slug } : undefined,
    images: (product.images ?? []).map((image) => ({ id: image.id, imageUrl: image.imageUrl, altText: image.altText, sortOrder: image.sortOrder })),
    variants: (product.variants ?? []).map(serializeVariant),
    createdAt: product.createdAt,
    updatedAt: product.updatedAt,
  };
}

function catalogOrderHash(value) {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export function createCatalogRouter({ db }) {
  const router = Router();

  router.get('/categories', asyncHandler(async (request, response) => {
    const categories = await db.category.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      include: {
        _count: {
          select: {
            products: {
              where: {
                isActive: true,
                variants: { some: { isActive: true, sku: { startsWith: 'SS-CUR-' } } },
              },
            },
          },
        },
      },
    });
    return successResponse(request, response, categories.map((category) => ({ id: category.id, name: category.name, slug: category.slug, productCount: category._count.products })));
  }));

  router.get('/products', validate(productListRequest), asyncHandler(async (request, response) => {
    const { page, pageSize, skip, take } = getPagination(request.validated.query);
    const { search, marketplaceBrand, categoryId, sort, direction, minPrice, maxPrice, variantOption } = request.validated.query;
    const matchingVariants = {
      isActive: true,
      sku: { startsWith: 'SS-CUR-' },
      ...(variantOption ? { attributes: { path: ['option'], equals: variantOption } } : {}),
      ...(minPrice || maxPrice ? { price: { ...(minPrice ? { gte: minPrice } : {}), ...(maxPrice ? { lte: maxPrice } : {}) } } : {}),
    };
    const filters = [];
    if (search) filters.push({ OR: [{ name: { contains: search, mode: 'insensitive' } }, { slug: { contains: search, mode: 'insensitive' } }] });
    if (marketplaceBrand) {
      const matchingProducts = [];
      for (const entry of Object.values(marketplaceManifest)) {
        for (const [listingIndex, listing] of (entry.listings ?? []).entries()) {
          if (listing.brand?.toLowerCase() !== marketplaceBrand.toLowerCase()) continue;
          const seededBrand = entry.brands?.[listingIndex];
          if (seededBrand) matchingProducts.push({ name: { equals: `${seededBrand} ${entry.productType}`, mode: 'insensitive' } });
        }
      }
      filters.push(matchingProducts.length ? { OR: matchingProducts } : { id: '__no_marketplace_brand_match__' });
    }
    const where = {
      isActive: true,
      ...(categoryId ? { categoryId } : {}),
      ...(filters.length ? { AND: filters } : {}),
      variants: { some: matchingVariants },
    };

    const productInclude = { category: true, images: { orderBy: { sortOrder: 'asc' } }, variants: { where: { isActive: true, sku: { startsWith: 'SS-CUR-' } }, include: variantInclude } };
    let products;
    let totalItems;
    if (sort === 'random') {
      const allProductIds = await db.product.findMany({ where, select: { id: true, slug: true } });
      allProductIds.sort((left, right) => catalogOrderHash(left.slug) - catalogOrderHash(right.slug) || left.slug.localeCompare(right.slug));
      totalItems = allProductIds.length;
      const pageIds = allProductIds.slice(skip, skip + take).map(({ id }) => id);
      const pageProducts = pageIds.length ? await db.product.findMany({ where: { id: { in: pageIds } }, include: productInclude }) : [];
      const pageOrder = new Map(pageIds.map((id, index) => [id, index]));
      products = pageProducts.sort((left, right) => pageOrder.get(left.id) - pageOrder.get(right.id));
    } else {
      [products, totalItems] = await db.$transaction([
        db.product.findMany({ where, orderBy: { [sort]: direction }, include: productInclude, skip, take }),
        db.product.count({ where }),
      ]);
    }
    
    return paginatedResponse(request, response, products.map(serializeProduct), { page, pageSize, totalItems });
  }));

  router.get('/products/:productId', validate(productParams), asyncHandler(async (request, response) => {
    const product = await db.product.findFirst({
      where: {
        id: request.validated.params.productId,
        isActive: true,
        variants: { some: { isActive: true, sku: { startsWith: 'SS-CUR-' } } },
      },
      include: {
        category: true,
        images: { orderBy: { sortOrder: 'asc' } },
        variants: { where: { isActive: true, sku: { startsWith: 'SS-CUR-' } }, include: variantInclude },
      },
    });
    if (!product) throw new AppError('Product not found.', { statusCode: 404, code: 'NOT_FOUND' });
    return successResponse(request, response, serializeProduct(product));
  }));

  const admin = [authenticate({ db }), requireRoles({ db, roles: ['ADMIN'] })];

  router.post('/categories', ...admin, validate(categoryCreateRequest), asyncHandler(async (request, response) => {
    const category = await db.category.create({ data: request.validated.body });
    await writeAudit(db, { actorId: request.user.id, action: 'CATEGORY_CREATED', resourceType: 'CATEGORY', resourceId: category.id, correlationId: request.id });
    return createdResponse(request, response, category);
  }));

  router.patch('/categories', ...admin, validate(categoryUpdateRequest), asyncHandler(async (request, response) => {
    const { categoryId, ...data } = request.validated.body;
    const category = await db.category.update({ where: { id: categoryId }, data });
    await writeAudit(db, { actorId: request.user.id, action: 'CATEGORY_UPDATED', resourceType: 'CATEGORY', resourceId: category.id, correlationId: request.id, metadata: { fields: Object.keys(data) } });
    return successResponse(request, response, category);
  }));

  router.delete('/categories', ...admin, validate(categoryDeleteRequest), asyncHandler(async (request, response) => {
    const { categoryId } = request.validated.body;
    const category = await db.category.update({ where: { id: categoryId }, data: { isActive: false } });
    await writeAudit(db, { actorId: request.user.id, action: 'CATEGORY_DEACTIVATED', resourceType: 'CATEGORY', resourceId: category.id, correlationId: request.id });
    return response.status(204).send();
  }));

  router.post('/products', ...admin, validate(createProductRequest), asyncHandler(async (request, response) => {
    const { variants, images, ...data } = request.validated.body;
    const product = await db.$transaction(async (tx) => {
      await tx.category.findUniqueOrThrow({ where: { id: data.categoryId, isActive: true }, select: { id: true } });
      const created = await tx.product.create({ data: { ...data, images: images.length ? { create: images } : undefined } });
      for (const variant of variants) await tx.productVariant.create({ data: { ...variant, productId: created.id } });
      return tx.product.findUnique({ where: { id: created.id }, include: { category: true, images: { orderBy: { sortOrder: 'asc' } }, variants: { include: variantInclude } } });
    });
    await writeAudit(db, { actorId: request.user.id, action: 'PRODUCT_CREATED', resourceType: 'PRODUCT', resourceId: product.id, correlationId: request.id, metadata: { variantCount: variants.length } });
    return createdResponse(request, response, serializeProduct(product));
  }));

  async function updateProduct(request, response) {
    const { productId, ...data } = request.validated.body.productId ? request.validated.body : { productId: request.validated.params.productId, ...request.validated.body };
    if (data.categoryId) await db.category.findFirstOrThrow({ where: { id: data.categoryId, isActive: true }, select: { id: true } });
    const product = await db.product.update({ where: { id: productId }, data, include: { category: true, images: { orderBy: { sortOrder: 'asc' } }, variants: { include: variantInclude } } });
    await writeAudit(db, { actorId: request.user.id, action: 'PRODUCT_UPDATED', resourceType: 'PRODUCT', resourceId: product.id, correlationId: request.id, metadata: { fields: Object.keys(data) } });
    return successResponse(request, response, serializeProduct(product));
  }

  router.patch('/products', ...admin, validate(collectionProductUpdateRequest), asyncHandler(updateProduct));
  router.patch('/products/:productId', ...admin, validate(updateProductRequest), asyncHandler(updateProduct));

  async function deactivateProduct(request, response) {
    const productId = request.params.productId ?? request.validated.body.productId;
    const product = await db.product.update({ where: { id: productId }, data: { isActive: false } });
    await writeAudit(db, { actorId: request.user.id, action: 'PRODUCT_DEACTIVATED', resourceType: 'PRODUCT', resourceId: product.id, correlationId: request.id });
    return response.status(204).send();
  }
  router.delete('/products', ...admin, validate(productIdBody), asyncHandler(deactivateProduct));
  router.delete('/products/:productId', ...admin, validate(productParams), asyncHandler(deactivateProduct));

  router.post('/products/:productId/variants', ...admin, validate(createVariantRequest), asyncHandler(async (request, response) => {
    const { productId } = request.validated.params;
    const { variantId, ...data } = request.validated.body;
    const product = await db.product.findUniqueOrThrow({ where: { id: productId }, select: { id: true } });
    if (variantId) await db.productVariant.findFirstOrThrow({ where: { id: variantId, productId }, select: { id: true } });
    const image = await db.productImage.create({ data: { ...data, productId: product.id, variantId } });
    await writeAudit(db, { actorId: request.user.id, action: 'PRODUCT_IMAGE_CREATED', resourceType: 'PRODUCT_IMAGE', resourceId: image.id, correlationId: request.id });
    return createdResponse(request, response, serializeVariant(image));
  }));

  router.delete('/products/:productId/images', ...admin, validate(deleteImageRequest), asyncHandler(async (request, response) => {
    const image = await db.productImage.findFirstOrThrow({ where: { id: request.validated.body.imageId, productId: request.validated.params.productId }, select: { id: true } });
    await db.productImage.delete({ where: { id: image.id } });
    await writeAudit(db, { actorId: request.user.id, action: 'PRODUCT_IMAGE_DELETED', resourceType: 'PRODUCT_IMAGE', resourceId: image.id, correlationId: request.id });
    return response.status(204).send();
  }));

  return router;
}
