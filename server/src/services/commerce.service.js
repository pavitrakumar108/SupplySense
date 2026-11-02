import { AppError } from '../utils/app-error.js';
import { centsToDecimal, decimalToCents } from '../utils/money.js';

const variantInclude = {
  product: {
    select: {
      id: true,
      name: true,
      slug: true,
      isActive: true,
      category: { select: { name: true, slug: true } },
      images: { where: { variantId: null }, orderBy: { sortOrder: 'asc' }, select: { id: true, imageUrl: true, altText: true, sortOrder: true } },
    },
  },
  images: { orderBy: { sortOrder: 'asc' }, select: { id: true, imageUrl: true, altText: true, sortOrder: true } },
  inventory: {
    where: { warehouse: { isActive: true } },
    select: { onHandQuantity: true, reservedQuantity: true },
  },
};

const cartInclude = {
  items: { orderBy: { createdAt: 'asc' }, include: { variant: { include: variantInclude } } },
};

const wishlistInclude = {
  items: { orderBy: { createdAt: 'asc' }, include: { variant: { include: variantInclude } } },
};

function availableQuantity(variant) {
  return (variant.inventory ?? []).reduce((total, row) => total + row.onHandQuantity - row.reservedQuantity, 0);
}

function serializeVariant(variant) {
  const available = availableQuantity(variant);
  return {
    id: variant.id,
    sku: variant.sku,
    product: variant.product,
    images: variant.product?.images ?? variant.images ?? [],
    attributes: variant.attributes,
    price: variant.price.toString(),
    currency: variant.currency,
    isActive: variant.isActive,
    availableQuantity: available,
    inStock: available > 0,
  };
}

export function serializeCart(cart) {
  let totalCents = 0n;
  const items = cart.items.map((item) => {
    const priceCents = decimalToCents(item.variant.price);
    const lineTotalCents = priceCents * BigInt(item.quantity);
    totalCents += lineTotalCents;
    return {
      id: item.id,
      quantity: item.quantity,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      variant: serializeVariant(item.variant),
      lineTotal: centsToDecimal(lineTotalCents),
    };
  });
  return {
    id: cart.id,
    userId: cart.userId,
    items,
    subtotal: centsToDecimal(totalCents),
    updatedAt: cart.updatedAt,
  };
}

export function serializeWishlist(wishlist) {
  return {
    id: wishlist.id,
    userId: wishlist.userId,
    items: wishlist.items.map((item) => ({
      id: item.id,
      createdAt: item.createdAt,
      variant: serializeVariant(item.variant),
    })),
  };
}

export async function loadCart(db, userId) {
  return db.cart.upsert({ where: { userId }, update: {}, create: { userId }, include: cartInclude });
}

export async function loadWishlist(db, userId) {
  return db.wishlist.upsert({ where: { userId }, update: {}, create: { userId }, include: wishlistInclude });
}

async function requireActiveVariant(db, variantId) {
  const variant = await db.productVariant.findFirst({
    where: { id: variantId, isActive: true, product: { isActive: true } },
    select: { id: true },
  });
  if (!variant) throw new AppError('The SKU is not available.', { statusCode: 422, code: 'SKU_UNAVAILABLE' });
  return variant;
}

export async function addCartItem(db, userId, variantId, quantity) {
  return db.$transaction(async (tx) => {
    await requireActiveVariant(tx, variantId);
    const cart = await tx.cart.upsert({ where: { userId }, update: {}, create: { userId } });
    const current = await tx.cartItem.findUnique({ where: { cartId_variantId: { cartId: cart.id, variantId } } });
    if (current && current.quantity + quantity > 1000) {
      throw new AppError('Cart quantity cannot exceed 1000 units per SKU.', { statusCode: 422, code: 'CART_QUANTITY_LIMIT' });
    }
    if (current) {
      await tx.cartItem.update({ where: { id: current.id }, data: { quantity: { increment: quantity } } });
    } else {
      await tx.cartItem.create({ data: { cartId: cart.id, variantId, quantity } });
    }
    return tx.cart.findUnique({ where: { id: cart.id }, include: cartInclude });
  });
}

export async function updateCartItem(db, userId, variantId, quantity) {
  return db.$transaction(async (tx) => {
    const cart = await tx.cart.upsert({ where: { userId }, update: {}, create: { userId } });
    const item = await tx.cartItem.findUnique({ where: { cartId_variantId: { cartId: cart.id, variantId } } });
    if (!item) throw new AppError('Cart item not found.', { statusCode: 404, code: 'NOT_FOUND' });
    if (quantity === 0) {
      await tx.cartItem.delete({ where: { id: item.id } });
    } else {
      await requireActiveVariant(tx, variantId);
      await tx.cartItem.update({ where: { id: item.id }, data: { quantity } });
    }
    return tx.cart.findUnique({ where: { id: cart.id }, include: cartInclude });
  });
}

export async function removeCartItem(db, userId, variantId) {
  const cart = await db.cart.upsert({ where: { userId }, update: {}, create: { userId } });
  await db.cartItem.deleteMany({ where: { cartId: cart.id, variantId } });
  return loadCart(db, userId);
}

export async function clearCart(db, userId) {
  const cart = await db.cart.upsert({ where: { userId }, update: {}, create: { userId } });
  await db.cartItem.deleteMany({ where: { cartId: cart.id } });
}

export async function addWishlistItem(db, userId, variantId) {
  await requireActiveVariant(db, variantId);
  const wishlist = await db.wishlist.upsert({ where: { userId }, update: {}, create: { userId } });
  await db.wishlistItem.upsert({
    where: { wishlistId_variantId: { wishlistId: wishlist.id, variantId } },
    update: {},
    create: { wishlistId: wishlist.id, variantId },
  });
  return loadWishlist(db, userId);
}

export async function removeWishlistItem(db, userId, variantId) {
  const wishlist = await db.wishlist.upsert({ where: { userId }, update: {}, create: { userId } });
  await db.wishlistItem.deleteMany({ where: { wishlistId: wishlist.id, variantId } });
  return loadWishlist(db, userId);
}
