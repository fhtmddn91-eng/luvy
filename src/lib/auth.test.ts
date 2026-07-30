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
    const token = await signSession({ userId: "user_1", sv: 0 });
    const payload = await verifySession(token);
    expect(payload?.userId).toBe("user_1");
  });
  it("returns null for a tampered token", async () => {
    const token = await signSession({ userId: "user_1", sv: 0 });
    expect(await verifySession(token + "x")).toBeNull();
  });

  it("세션 버전을 그대로 실어 보낸다 (비밀번호 변경 감지용)", async () => {
    const token = await signSession({ userId: "user_1", sv: 3 });
    expect((await verifySession(token))?.sv).toBe(3);
  });
});
