/**
 * 저장 후보 재검증 — 해시 게이트와 fail-closed 계약.
 *
 * 이 경로는 "검사 단계를 건너뛰게 하는 힘"을 갖기 때문에, ① 운영 진입점에
 * 옵션으로 노출되지 않고 ② 저장 당시와 바이트·버전·문구가 같다는 걸 해시로
 * 증명해야만 열린다. 아래 테스트가 그 두 가지를 못 박는다.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";

vi.mock("@/lib/db", () => ({ db: {} }));

const { reverifySavedCandidate, makeReverifyTicket, ticketMismatch, boxesTraceHash } = await import("./translateReverify");
const { translateImageAuto, IMAGE_MODEL } = await import("./imageTranslate");
type OcrBox = import("./imageTranslate").OcrBox;
const { PIPELINE_VERSION } = await import("./translateCache");

const W = 400;
const H = 400;
const BOX: [number, number, number, number] = [100, 100, 200, 900];

function drawBase(): import("@napi-rs/canvas").Canvas {
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000000";
  ctx.fillRect(40, 40, 320, 40);
  return c;
}
const ORIG: Buffer = drawBase().toBuffer("image/png");
const OTHER: Buffer = (() => {
  const c = drawBase();
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#888";
  ctx.fillRect(0, 300, 400, 20); // 다른 원본
  return c.toBuffer("image/png");
})();
const CAND: Buffer = (() => {
  const c = drawBase();
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(42, 42, 316, 36);
  ctx.fillStyle = "#111111";
  for (let x = 50; x < 350; x += 20) ctx.fillRect(x, 48, 10, 24);
  return c.toBuffer("image/png");
})();

const boxes = [{ box: BOX, zh: "强震深处", ko: "강렬한 진동", bg: "#ffffff", fg: "#000000" }] as unknown as OcrBox[];
const ticketOf = () => makeReverifyTicket({ original: ORIG, candidate: CAND, boxes });

/* ── fetch 목 — 재개 경로에서 어떤 검사가 실제로 도는지 세기 위해 ── */
type Json = Record<string, unknown>;
const textResp = (payload: unknown): Json => ({
  candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] }, finishReason: "STOP" }],
});
let imageHttp = 0;
let prompts: string[] = [];
let transcribeCall = 0;
const realFetch = globalThis.fetch;
beforeEach(() => {
  imageHttp = 0;
  prompts = [];
  transcribeCall = 0;
  process.env.GEMINI_API_KEY = "test-key";
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { contents?: { parts?: { text?: string }[] }[] };
    const prompt = body.contents?.[0]?.parts?.map((p) => p.text ?? "").join("\n") ?? "";
    if (String(url).includes(IMAGE_MODEL)) {
      imageHttp++;
      return {
        ok: true,
        status: 200,
        json: async () => ({ candidates: [{ content: { parts: [{ inlineData: { data: CAND.toString("base64") } }] }, finishReason: "STOP" }] }),
      } as unknown as Response;
    }
    prompts.push(prompt);
    let payload: Json;
    if (prompt.includes("모두 찾아주세요")) payload = textResp([]);
    else if (prompt.includes("그대로 옮겨 적어주세요")) {
      transcribeCall++;
      payload = textResp(
        transcribeCall === 1 ? [{ box: BOX, text: "强震深处" }] : transcribeCall === 2 ? [{ box: BOX, text: "강렬한 진동" }] : [],
      );
    } else if (prompt.includes("실제로 읽어온 한국어입니다")) payload = textResp([{ ok: true, issues: [], hard: [] }]);
    else if (prompt.includes("제품 사진")) payload = textResp({ ok: true, issues: [], hard: [] });
    else payload = textResp([]);
    return { ok: true, status: 200, json: async () => payload } as unknown as Response;
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("공개 API 차단 — 임의 resume 주입 불가", () => {
  it("운영 진입점 translateImageAuto 는 인자가 2개뿐이다 (재개 옵션 없음)", () => {
    expect(translateImageAuto.length).toBe(2);
  });

  it("어드민 액션·라우트는 재개 경로를 import 하지 않는다", () => {
    const roots = ["src/lib/actions", "src/app"];
    const hits: string[] = [];
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) walk(f);
        else if (/\.tsx?$/.test(e.name)) {
          const src = fs.readFileSync(f, "utf8");
          if (src.includes("reverifySavedCandidate") || src.includes("__resumeVerifiedPipeline")) hits.push(f);
        }
      }
    };
    roots.forEach(walk);
    expect(hits).toEqual([]);
  });
});

