/**
 * FNV-1a (32-bit) — a fast, non-cryptographic hash with good distribution.
 * Used to map a logical key onto one of N buckets, deterministically.
 *
 * The "1a" variant XORs the byte first, then multiplies by the FNV prime,
 * which gives better avalanche than plain FNV-1.
 *
 * @returns An unsigned 32-bit integer.
 */
export function fnv1a(input: string): number {
  let hash = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime, 32-bit safe multiply
  }
  return hash >>> 0; // coerce to unsigned 32-bit
}
