(function initializeSiteLockAuth(globalScope) {
  "use strict";

  const DEFAULT_ITERATIONS = 600_000;
  const MIN_ITERATIONS = 100_000;
  const MAX_ITERATIONS = 1_000_000;
  const MIN_PASSWORD_LENGTH = 8;
  const MAX_PASSWORD_LENGTH = 128;
  const MAX_PASSWORD_BYTES = 256;
  const SALT_BYTES = 16;
  const DIGEST_BYTES = 32;

  function normalizePassword(password) {
    if (typeof password !== "string") {
      throw new TypeError("invalid_password");
    }

    const normalized = password.normalize("NFC");
    const byteLength = new TextEncoder().encode(normalized).byteLength;
    if (
      normalized.length > MAX_PASSWORD_LENGTH ||
      byteLength > MAX_PASSWORD_BYTES
    ) {
      throw new TypeError("password_too_long");
    }
    return normalized;
  }

  function validateNewPassword(password) {
    const normalized = normalizePassword(password);
    if (normalized.length < MIN_PASSWORD_LENGTH) {
      throw new TypeError("password_too_short");
    }
    return normalized;
  }

  function bytesToBase64(bytes) {
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  }

  function base64ToBytes(value) {
    if (
      typeof value !== "string" ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(value)
    ) {
      throw new TypeError("invalid_verifier");
    }

    let binary;
    try {
      binary = atob(value);
    } catch {
      throw new TypeError("invalid_verifier");
    }

    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  async function derive(password, salt, iterations) {
    const keyMaterial = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    );
    const bits = await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt,
        iterations,
      },
      keyMaterial,
      DIGEST_BYTES * 8
    );
    return new Uint8Array(bits);
  }

  function isValidVerifier(verifier) {
    if (
      !verifier ||
      verifier.kind !== "pbkdf2-sha256" ||
      !Number.isInteger(verifier.iterations) ||
      verifier.iterations < MIN_ITERATIONS ||
      verifier.iterations > MAX_ITERATIONS
    ) {
      return false;
    }

    try {
      return (
        base64ToBytes(verifier.salt).byteLength === SALT_BYTES &&
        base64ToBytes(verifier.digest).byteLength === DIGEST_BYTES
      );
    } catch {
      return false;
    }
  }

  async function createVerifier(
    password,
    iterations = DEFAULT_ITERATIONS
  ) {
    const normalized = validateNewPassword(password);
    if (
      !Number.isInteger(iterations) ||
      iterations < MIN_ITERATIONS ||
      iterations > MAX_ITERATIONS
    ) {
      throw new TypeError("invalid_iterations");
    }

    const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const digest = await derive(normalized, salt, iterations);
    return Object.freeze({
      kind: "pbkdf2-sha256",
      iterations,
      salt: bytesToBase64(salt),
      digest: bytesToBase64(digest),
    });
  }

  async function verifyPassword(password, verifier) {
    if (!isValidVerifier(verifier)) {
      return false;
    }

    let normalized;
    try {
      normalized = normalizePassword(password);
    } catch {
      return false;
    }

    const expected = base64ToBytes(verifier.digest);
    const actual = await derive(
      normalized,
      base64ToBytes(verifier.salt),
      verifier.iterations
    );

    let difference = expected.byteLength ^ actual.byteLength;
    for (let index = 0; index < expected.byteLength; index += 1) {
      difference |= expected[index] ^ (actual[index] ?? 0);
    }
    return difference === 0;
  }

  globalScope.SiteLockAuth = Object.freeze({
    DEFAULT_ITERATIONS,
    MAX_PASSWORD_LENGTH,
    MIN_PASSWORD_LENGTH,
    createVerifier,
    isValidVerifier,
    normalizePassword,
    verifyPassword,
  });
})(globalThis);
