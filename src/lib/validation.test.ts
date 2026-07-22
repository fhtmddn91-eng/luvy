import { describe, it, expect } from "vitest";
import { normalizeBizNumber, isValidBizNumber, isValidEmail } from "./validation";

describe("normalizeBizNumber", () => {
  it("strips non-digits", () => {
    expect(normalizeBizNumber("123-45-67890")).toBe("1234567890");
    expect(normalizeBizNumber(" 123 45 67890 ")).toBe("1234567890");
  });
});

describe("isValidBizNumber", () => {
  it("accepts 10 digits", () => {
    expect(isValidBizNumber("123-45-67890")).toBe(true);
  });
  it("rejects wrong length", () => {
    expect(isValidBizNumber("12345")).toBe(false);
    expect(isValidBizNumber("12345678901")).toBe(false);
  });
});

describe("isValidEmail", () => {
  it("accepts a normal email", () => {
    expect(isValidEmail("a@b.com")).toBe(true);
  });
  it("rejects malformed", () => {
    expect(isValidEmail("nope")).toBe(false);
  });
});
