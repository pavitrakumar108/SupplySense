import bcrypt from 'bcryptjs';
import { PrismaClient, UserRoleCode } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { getProductVariantConfiguration } from '../src/services/product-options.js';

const prisma = new PrismaClient();
const catalogPhotos = JSON.parse(await readFile(new URL('./catalog-photo-manifest.json', import.meta.url), 'utf8'));

const PRODUCT_TEMPLATES = {
  'hydration': {
    category: 'Hydration',
    brands: ['Milton', 'Cello', 'Borosil', 'Tupperware', 'Prestige', 'Pigeon', 'Thermos', 'Wonderchef', 'Signoraware', 'Treo'],
    names: ['Water Bottle', 'Travel Mug', 'Coffee Mug', 'Glass Tumbler', 'Water Pitcher', 'Tea Kettle', 'Insulated Flask', 'Sports Bottle', 'Lunch Thermos', 'Tea Infuser', 'Reusable Straw Set', 'Water Filter Jug', 'Ceramic Cup', 'Travel Cup', 'Coffee Press', 'Bottle Brush', 'Drink Dispenser', 'Kids Water Bottle', 'Tea Set', 'Thermal Carafe'],
    description: 'Made for everyday hydration at home or on the go.',
  },
  'electronics': {
    category: 'Electronics',
    brands: ['Sony', 'Logitech', 'JBL', 'boAt', 'Anker', 'Samsung', 'Philips', 'Dell', 'HP', 'Portronics'],
    names: ['Wireless Headphones', 'Bluetooth Speaker', 'Mechanical Keyboard', 'Wireless Mouse', 'Laptop Stand', 'USB-C Hub', 'Portable SSD', 'Webcam', 'Monitor Light', 'Phone Charger', 'Power Bank', 'Desk Microphone', 'Gaming Headset', 'Tablet Stand', 'Wireless Earbuds', 'Screen Protector', 'Smart Plug', 'LED Desk Lamp', 'Laptop Sleeve', 'Phone Tripod'],
    description: 'A practical tech essential for work, home, and travel.',
  },
  'shoes': {
    category: 'Footwear',
    brands: ['Nike', 'Adidas', 'Puma', 'Skechers', 'Bata', 'Reebok', 'ASICS', 'New Balance', 'Woodland', 'Decathlon'],
    names: ['Running Shoes', 'Walking Shoes', 'Canvas Sneakers', 'Leather Loafers', 'Hiking Boots', 'Trail Shoes', 'Court Shoes', 'Slip-on Shoes', 'Sandals', 'House Slippers', 'Oxford Shoes', 'Ankle Boots', 'Tennis Shoes', 'Training Shoes', 'Clogs', 'Rain Boots', 'Basketball Shoes', 'Flat Shoes', 'Everyday Sneakers', 'Work Shoes'],
    description: 'Comfortable footwear designed for daily wear.',
  },
  'fashion': {
    category: 'Fashion',
    brands: ["Levi's", 'Uniqlo', 'H&M', 'Zara', 'Fabindia', 'Allen Solly', 'Van Heusen', 'Marks & Spencer', 'Roadster', 'W for Woman'],
    names: ['Cotton T-Shirt', 'Linen Shirt', 'Denim Jeans', 'Knit Sweater', 'Everyday Hoodie', 'Button-down Shirt', 'Midi Dress', 'Summer Dress', 'Wool Coat', 'Denim Jacket', 'Cotton Socks', 'Polo Shirt', 'Chino Trousers', 'Cardigan', 'Rain Jacket', 'Shorts', 'Cotton Pajamas', 'Scarf', 'Beanie Hat', 'Canvas Tote Bag'],
    description: 'An easy-to-wear wardrobe staple with a comfortable fit.',
  },
  'home-living': {
    category: 'Home & Living',
    brands: ['IKEA', 'Home Centre', 'Urban Ladder', 'DDecor', 'Sleepyhead', 'Wakefit', 'HomeTown', 'Story@Home', 'Solimo', 'Ellementry'],
    names: ['Table Lamp', 'Throw Pillow', 'Cotton Bed Sheets', 'Wool Blanket', 'Ceramic Vase', 'Wall Clock', 'Storage Basket', 'Bath Towel Set', 'Plant Pot', 'Scented Candle', 'Desk Organizer', 'Laundry Basket', 'Curtain Panel', 'Doormat', 'Mirror', 'Serving Tray', 'Throw Blanket', 'Bedside Table', 'Photo Frame', 'Cotton Bath Mat'],
    description: 'A simple home essential made to bring comfort to your space.',
  },
  'beauty-care': {
    category: 'Beauty & Personal Care',
    brands: ['Nivea', 'Minimalist', 'Cetaphil', 'Neutrogena', 'Dove', 'Lakme', 'Plum', 'Mamaearth', 'Himalaya', "L'Oreal"],
    names: ['Face Cleanser', 'Daily Moisturizer', 'Vitamin C Serum', 'Face Sunscreen', 'Body Lotion', 'Lip Balm', 'Shampoo', 'Conditioner', 'Hair Mask', 'Hand Cream', 'Face Toner', 'Cleansing Oil', 'Bath Soap Set', 'Hair Brush', 'Nail Care Kit', 'Face Mask Set', 'Beard Oil', 'Body Wash', 'Eye Cream', 'Makeup Brush Set'],
    description: 'A gentle personal-care essential for your daily routine.',
  },
  'grocery': {
    category: 'Grocery',
    brands: ['Tata Sampann', 'Aashirvaad', 'Fortune', 'Saffola', 'Amul', 'MTR', 'Patanjali', 'Organic Tattva', 'Paper Boat', 'Haldiram'],
    names: ['Rolled Oats', 'Basmati Rice', 'Pasta', 'Olive Oil', 'Ground Coffee', 'Tea Bags', 'Almond Butter', 'Peanut Butter', 'Wildflower Honey', 'Tomato Sauce', 'Coconut Milk', 'Lentils', 'Quinoa', 'Granola', 'Dark Chocolate', 'Coconut Sugar', 'Sea Salt', 'Dried Mango', 'Green Tea', 'Mixed Nuts'],
    description: 'A pantry staple selected for everyday meals and snacks.',
  },
  'sports-fitness': {
    category: 'Sports & Fitness',
    brands: ['Decathlon', 'Nike', 'Adidas', 'Puma', 'Boldfit', 'Nivia', 'Strauss', 'Cultsport', 'Yonex', 'Cosco'],
    names: ['Yoga Mat', 'Resistance Bands', 'Dumbbell Set', 'Skipping Rope', 'Foam Roller', 'Training Gloves', 'Gym Towel', 'Exercise Ball', 'Yoga Block Set', 'Kettlebell', 'Running Belt', 'Sports Socks', 'Waterproof Gym Bag', 'Wrist Weights', 'Pull-up Bar', 'Training Cones', 'Cycling Gloves', 'Tennis Racket', 'Knee Support', 'Massage Ball'],
    description: 'Reliable fitness gear for training at home or outdoors.',
  },
  'toys-games': {
    category: 'Toys & Games',
    brands: ['LEGO', 'Hasbro', 'Mattel', 'Funskool', 'Skillmatics', 'Hamleys', 'PlayShifu', 'Toyshine', 'Ratna', 'Smartivity'],
    names: ['Building Blocks', 'Wooden Puzzle', 'Board Game', 'Playing Cards', 'Stuffed Bear', 'Toy Train Set', 'Art Kit', 'Modeling Clay Set', 'Wooden Stacking Rings', 'Jigsaw Puzzle', 'Doll House', 'Toy Kitchen Set', 'Science Kit', 'Chess Set', 'Coloring Book Set', 'Toy Car Set', 'Plush Rabbit', 'Magnetic Tiles', 'Marble Run', 'Memory Game'],
    description: 'A fun, thoughtfully made toy for playtime and learning.',
  },
  'books-stationery': {
    category: 'Books & Stationery',
    brands: ['Classmate', 'Faber-Castell', 'Camlin', 'Parker', 'Reynolds', 'Navneet', 'Pilot', 'Oddy', 'Kangaro', 'DOMS'],
    names: ['Hardcover Journal', 'Ruled Notebook', 'Sketchbook', 'Daily Planner', 'Pocket Notebook', 'Gel Pen Set', 'Pencil Set', 'Watercolor Pad', 'Desk Calendar', 'Sticky Notes Set', 'File Folder Set', 'Fountain Pen', 'Drawing Pencils', 'Greeting Card Set', 'Bookends', 'Reading Light', 'Book Stand', 'Index Cards', 'Travel Journal', 'Marker Set'],
    description: 'A useful writing and desk essential for work or study.',
  },
};

