import { describe, it, expect, beforeAll } from "vitest";
import { encrypt, decrypt } from "../encryption";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = "test-key-for-unit-tests-only";
});

describe("encrypt / decrypt", () => {
  it("round-trips a password", () => {
    const password = "mySecretPassword123";
    const encrypted = encrypt(password);
    expect(decrypt(encrypted)).toBe(password);
  });

  it("produces different ciphertext each time (random IV)", () => {
    const password = "samePassword";
    const a = encrypt(password);
    const b = encrypt(password);
    expect(a).not.toBe(b);
    // But both decrypt to the same value
    expect(decrypt(a)).toBe(password);
    expect(decrypt(b)).toBe(password);
  });

  it("handles empty string", () => {
    const encrypted = encrypt("");
    expect(decrypt(encrypted)).toBe("");
  });

  it("handles unicode characters", () => {
    const password = "p@$$w0rd_日本語_🔑";
    const encrypted = encrypt(password);
    expect(decrypt(encrypted)).toBe(password);
  });

  it("encrypted format is iv:ciphertext hex", () => {
    const encrypted = encrypt("test");
    const parts = encrypted.split(":");
    expect(parts).toHaveLength(2);
    // IV is 16 bytes = 32 hex chars
    expect(parts[0]).toMatch(/^[0-9a-f]{32}$/);
    // Ciphertext is hex
    expect(parts[1]).toMatch(/^[0-9a-f]+$/);
  });
});
