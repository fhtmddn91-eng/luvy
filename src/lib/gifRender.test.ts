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
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

/**
 * 위쪽 글자 자리에 검은 막대(가짜 글자, 20px)가 있는 GIF — 글자 크기 관문용.
 * topBox(y 19~48px) 안에 y 24~44 · x 30~210 막대. 위쪽은 정지, 아래쪽만 움직인다.
 */
async function makeGifWithGlyph(): Promise<Buffer> {
  const frames: Buffer[] = [];
  for (let i = 0; i < 3; i++) {
    const shade = 40 + i * 60;
    const raw = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) {
      const v = y < H / 2 ? 230 : shade;
      raw.fill(v, y * W * 3, (y + 1) * W * 3);
      if (y >= 24 && y < 44) raw.fill(20, (y * W + 30) * 3, (y * W + 210) * 3);
    }
    frames.push(await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer());
  }
  return sharp(frames, { join: { animated: true } }).gif({ delay: [100, 100, 100] }).toBuffer();
}

/**
 * 글자 막대(y 24~44) **바로 위 한 줄(y 0~23)까지** 움직이는 GIF — 정지 띠를 만들 여백이 0.
 * 실측(exp12 「回弹设计」): 제품 사진이 글자 1px 위까지 움직여 "움직이는 화면 위"로 원문이 남았다.
 * noisy=true 면 배경이 사진처럼 얼룩져 단색이 아니다.
 */
