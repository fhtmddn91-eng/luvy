/**
 * GIF 렌더 통합 — 정지 띠는 번역되고, 움직이는 글자는 얼려붙이지 않는다.
 *
 * 계약(2026-08-31 전환):
 *  1. 글자가 정지 영역이면 띠 국소 재생성으로 번역된다 (옛 좌표 패치는 실패했다)
 *  2. 결과 GIF 는 프레임 수·애니메이션을 유지한다 (전 프레임 같은 패치 = 떨림 없음)
 *  3. 글자가 움직이는 화면 위면 번역하지 않고 **한국어 사유**와 함께 실패한다
 *  4. 어떤 경우에도 이미지 호출은 예산(1회)을 넘지 않는다
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import sharp from "sharp";
import { renderTranslatedImage, type OcrBox } from "./imageTranslate";

const W = 240;
const H = 240;

/** 위쪽은 항상 같고, 아래쪽만 프레임마다 달라지는 애니메이션 GIF */
async function makeGif(animateTop: boolean): Promise<Buffer> {
  const frames: Buffer[] = [];
  for (let i = 0; i < 3; i++) {
    const shade = 40 + i * 60;
    const top = animateTop ? shade : 230;
    const bottom = animateTop ? 230 : shade;
    const raw = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) {
      const v = y < H / 2 ? top : bottom;
      raw.fill(v, y * W * 3, (y + 1) * W * 3);
    }
    frames.push(await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer());
  }
  return sharp(frames, { join: { animated: true } }).gif({ delay: [100, 100, 100] }).toBuffer();
}

/** 글자는 위쪽 절반에 있다 (0~1000 정규화) */
const topBox: OcrBox = {
  box: [80, 100, 200, 900], zh: "强震", ko: "강력 진동", bg: "#ffffff", fg: "#000000", solid_bg: true,
};

let imageCalls = 0;

/** 요청한 crop 과 같은 크기의 흰 PNG 를 돌려주는 가짜 이미지 모델 */
function stubGemini(
  mode: "ok" | "refuse",
  transcribed: string[] = ["강력 진동"],
  /** 띠 육안 심사(그림 품질) 판정을 호출 순서대로 — 없으면 항상 합격 */
  visual: { ok: boolean; issues: string[]; hard: string[] }[] = [],
) {
  imageCalls = 0;
  vi.stubGlobal("fetch", async (_u: unknown, init?: { body?: string }) => {
    const body = JSON.parse(init?.body ?? "{}") as {
      contents?: { parts?: { inline_data?: { data?: string } }[] }[];
      generationConfig?: { responseModalities?: string[] };
    };
    if (body.generationConfig?.responseModalities?.includes("IMAGE")) {
      imageCalls++;
      if (mode === "refuse") {
        return new Response(
          JSON.stringify({ candidates: [{ finishReason: "PROHIBITED_CONTENT", content: { parts: [] } }] }),
          { status: 200 },
        );
      }
      // 받은 crop 을 그대로 돌려준다 = 배경이 원본과 같은 정상 결과.
      // 흰색으로 새로 그리면 내부 배경 검사(BAND_INNER_MAX)에 정당하게 걸린다.
      const b64 = body.contents?.[0]?.parts?.find((p) => p.inline_data?.data)?.inline_data?.data ?? "";
      const png = await sharp(Buffer.from(b64, "base64")).png().toBuffer();
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: png.toString("base64") } }] } }] }),
        { status: 200 },
      );
    }
    // 띠 육안 심사 — 프롬프트로 구분한다 (그림 품질 판정 JSON 하나)
    const asked = JSON.stringify(body.contents ?? "");
    if (asked.includes("글자 부분만 잘라낸 띠")) {
      const v = visual.shift() ?? { ok: true, issues: [], hard: [] };
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(v) }] } }] }),
        { status: 200 },
      );
    }
    // 판독(텍스트) 호출 — 띠 채택 전 검사가 읽는 내용
    return new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(transcribed.map((t) => ({ box: [80, 100, 200, 900], text: t }))) }] } }] }),
      { status: 200 },
    );
  });
}

