const SHOE_SIZES = Array.from({ length: 10 }, (_, index) => `UK ${index + 5}`);
const CLOTHING_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL', '5XL', '6XL'];
const COLORS = ['Black', 'White', 'Navy', 'Grey', 'Blue', 'Green', 'Red', 'Pink', 'Beige', 'Multicolour'];
const CAPACITIES = ['250 ml', '350 ml', '500 ml', '650 ml', '750 ml', '1 L', '1.2 L', '1.5 L', '2 L', '3 L'];
const PACKS = ['Pack of 1', 'Pack of 2', 'Pack of 3', 'Pack of 4', 'Pack of 5', 'Pack of 6', 'Pack of 8', 'Pack of 10', 'Pack of 12', 'Pack of 24'];

function choice(label, options) {
  const choiceLabel = label.startsWith('Choose') ? label : `Choose ${label[0].toLowerCase()}${label.slice(1)}`;
  return { label: choiceLabel, options };
}

export function getProductVariantConfiguration(categorySlug, productName) {
  const name = productName.toLowerCase();
  if (categorySlug === 'shoes') return choice('Shoe size (UK)', SHOE_SIZES);

  if (categorySlug === 'fashion') {
    if (name.includes('sock')) {
      return choice('Sock size and pack', ['UK 4–6', 'UK 6–8', 'UK 8–10', 'UK 10–12', 'UK 4–6 · 3 pairs', 'UK 6–8 · 3 pairs', 'UK 8–10 · 3 pairs', 'UK 10–12 · 3 pairs', 'Ankle length · one size', 'Crew length · one size']);
    }
    if (/t-shirt|shirt|jeans|sweater|hoodie|dress|coat|jacket|polo|trousers|cardigan|shorts|pajamas/.test(name)) {
      return choice('Clothing size', CLOTHING_SIZES);
    }
    return choice('Colour', COLORS);
  }

  if (categorySlug === 'electronics') {
    if (name.includes('laptop sleeve')) return choice('Laptop size', ['11 inch', '12 inch', '13 inch', '13.3 inch', '14 inch', '15 inch', '15.6 inch', '16 inch', '17 inch', 'Universal fit']);
    if (name.includes('portable ssd')) return choice('Storage capacity', ['250 GB', '500 GB', '1 TB', '2 TB', '4 TB', '500 GB · USB-C', '1 TB · USB-C', '2 TB · USB-C', '1 TB · rugged', '2 TB · rugged']);
    if (name.includes('power bank')) return choice('Battery capacity', ['5,000 mAh', '10,000 mAh', '15,000 mAh', '20,000 mAh', '25,000 mAh', '10,000 mAh · slim', '20,000 mAh · fast charge', '20,000 mAh · USB-C', '10,000 mAh · wireless', '20,000 mAh · wireless']);
    if (name.includes('charger')) return choice('Charging power', ['20 W', '25 W', '30 W', '33 W', '45 W', '65 W', '80 W', '100 W', 'Dual USB-C · 45 W', 'USB-C + USB-A · 30 W']);
    if (name.includes('usb-c hub')) return choice('Port configuration', ['5-in-1', '6-in-1', '7-in-1', '8-in-1', '9-in-1', 'USB-C · HDMI', 'USB-C · Ethernet', 'USB-C · card reader', 'USB-C · dual HDMI', 'USB-C · 4K HDMI']);
    if (name.includes('keyboard')) return choice('Keyboard layout', ['60% compact', '65% compact', '75% compact', 'TKL', 'Full-size', 'Ergonomic', 'Full-size · wireless', 'TKL · wireless', 'Compact · Bluetooth', 'Full-size · Bluetooth']);
    return choice('Colour', COLORS);
  }

  if (categorySlug === 'hydration') {
    if (/straw set|tea set|tea infuser|bottle brush/.test(name)) return choice('Pack size', PACKS);
    if (/kettle/.test(name)) return choice('Kettle capacity', ['1 L', '1.2 L', '1.5 L', '1.7 L', '1.8 L', '2 L', '1.2 L · steel', '1.5 L · steel', '1.7 L · auto shut-off', '2 L · family size']);
    return choice('Capacity', CAPACITIES);
  }

  if (categorySlug === 'grocery') {
    if (name.includes('tea bags') || name.includes('green tea')) return choice('Pack size', ['10 bags', '25 bags', '50 bags', '100 bags', '200 bags', '25 bags · family pack', '50 bags · family pack', '100 bags · family pack', 'Loose tea · 100 g', 'Loose tea · 250 g']);
    if (/olive oil|coffee|honey|sauce|coconut milk|butter/.test(name)) return choice('Pack size', ['100 g / ml', '200 g / ml', '250 g / ml', '500 g / ml', '750 g / ml', '1 kg / L', '2 kg / L', 'Single pack · 250 g / ml', 'Twin pack · 250 g / ml', 'Family pack · 1 kg / L']);
    return choice('Pack size', ['100 g', '250 g', '500 g', '750 g', '1 kg', '2 kg', '5 kg', '10 kg', '500 g · family pack', '1 kg · family pack']);
  }

  if (categorySlug === 'home-living') {
    if (/bed sheets|blanket|throw blanket/.test(name)) return choice('Bed size', ['Single', 'Double', 'Queen', 'King', 'Super King', 'Single · 2-piece set', 'Double · 2-piece set', 'Queen · 2-piece set', 'King · 2-piece set', 'Super King · 2-piece set']);
    if (/towel|bath mat|curtain/.test(name)) return choice('Size', ['Small', 'Medium', 'Large', 'Extra Large', 'Set of 2', 'Set of 4', '50 × 80 cm', '60 × 100 cm', 'Standard length', 'Long length']);
    if (/set|basket|organizer|tray|frame|pillow/.test(name)) return choice('Size or pack', ['Small', 'Medium', 'Large', 'Set of 2', 'Set of 3', 'Set of 4', 'Set of 6', 'Natural', 'White', 'Black']);
    return choice('Colour or finish', COLORS);
  }

  if (categorySlug === 'beauty-care') {
    if (/soap set|brush set|care kit|mask set/.test(name)) return choice('Pack size', ['Single', 'Pack of 2', 'Pack of 3', 'Pack of 4', 'Pack of 5', 'Starter kit', 'Travel kit', 'Family pack', 'Essential set', 'Complete set']);
    return choice('Pack size', ['30 ml', '50 ml', '100 ml', '150 ml', '200 ml', '250 ml', 'Travel size · 30 ml', 'Twin pack · 100 ml', 'Twin pack · 200 ml', 'Family pack · 500 ml']);
  }

  if (categorySlug === 'sports-fitness') {
    if (/gloves|sports socks/.test(name)) return choice('Size', ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Pair · S', 'Pair · M', 'Pair · L', 'Pair · XL']);
    if (name.includes('yoga mat')) return choice('Mat thickness', ['3 mm', '4 mm', '5 mm', '6 mm', '8 mm', '10 mm', '4 mm · textured', '6 mm · textured', '6 mm · extra grip', '8 mm · extra grip']);
    if (name.includes('resistance band')) return choice('Resistance level', ['Extra light', 'Light', 'Medium', 'Heavy', 'Extra heavy', 'Set of 3', 'Set of 5', 'Loop band · light', 'Loop band · medium', 'Loop band · heavy']);
    if (/dumbbell|kettlebell|wrist weights/.test(name)) return choice('Weight', ['1 kg', '2 kg', '3 kg', '4 kg', '5 kg', '6 kg', '8 kg', '10 kg', '12 kg', '15 kg']);
    return choice('Pack or size', ['Small', 'Medium', 'Large', 'Pair', 'Set of 2', 'Set of 4', 'Set of 6', 'Light', 'Medium resistance', 'Heavy resistance']);
  }

  if (categorySlug === 'toys-games') {
    if (/blocks|puzzle|tiles|marble run/.test(name)) return choice('Piece count', ['12 pieces', '24 pieces', '50 pieces', '100 pieces', '150 pieces', '200 pieces', '300 pieces', '500 pieces', 'Starter set', 'Deluxe set']);
    return choice('Set or edition', ['Starter', 'Classic', 'Junior', 'Family', 'Travel', 'Deluxe', 'Small set', 'Medium set', 'Large set', 'Complete set']);
  }

  if (categorySlug === 'books-stationery') {
    if (/journal|notebook|planner|sketchbook|calendar|pad/.test(name)) return choice('Format', ['A6 · Pocket', 'A5', 'A4', 'B5', 'A5 · ruled', 'A5 · blank', 'A4 · ruled', 'A4 · blank', 'Hardcover', 'Softcover']);
    if (/set|cards|pencils|markers|notes|folder/.test(name)) return choice('Pack size', PACKS);
    return choice('Style', ['Black', 'Blue', 'Red', 'Green', 'Fine tip', 'Medium tip', 'Broad tip', 'Set of 2', 'Set of 3', 'Set of 5']);
  }

  return choice('Colour or style', COLORS);
}
