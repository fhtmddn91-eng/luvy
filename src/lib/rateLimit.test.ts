import { describe, it, expect } from "vitest";
import { hit, reset, count, retryMessage, type RateLimitRule } from "./rateLimit";

const RULE: RateLimitRule = { limit: 3, windowMs: 1000 };

const fresh = () => new Map<string, number[]>();

describe("rateLimit", () => {
  it("한도까지는 통과하고 초과하면 막는다", () => {
    const s = fresh();
    expect(hit("a", RULE, 0, s).ok).toBe(true);
    expect(hit("a", RULE, 10, s).ok).toBe(true);
    expect(hit("a", RULE, 20, s).ok).toBe(true);
    const blocked = hit("a", RULE, 30, s);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("남은 횟수를 정확히 알려준다", () => {
    const s = fresh();
    expect(hit("a", RULE, 0, s).remaining).toBe(2);
    expect(hit("a", RULE, 1, s).remaining).toBe(1);
    expect(hit("a", RULE, 2, s).remaining).toBe(0);
  });

  it("윈도우가 지나면 다시 허용한다", () => {
    const s = fresh();
    for (let i = 0; i < 3; i++) hit("a", RULE, i, s);
    expect(hit("a", RULE, 500, s).ok).toBe(false);
    // 첫 시도(t=0)가 윈도우를 벗어나는 시점
    expect(hit("a", RULE, 1001, s).ok).toBe(true);
  });

  it("차단 시 남은 대기 시간을 초로 알려준다", () => {
    const s = fresh();
    for (let i = 0; i < 3; i++) hit("a", RULE, 0, s);
    const r = hit("a", RULE, 200, s);
    expect(r.ok).toBe(false);
    expect(r.retryAfterSec).toBe(1); // (0 + 1000 - 200) / 1000 → 올림 1초
  });

  it("키가 다르면 서로 영향을 주지 않는다", () => {
    const s = fresh();
    for (let i = 0; i < 3; i++) hit("a", RULE, i, s);
    expect(hit("a", RULE, 5, s).ok).toBe(false);
    expect(hit("b", RULE, 5, s).ok).toBe(true);
  });

  it("reset 하면 카운터가 비워진다 (로그인 성공 시)", () => {
    const s = fresh();
    for (let i = 0; i < 3; i++) hit("a", RULE, i, s);
    expect(hit("a", RULE, 5, s).ok).toBe(false);
    reset("a", s);
    expect(hit("a", RULE, 6, s).ok).toBe(true);
  });

  it("차단이 계속돼도 기록이 무한히 쌓이지 않는다", () => {
    const s = fresh();
    for (let i = 0; i < 200; i++) hit("a", RULE, i * 10, s);
    // 윈도우(1초) 안의 기록만 남아야 한다
    expect(count("a", RULE, 2000, s)).toBeLessThanOrEqual(RULE.limit);
    expect(s.get("a")!.length).toBeLessThanOrEqual(RULE.limit);
  });

  it("안내 문구는 초/분을 구분한다", () => {
    expect(retryMessage(30)).toBe("30초 후 다시 시도해주세요.");
    expect(retryMessage(120)).toBe("2분 후 다시 시도해주세요.");
    expect(retryMessage(61)).toBe("2분 후 다시 시도해주세요.");
  });
});
