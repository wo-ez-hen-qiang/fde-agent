import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FeishuCrypto } from "./feishu-crypto.js";

describe("FeishuCrypto", () => {
  it("decrypts the official Feishu sample payload", () => {
    // sample from the Feishu "Encrypt Key" docs
    const c = new FeishuCrypto("test key");
    assert.equal(c.decrypt("P37w+VZImNgPEO1RBhJ6RtKl7n6zymIbEG1pReEzghk="), "hello world");
  });

  it("round-trips encrypt -> decrypt (unicode JSON)", () => {
    const c = new FeishuCrypto("k3y");
    const plain = JSON.stringify({ text: "订单支付失败 500", n: 1 });
    assert.equal(c.decrypt(c.encrypt(plain)), plain);
  });

  it("fails to decrypt with a wrong key", () => {
    const enc = new FeishuCrypto("right").encrypt(JSON.stringify({ a: 1 }));
    assert.throws(() => new FeishuCrypto("wrong").decrypt(enc));
  });

  it("rejects malformed ciphertext", () => {
    assert.throws(() => new FeishuCrypto("k").decrypt("c2hvcnQ="));
  });

  it("computes sha256(timestamp + nonce + key + body) signatures", () => {
    const c = new FeishuCrypto("key");
    const sig = c.sign("1700000000", "nonce", '{"encrypt":"x"}');
    assert.match(sig, /^[0-9a-f]{64}$/);
    assert.equal(c.verifySignature("1700000000", "nonce", '{"encrypt":"x"}', sig), true);
    assert.equal(c.verifySignature("1700000000", "nonce", '{"encrypt":"y"}', sig), false);
    assert.equal(c.verifySignature("1700000001", "nonce", '{"encrypt":"x"}', sig), false);
    assert.equal(c.verifySignature("1700000000", "nonce", '{"encrypt":"x"}', "deadbeef"), false);
  });
});
