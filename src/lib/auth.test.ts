import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, signSession, verifySession } from "./session";

describe("password hashing", () => {
  it("verifies a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("luvy1234");
    expect(await verifyPassword("luvy1234", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
});

describe("session token", () => {
  it("round-trips the userId", async () => {
    const token = await signSession({ userId: "user_1" });
    const payload = await verifySession(token);
    expect(payload?.userId).toBe("user_1");
  });
  it("returns null for a tampered token", async () => {
    const token = await signSession({ userId: "user_1" });
    expect(await verifySession(token + "x")).toBeNull();
  });
});