describe("renderTranslatedImage — GIF", () => {
  beforeEach(() => { process.env.GEMINI_API_KEY = "test"; });
  afterEach(() => vi.unstubAllGlobals());

  it("정지 영역의 글자는 번역되고 프레임·애니메이션이 유지된다", async () => {
    stubGemini("ok");
    const gif = await makeGif(false); // 아래쪽만 움직임 = 글자(위)는 정지
    const out = await renderTranslatedImage(gif, "image/gif", [topBox]);
    expect(out.mime).toBe("image/gif");
    const meta = await sharp(out.data, { animated: true }).metadata();
    expect(meta.pages).toBe(3); // 애니메이션 살아 있음
    expect(imageCalls).toBe(1); // 띠 하나 = 호출 1회 (예산 준수)
  }, 60_000);

  it("글자가 움직이는 화면 위면 한국어 사유와 함께 실패한다 — 얼려붙이지 않는다", async () => {
    stubGemini("ok");
    const gif = await makeGif(true); // 위쪽이 움직임 = 글자 자리가 움직인다
    await expect(renderTranslatedImage(gif, "image/gif", [topBox])).rejects.toThrow(/움직이는 화면 위/);
    expect(imageCalls).toBe(0); // 못 할 일에 돈을 쓰지 않는다
  }, 60_000);

  it("정지 띠가 둘로 갈리면(사이가 애니메이션) 승인 재렌더는 띠마다 호출한다 — 둘 다 번역", async () => {
    // 위·아래는 정지, 가운데 1/3 만 프레임마다 달라지는 GIF
    stubGemini("ok");
    const frames: Buffer[] = [];
    for (let i = 0; i < 3; i++) {
      const raw = Buffer.alloc(W * H * 3);
      for (let y = 0; y < H; y++) {
        const v = y < H / 3 ? 230 : y < (2 * H) / 3 ? 40 + i * 60 : 230;
        raw.fill(v, y * W * 3, (y + 1) * W * 3);
      }
      frames.push(await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer());
    }
    const gif = await sharp(frames, { join: { animated: true } }).gif({ delay: [100, 100, 100] }).toBuffer();
    const boxA: OcrBox = { box: [60, 100, 200, 900], zh: "强震", ko: "강력 진동", bg: "#ffffff", fg: "#000000", solid_bg: true };
    const boxB: OcrBox = { box: [800, 100, 940, 900], zh: "温热", ko: "강력 진동", bg: "#ffffff", fg: "#000000", solid_bg: true };
    const out = await renderTranslatedImage(gif, "image/gif", [boxA, boxB]);
    expect(out.mime).toBe("image/gif");
    // 합치면 가운데 애니메이션을 물어 못 합친다 — 띠 2개 = 호출 2회.
    // 예전에는 예산 1회에 걸려 두 번째 띠가 영영 원문으로 남았다 (2026-09-01 실측)
    expect(imageCalls).toBe(2);
  }, 60_000);

  it("재생성본에 기대 문구 밖 한글(겹침 인쇄)이 읽히면 1회 재시도 후 원본 유지로 실패한다", async () => {
    // 실측(2026-09-01 마리아 GIF): "인체용"이 두 번 겹쳐 "인체용 단계"로 읽혔다
    stubGemini("ok", ["강력 진동", "인체용 단계"]);
    const gif = await makeGif(false);
    await expect(renderTranslatedImage(gif, "image/gif", [topBox])).rejects.toThrow(/문구 밖 글자/);
    expect(imageCalls).toBe(2); // 첫 시도 + 재시도 1회 — 그 이상 쓰지 않는다
  }, 60_000);

  it("'원문 그대로(keep)' 문구가 있어도 나머지는 띠 편집으로 번역된다 — keep 은 오버레이 강제 사유가 아니다", async () => {
    // 실측(2026-09-01 마리아 GIF): 깨지는 제목만 keep 으로 두고 나머지를 번역하려
    // 했는데 mustOverlay 가 keep 을 수동 지시로 취급해 통째로 거부됐다
    stubGemini("ok");
    const gif = await makeGif(false);
    const keepBox: OcrBox = { box: [820, 100, 960, 900], zh: "防水", ko: "", bg: "#ffffff", fg: "#000000", solid_bg: true, mode: "keep" };
    const out = await renderTranslatedImage(gif, "image/gif", [topBox, keepBox]);
    expect(out.mime).toBe("image/gif");
    expect(imageCalls).toBe(1); // keep 박스는 대상에서 빠진다 — 원본 픽셀 그대로
  }, 60_000);

  it("위치를 옮긴 문구는 GIF 에서 지킬 수 없어 원본 유지로 거부한다", async () => {
    stubGemini("ok");
    const gif = await makeGif(false);
    const moved: OcrBox = { ...topBox, dx: 12 };
    await expect(renderTranslatedImage(gif, "image/gif", [moved])).rejects.toThrow(/지킬 수 없습니다/);
    expect(imageCalls).toBe(0);
  }, 60_000);

  it("겹쳐 찍힌 띠는 육안 심사가 잡고 재시도해 통과시킨다 — 판독은 정상으로 읽어 못 잡는다", async () => {
    // 실측(2026-09-01 마리아 GIF): 제목이 두 겹으로 찍혔는데 판독 모델은 정상
    // 문자열로 읽어 그대로 채택됐다. 모양은 그림을 보는 눈이 잡아야 한다.
    stubGemini("ok", ["강력 진동"], [{ ok: false, issues: ["제목이 겹쳐 찍힘"], hard: ["제목이 겹쳐 찍힘"] }]);
    const gif = await makeGif(false);
    const out = await renderTranslatedImage(gif, "image/gif", [topBox]);
    expect(out.mime).toBe("image/gif");
    expect(imageCalls).toBe(2); // 1차 불합격 → 재시도 1회로 합격
  }, 60_000);

  it("두 번 다 겹쳐 찍히면 그 띠는 원문을 유지한다 — 깨진 그림을 채택하지 않는다", async () => {
    const bad = { ok: false, issues: ["겹쳐 찍힘"], hard: ["겹쳐 찍힘"] };
    stubGemini("ok", ["강력 진동"], [bad, bad]);
    const gif = await makeGif(false);
    // 유일한 띠가 불합격 → 얹을 패치가 없으므로 원본 유지(실패)로 올라온다
    await expect(renderTranslatedImage(gif, "image/gif", [topBox])).rejects.toThrow(/글자 품질 불합격/);
    expect(imageCalls).toBe(2); // 시도 상한 2회를 넘지 않는다
  }, 60_000);

  it("429(월 한도)면 첫 띠에서 즉시 멈춘다 — 남은 띠를 헛되이 두드리지 않는다", async () => {
    // 실측(2026-09-01): 월 지출 상한 초과 상태에서 띠 3개 × 시도 2회 = 6번을 두드렸다
    imageCalls = 0;
    vi.stubGlobal("fetch", async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as { generationConfig?: { responseModalities?: string[] } };
      if (body.generationConfig?.responseModalities?.includes("IMAGE")) {
        imageCalls++;
        return new Response(JSON.stringify({ error: { status: "RESOURCE_EXHAUSTED" } }), { status: 429 });
      }
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "[]" }] } }] }),
        { status: 200 },
      );
    });
    // 위·아래 정지, 가운데만 움직이는 GIF → 띠 2개
    const frames: Buffer[] = [];
    for (let i = 0; i < 3; i++) {
      const raw = Buffer.alloc(W * H * 3);
      for (let y = 0; y < H; y++) {
        const v = y < H / 3 ? 230 : y < (2 * H) / 3 ? 40 + i * 60 : 230;
        raw.fill(v, y * W * 3, (y + 1) * W * 3);
      }
      frames.push(await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer());
    }
    const gif = await sharp(frames, { join: { animated: true } }).gif({ delay: [100, 100, 100] }).toBuffer();
    const a: OcrBox = { box: [60, 100, 200, 900], zh: "强震", ko: "강력 진동", bg: "#fff", fg: "#000", solid_bg: true };
    const b: OcrBox = { box: [800, 100, 940, 900], zh: "温热", ko: "스마트 온열", bg: "#fff", fg: "#000", solid_bg: true };
    await expect(renderTranslatedImage(gif, "image/gif", [a, b])).rejects.toThrow(/429/);
    expect(imageCalls).toBe(1);
  }, 60_000);

  it("띠 배경이 원본과 어긋나면 원문을 유지한다 — 네모 자국을 손님에게 내보내지 않는다", async () => {
    imageCalls = 0;
    vi.stubGlobal("fetch", async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as {
        contents?: { parts?: { inline_data?: { data?: string } }[] }[];
        generationConfig?: { responseModalities?: string[] };
      };
      if (body.generationConfig?.responseModalities?.includes("IMAGE")) {
        imageCalls++;
        const b64 = body.contents?.[0]?.parts?.find((p) => p.inline_data?.data)?.inline_data?.data ?? "";
        const m = await sharp(Buffer.from(b64, "base64")).metadata();
        // 원본(230 회색)과 크게 다른 배경으로 그린다 = 얹으면 네모가 보인다
        const png = await sharp({
          create: { width: m.width ?? 8, height: m.height ?? 8, channels: 3, background: { r: 90, g: 90, b: 90 } },
        }).png().toBuffer();
        return new Response(
          JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: png.toString("base64") } }] } }] }),
          { status: 200 },
        );
      }
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify([{ box: [80, 100, 200, 900], text: "강력 진동" }]) }] } }] }),
        { status: 200 },
      );
    });
    const gif = await makeGif(false);
    await expect(renderTranslatedImage(gif, "image/gif", [topBox])).rejects.toThrow(/이음매가 보입니다/);
    expect(imageCalls).toBe(2); // 재시도 1회까지만
  }, 60_000);

  it("띠 여백에 이웃 문구가 걸쳐 읽혀도 거부하지 않는다 — 헛글자와 구분한다", async () => {
    // 실측(2026-09-01 재생 감사): 운영 결과물 4장 중 3장이 이웃 문구를 헛글자로
    // 세는 바람에 통째로 거부됐다. 띠는 글자 주위 여백까지 자르므로 이웃이 들어온다.
    stubGemini("ok", ["강력 진동", "스마트 온열"]);
    const frames: Buffer[] = [];
    for (let i = 0; i < 3; i++) {
      const raw = Buffer.alloc(W * H * 3);
      for (let y = 0; y < H; y++) {
        const v = y < H / 3 ? 230 : y < (2 * H) / 3 ? 40 + i * 60 : 230;
        raw.fill(v, y * W * 3, (y + 1) * W * 3);
      }
      frames.push(await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer());
    }
    const gif = await sharp(frames, { join: { animated: true } }).gif({ delay: [100, 100, 100] }).toBuffer();
    const a: OcrBox = { box: [60, 100, 200, 900], zh: "强震", ko: "강력 진동", bg: "#fff", fg: "#000", solid_bg: true };
    const b: OcrBox = { box: [800, 100, 940, 900], zh: "温热", ko: "스마트 온열", bg: "#fff", fg: "#000", solid_bg: true };
    const out = await renderTranslatedImage(gif, "image/gif", [a, b]);
    expect(out.mime).toBe("image/gif");
    expect(imageCalls).toBe(2); // 재시도 없이 띠 2개 = 2회
  }, 60_000);

  it("모델이 거부하면 거부 사유가 그대로 올라온다 — 재시도 분류가 가능하게", async () => {
    stubGemini("refuse");
    const gif = await makeGif(false);
    await expect(renderTranslatedImage(gif, "image/gif", [topBox])).rejects.toThrow(/모델 거부/);
  }, 60_000);
});
