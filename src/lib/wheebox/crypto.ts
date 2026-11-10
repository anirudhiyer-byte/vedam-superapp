import crypto from "crypto";

/**
 * Wheebox payload encryption.
 *
 * Wheebox encrypts/decrypts every JSON payload and every URL path segment with a
 * fixed scheme (see their API doc, Annexure-1):
 *   - AES-128-CBC
 *   - key   = MD5(privateKey) as raw 16 bytes
 *   - IV    = the fixed 16-byte vector 0x00,0x01,…,0x0f
 *   - PKCS#7 padding
 *   - output = lowercase hex of the ciphertext
 *
 * The private key is a SECRET (WHEEBOX_PRIVATE_KEY). This module runs server-side
 * only — never import it into client code. Verified against the doc's own vector:
 *   encrypt("john.carter@wheebox.com", "8nLNssE3VEyW")
 *     === "fe2761cbfa850a8ae7e1879b0c0c979bf650315fa83d23464a42652b20126fa1"
 */

const IV = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

function keyBytes(privateKey: string): Buffer {
  return crypto.createHash("md5").update(privateKey, "utf8").digest(); // 16 bytes
}

/** Encrypt a plaintext string to Wheebox's hex form. */
export function wheeboxEncrypt(plaintext: string, privateKey: string): string {
  const c = crypto.createCipheriv("aes-128-cbc", keyBytes(privateKey), IV); // PKCS7 on by default
  return Buffer.concat([c.update(plaintext, "utf8"), c.final()]).toString("hex");
}

/** Decrypt a Wheebox hex string back to plaintext. */
export function wheeboxDecrypt(hexCipher: string, privateKey: string): string {
  const d = crypto.createDecipheriv("aes-128-cbc", keyBytes(privateKey), IV);
  return Buffer.concat([d.update(Buffer.from(hexCipher, "hex")), d.final()]).toString("utf8");
}

/** Convenience: encrypt a JSON-serialisable value (for the `val` request param). */
export function wheeboxEncryptJson(value: unknown, privateKey: string): string {
  return wheeboxEncrypt(JSON.stringify(value), privateKey);
}

/** Wheebox server-side credentials, read from env (never shipped to the client). */
export function wheeboxCreds(): { base: string; companyCode: string; accessToken: string; privateKey: string } | null {
  const base = process.env.WHEEBOX_BASE_URL;
  const companyCode = process.env.WHEEBOX_COMPANY_CODE;
  const accessToken = process.env.WHEEBOX_ACCESS_TOKEN;
  const privateKey = process.env.WHEEBOX_PRIVATE_KEY;
  if (!base || !companyCode || !accessToken || !privateKey) return null;
  return { base: base.replace(/\/+$/, ""), companyCode, accessToken, privateKey };
}
