// Canonical state hashing (docs/30 §3.4). Used by replay verification and the determinism
// tests: two runs of the same scenario+seed+inputs must produce identical hashes every tick.
//
// Canonical means: object keys are sorted, numbers are quantized to 9 decimals (so harmless
// float noise doesn't flip the hash), and -0 normalizes to 0.

/** Deterministic JSON-ish serialization: sorted keys, quantized numbers. */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return String(value);
    const q = value === 0 ? 0 : value; // normalize -0
    return q.toFixed(9);
  }
  if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value instanceof Map) {
    const entries = [...value.entries()].map(([k, v]) => [String(k), v] as const);
    entries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
  }
  if (value instanceof Set) {
    return `[${[...value].map(canonicalize).sort().join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(String(value));
}

/** FNV-1a over the canonical form, as 8 hex chars. */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function stateHash(state: unknown): string {
  return hashString(canonicalize(state));
}
