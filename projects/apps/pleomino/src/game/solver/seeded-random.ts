export function normalizeSeed(seed: number): number {
  const value = Math.trunc(seed);
  const normalized = value >>> 0;
  return normalized === 0 ? 0x9e3779b9 : normalized;
}

export function mixSeed32(seed: number): number {
  let value = seed >>> 0;
  value ^= value >>> 16;
  value = Math.imul(value, 0x85ebca6b);
  value ^= value >>> 13;
  value = Math.imul(value, 0xc2b2ae35);
  value ^= value >>> 16;
  return value >>> 0;
}
