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
function stubGemini(mode: "ok" | "refuse") {
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
      const b64 = body.contents?.[0]?.parts?.find((p) => p.inline_data?.data)?.inline_data?.data ?? "";
      const meta = await sharp(Buffer.from(b64, "base64")).metadata();
      const png = await sharp({
        create: { width: meta.width ?? 8, height: meta.height ?? 8, channels: 3, background: { r: 250, g: 250, b: 250 } },
      }).png().toBuffer();
      return new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { data: png.toString("base64") } }] } }] }),
        { status: 200 },
      );
    }
    // 판독(텍스트) 호출 — 한국어만 읽혔다고 답한다 (원문 잔류 없음)
    return new Response(
      JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify([{ box: [80, 100, 200, 900], text: "강력 진동" }]) }] } }] }),
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

  it("모델이 거부하면 거부 사유가 그대로 올라온다 — 재시도 분류가 가능하게", async () => {
    stubGemini("refuse");
    const gif = await makeGif(false);
    await expect(renderTranslatedImage(gif, "image/gif", [topBox])).rejects.toThrow(/모델 거부/);
  }, 60_000);
});
