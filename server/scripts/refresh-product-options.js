import { PrismaClient } from '@prisma/client';
import { getProductVariantConfiguration } from '../src/services/product-options.js';

const prisma = new PrismaClient();

async function main() {
  const products = await prisma.product.findMany({
    where: { isActive: true, variants: { some: { sku: { startsWith: 'SS-CUR-' }, isActive: true } } },
    select: {
      name: true,
      category: { select: { slug: true } },
      variants: { where: { sku: { startsWith: 'SS-CUR-' }, isActive: true }, orderBy: { sku: 'asc' }, select: { id: true, attributes: true } },
    },
  });
  const updates = [];
  for (const product of products) {
    const config = getProductVariantConfiguration(product.category.slug, product.name);
    product.variants.forEach((variant, index) => {
      const option = config.options[index % config.options.length];
      const attributes = { option, optionLabel: config.label };
      if (JSON.stringify(variant.attributes) !== JSON.stringify(attributes)) updates.push({ id: variant.id, attributes });
    });
  }
  for (let index = 0; index < updates.length; index += 500) {
    await prisma.$transaction(updates.slice(index, index + 500).map(({ id, attributes }) =>
      prisma.productVariant.update({ where: { id }, data: { attributes } }),
    ));
  }
  console.log(JSON.stringify({ products: products.length, variantsUpdated: updates.length }));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  await prisma.$disconnect();
});