describe("해시 게이트 — 어긋나면 호출 0회로 차단 (fail-closed)", () => {
  it("정상 표는 통과하고 이미지 HTTP 0회로 재판정한다", async () => {
    const r = await reverifySavedCandidate({
      ticket: ticketOf(),
      original: ORIG,
      originalMime: "image/png",
      boxes,
      candidate: { data: CAND, mime: "image/png" },
    });
    expect(imageHttp).toBe(0);
    expect(r.status).toBe("VERIFIED");
  });

  it("원본이 다른 이미지면 거부 — API 호출 0회", async () => {
    const r = await reverifySavedCandidate({
      ticket: ticketOf(),
      original: OTHER,
      originalMime: "image/png",
      boxes,
      candidate: { data: CAND, mime: "image/png" },
    });
    expect(r.status).toBe("VERIFICATION_FAILED");
    expect(prompts).toHaveLength(0);
    expect(imageHttp).toBe(0);
    if (r.status === "VERIFICATION_FAILED") expect(r.reasons[0].detail).toContain("원본 바이트 불일치");
  });

  it("후보가 변조되면 거부", async () => {
    const tampered = Buffer.concat([CAND, Buffer.from([0])]);
    const r = await reverifySavedCandidate({
      ticket: ticketOf(),
      original: ORIG,
      originalMime: "image/png",
      boxes,
      candidate: { data: tampered, mime: "image/png" },
    });
    expect(r.status).toBe("VERIFICATION_FAILED");
    if (r.status === "VERIFICATION_FAILED") expect(r.reasons[0].detail).toContain("후보 바이트 불일치");
  });

  it("boxes 가 변조되면 거부 — 번역문 한 글자만 바꿔도", async () => {
    const t = ticketOf();
    const tampered = [{ ...boxes[0], ko: "강렬한 진동!" }] as unknown as OcrBox[];
    const r = await reverifySavedCandidate({
      ticket: t,
      original: ORIG,
      originalMime: "image/png",
      boxes: tampered,
      candidate: { data: CAND, mime: "image/png" },
    });
    expect(r.status).toBe("VERIFICATION_FAILED");
    if (r.status === "VERIFICATION_FAILED") expect(r.reasons[0].detail).toContain("해시 불일치");
  });

  it("좌표가 변조되면 거부", async () => {
    const tampered = [{ ...boxes[0], box: [110, 100, 200, 900] }] as unknown as OcrBox[];
    const r = await reverifySavedCandidate({
      ticket: ticketOf(),
      original: ORIG,
      originalMime: "image/png",
      boxes: tampered,
      candidate: { data: CAND, mime: "image/png" },
    });
    expect(r.status).toBe("VERIFICATION_FAILED");
  });

  it("파이프라인 버전이 다르면 거부 — 구버전 판정 재사용 금지", async () => {
    const t = { ...ticketOf(), pipelineVersion: `${PIPELINE_VERSION}|old` };
    const r = await reverifySavedCandidate({
      ticket: t,
      original: ORIG,
      originalMime: "image/png",
      boxes,
      candidate: { data: CAND, mime: "image/png" },
    });
    expect(r.status).toBe("VERIFICATION_FAILED");
    if (r.status === "VERIFICATION_FAILED") expect(r.reasons[0].detail).toContain("파이프라인 버전 불일치");
  });

  it("문구가 누락되면 거부 — trace 가 저장 당시와 달라진다", async () => {
    const two = [
      boxes[0],
      { box: [300, 100, 400, 900], zh: "柔软咬合", ko: "부드러운 밀착", bg: "#fff", fg: "#000" },
    ] as unknown as OcrBox[];
    const t = makeReverifyTicket({ original: ORIG, candidate: CAND, boxes: two });
    const r = await reverifySavedCandidate({
      ticket: t,
      original: ORIG,
      originalMime: "image/png",
      boxes: [two[0]], // 한 문구가 빠졌다
      candidate: { data: CAND, mime: "image/png" },
    });
    expect(r.status).toBe("VERIFICATION_FAILED");
    if (r.status === "VERIFICATION_FAILED") expect(r.reasons[0].detail).toContain("누락");
  });

  it("표가 아예 없으면 거부", async () => {
    const r = await reverifySavedCandidate({
      ticket: undefined as unknown as ReturnType<typeof ticketOf>,
      original: ORIG,
      originalMime: "image/png",
      boxes,
    });
    expect(r.status).toBe("VERIFICATION_FAILED");
  });

  it("후보 없이 표만 맞으면 렌더부터 재개 — 이미지 1회", async () => {
    const t = makeReverifyTicket({ original: ORIG, candidate: null, boxes });
    const r = await reverifySavedCandidate({ ticket: t, original: ORIG, originalMime: "image/png", boxes });
    expect(imageHttp).toBe(1);
    expect(r.status).toBe("VERIFIED");
  });
});

