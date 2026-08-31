/**
 * 상품명 재번역 — 수집 때 번역이 실패(429 등)해 중국어 원문이 남은 상품의 복구.
 *
 * 실사례(2026-08-27): 월 한도 429로 수집 4건 중 1건이 번역 없이 저장돼
 * 어드민·검수함에 「久爱成年人情趣跳蛋…」 같은 원문 이름이 그대로 노출됐다.
 * 판매 전환 시 이름에 한자가 남아 있으면 자동으로 한 번 더 번역한다.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { retranslateName } from "./translate";

const stub = (reply: () => Response | Promise<Response>) => vi.stubGlobal("fetch", reply);

describe("retranslateName", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("한자 이름을 한국어 이름으로 바꾼다", async () => {
    process.env.GEMINI_API_KEY = "test";
    stub(async () =>
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"name":"커플용 원격 진동 에그"}' }] } }] }),
        { status: 200 },
      ),
    );
    expect(await retranslateName("久爱成年人情趣跳蛋女生用远程遥控小玩具")).toBe("커플용 원격 진동 에그");
  });

  it("실패하면 null — 호출부가 원래 이름을 유지한다", async () => {
    process.env.GEMINI_API_KEY = "test";
    stub(async () => new Response("{}", { status: 500 }));
    expect(await retranslateName("情趣用品")).toBeNull();
  });

  it("번역 결과에 여전히 한자가 남으면 실패로 친다 — 반쪽 번역 이름 금지", async () => {
    process.env.GEMINI_API_KEY = "test";
    stub(async () =>
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"name":"고급 情趣 에그"}' }] } }] }),
        { status: 200 },
      ),
    );
    expect(await retranslateName("情趣跳蛋")).toBeNull();
  });

  it("키가 없으면 호출 없이 null", async () => {
    const saved = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;
    let called = 0;
    stub(async () => { called++; return new Response("{}"); });
    expect(await retranslateName("情趣用品")).toBeNull();
    expect(called).toBe(0);
    if (saved) process.env.GEMINI_API_KEY = saved;
  });
});
