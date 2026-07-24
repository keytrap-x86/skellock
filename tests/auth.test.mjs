import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  new URL("../auth.js", import.meta.url),
  "utf8"
);
const context = vm.createContext({
  crypto: webcrypto,
  TextEncoder,
  Uint8Array,
  TypeError,
  Object,
  Number,
  String,
  btoa,
  atob,
});
context.globalThis = context;
vm.runInContext(source, context);
const auth = context.SiteLockAuth;

test("creates a salted verifier and never retains plaintext", async () => {
  const first = await auth.createVerifier("mot-de-passe", 100_000);
  const second = await auth.createVerifier("mot-de-passe", 100_000);

  assert.equal(first.kind, "pbkdf2-sha256");
  assert.equal(first.iterations, 100_000);
  assert.notEqual(first.salt, second.salt);
  assert.notEqual(first.digest, second.digest);
  assert.equal(JSON.stringify(first).includes("mot-de-passe"), false);
  assert.equal(await auth.verifyPassword("mot-de-passe", first), true);
  assert.equal(await auth.verifyPassword("incorrect", first), false);
});

test("normalizes Unicode passwords consistently", async () => {
  const verifier = await auth.createVerifier("cafe\u0301-secret", 100_000);
  assert.equal(await auth.verifyPassword("café-secret", verifier), true);
});

test("rejects weak passwords and tampered verifier costs", async () => {
  await assert.rejects(
    auth.createVerifier("court", 100_000),
    /password_too_short/
  );
  assert.equal(
    auth.isValidVerifier({
      kind: "pbkdf2-sha256",
      iterations: 10_000_000,
      salt: "AAAAAAAAAAAAAAAAAAAAAA==",
      digest: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    }),
    false
  );
});
