import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt);
const KEY_LENGTH = 64;

/**
 * Hashes a plaintext password using crypto.scrypt with a 128-bit cryptographic salt.
 * Format: `<salt_hex>:<derived_key_hex>`
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derivedKey = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

/**
 * Constant-time verification of plaintext password against stored scrypt hash.
 * Mitigates timing attacks and handles malformed hash strings safely.
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  if (!storedHash || !storedHash.includes(":")) {
    return false;
  }
  const [salt, key] = storedHash.split(":");
  if (!salt || !key) {
    return false;
  }
  try {
    const keyBuffer = Buffer.from(key, "hex");
    const derivedKey = (await scryptAsync(password, salt, KEY_LENGTH)) as Buffer;
    if (keyBuffer.length !== derivedKey.length) {
      return false;
    }
    return timingSafeEqual(keyBuffer, derivedKey);
  } catch {
    return false;
  }
}
