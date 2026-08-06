import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ImportDraft } from "./types";

// getCategories 는 DB를 부르므로 고정 목록으로 대체
vi.mock("@/lib/categories", () => ({
  getCategories: async () => [
    { slug: "women", name: "여성용품" },
    { slug: "lotion", name: "마사지 & 로션" },
  ],
}));
vi.mock("server-only", () => ({}));

import { translateDraft, isTranslatorConfigured } from "./translate";

const draft: ImportDraft = {
  sourceId: "12345",
  sourceUrl: "https://detail.1688.com/offer/12345.html",
  rawTitle: "情趣内衣",
  rawAttributes: [{ label: "材质", value: "蕾丝" }],
  priceTiers: [],
  imageUrls: [],
  detailImageUrls: [],
} as unknown as ImportDraft;

describe("translateDraft (Gemini)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("키가 없으면 API를 부르지 않고 원문 fallback", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const r = await translateDraft(draft);
    expect(r.translated).toBe(false);
    expect(r.note).toContain("GEMINI_API_KEY");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(isTranslatorConfigured()).toBe(false);
  });

  it("Gemini 형식으로 호출하고(candidates 응답) 결과를 해석한다", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    let captured: { url: string; init: RequestInit } | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        captured = { url, init };
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    { text: '{"name":"레이스 슬립","description":"부드러운 레이스 소재.","categorySlug":"women"}' },
                  ],
                },
              },
            ],
          }),
          { status: 200 },
        );
      }),
    );

    const r = await translateDraft(draft);

    // 요청 형식: Gemini 엔드포인트 + 헤더 키(쿼리스트링 아님) + JSON 강제
    expect(captured!.url).toContain("generativelanguage.googleapis.com");
    expect(captured!.url).not.toContain("key="); // 키가 URL에 노출되면 안 된다
    const headers = captured!.init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("test-key");
    const body = JSON.parse(String(captured!.init.body));
    expect(body.systemInstruction.parts[0].text).toContain("상품 등록 담당자");
    expect(body.contents[0].parts[0].text).toContain("情趣内衣");
    expect(body.generationConfig.responseMimeType).toBe("application/json");

    // 응답 해석
    expect(r.translated).toBe(true);
    expect(r.name).toBe("레이스 슬립");
    expect(r.categorySlug).toBe("women");
    expect(r.description).toContain("[원본] https://detail.1688.com/offer/12345.html");
  });

  it("API 오류면 원문 fallback + 상태코드 기록", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("quota", { status: 429 })));

    const r = await translateDraft(draft);
    expect(r.translated).toBe(false);
    expect(r.note).toContain("429");
    expect(r.name).toBe("情趣内衣"); // 원문 유지
  });

  it("목록에 없는 카테고리를 답하면 버린다 (환각 방지)", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: '{"name":"이름","description":"설명","categorySlug":"없는슬러그"}' }] } },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const r = await translateDraft(draft);
    expect(r.translated).toBe(true);
    expect(r.categorySlug).toBe("");
  });
});
