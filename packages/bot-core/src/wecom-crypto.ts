import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * WeCom callback crypto (AES-256-CBC).
 * EncodingAESKey is 43 chars; real key = base64decode(aesKey + "="), IV = key[0:16].
 */
export class WeComCrypto {
  private readonly key: Buffer;
  private readonly iv: Buffer;

  constructor(
    private readonly token: string,
    encodingAESKey: string,
    private readonly corpId: string,
  ) {
    this.key = Buffer.from(encodingAESKey + "=", "base64");
    if (this.key.length !== 32) throw new Error("[bot-core] invalid WeCom EncodingAESKey");
    this.iv = this.key.subarray(0, 16);
  }

  sign(timestamp: string, nonce: string, encryptMsg: string): string {
    const parts = [this.token, timestamp, nonce, encryptMsg].sort();
    return createHash("sha1").update(parts.join("")).digest("hex");
  }

  verifySignature(timestamp: string, nonce: string, encryptMsg: string, signature: string): boolean {
    return this.sign(timestamp, nonce, encryptMsg) === signature;
  }

  /** Decrypt base64 encrypted message -> inner payload (XML string). */
  decrypt(encryptMsg: string): string {
    const decipher = createDecipheriv("aes-256-cbc", this.key, this.iv);
    decipher.setAutoPadding(false);
    let decrypted = Buffer.concat([decipher.update(encryptMsg, "base64"), decipher.final()]);
    // remove PKCS#7 padding
    const pad = decrypted[decrypted.length - 1]!;
    decrypted = decrypted.subarray(0, decrypted.length - pad);
    // layout: 16 random bytes | 4-byte msg length (BE) | msg | corpId
    const msgLen = decrypted.readUInt32BE(16);
    const msg = decrypted.subarray(20, 20 + msgLen).toString("utf8");
    const corpId = decrypted.subarray(20 + msgLen).toString("utf8");
    if (corpId !== this.corpId) throw new Error("[bot-core] WeCom corpId mismatch");
    return msg;
  }

  /** Encrypt an inner payload (XML string) -> { encrypt, signature }. */
  encrypt(msg: string, timestamp: string, nonce: string): { encrypt: string; signature: string } {
    const msgBuf = Buffer.from(msg, "utf8");
    const lenBuf = Buffer.alloc(4);
    lenBuf.writeUInt32BE(msgBuf.length, 0);
    let plain = Buffer.concat([randomBytes(16), lenBuf, msgBuf, Buffer.from(this.corpId, "utf8")]);
    // PKCS#7 pad to 32-block
    const pad = 32 - (plain.length % 32);
    plain = Buffer.concat([plain, Buffer.alloc(pad, pad)]);
    const cipher = createCipheriv("aes-256-cbc", this.key, this.iv);
    cipher.setAutoPadding(false);
    const encrypt = Buffer.concat([cipher.update(plain), cipher.final()]).toString("base64");
    return { encrypt, signature: this.sign(timestamp, nonce, encrypt) };
  }
}

/** Minimal CDATA field extractor - sufficient for WeCom's flat message XML. */
export function xmlField(xml: string, field: string): string | undefined {
  const m = xml.match(new RegExp(`<${field}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${field}>`))
    ?? xml.match(new RegExp(`<${field}>([^<]*)</${field}>`));
  return m?.[1];
}
