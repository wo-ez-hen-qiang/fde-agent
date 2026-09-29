import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Feishu (Lark) event-subscription crypto.
 *
 * - Encrypted body `{ "encrypt": "<base64>" }`: AES-256-CBC, key = sha256(encryptKey),
 *   IV = first 16 bytes of the base64-decoded payload, PKCS#7 padding.
 * - Signature header `X-Lark-Signature` = sha256_hex(timestamp + nonce + encryptKey + rawBody),
 *   with timestamp/nonce from `X-Lark-Request-Timestamp` / `X-Lark-Request-Nonce`.
 *
 * Ref: https://open.feishu.cn/document/server-docs/event-subscription-guide/event-subscription-configure-/encrypt-key-encryption-configuration-case
 */
export class FeishuCrypto {
  private readonly key: Buffer;

  constructor(private readonly encryptKey: string) {
    if (!encryptKey) throw new Error("[bot-core] feishu encrypt key is empty");
    this.key = createHash("sha256").update(encryptKey, "utf8").digest();
  }

  /** Decrypt the `encrypt` field of an event body -> plaintext JSON string. */
  decrypt(encrypted: string): string {
    const buf = Buffer.from(encrypted, "base64");
    if (buf.length < 32 || (buf.length - 16) % 16 !== 0) {
      throw new Error("[bot-core] feishu encrypted payload has invalid length");
    }
    const iv = buf.subarray(0, 16);
    const decipher = createDecipheriv("aes-256-cbc", this.key, iv);
    // Node validates PKCS#7 padding itself (throws on a wrong key)
    return Buffer.concat([decipher.update(buf.subarray(16)), decipher.final()]).toString("utf8");
  }

  /** Encrypt a plaintext JSON string the way Feishu does (used by tests / local mocks). */
  encrypt(plain: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv("aes-256-cbc", this.key, iv);
    const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
    return Buffer.concat([iv, body]).toString("base64");
  }

  sign(timestamp: string, nonce: string, rawBody: string): string {
    return createHash("sha256")
      .update(timestamp + nonce + this.encryptKey + rawBody, "utf8")
      .digest("hex");
  }

  verifySignature(timestamp: string, nonce: string, rawBody: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(timestamp, nonce, rawBody), "utf8");
    const actual = Buffer.from(signature, "utf8");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }
}