const PRODUCT_ICONS = [
  [/bottle brush|hair brush|makeup brush|brush set/, '🪥'],
  [/headphones|headset|earbuds/, '🎧'],
  [/speaker|microphone/, '🔊'],
  [/keyboard/, '⌨️'],
  [/wireless mouse|mouse/, '🖱️'],
  [/ssd|usb-c hub|webcam|charger|power bank|smart plug|screen protector|tripod|laptop sleeve|stand/, '💻'],
  [/lamp|light/, '💡'],
  [/running shoes|walking shoes|sneakers|shoes|boots|loafers|sandals|slippers|clogs/, '👟'],
  [/t-shirt|shirt|polo|hoodie|sweater|cardigan|coat|jacket|dress|jeans|trousers|shorts|socks|pajamas|scarf|hat|beanie/, '👕'],
  [/tote bag|gym bag|basket|laundry basket/, '👜'],
  [/pillow|bed sheets|blanket|towel|bath mat|curtain|doormat/, '🛏️'],
  [/vase|plant pot|candle|clock|mirror|tray|frame|organizer/, '🏠'],
  [/cleanser|moisturizer|serum|sunscreen|lotion|lip balm|shampoo|conditioner|hair mask|hand cream|toner|cleansing oil|soap|nail care|beard oil|body wash|eye cream/, '🧴'],
  [/coffee|tea|kettle|mug|cup|tumbler|carafe|infuser|straw|pitcher|thermos|flask|dispenser/, '☕'],
  [/oats|rice|pasta|lentils|quinoa|granola|nuts/, '🥣'],
  [/olive oil|butter|honey|sauce|coconut milk|salt|sugar/, '🫙'],
  [/chocolate|mango/, '🍫'],
  [/yoga mat|resistance band|dumbbell|kettlebell|foam roller|exercise ball|wrist weights|knee support|massage ball/, '🏋️'],
  [/rope|running belt|gym towel|sports socks|gym bag|pull-up bar|training cones|cycling gloves|tennis racket|training gloves/, '🏃'],
  [/blocks|puzzle|board game|playing cards|bear|train set|art kit|clay|stacking rings|doll house|kitchen set|science kit|chess|coloring book|toy car|rabbit|magnetic tiles|marble run|memory game/, '🧸'],
  [/journal|notebook|sketchbook|planner|pen|pencil|pad|calendar|sticky notes|folder|greeting card|bookend|reading light|book stand|index cards|marker/, '📓'],
];

