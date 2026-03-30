/**
 * Shared SSU display-name utilities.
 * Ensures SSU hex addresses are never shown to users.
 *
 * Naming tiers (progressive):
 *   1. SSU-A3F1           — short random hex (base, no info yet)
 *   2. SSU ERR-HSD        — after system is known (via route link)
 *   3. SSU ERR-HSD P2L3   — after L-Point is known (via route endpoints)
 */

// ── Stable short identifier for unnamed SSUs ──
const anonNameCache = new Map<string, string>();

export function anonSsuName(ssuId: string): string {
  if (anonNameCache.has(ssuId)) return anonNameCache.get(ssuId)!;
  // Simple hash → 4 hex chars. Deterministic but unrelated to the raw address.
  let h = 0x9E3779B9; // golden ratio seed
  for (let i = 0; i < ssuId.length; i++) {
    h = Math.imul(h ^ ssuId.charCodeAt(i), 0x5BD1E995);
    h ^= h >>> 15;
  }
  const code = (Math.abs(h) & 0xFFFF).toString(16).toUpperCase().padStart(4, "0");
  const name = `SSU-${code}`;
  anonNameCache.set(ssuId, name);
  return name;
}

/** Returns true if the string looks like a hex address rather than a readable name. */
export function isLikelyAddress(s: string): boolean {
  // Pure hex address: 0x... (20+ chars)
  if (s.length >= 20 && /^0x[0-9a-fA-F]+$/.test(s)) return true;
  // Pure hex without prefix (30+ chars)
  if (s.length >= 30 && /^[0-9a-fA-F]+$/.test(s)) return true;
  // Prefixed address: "SSU 0x..." or "Node 0x..." etc.
  const stripped = s.replace(/^\S+\s+/, "");
  if (stripped !== s && stripped.length >= 20 && /^0x[0-9a-fA-F]+$/.test(stripped)) return true;
  return false;
}

/**
 * Build the progressive SSU label:
 *   system + P/L → "SSU <system> P<n>L<n>"
 *   system only  → "SSU <system>"
 *   nothing      → "SSU-XXXX"
 */
export function buildSsuLabel(opts: { system?: string; pNum?: string; lNum?: string }): string | null {
  const sys = opts.system?.trim();
  if (!sys) return null;
  const p = opts.pNum?.trim();
  const l = opts.lNum?.trim();
  if (p && l) return `SSU ${sys} P${p}L${l}`;
  return `SSU ${sys}`;
}

/** Sanitise any label that might contain a raw address. */
export function sanitiseLabel(label: string, ssuId: string): string {
  if (!label || isLikelyAddress(label)) return anonSsuName(ssuId);
  return label;
}

/** Display name for an SSU object with hubName. */
export function ssuDisplayName(ssu: { ssuId: string; hubName: string }): string {
  if (ssu.hubName && !isLikelyAddress(ssu.hubName)) return ssu.hubName;
  return anonSsuName(ssu.ssuId);
}
