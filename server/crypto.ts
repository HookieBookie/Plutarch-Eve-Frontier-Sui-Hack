/**
 * Location encryption — AES-256-GCM encryption for SSU location data.
 *
 * Encrypts system names, L-point details, and coordinates so they are
 * unreadable when inspecting the SQLite database directly.
 *
 * Key management:
 *   1. If env var LOCATION_ENCRYPTION_KEY is set (64-char hex = 32 bytes), use it.
 *   2. Otherwise auto-generate a key and persist to `.location-key` next to the DB.
 */
import crypto from "node:crypto";
import path from "node:path";
import fs from "node:fs";

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // 96-bit IV for GCM

let _key: Buffer | null = null;

/** Initialise the encryption key. Call once at server start. */
export function initLocationKey(dappsDir: string): void {
  const envKey = process.env.LOCATION_ENCRYPTION_KEY;
  if (envKey && envKey.length === 64) {
    _key = Buffer.from(envKey, "hex");
    return;
  }

  const keyPath = path.join(dappsDir, ".location-key");
  if (fs.existsSync(keyPath)) {
    _key = Buffer.from(fs.readFileSync(keyPath, "utf-8").trim(), "hex");
    return;
  }

  // First run — generate and persist a new key
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyPath, key.toString("hex"), { mode: 0o600 });
  _key = key;
}

/** Encrypt a plaintext string. Returns `iv:ciphertext:tag` in hex. */
export function encryptField(value: string): string {
  if (!_key) throw new Error("Location encryption key not initialised");
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, _key, iv);
  const enc = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${enc.toString("hex")}:${tag.toString("hex")}`;
}

/** Decrypt a ciphertext produced by encryptField. Falls back to returning the raw value for legacy unencrypted data. */
export function decryptField(ciphertext: string): string {
  if (!_key) throw new Error("Location encryption key not initialised");
  if (!ciphertext) return ciphertext;

  const parts = ciphertext.split(":");
  if (parts.length !== 3) return ciphertext; // unencrypted legacy value

  const [ivHex, encHex, tagHex] = parts;
  try {
    const decipher = crypto.createDecipheriv(ALGO, _key, Buffer.from(ivHex, "hex"));
    decipher.setAuthTag(Buffer.from(tagHex, "hex"));
    return decipher.update(Buffer.from(encHex, "hex"), undefined, "utf8") + decipher.final("utf8");
  } catch {
    return ciphertext; // can't decrypt — return as-is (legacy)
  }
}