async function makeGifTouchingMotion(noisy = false): Promise<Buffer> {
  const frames: Buffer[] = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const noise = Buffer.alloc(W * H);
  for (let i = 0; i < W * H; i++) noise[i] = noisy ? Math.floor(rnd() * 50) : 0;
  for (let i = 0; i < 3; i++) {
    const raw = Buffer.alloc(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const k = (y * W + x) * 3;
      let v = 230 - noise[y * W + x];
      if (y < 24) v = 40 + i * 60; // 글자 바로 위까지 움직인다
      if (y >= 24 && y < 44 && x >= 30 && x < 210 && (x - 30) % 12 < 4) v = 20; // 정지 글자(세로 줄무늬 = 획, 잉크 1/3)
      raw[k] = raw[k + 1] = raw[k + 2] = v;
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
  mode: "ok" | "refuse" | "shrink",
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
      let png = await sharp(Buffer.from(b64, "base64")).png().toBuffer();
      if (mode === "shrink") {
        // 어두운 행(가짜 글자)의 위아래 1/4 씩을 배경색으로 지운다 = 글자 높이 50%
        const src = sharp(Buffer.from(b64, "base64"));
        const m = await src.metadata();
        const cw = m.width ?? 1, ch = m.height ?? 1;
        const raw = await src.ensureAlpha().raw().toBuffer();
        const dark: number[] = [];
        for (let y = 0; y < ch; y++) {
          let sum = 0;
          for (let x = 0; x < cw; x++) sum += raw[(y * cw + x) * 4];
          if (sum / cw < 200) dark.push(y); // 확대 보간으로 섞인 경계 행까지 포함
        }
        const keep = new Set(dark.slice(Math.floor(dark.length / 4), Math.ceil((dark.length * 3) / 4)));
        for (const y of dark) {
          if (keep.has(y)) continue;
          for (let x = 0; x < cw; x++) {
            const i = (y * cw + x) * 4;
            raw[i] = raw[0]; raw[i + 1] = raw[1]; raw[i + 2] = raw[2];
          }
        }
        png = await sharp(raw, { raw: { width: cw, height: ch, channels: 4 } }).png().toBuffer();
      }
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

  it("1차가 이음매로 떨어지고 2차가 깨끗하면 '합격'이다 — 직전 사유가 다음 시도에 새면 안 된다", async () => {
    // 실측 13 「360°贴合」: 2차가 모든 관문을 통과했는데 1차의 "덧댄 자국" 사유가 남아 있어
    // soft 후보(점수 0.90)로 채택됐다고 기록됐다. 결과는 같았지만 기록과 분류가 틀렸다.
    imageCalls = 0;
    let call = 0;
    vi.stubGlobal("fetch", async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as {
        contents?: { parts?: { inline_data?: { data?: string } }[] }[];
        generationConfig?: { responseModalities?: string[] };
      };
      if (body.generationConfig?.responseModalities?.includes("IMAGE")) {
        imageCalls++; call++;
        const b64 = body.contents?.[0]?.parts?.find((p) => p.inline_data?.data)?.inline_data?.data ?? "";
        if (call === 1) {
          const m = await sharp(Buffer.from(b64, "base64")).metadata();
          const png = await sharp({ create: { width: m.width ?? 8, height: m.height ?? 8, channels: 3, background: { r: 90, g: 90, b: 90 } } }).png().toBuffer();
          return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: png.toString("base64") } }] } }] }), { status: 200 });
        }
        const png = await sharp(Buffer.from(b64, "base64")).png().toBuffer(); // 2차: 받은 그대로 = 깨끗
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: png.toString("base64") } }] } }] }), { status: 200 });
      }
      const asked = JSON.stringify(body.contents ?? "");
      if (asked.includes("글자 부분만 잘라낸 띠")) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ ok: true, issues: [], hard: [] }) }] } }] }), { status: 200 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify([{ box: [80, 100, 200, 900], text: "강력 진동" }]) }] } }] }), { status: 200 });
    });
    const gif = await makeGifWithGlyph();
    const logs: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { logs.push(a.join(" ")); });
    try {
      const out = await renderTranslatedImage(gif, "image/gif", [topBox]);
      expect(imageCalls).toBe(2);
      expect(out.notes ?? []).toEqual([]);
    } finally {
      spy.mockRestore();
    }
    expect(logs.some((l) => l.includes("시도 2: 합격"))).toBe(true);
    expect(logs.some((l) => l.includes("soft 후보 채택"))).toBe(false);
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

  /**
   * 글자 크기 관문(2026-09-02). 실측(exp7~9 산출물 3회분·띠 22개): 정상 88~135%,
   * 작아진 것 45~83%. 「全面覆盖」는 4자 번역으로도 세 번 다 75~82% 였다 —
   * 프롬프트의 "같게 유지"를 모델이 절반은 어긴다. 픽셀로 재서(공짜) 실측값을
   * 힌트에 실어 재시도하고, 그래도 작으면 더 나은 쪽을 채택하되 사유를 남긴다.
   * 작은 한국어가 중국어 원문보다는 낫다 — '깨진 그림'과는 다른 부류다.
   */
  it("글자가 작게 그려지면 재시도하고, 그래도 작으면 더 나은 쪽을 채택하되 사유를 남긴다", async () => {
    stubGemini("shrink");
    const gif = await makeGifWithGlyph();
    const out = await renderTranslatedImage(gif, "image/gif", [topBox]);
    expect(imageCalls).toBe(2); // 1차 작음 → 재시도 1회 → 여전히 작음 → 채택
    expect(out.mime).toBe("image/gif");
    expect((out.notes ?? []).join(" ")).toMatch(/强震.*작아졌/);
    // 패치가 실제로 얹혔다 — 막대 위쪽 행은 지워져 배경색, 가운데는 여전히 글자
    const raw = await sharp(out.data, { page: 0, pages: 1 }).ensureAlpha().raw().toBuffer();
    expect(raw[(26 * W + 120) * 4]).toBeGreaterThan(150);
    expect(raw[(34 * W + 120) * 4]).toBeLessThan(100);
  }, 60_000);

  it("작아진 띠의 재시도는 같은 배율로 한다 — 배율을 올렸더니 더 작아졌다(실측 13: 84%→78%)", async () => {
    // 배율 확대는 뭉개진 획(품질)용이지 크기용이 아니다. 크기 문제는 힌트만 바꿔 같은 조건으로.
    const sizes: number[] = [];
    stubGemini("shrink");
    const inner = globalThis.fetch;
    vi.stubGlobal("fetch", async (u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as { contents?: { parts?: { inline_data?: { data?: string } }[] }[]; generationConfig?: { responseModalities?: string[] } };
      if (body.generationConfig?.responseModalities?.includes("IMAGE")) {
        const b64 = body.contents?.[0]?.parts?.find((p) => p.inline_data?.data)?.inline_data?.data ?? "";
        sizes.push((await sharp(Buffer.from(b64, "base64")).metadata()).width ?? 0);
      }
      return inner(u as string, init as RequestInit);
    });
    await renderTranslatedImage(await makeGifWithGlyph(), "image/gif", [topBox]);
    expect(sizes).toHaveLength(2);
    expect(sizes[1]).toBe(sizes[0]);
  }, 60_000);

  it("글자가 36px 이상이면 크기 재시도는 배율을 한 단계 낮춘다 — 큰 그림일수록 모델이 여백을 더 둔다(84%→78%)", async () => {
    // 글자 40px: 기본 배율 2(목표 44px). 재시도는 ×1 — 40px 이면 모델이 또렷이 그리는 하한(36px) 위다.
    const sizes: number[] = [];
    stubGemini("shrink");
    const inner = globalThis.fetch;
    vi.stubGlobal("fetch", async (u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as { contents?: { parts?: { inline_data?: { data?: string } }[] }[]; generationConfig?: { responseModalities?: string[] } };
      if (body.generationConfig?.responseModalities?.includes("IMAGE")) {
        const b64 = body.contents?.[0]?.parts?.find((p) => p.inline_data?.data)?.inline_data?.data ?? "";
        sizes.push((await sharp(Buffer.from(b64, "base64")).metadata()).width ?? 0);
      }
      return inner(u as string, init as RequestInit);
    });
    const frames: Buffer[] = [];
    for (let i = 0; i < 3; i++) {
      const raw = Buffer.alloc(W * H * 3);
      for (let y = 0; y < H; y++) {
        const v = y < H / 2 ? 230 : 40 + i * 60;
        raw.fill(v, y * W * 3, (y + 1) * W * 3);
        if (y >= 20 && y < 60 && (y - 20) % 10 < 7) raw.fill(20, (y * W + 30) * 3, (y * W + 210) * 3); // 40px 높이 글자(가로 줄무늬)
      }
      frames.push(await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer());
    }
    const gif = await sharp(frames, { join: { animated: true } }).gif({ delay: [100, 100, 100] }).toBuffer();
    const big: OcrBox = { box: [83, 100, 250, 900], zh: "强震", ko: "강력 진동", bg: "#ffffff", fg: "#000000", solid_bg: true }; // y 20~60 = 40px → 기본 배율 2
    await renderTranslatedImage(gif, "image/gif", [big]);
    expect(sizes).toHaveLength(2);
    expect(sizes[1]).toBeLessThan(sizes[0]);
  }, 60_000);

  it("재시도가 첫 시도보다 더 작아지면 첫 시도를 쓴다 — 재시도는 복권이지 개선이 아니다", async () => {
    // 실측 13 제목: 1차 84% → 2차 78%. 더 나은 쪽(1차)을 채택해야 한다.
    imageCalls = 0;
    let call = 0;
    vi.stubGlobal("fetch", async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? "{}") as { contents?: { parts?: { inline_data?: { data?: string } }[] }[]; generationConfig?: { responseModalities?: string[] } };
      if (body.generationConfig?.responseModalities?.includes("IMAGE")) {
        imageCalls++; call++;
        const b64 = body.contents?.[0]?.parts?.find((p) => p.inline_data?.data)?.inline_data?.data ?? "";
        const src = sharp(Buffer.from(b64, "base64"));
        const m = await src.metadata(); const cw = m.width ?? 1, ch = m.height ?? 1;
        const raw = await src.ensureAlpha().raw().toBuffer();
        const dark: number[] = [];
        for (let y = 0; y < ch; y++) { let sum = 0; for (let x = 0; x < cw; x++) sum += raw[(y * cw + x) * 4]; if (sum / cw < 200) dark.push(y); }
        // 1차: 어두운 행의 위아래 1/8 씩 지움(75%), 2차: 1/4 씩 지움(50%)
        const cut = call === 1 ? 8 : 4;
        const keep = new Set(dark.slice(Math.floor(dark.length / cut), Math.ceil((dark.length * (cut - 1)) / cut)));
        for (const y of dark) { if (keep.has(y)) continue; for (let x = 0; x < cw; x++) { const i = (y * cw + x) * 4; raw[i] = raw[0]; raw[i + 1] = raw[1]; raw[i + 2] = raw[2]; } }
        const png = await sharp(raw, { raw: { width: cw, height: ch, channels: 4 } }).png().toBuffer();
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: png.toString("base64") } }] } }] }), { status: 200 });
      }
      const asked = JSON.stringify(body.contents ?? "");
      if (asked.includes("글자 부분만 잘라낸 띠")) return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ ok: true, issues: [], hard: [] }) }] } }] }), { status: 200 });
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify([{ box: [80, 100, 200, 900], text: "강력 진동" }]) }] } }] }), { status: 200 });
    });
    const out = await renderTranslatedImage(await makeGifWithGlyph(), "image/gif", [topBox]);
    expect(imageCalls).toBe(2);
    const note = (out.notes ?? []).join(" ");
    expect(note).toMatch(/[78]\d%/); // 1차(≈75~80%)를 채택 — 2차(≈50~55%)가 아니다
    expect(note).not.toMatch(/5\d%/);
  }, 60_000);

  it("글자가 제 크기면 재시도하지 않는다 — 크기 관문은 공짜지만 재시도는 돈이다", async () => {
    stubGemini("ok");
    const gif = await makeGifWithGlyph();
    const out = await renderTranslatedImage(gif, "image/gif", [topBox]);
    expect(imageCalls).toBe(1);
    expect(out.notes ?? []).toEqual([]);
  }, 60_000);

  it("판독에 기대 문구가 하나도 안 읽히면(글자를 지운 채 비움) 재시도 후 원문 유지", async () => {
    // 잔류 검사(한자만 봄)·헛글자 검사(없는 한글만 봄)는 빈 띠를 통과시킨다.
    stubGemini("ok", []);
    const gif = await makeGif(false);
    await expect(renderTranslatedImage(gif, "image/gif", [topBox])).rejects.toThrow(/문구 누락/);
    expect(imageCalls).toBe(2);
  }, 60_000);

  it("확정 문구와 한두 글자 다른 결과는 재시도 뒤에도 못 맞추면 채택한다 — 최종 관문이 차이를 보고한다", async () => {
    // 실측(2026-09-02 exp10): "자극적이게"를 "자극적으로"로 그려 헛글자로 거부됐고,
    // 재시도는 이음매에 걸려 중국어 원문이 남았다. 뜻이 같은 어미 차이는 원문보다 낫다.
    const longBox: OcrBox = { ...topBox, zh: "大头爆震 更大更刺激", ko: "빅헤드 강진동 더 크고 자극적이게" };
    stubGemini("ok", ["빅헤드 강진동 더 크고 자극적으로"]);
    const gif = await makeGif(false);
    const out = await renderTranslatedImage(gif, "image/gif", [longBox]);
    expect(out.mime).toBe("image/gif");
    expect(imageCalls).toBe(2); // 정확히 맞추려 1회 재시도 → 같은 결과 → 채택
  }, 60_000);

  it("GIF_BAND_DEBUG_DIR 를 주면 시도마다 보낸 띠와 받은 띠를 파일로 남긴다 — 다음 실측의 증거", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gifband-"));
    process.env.GIF_BAND_DEBUG_DIR = dir;
    try {
      stubGemini("ok");
      await renderTranslatedImage(await makeGif(false), "image/gif", [topBox]);
    } finally {
      delete process.env.GIF_BAND_DEBUG_DIR;
    }
    const files = fs.readdirSync(dir);
    expect(files.some((f) => /band1_try1_in\.png$/.test(f))).toBe(true);
    expect(files.some((f) => /band1_try1_out\.png$/.test(f))).toBe(true);
  }, 60_000);

  it("패치 밖이 원본과 같은지 프레임마다 재서 돌려준다 — 재부호화 손실은 팔레트 양자화뿐이다", async () => {
    stubGemini("ok");
    const out = await renderTranslatedImage(await makeGifWithGlyph(), "image/gif", [topBox]);
    expect(out.outsideMaxDiff).toBeDefined();
    expect(out.outsideMaxDiff!).toBeLessThanOrEqual(8);
    expect(out.outsideChangedFrac!).toBe(0);
  }, 60_000);

  /**
   * 단색 배경 폴백(2026-09-02 결정). 글자 바로 옆까지 움직이는 자리는 모델 띠를 만들 수
   * 없다 — 실측(exp10~12 「回弹设计」): 세 번 중 두 번 원문이 남았다. 배경이 픽셀로
   * 확인된 단색이고 글자 자리가 정지면, 그 자리만 배경색으로 지우고 우리가 직접 쓴다.
   * 서체는 바뀌지만(프리텐다드) 자국은 없다 — 사진·그라데이션(자국의 원인)은 절대 안 한다.
   */
  it("띠를 못 만드는 자리라도 배경이 단색이면 직접 그린다 — 모델 호출 0회, 애니메이션 유지", async () => {
    stubGemini("ok");
    const gif = await makeGifTouchingMotion();
    const out = await renderTranslatedImage(gif, "image/gif", [topBox]);
    expect(imageCalls).toBe(0);
    expect(out.localText).toEqual(["强震"]);
    const raw = await sharp(out.data, { page: 0, pages: 1 }).ensureAlpha().raw().toBuffer();
    // 줄무늬(획 50%)가 지워지고 그 자리에 글자가 그려졌다 — 어두운 픽셀 비율이 달라진다
    let dark = 0, n = 0, stripeLeft = 0;
    for (let y = 24; y < 44; y++) for (let x = 30; x < 210; x++) {
      n++;
      const d = raw[(y * W + x) * 4] < 100;
      if (d) dark++;
      if (d && (x - 30) % 12 >= 6) stripeLeft++; // 원래 배경이던 자리에 획이 있다 = 새 글자
    }
    expect(dark / n).toBeGreaterThan(0.02);
    expect(dark / n).toBeLessThan(0.45);
    expect(stripeLeft).toBeGreaterThan(20);
    // 글자 밖은 그대로
    expect(raw[(60 * W + 120) * 4]).toBe(230);
    const meta = await sharp(out.data, { animated: true }).metadata();
    expect(meta.pages).toBe(3);
  }, 60_000);

  it("글자 자리가 좁아도 좌우 정지 여백이 있으면 그리로 넓혀 원래 크기로 쓴다", async () => {
    // 실측(M18 「回弹设计」): 잉크 범위 247px 에 16자는 82% 로 줄여야 들어가지만, 좌우에 정지 여백
    // 98+51px 이 있었다. 띠 예산이 그 여백까지 세어 준 문구이니 폴백도 그 여백을 써야 한다.
    stubGemini("ok");
    const frames: Buffer[] = [];
    for (let i = 0; i < 3; i++) {
      const raw = Buffer.alloc(W * H * 3);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const k = (y * W + x) * 3;
        let v = 230;
        if (y < 24) v = 40 + i * 60;
        if (y >= 24 && y < 44 && x >= 100 && x < 140 && (x - 100) % 12 < 4) v = 20; // 좁은 글자(40px)
        raw[k] = raw[k + 1] = raw[k + 2] = v;
      }
      frames.push(await sharp(raw, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer());
    }
    const gif = await sharp(frames, { join: { animated: true } }).gif({ delay: [100, 100, 100] }).toBuffer();
    const narrow: OcrBox = { box: [100, 417, 183, 583], zh: "强震", ko: "강력한 진동 자극", bg: "#ffffff", fg: "#000000", solid_bg: true };
    const out = await renderTranslatedImage(gif, "image/gif", [narrow]);
    expect(out.localText).toEqual(["强震"]);
    const raw = await sharp(out.data, { page: 0, pages: 1 }).ensureAlpha().raw().toBuffer();
    // 원래 글자 자리(x100~140) 밖, 여백 쪽(x60~100 또는 x140~180)에 글자 획이 생겼다 = 넓혀서 썼다
    let outside = 0;
    for (let y = 24; y < 44; y++) for (let x = 60; x < 180; x++) if ((x < 100 || x >= 140) && raw[(y * W + x) * 4] < 100) outside++;
    expect(outside).toBeGreaterThan(20);
  }, 60_000);

  it("배경이 사진처럼 얼룩지면 직접 그리지 않는다 — 자국의 원인이던 자리", async () => {
    stubGemini("ok");
    const gif = await makeGifTouchingMotion(true);
    await expect(renderTranslatedImage(gif, "image/gif", [topBox])).rejects.toThrow(/움직이는 화면 위/);
    expect(imageCalls).toBe(0);
  }, 60_000);

  it("모델이 거부하면 거부 사유가 그대로 올라온다 — 재시도 분류가 가능하게", async () => {
    stubGemini("refuse");
    const gif = await makeGif(false);
    await expect(renderTranslatedImage(gif, "image/gif", [topBox])).rejects.toThrow(/모델 거부/);
  }, 60_000);
});
