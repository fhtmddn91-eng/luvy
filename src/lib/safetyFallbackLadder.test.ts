/**
 * 국소 폴백(안전필터 거부 → 글자 띠 편집) 통합 테스트.
 *
 * 감사(2026-08-31)에서 못 박은 계약:
 *  1. 폴백은 구조화된 안전 코드 화이트리스트에서만 발동 — 미반환(NO_IMAGE)·
 *     429·GIF·비활성 상태에서는 절대 발동하지 않는다
 *  2. 연쇄 병합으로 커진 거대 띠(면적 상한 초과)는 모델로 보내지 않는다 —
 *     "글자 영역만 보낸다"는 최소 범위 편집의 전제
 *  3. 이미지 호출은 폴백 예산(5회)을 절대 넘지 않는다
 *  4. 잔존 검사가 실패하면 침묵 채택하지 않고 사유에 남긴다
 *  5. 어떤 결과도 후보(NEEDS_REVIEW)행 — 검수 사유(SAFETY_FALLBACK)가 붙는다
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import sharp from "sharp";
import {
  renderSafetyFallback,
  shouldAttemptSafetyFallback,
  type OcrBox,
} from "./imageTranslate";

/* ── 1. 발동 조건 (화이트리스트) ───────────────────────────── */

describe("shouldAttemptSafetyFallback — 발동 화이트리스트", () => {
  it("안전 코드 거부에서만 발동한다", () => {
    expect(shouldAttemptSafetyFallback("모델 거부(PROHIBITED_CONTENT) [block=프롬프트 차단]", "image/jpeg", true)).toBe(true);
    expect(shouldAttemptSafetyFallback("모델 거부(SAFETY) [finish=생성 중단]", "image/jpeg", true)).toBe(true);
    expect(shouldAttemptSafetyFallback("모델 거부(IMAGE_SAFETY)", "image/png", true)).toBe(true);
  });

  it("미반환(NO_IMAGE)은 발동하지 않는다 — 재시도 1회면 뒤집히는 일시 증상", () => {
    expect(shouldAttemptSafetyFallback("이미지 모델이 이미지를 반환하지 않음", "image/jpeg", true)).toBe(false);
  });

  it("모르는 코드·비안전 종료·API 오류는 발동하지 않는다", () => {
    expect(shouldAttemptSafetyFallback("모델 거부(RECITATION)", "image/jpeg", true)).toBe(false);
    expect(shouldAttemptSafetyFallback("API 오류 429 (RESOURCE_EXHAUSTED)", "image/jpeg", true)).toBe(false);
    expect(shouldAttemptSafetyFallback("시간 초과 (1회 시도)", "image/jpeg", true)).toBe(false);
  });

  it("GIF·비활성(자동 흐름)에서는 안전 코드라도 발동하지 않는다", () => {
    expect(shouldAttemptSafetyFallback("모델 거부(PROHIBITED_CONTENT)", "image/gif", true)).toBe(false);
    expect(shouldAttemptSafetyFallback("모델 거부(PROHIBITED_CONTENT)", "image/jpeg", false)).toBe(false);
  });
});

/* ── 2~4. 사다리 통합 (fetch 를 막아 실제 호출 없이) ───────── */

const box = (b: [number, number, number, number], over: Partial<OcrBox> = {}): OcrBox => ({
  box: b, zh: "强震模式", ko: "강력 진동", bg: "#ffffff", fg: "#000000", solid_bg: true, ...over,
});

/** 테스트용 원본 — 단색 400×400 JPEG */
const makeImage = () =>
  sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 240, g: 220, b: 210 } } })
    .jpeg()
    .toBuffer();

type FetchLog = { image: number; text: number };

/**
 * Gemini API 흉내 — 이미지 생성 호출과 텍스트(판독) 호출을 본문으로 구분한다.
 * imageMode: "refuse" = 안전 거부, "echo" = 요청 crop 과 같은 크기의 PNG 반환
 * textMode: "korean" = 한국어만 판독, "fail" = 500 오류
 */