const CATEGORY_ICONS = {
  hydration: '🥤',
  electronics: '🎧',
  shoes: '👟',
  fashion: '👕',
  'home-living': '🏠',
  'beauty-care': '🧴',
  grocery: '🥣',
  'sports-fitness': '🏃',
  'toys-games': '🧸',
  'books-stationery': '📓',
};

const ARTWORK_COLORS = [
  ['#e4f2e7', '#b6d8bc'],
  ['#e5edf9', '#b7c8e7'],
  ['#fff0df', '#f0ceaa'],
  ['#f7e6eb', '#e9bac8'],
  ['#e8e5f6', '#c8c0e8'],
  ['#f4edcf', '#e5d99e'],
  ['#e1eff0', '#b7d7d9'],
  ['#f5e9dd', '#e8cdb5'],
];

async function createManyInBatches(delegate, rows, batchSize = 1000) {
  for (let index = 0; index < rows.length; index += batchSize) {
    await delegate.createMany({ data: rows.slice(index, index + batchSize), skipDuplicates: true });
  }
}

function productIllustration(productName, categorySlug, colorIndex) {
  const icon = PRODUCT_ICONS.find(([pattern]) => pattern.test(productName))?.[1]
    ?? CATEGORY_ICONS[categorySlug]
    ?? '🛍️';
  const [background, accent] = ARTWORK_COLORS[colorIndex % ARTWORK_COLORS.length];
  const label = productName.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="520" viewBox="0 0 720 520"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${background}"/><stop offset="1" stop-color="#fffaf4"/></linearGradient></defs><rect width="720" height="520" rx="32" fill="url(#bg)"/><circle cx="590" cy="106" r="115" fill="${accent}" opacity=".55"/><circle cx="104" cy="432" r="145" fill="${accent}" opacity=".35"/><rect x="150" y="58" width="420" height="404" rx="42" fill="#ffffff" opacity=".76"/><text x="360" y="118" text-anchor="middle" fill="#64736a" font-family="Arial,sans-serif" font-size="17" font-weight="700" letter-spacing="3">SUPPLYSENSE SELECT</text><text x="360" y="303" text-anchor="middle" font-family="Apple Color Emoji,Segoe UI Emoji,Noto Color Emoji,sans-serif" font-size="152">${icon}</text><path d="M272 337h176" stroke="${accent}" stroke-width="5" stroke-linecap="round"/><text x="360" y="374" text-anchor="middle" fill="#32463a" font-family="Arial,sans-serif" font-size="18" font-weight="700" textLength="340" lengthAdjust="spacingAndGlyphs">${label}</text><text x="360" y="417" text-anchor="middle" fill="#64736a" font-family="Arial,sans-serif" font-size="16" font-weight="700" letter-spacing="2">${categorySlug.replaceAll('-', ' ').toUpperCase()}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

async function main() {
  const roles = {};

  for (const code of Object.values(UserRoleCode)) {
    roles[code] = await prisma.role.upsert({
      where: { code },
      update: { name: code.replaceAll('_', ' ') },
      create: { code, name: code.replaceAll('_', ' ') },
    });
  }

  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe!12345';
  const admin = await prisma.user.upsert({
    where: { email: 'admin@supplysense.local' },
    update: { fullName: 'SupplySense Admin', isActive: true },
    create: {
      email: 'admin@supplysense.local',
      passwordHash: await bcrypt.hash(adminPassword, 12),
      fullName: 'SupplySense Admin',
    },
  });

  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: roles.ADMIN.id } },
    update: {},
    create: { userId: admin.id, roleId: roles.ADMIN.id },
  });

  async function upsertDemoUser({ email, fullName, password, roleCode }) {
    const user = await prisma.user.upsert({
      where: { email },
      update: { fullName, isActive: true },
      create: { email, fullName, passwordHash: await bcrypt.hash(password, 12) },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: roles[roleCode].id } },
      update: {},
      create: { userId: user.id, roleId: roles[roleCode].id },
    });
    if (roleCode === 'CUSTOMER') {
      await prisma.cart.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } });
      await prisma.wishlist.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id } });
    }
    return user;
  }

  await upsertDemoUser({
    email: 'customer@supplysense.local',
    fullName: 'SupplySense Customer',
    password: process.env.SEED_CUSTOMER_PASSWORD ?? 'Customer!12345',
    roleCode: 'CUSTOMER',
  });
  const manager = await upsertDemoUser({
    email: 'manager@supplysense.local',
    fullName: 'SupplySense Warehouse Manager',
    password: process.env.SEED_MANAGER_PASSWORD ?? 'Manager!12345',
    roleCode: 'WAREHOUSE_MANAGER',
  });
  await upsertDemoUser({
    email: 'auditor@supplysense.local',
    fullName: 'SupplySense Auditor',
    password: process.env.SEED_AUDITOR_PASSWORD ?? 'Auditor!12345',
    roleCode: 'AUDITOR',
  });
  const supplierUser = await upsertDemoUser({
    email: 'supplier@supplysense.local',
    fullName: 'Acme Hydration Supplier',
    password: process.env.SEED_SUPPLIER_PASSWORD ?? 'Supplier!12345',
    roleCode: 'SUPPLIER',
  });

  const categoriesData = Object.entries(PRODUCT_TEMPLATES).map(([slug, template]) => ({ name: template.category, slug }));

  const categoryMap = {};
  for (const cat of categoriesData) {
    const createdCat = await prisma.category.upsert({
      where: { slug: cat.slug },
      update: { name: cat.name, isActive: true },
      create: { name: cat.name, slug: cat.slug },
    });
    categoryMap[cat.slug] = createdCat.id;
  }

  const existingProducts = await prisma.product.findMany({
    where: { isActive: true },
    select: { id: true, slug: true, variants: { select: { sku: true } } },
  });
  const legacyDemoIds = existingProducts
    .filter(({ slug, variants }) => /-\d+$/.test(slug) && variants.length > 0 && variants.every(({ sku }) => /^[A-Z0-9]{8}$/.test(sku)))
    .map(({ id }) => id);
  if (legacyDemoIds.length) {
    await prisma.product.updateMany({ where: { id: { in: legacyDemoIds } }, data: { isActive: false } });
    await prisma.productVariant.updateMany({ where: { productId: { in: legacyDemoIds } }, data: { isActive: false } });
    console.log(`Archived ${legacyDemoIds.length} legacy demo products.`);
  }

  console.log('Seeding 2,000 curated products...');
  const productRows = [];
  const variantRows = [];
  const imageRows = [];
  const productsBySlug = new Map();
  let productNumber = 0;

  for (const [categorySlug, template] of Object.entries(PRODUCT_TEMPLATES)) {
    for (const productType of template.names) {
      for (const brand of template.brands) {
        productNumber += 1;
        const name = `${brand} ${productType}`;
        const slug = `${categorySlug}-${name}`
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '');
        const photo = catalogPhotos[slug];
        if (!photo?.url || !photo?.sourcePage || !photo?.license) {
          throw new Error(`Missing a licensed product photo for ${name}.`);
        }
        const imageUrl = photo.url;
        const variantConfiguration = getProductVariantConfiguration(categorySlug, productType);
        const price = (99 + ((productNumber * 137) % 99000) / 100).toFixed(2);
        const product = {
          categoryId: categoryMap[categorySlug],
          name,
          slug,
          description: `${name} is a practical ${template.category.toLowerCase()} essential. ${template.description}`,
          isActive: true,
        };
        productRows.push(product);
        for (const [optionIndex, option] of variantConfiguration.options.entries()) {
          const skuNumber = (productNumber - 1) * variantConfiguration.options.length + optionIndex + 1;
          variantRows.push({
            sku: `SS-CUR-${categorySlug.slice(0, 3).toUpperCase()}-${String(skuNumber).padStart(6, '0')}`,
            productSlug: slug,
            price,
            attributes: { option, optionLabel: variantConfiguration.label },
            currency: 'INR',
            isActive: true,
          });
        }
        imageRows.push({
          productSlug: slug,
          imageUrl,
          altText: `Photo ${photo.title} · by ${photo.artist || 'Wikimedia Commons contributor'} · ${photo.license} · ${photo.sourcePage}`,
          sortOrder: 0,
        });
        productsBySlug.set(slug, product);
      }
    }
  }

  const expectedSlugs = new Set(productsBySlug.keys());
  const oldCatalogProducts = await prisma.product.findMany({
    where: { isActive: true, variants: { some: { sku: { startsWith: 'SS-' } } } },
    select: { id: true, slug: true },
  });
  const staleCatalogIds = oldCatalogProducts
    .filter(({ slug }) => !expectedSlugs.has(slug))
    .map(({ id }) => id);
  if (staleCatalogIds.length) {
    await prisma.product.updateMany({ where: { id: { in: staleCatalogIds } }, data: { isActive: false } });
    await prisma.productVariant.updateMany({ where: { productId: { in: staleCatalogIds } }, data: { isActive: false } });
    console.log(`Archived ${staleCatalogIds.length} outdated seeded products.`);
  }
  const orphanedProducts = await prisma.product.updateMany({
    where: { isActive: true, variants: { none: { isActive: true } } },
    data: { isActive: false },
  });
  if (orphanedProducts.count) console.log(`Archived ${orphanedProducts.count} products without active options.`);

  await prisma.product.createMany({ data: productRows, skipDuplicates: true });
  const seededProducts = await prisma.product.findMany({
    where: { slug: { in: [...productsBySlug.keys()] } },
    select: { id: true, slug: true, name: true, categoryId: true, description: true },
  });
  const productIds = new Map(seededProducts.map(({ id, slug }) => [slug, id]));
  const productUpdates = seededProducts.flatMap((existing) => {
    const desired = productsBySlug.get(existing.slug);
    if (existing.name === desired.name && existing.categoryId === desired.categoryId && existing.description === desired.description) return [];
    return [prisma.product.update({ where: { id: existing.id }, data: { name: desired.name, categoryId: desired.categoryId, description: desired.description, isActive: true } })];
  });
  if (productUpdates.length) await prisma.$transaction(productUpdates);
  const previousVariants = await prisma.productVariant.findMany({
    where: { productId: { in: seededProducts.map(({ id }) => id) }, sku: { startsWith: 'SS-' } },
    select: { id: true, sku: true },
  });
  const previousVariantIds = previousVariants
    .filter(({ sku }) => !sku.startsWith('SS-CUR-'))
    .map(({ id }) => id);
  if (previousVariantIds.length) {
    await prisma.productVariant.updateMany({ where: { id: { in: previousVariantIds } }, data: { isActive: false } });
  }
  await createManyInBatches(prisma.productVariant, variantRows.map(({ productSlug, ...variant }) => ({ ...variant, productId: productIds.get(productSlug) })));
  const optionBySku = new Map(variantRows.map(({ sku, attributes }) => [sku, attributes]));
  const activeSeededVariants = await prisma.productVariant.findMany({
    where: { productId: { in: seededProducts.map(({ id }) => id) }, sku: { startsWith: 'SS-CUR-' } },
    select: { id: true, sku: true, attributes: true },
  });
  const changedOptionRows = activeSeededVariants.filter(({ sku, attributes }) => {
    const desired = optionBySku.get(sku);
    return desired && JSON.stringify(attributes) !== JSON.stringify(desired);
  });
  for (let index = 0; index < changedOptionRows.length; index += 500) {
    const batch = changedOptionRows.slice(index, index + 500);
    await prisma.$transaction(batch.map(({ id, sku }) => prisma.productVariant.update({ where: { id }, data: { attributes: optionBySku.get(sku) } })));
  }
  await prisma.productImage.deleteMany({
    where: {
      productId: { in: seededProducts.map(({ id }) => id) },
      OR: [
        { imageUrl: { contains: 'loremflickr.com' } },
        { imageUrl: { startsWith: 'data:image/svg+xml' } },
      ],
    },
  });
  const existingImages = await prisma.productImage.findMany({
    where: { productId: { in: seededProducts.map(({ id }) => id) } },
    select: { id: true, productId: true, imageUrl: true, variantId: true },
  });
  const photoByUrl = new Map(imageRows.map((image) => [image.imageUrl, image]));
  const existingCatalogPhotos = existingImages.filter(({ variantId, imageUrl }) =>
    variantId === null && (imageUrl.startsWith('data:image/svg+xml') || imageUrl.includes('wikimedia.org')),
  );
  const existingByProduct = new Map(existingCatalogPhotos.map((image) => [image.productId, image]));
  const photoUpdates = imageRows.flatMap((image) => {
    const productId = productIds.get(image.productSlug);
    const existing = existingByProduct.get(productId);
    if (!existing) return [];
    const desired = photoByUrl.get(image.imageUrl);
    return existing.imageUrl === desired.imageUrl && existing.altText === desired.altText
      ? []
      : [prisma.productImage.update({ where: { id: existing.id }, data: { imageUrl: desired.imageUrl, altText: desired.altText } })];
  });
  if (photoUpdates.length) await prisma.$transaction(photoUpdates);
  const productsWithImages = new Set(existingImages.map(({ productId }) => productId));
  await createManyInBatches(prisma.productImage, imageRows
    .filter(({ productSlug }) => !productsWithImages.has(productIds.get(productSlug)))
    .map(({ productSlug, ...image }) => ({ ...image, productId: productIds.get(productSlug) })));

  const warehouses = [];
  for (const item of [
    { code: 'DEL-WH-01', name: 'Delhi Warehouse', city: 'New Delhi', state: 'Delhi' },
    { code: 'MUM-WH-01', name: 'Mumbai Warehouse', city: 'Mumbai', state: 'Maharashtra' },
    { code: 'KOL-WH-01', name: 'Kolkata Warehouse', city: 'West Bengal', state: 'West Bengal' },
    { code: 'CHE-WH-01', name: 'Chennai Warehouse', city: 'Chennai', state: 'Tamil Nadu' },
    { code: 'BNG-WH-01', name: 'Bangalore Warehouse', city: 'Bangalore', state: 'Karnataka' },
  ]) {
    warehouses.push(await prisma.warehouse.upsert({
      where: { code: item.code },
      update: { name: item.name, isActive: true },
      create: {
        ...item,
        addressLine1: 'SupplySense Operations Center',
        postalCode: '110001',
        country: 'India',
      },
    }));
  }

  const allVariants = await prisma.productVariant.findMany({
    where: { sku: { startsWith: 'SS-CUR-' }, isActive: true, product: { isActive: true } },
    select: { id: true },
  });
  for (const warehouse of warehouses) {
    const inventoryRows = allVariants.map((variant, index) => ({
        warehouseId: warehouse.id,
        variantId: variant.id,
        onHandQuantity: 10 + ((index * 17 + warehouse.code.length) % 191),
      }));
    await createManyInBatches(prisma.inventory, inventoryRows);
  }

  for (const warehouse of warehouses) {
    await prisma.managerWarehouse.upsert({
      where: { managerId_warehouseId: { managerId: manager.id, warehouseId: warehouse.id } },
      update: {},
      create: { managerId: manager.id, warehouseId: warehouse.id },
    });
  }

  const supplier = await prisma.supplier.upsert({
    where: { code: 'SUP-ACME-01' },
    update: { name: 'Acme Hydration Supplies', isActive: true, userId: supplierUser.id },
    create: {
      code: 'SUP-ACME-01',
      name: 'Acme Hydration Supplies',
      email: 'orders@acme-hydration.local',
      userId: supplierUser.id,
    },
  });

  const someVariants = allVariants.slice(0, 200);
  for (const v of someVariants) {
    const variant = await prisma.productVariant.findUnique({ where: { id: v.id }, select: { id: true, productId: true } });
    const product = seededProducts.find(({ id }) => id === variant.productId);
    if (!product) continue;
    await prisma.supplierProduct.upsert({
      where: { supplierId_variantId: { supplierId: supplier.id, variantId: v.id } },
      update: { isActive: true },
      create: {
        supplierId: supplier.id,
        variantId: v.id,
        supplierSku: "ACME-" + v.id.slice(0,8),
        unitCost: '11.50',
        leadTimeDays: 5,
        minimumOrderQty: 20,
        packSize: 10,
      },
    });
  }

  console.log('SupplySense seed complete.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
