export function decimalToCents(value) {
  const normalized = String(value);
  const [whole, fraction = ''] = normalized.split('.');
  return BigInt(whole) * 100n + BigInt((fraction + '00').slice(0, 2));
}

export function centsToDecimal(cents) {
  const value = BigInt(cents);
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${String(absolute % 100n).padStart(2, '0')}`;
}