describe("재개해도 검사는 생략되지 않는다", () => {
  it("판독·의미대조·관문·무결성이 전부 호출된다 (텍스트 11회)", async () => {
    await reverifySavedCandidate({
      ticket: ticketOf(),
      original: ORIG,
      originalMime: "image/png",
      boxes,
      candidate: { data: CAND, mime: "image/png" },
    });
    expect(prompts.filter((p) => p.includes("한국어로 번역하세요"))).toHaveLength(0); // 건너뜀
    expect(prompts.filter((p) => p.includes("각 쌍을 심사하세요"))).toHaveLength(0); // 건너뜀
    expect(prompts.filter((p) => p.includes("그대로 옮겨 적어주세요"))).toHaveLength(5); // 원본1 + 완성본 교차4
    expect(prompts.filter((p) => p.includes("실제로 읽어온 한국어입니다"))).toHaveLength(1);
    expect(prompts.filter((p) => p.includes("모두 찾아주세요"))).toHaveLength(4); // 관문 교차
    expect(prompts.filter((p) => p.includes("제품 사진"))).toHaveLength(1);
    expect(prompts).toHaveLength(11);
  });

  it("boxesTraceHash 는 배열 순서에 흔들리지 않는다", () => {
    const a = [boxes[0], { box: [300, 100, 400, 900], zh: "柔软", ko: "부드러움", bg: "#fff", fg: "#000" }] as unknown as OcrBox[];
    const b = [a[1], a[0]] as unknown as OcrBox[];
    expect(boxesTraceHash(a)).toBe(boxesTraceHash(b));
  });

  it("ticketMismatch 는 어긋난 이유를 정확히 말한다", () => {
    expect(ticketMismatch({ ticket: ticketOf(), original: ORIG, originalMime: "image/png", boxes, candidate: { data: CAND, mime: "image/png" } })).toBeNull();
    expect(ticketMismatch({ ticket: ticketOf(), original: ORIG, originalMime: "image/png", boxes })).toContain("후보 바이트 불일치");
  });
});

describe("오류 관측성 — 429·5xx 도 quota metric·Retry-After 가 남는다", () => {
  it("429 사유에 status·quota metric·retry-after 가 실린다", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 429,
        headers: { get: (k: string) => (k.toLowerCase() === "retry-after" ? "42" : null) },
        json: async () => ({
          error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for quota metric 'Generate requests per day'" },
        }),
      }) as unknown as Response) as typeof fetch;
    const r = await reverifySavedCandidate({
      ticket: ticketOf(),
      original: ORIG,
      originalMime: "image/png",
      boxes,
      candidate: { data: CAND, mime: "image/png" },
    });
    expect(r.status).toBe("RETRYABLE");
    if (r.status === "RETRYABLE") {
      const d = r.reasons.find((x) => x.code === "RATE_LIMITED")!.detail;
      expect(d).toContain("RESOURCE_EXHAUSTED");
      expect(d).toContain("per day"); // 분당/일간/월간 구분 근거
      expect(d).toContain("retry-after=42");
    }
  });

  it("403(인증)도 사유에 상세가 실린다", async () => {
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 403,
        headers: { get: () => null },
        json: async () => ({ error: { status: "PERMISSION_DENIED", message: "API key not valid" } }),
      }) as unknown as Response) as typeof fetch;
    const r = await reverifySavedCandidate({
      ticket: ticketOf(),
      original: ORIG,
      originalMime: "image/png",
      boxes,
      candidate: { data: CAND, mime: "image/png" },
    });
    expect(r.status).toBe("RETRYABLE");
    if (r.status === "RETRYABLE") {
      expect(r.reasons.find((x) => x.code === "AUTH_ERROR")!.detail).toContain("PERMISSION_DENIED");
    }
  });
});