function stubGemini(log: FetchLog, imageMode: "refuse" | "echo", textMode: "korean" | "fail") {
  vi.stubGlobal("fetch", async (_url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as {
      contents?: { parts?: { inline_data?: { data?: string } }[] }[];
      generationConfig?: { responseModalities?: string[] };
    };
    const isImage = body.generationConfig?.responseModalities?.includes("IMAGE") === true;
    if (isImage) {
      log.image++;
      if (imageMode === "refuse") {
        return new Response(
          JSON.stringify({ candidates: [{ finishReason: "PROHIBITED_CONTENT", content: { parts: [] } }] }),
          { status: 200 },
        );
      }
      const b64 = body.contents?.[0]?.parts?.find((p) => p.inline_data?.data)?.inline_data?.data ?? "";
      const src = Buffer.from(b64, "base64");
      const meta = await sharp(src).metadata();
      const png = await sharp({
        create: { width: meta.width ?? 64, height: meta.height ?? 64, channels: 3, background: { r: 250, g: 245, b: 240 } },
      })
        .png()
        .toBuffer();
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: png.toString("base64") } }] } }] }),
        { status: 200 },
      );
    }
    log.text++;
    if (textMode === "fail") return new Response("{}", { status: 500 });
    return new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify([{ box: [100, 100, 200, 800], text: "강력 진동" }]) }] } }],
      }),
      { status: 200 },
    );
  });
}

describe("renderSafetyFallback — 사다리·상한·사유", () => {
  const log: FetchLog = { image: 0, text: 0 };
  beforeEach(() => {
    log.image = 0;
    log.text = 0;
    process.env.GEMINI_API_KEY = "test-key";
  });
  afterEach(() => vi.unstubAllGlobals());

  it("띠까지 전부 거부되면 로컬로 강등하되 호출 상한(5회)을 절대 넘지 않는다", async () => {
    stubGemini(log, "refuse", "korean");
    const img = await makeImage();
    const r = await renderSafetyFallback(img, "image/jpeg", [box([100, 100, 250, 600])]);
    expect(r.data.byteLength).toBeGreaterThan(0);
    // 명시적 검수 안내(이음새·자국) — NEEDS_REVIEW 사유에 실리는 문장
    expect(r.note).toContain("확인해주세요");
    expect(r.note).toContain("덧댄 자국");
    expect(log.image).toBeLessThanOrEqual(5);
  }, 60_000);

  it("면적 상한을 넘는 거대 띠는 모델로 보내지 않는다 (이미지 호출 0회)", async () => {
    stubGemini(log, "refuse", "korean");
    const img = await makeImage();
    await expect(
      renderSafetyFallback(img, "image/jpeg", [box([0, 0, 1000, 1000])]),
    ).rejects.toThrow(/국소 편집이 불가능/);
    expect(log.image).toBe(0);
  }, 60_000);

  it("잔존 검사가 실패하면 침묵 채택하지 않고 사유에 남긴다", async () => {
    stubGemini(log, "echo", "fail");
    const img = await makeImage();
    const r = await renderSafetyFallback(img, "image/jpeg", [box([100, 100, 250, 600])]);
    expect(r.note).toContain("남은 글자 확인이 안 됐습니다");
  }, 60_000);

  it("재생성이 깨끗하면 잔존·경고 없이 검수 안내만 남는다", async () => {
    stubGemini(log, "echo", "korean");
    const img = await makeImage();
    const r = await renderSafetyFallback(img, "image/jpeg", [box([100, 100, 250, 600])]);
    expect(r.note).toContain("자동으로 고쳤습니다");
    expect(r.note).not.toContain("남았을 수 있는 글자");
    expect(r.note).not.toContain("확인이 안 됐습니다");
  }, 60_000);
});
