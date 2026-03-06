import { describe, it, expect } from "vitest";
import { sanitizeFmFindValue, encodeBasicAuth } from "../src/utils.js";

// ─── sanitizeFmFindValue ────────────────────────────────────────────────────

describe("sanitizeFmFindValue", () => {
  it("passes through a normal string unchanged", () => {
    expect(sanitizeFmFindValue("jdoe")).toBe("jdoe");
  });

  it("passes through an empty string", () => {
    expect(sanitizeFmFindValue("")).toBe("");
  });

  it("strips single-character FM Find operators", () => {
    expect(sanitizeFmFindValue("=!<>≤≥~*@#/\\")).toBe("");
  });

  it("strips double-quote character", () => {
    expect(sanitizeFmFindValue('user"name')).toBe("username");
  });

  it("strips operators while preserving normal characters", () => {
    expect(sanitizeFmFindValue("j*doe@example")).toBe("jdoeexample");
  });

  it("does not strip safe special characters (hyphen, underscore, dot, space)", () => {
    expect(sanitizeFmFindValue("j.doe-name_1 test")).toBe("j.doe-name_1 test");
  });

  it("handles a string that is entirely operators", () => {
    expect(sanitizeFmFindValue("==><!*")).toBe("");
  });
});

// ─── encodeBasicAuth ────────────────────────────────────────────────────────

describe("encodeBasicAuth", () => {
  it("encodes username:password as base64", () => {
    const result = encodeBasicAuth("user", "pass");
    expect(result).toBe(Buffer.from("user:pass", "utf8").toString("base64"));
  });

  it("handles colon in password", () => {
    const result = encodeBasicAuth("user", "p:a:ss");
    expect(result).toBe(Buffer.from("user:p:a:ss", "utf8").toString("base64"));
  });

  it("handles non-ASCII characters", () => {
    const result = encodeBasicAuth("über", "paß");
    expect(result).toBe(Buffer.from("über:paß", "utf8").toString("base64"));
  });

  it("handles empty username and password", () => {
    const result = encodeBasicAuth("", "");
    expect(result).toBe(Buffer.from(":", "utf8").toString("base64"));
  });
});
