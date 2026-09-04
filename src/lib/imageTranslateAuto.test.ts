/**
 * 자동 번역 흐름의 계약 검증 — fetch 를 목으로 갈아끼우고 실제 파이프라인을
 * 끝까지 돌려, **이미지 API HTTP 요청이 모든 시나리오에서 최대 1회**임을 센다.
 * (설계 2026-08-24 v2.1: 캐시 미스 + 렌더 전 검수 통과 시 1회, 렌더 전 실패 0회)
 */
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { createCanvas } from "@napi-rs/canvas";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";

/**
 * OUTSIDE_CHANGED 통합 검증용 1px 변조 스위치 — 합성이 원본을 보존하는 한 실제
 * 파이프라인에서는 밖 변화가 만들어질 수 없으므로(구성상 0px), 디코딩 raw 단계에서
 * 허용 rect 밖 1px 을 실제로 뒤집어 진짜 검출기가 잡는지 본다 (검사 연결 증명).
 */
const tamper = vi.hoisted(() => ({ on: false }));
vi.mock("./translateVerify", async (importOriginal) => {
  const real = await importOriginal<typeof import("./translateVerify")>();
  return {
    ...real,
    outsidePatchDiff: (
      orig: Uint8Array,
      out: Uint8Array,
      W: number,
      H: number,
      rects: { x0: number; y0: number; x1: number; y1: number }[],
      tol?: number,
    ) => {
      if (tamper.on) {
        const i = ((H - 2) * W + (W - 2)) * 4; // 우하단 구석 — 글자 박스에서 멀다
        out[i] = out[i] ^ 0x80;
      }
      return real.outsidePatchDiff(orig, out, W, H, rects, tol);
    },
  };
});

const { translateImageAuto, IMAGE_MODEL } = await import("./imageTranslate");

/* ── 픽스처 이미지 ─────────────────────────────────────────
 * 400×400 흰 바탕에 검은 띠(글자 대역) — 대비 필터를 통과해야 진짜 경로를 탄다.
 * 재생성본은 같은 그림에서 글자 띠 안쪽만 다른 무늬로 바뀐 것 — 경계(seam)와
 * 글자 밖 픽셀은 원본과 같아야 패치 검사를 통과한다.
 */
const W = 400;
const H = 400;
// 정규화 [ymin,xmin,ymax,xmax] = [100,100,200,900] → 픽셀 y 40~80, x 40~360
const BOX: [number, number, number, number] = [100, 100, 200, 900];

function drawBase(): import("@napi-rs/canvas").Canvas {
  const c = createCanvas(W, H);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#000000";
  ctx.fillRect(40, 40, 320, 40); // 원문 글자 대역
  return c;
}
const ORIG_PNG: Buffer = drawBase().toBuffer("image/png");
const REGEN_PNG: Buffer = (() => {
  const c = drawBase();
  const ctx = c.getContext("2d");
  // 글자 띠 안쪽만 "한국어로 바뀐" 무늬 — 밖은 원본과 동일해야 한다
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(42, 42, 316, 36);
  ctx.fillStyle = "#111111";
  for (let x = 50; x < 350; x += 20) ctx.fillRect(x, 48, 10, 24);
  return c.toBuffer("image/png");
})();
const REGEN_WRONG_RATIO: Buffer = (() => {
  const c = createCanvas(200, 400);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, 200, 400);
  return c.toBuffer("image/png");
})();

/* ── fetch 목 ── */
type Json = Record<string, unknown>;
const textResp = (payload: unknown): Json => ({
  candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] }, finishReason: "STOP" }],
});
const imageResp = (png: Buffer): Json => ({
  candidates: [{ content: { parts: [{ inlineData: { data: png.toString("base64") } }] }, finishReason: "STOP" }],
});

const ocrItem = (box: number[], zh: string) => ({ box, zh, bg: "#ffffff", fg: "#000000", bold: true, solid_bg: true });
/** 띠 0(전체 높이의 45%) 좌표계로 옮긴 같은 박스 */
const BOX_BAND0 = [Math.round(((BOX[0] / 1000) * H) / (0.45 * H) * 1000), BOX[1], Math.round(((BOX[2] / 1000) * H) / (0.45 * H) * 1000), BOX[3]];

interface Mock {
  /** OCR(추출) 호출이 올 때마다 순서대로 꺼내 쓴다 — 다 떨어지면 마지막 값 반복 */
  ocr: unknown[][];
  /** 번역 응답 — 항목이 문자열이면 답 1개, 배열이면 후보 여러 개(GIF 처음 보는 문구) */
  translate: (string | string[])[][];
  /** 교정 재번역(검수 지적 되먹임) — 배치 1회 호출 */
  correct: string[][];
  /** hard 가 있으면 렌더 전 차단, soft(issues 만)면 렌더 진입 */
  meaning: { ok: boolean; issues: string[]; hard?: string[] }[][];
  /** 완성본(원문↔판독문) 의미 대조 — 정책 4 */
  renderedMeaning: { ok: boolean; issues: string[]; hard?: string[] }[][];
  transcribe: unknown[][];
  /** 제품 무결성 심사(원본·완성본 두 장 비교) — 전체 채택 경로 */
  productCheck: { ok: boolean; issues: string[]; hard?: string[] }[][];
  /**
   * "echo" = 보낸 이미지와 같은 크기의 흰 그림으로 응답(국소 편집 띠 검증용)
   * "shrink" = 보낸 그림에서 어두운 행(글자)의 위아래 1/4 씩을 지워 돌려준다 = 글자 높이 50%
   */
  image: (Json | { status: number } | "hang" | "echo" | "shrink")[];
  /** 후보 3개 심사(GIF) — 항목별로 고른 후보 번호 */
  judge: number[][];
}
let mock: Mock;
let imageHttp = 0;
let textHttp = 0;
/** 요청 본문 기록 — "지적이 재번역 요청에 실제 들어갔는가" 같은 본문 단언용 */
let textPrompts: string[] = [];
let imagePrompts: string[] = [];
/** 판독 호출 순번 — 1=원본, 2=완성본 전체, 3~5=완성본 띠(교차 판독) */
let transcribeCall = 0;

const realFetch = globalThis.fetch;
beforeEach(() => {
  imageHttp = 0;
  textHttp = 0;
  textPrompts = [];
  imagePrompts = [];
  transcribeCall = 0;
  process.env.GEMINI_API_KEY = "test-key";
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url);
    const body = JSON.parse(String(init?.body ?? "{}")) as { contents?: { parts?: { text?: string }[] }[] };
    const prompt = body.contents?.[0]?.parts?.map((p) => p.text ?? "").join("\n") ?? "";
    const take = <T>(q: T[][]): T[] => (q.length > 1 ? q.shift()! : q[0] ?? []);

    if (u.includes(IMAGE_MODEL)) {
      imageHttp++;
      imagePrompts.push(prompt);
      const r = mock.image.length > 1 ? mock.image.shift()! : mock.image[0];
      if (r === "echo") {
        // 실제 모델처럼 **보낸 이미지와 같은 크기**로 돌려준다 — 국소 편집(띠)은
        // 원본이 아니라 잘라낸 조각을 보내므로 고정 크기 응답은 비율이 어긋난다
        const inline = (body as { contents?: { parts?: { inline_data?: { data?: string } }[] }[] })
          .contents?.[0]?.parts?.find((x) => x.inline_data?.data)?.inline_data?.data ?? "";
        const meta = await sharp(Buffer.from(inline, "base64")).metadata();
        const png = await sharp({
          create: { width: meta.width ?? 8, height: meta.height ?? 8, channels: 3, background: { r: 255, g: 255, b: 255 } },
        }).png().toBuffer();
        return { ok: true, status: 200, json: async () => imageResp(png) } as unknown as Response;
      }
      if (r === "shrink") {
        const inline = (body as { contents?: { parts?: { inline_data?: { data?: string } }[] }[] })
          .contents?.[0]?.parts?.find((x) => x.inline_data?.data)?.inline_data?.data ?? "";
        const src = sharp(Buffer.from(inline, "base64"));
        const meta = await src.metadata();
        const cw = meta.width ?? 1, ch = meta.height ?? 1;
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
        const png = await sharp(raw, { raw: { width: cw, height: ch, channels: 4 } }).png().toBuffer();
        return { ok: true, status: 200, json: async () => imageResp(png) } as unknown as Response;
      }
      if (r === "hang") {
        return new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
        }) as Promise<Response>;
      }
      if ("status" in (r as Json)) {
        return { ok: false, status: (r as { status: number }).status, json: async () => ({}) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => r } as unknown as Response;
    }
    textHttp++;
    textPrompts.push(prompt);
    let payload: Json;
    if (prompt.includes("모두 찾아주세요")) payload = textResp(take(mock.ocr));
    else if (prompt.includes("교정 번역을 만드세요")) payload = textResp(take(mock.correct));
    else if (prompt.includes("가장 알맞은 후보의 번호")) payload = textResp(take(mock.judge));
    else if (prompt.includes("한국어로 번역하세요")) payload = textResp(take(mock.translate));
    else if (prompt.includes("실제로 읽어온 한국어입니다")) payload = textResp(take(mock.renderedMeaning));
    else if (prompt.includes("각 쌍을 심사하세요")) payload = textResp(take(mock.meaning));
    else if (prompt.includes("그대로 옮겨 적어주세요")) {
      // 띠 판독(3회째부터)은 빈 결과 — 목이 같은 줄을 띠 좌표로 복제하면
      // 검사에 없던 "설명된 영역"이 생겨 판정이 왜곡된다
      transcribeCall++;
      payload = textResp(transcribeCall <= 2 ? take(mock.transcribe) : []);
    }
    else if (prompt.includes("제품 사진")) payload = textResp(take(mock.productCheck));
    else throw new Error(`알 수 없는 프롬프트: ${prompt.slice(0, 60)}`);
    return { ok: true, status: 200, json: async () => payload } as unknown as Response;
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});

/** 정상 시나리오의 기본 목 — 각 테스트가 필요한 부분만 덮어쓴다 */
function happyMock(): Mock {
  return {
    // 순서: ①전체 ②~④띠(0/1/2) ⑤최종 관문(전체) — 관문은 외국어 없음
    ocr: [
      [ocrItem(BOX, "强震深处")],
      [ocrItem(BOX_BAND0, "强震深处")],
      [],
      [],
      [],
    ],
    translate: [["강렬한 진동"]],
    judge: [[0]],
    correct: [[]],
    meaning: [[{ ok: true, issues: [] }]],
    renderedMeaning: [[{ ok: true, issues: [] }]],
    // 완성본 판독 → 번역문 그대로 / 원본 판독 → 원문
    transcribe: [
      [{ box: BOX, text: "强震深处" }],
      [{ box: BOX, text: "강렬한 진동" }],
    ],
    productCheck: [[{ ok: true, issues: [], hard: [] }]],
    image: [imageResp(REGEN_PNG)],
  };
}

describe("translateImageAuto — 이미지 HTTP 최대 1회 계약", () => {
  it("정상: VERIFIED, 이미지 HTTP 정확히 1회", async () => {
    mock = happyMock();
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("VERIFIED");
    expect(imageHttp).toBe(1);
    if (r.status === "VERIFIED") {
      expect(r.data.byteLength).toBeGreaterThan(0);
      expect(r.boxes[0].ko).toBe("강렬한 진동");
    }
  });

  it("외국어 없음(교차 확인): NO_FOREIGN_TEXT, 이미지 HTTP 0회", async () => {
    mock = happyMock();
    mock.ocr = [[], [], [], [], []];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("NO_FOREIGN_TEXT");
    expect(imageHttp).toBe(0);
  });

  /**
   * "외국어를 못 찾은 것"과 "찾았는데 못 번역한 것"은 절대 같은 상태가 아니다.
   *
   * 실사례(2026-08-27 감사): 번역 모델이 원문을 그대로 돌려주거나(에코) 빈
   * 문자열을 주면 그 박스가 조용히 버려지고, 전 박스가 버려지면 NO_FOREIGN_TEXT
   * 로 판정됐다. 이건 **노출 허용** 상태라 중국어 원본이 "검증 완료"로 손님에게
   * 나가고, sha256 캐시에까지 저장돼 같은 바이트의 모든 자산이 같은 오판을
   * 물려받았다. 자동 통과가 아니라 검수로 가야 한다.
   */
  it("전 문구가 에코(원문 그대로)면 NO_FOREIGN_TEXT 가 아니라 NEEDS_REVIEW", async () => {
    mock = happyMock();
    mock.translate = [["强震深处"]]; // 번역 모델이 원문을 되돌려줌
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(imageHttp).toBe(0); // 싼 단계에서 막는다 — 이미지 호출 낭비 금지
    if (r.status === "NEEDS_REVIEW") {
      expect(r.reasons.map((x) => x.code)).toContain("UNTRANSLATED");
      expect(JSON.stringify(r.reasons)).toContain("强震深处");
    }
  });

  it("전 문구의 번역이 비어 있으면 NEEDS_REVIEW", async () => {
    mock = happyMock();
    mock.translate = [[""]];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(imageHttp).toBe(0);
  });

  it("일부만 에코여도 렌더 전에 멈춘다 — 남은 원문이 그대로 실려 나가지 않는다", async () => {
    mock = happyMock();
    mock.ocr[0] = [ocrItem(BOX, "强震深处"), ocrItem([300, 100, 400, 900], "防水设计")];
    mock.ocr[1] = [ocrItem(BOX_BAND0, "强震深处")];
    mock.translate = [["강렬한 진동", "防水设计"]]; // 둘째만 에코
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(imageHttp).toBe(0);
    if (r.status === "NEEDS_REVIEW") {
      expect(JSON.stringify(r.reasons)).toContain("防水设计");
    }
  });

  it("원문이 외국어가 아니면 번역문이 같아도 정상 NO_FOREIGN_TEXT (과잉 차단 금지)", async () => {
    // "USB" 처럼 바꿀 것이 없는 문구는 번역문이 원문과 같은 게 정상이다.
    // 에코 차단이 여기까지 번지면 멀쩡한 이미지가 전부 검수로 쏟아진다.
    mock = happyMock();
    mock.ocr[0] = [ocrItem(BOX, "USB")];
    mock.ocr[1] = [ocrItem(BOX_BAND0, "USB")];
    mock.translate = [["USB"]];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("NO_FOREIGN_TEXT");
    expect(imageHttp).toBe(0);
  });

  it("교정 후에도 2차 검수 실격: 이미지 HTTP 0회 + NEEDS_REVIEW, 사유에 원문·1차·교정·양쪽 지적", async () => {
    mock = happyMock();
    mock.ocr[0] = [ocrItem(BOX, "奏响快乐和弦")];
    mock.ocr[1] = [ocrItem(BOX_BAND0, "奏响快乐和弦")];
    mock.translate = [["쾌락의 하모니"]];
    mock.correct = [["즐거운 쾌감 하모니"]]; // 교정은 됐지만
    mock.meaning = [
      [{ ok: false, issues: ["성적 표현 강화: 쾌락"] }],
      [{ ok: false, issues: ["수식어 누락: 和弦(화음)"] }], // 2차도 실격 — 렌더 없이 검수로
    ];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(imageHttp).toBe(0); // 렌더 전 차단 — 유료 이미지 호출이 아예 없다
    if (r.status === "NEEDS_REVIEW") {
      const m = r.reasons.find((x) => x.code === "MEANING_UNCERTAIN");
      expect(m).toBeDefined();
      // 운영자가 원인을 보게: 원문 + 1차 번역 + 1차 지적 + 교정 번역 + 2차 지적 전부
      expect(m!.detail).toContain("奏响快乐和弦");
      expect(m!.detail).toContain("쾌락의 하모니");
      expect(m!.detail).toContain("성적 표현 강화");
      expect(m!.detail).toContain("즐거운 쾌감 하모니");
      expect(m!.detail).toContain("수식어 누락");
      expect(r.data).toBeNull(); // 후보 없음 — 로컬 렌더로 대신 만들지 않는다
    }
  });

  it("1차 실격 시 검수 지적이 교정 재번역 요청 본문에 실제로 들어간다 (원문·기존 번역·예산 포함)", async () => {
    mock = happyMock();
    mock.ocr[0] = [ocrItem(BOX, "奏响快乐和弦")];
    mock.ocr[1] = [ocrItem(BOX_BAND0, "奏响快乐和弦")];
    mock.translate = [["쾌락의 하모니"]];
    mock.correct = [["즐거운 화음"]];
    mock.meaning = [[{ ok: false, issues: ["성적 표현 강화: 쾌락"] }], [{ ok: false, issues: ["누락"] }]];
    await translateImageAuto(ORIG_PNG, "image/png");
    const bodies = textPrompts.filter((p) => p.includes("교정 번역을 만드세요"));
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toContain("奏响快乐和弦"); // 원문
    expect(bodies[0]).toContain("쾌락의 하모니"); // 기존 번역
    expect(bodies[0]).toContain("성적 표현 강화: 쾌락"); // 1차 검수 지적 그대로
    expect(bodies[0]).toMatch(/최대 \d+자/); // 글자 예산
  });

  it("교정이 2차 검수를 통과하면 그 교정문이 이미지 프롬프트·최종 기준문구가 되고 이미지 HTTP 1회", async () => {
    mock = happyMock();
    mock.translate = [["살떨리는 초강력 진동"]]; // 1차 번역 — 과장으로 실격
    mock.correct = [["강렬한 진동"]]; // 지적 반영 교정 — 이후 happyMock 렌더·판독과 일치
    mock.meaning = [[{ ok: false, issues: ["과장: 살떨리는"] }], [{ ok: true, issues: [] }]];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("VERIFIED");
    expect(imageHttp).toBe(1);
    // 교정문이 이미지 프롬프트의 기준문구다 — 1차 번역은 어디에도 안 들어간다
    expect(imagePrompts[0]).toContain("강렬한 진동");
    expect(imagePrompts[0]).not.toContain("살떨리는");
    if (r.status === "VERIFIED") expect(r.boxes[0].ko).toBe("강렬한 진동");
  });

  it("교정이 첫 번역과 동일(정규화): 즉시 종료 — 이미지 0회 + 2차 검수 호출도 없음", async () => {
    mock = happyMock();
    mock.ocr[0] = [ocrItem(BOX, "奏响快乐和弦")];
    mock.ocr[1] = [ocrItem(BOX_BAND0, "奏响快乐和弦")];
    mock.translate = [["쾌락의 하모니"]];
    mock.correct = [["쾌락의  하모니!"]]; // 공백·부호만 다름 = 무변화 (live2 실측 재현)
    mock.meaning = [[{ ok: false, issues: ["성적 표현 강화: 쾌락"] }]];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(imageHttp).toBe(0);
    // 검수는 1차 한 번뿐 — 무변화 교정에 2차 검수 호출을 낭비하지 않는다
    expect(textPrompts.filter((p) => p.includes("각 쌍을 심사하세요"))).toHaveLength(1);
    expect(textHttp).toBe(7); // OCR 4(전체+띠3) + 번역 1 + 검수 1 + 교정 1
    if (r.status === "NEEDS_REVIEW") {
      expect(r.reasons.find((x) => x.code === "MEANING_UNCERTAIN")?.detail).toContain("재번역 무변화");
    }
  });

  it("5개 문구 동시 실격: 교정 재번역 HTTP 는 배치 1회뿐 — 문구별 반복 호출 금지", async () => {
    const boxes5: [number, number, number, number][] = [
      [100, 100, 200, 900],
      [250, 100, 350, 900],
      [400, 100, 500, 900],
      [550, 100, 650, 900],
      [700, 100, 800, 900],
    ];
    const zh5 = ["强震一号", "柔感二号", "深处三号", "拍打四号", "震颤五号"];
    mock = happyMock();
    mock.ocr = [boxes5.map((b, i) => ocrItem(b, zh5[i])), [], [], [], []];
    mock.translate = [["번역 일", "번역 이", "번역 삼", "번역 사", "번역 오"]];
    mock.correct = [["교정 일", "교정 이", "교정 삼", "교정 사", "교정 오"]];
    const fail5 = zh5.map((_, i) => ({ ok: false, issues: [`지적 ${i + 1}`] }));
    mock.meaning = [fail5, fail5]; // 2차도 전부 실격
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(imageHttp).toBe(0);
    const bodies = textPrompts.filter((p) => p.includes("교정 번역을 만드세요"));
    expect(bodies).toHaveLength(1); // 배치 1회
    for (const zh of zh5) expect(bodies[0]).toContain(zh); // 5문구 전부 그 한 번에
    if (r.status === "NEEDS_REVIEW") {
      expect(r.reasons.filter((x) => x.code === "MEANING_UNCERTAIN")).toHaveLength(5); // 문구별 사유
    }
  });

  it("교정에서 숫자·단위가 빠지면 통과 금지 — 무료 검사로 즉시 종료, 이미지 0회", async () => {
    mock = happyMock();
    mock.ocr[0] = [ocrItem(BOX, "不低于53MIN")];
    mock.ocr[1] = [ocrItem(BOX_BAND0, "不低于53MIN")];
    mock.translate = [["53MIN 이상 지속"]];
    mock.correct = [["오래 지속"]]; // 교정하며 53MIN 을 떨어뜨림
    mock.meaning = [[{ ok: false, issues: ["과장: 지속"] }]];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(imageHttp).toBe(0);
    if (r.status === "NEEDS_REVIEW") {
      expect(r.reasons.find((x) => x.code === "MEANING_UNCERTAIN")?.detail).toContain("53MIN");
    }
  });

  it("확정 문구 축소(live1 사례: 부드러운 흡입 밀착→부드러운 흡입): NEEDS_REVIEW(TEXT_ALTERED), 이미지 HTTP 1회", async () => {
    mock = happyMock();
    mock.ocr[0] = [ocrItem(BOX, "柔软咬合")];
    mock.ocr[1] = [ocrItem(BOX_BAND0, "柔软咬合")];
    mock.translate = [["부드러운 흡입 밀착"]];
    mock.transcribe = [
      [{ box: BOX, text: "柔软咬合" }],
      [{ box: BOX, text: "부드러운 흡입" }], // 모델이 "밀착"을 깎아 먹음 — 의미는 비슷해도 실격
    ];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(imageHttp).toBe(1);
    if (r.status === "NEEDS_REVIEW") {
      expect(r.reasons.map((x) => x.code)).toContain("TEXT_ALTERED");
      expect(r.reasons.find((x) => x.code === "TEXT_ALTERED")?.detail).toContain("부드러운 흡입 밀착");
    }
  });


  /* ── 확장 rect 자동 VERIFIED 금지 (2026-08-24 1차 출시 안전정책) ──
   * 글자 획 꼬리(y78~104)가 기본 사각형(y100) 을 넘어 확장 후보(y1.5: y10~110)가
   * 채택되게 하는 공통 픽스처. 링 검증에 실측 미탐이 있어(아래 두 케이스),
   * 확장 채택 장은 모든 검증을 통과해도 후보 보존 + NEEDS_REVIEW 여야 한다. */
  const tailRegen = (extra?: (ctx: import("@napi-rs/canvas").SKRSContext2D) => void, origExtra?: (ctx: import("@napi-rs/canvas").SKRSContext2D) => void): { orig: Buffer; regen: Buffer } => {
    const oc = drawBase();
    origExtra?.(oc.getContext("2d"));
    const rc = createCanvas(W, H);
    const ctx = rc.getContext("2d");
    ctx.drawImage(oc, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(42, 42, 316, 36);
    ctx.fillStyle = "#111111";
    // 기본 rect 는 y15~105 (toPixelBox 6% 패드 + padY) — 꼬리를 y112 까지 내려
    // 기본을 넘기고 y1.5 후보(y4~116)가 필요하게 한다
    for (let x = 50; x < 350; x += 12) ctx.fillRect(x, 78, 6, 34);
    extra?.(ctx);
    return { orig: oc.toBuffer("image/png"), regen: rc.toBuffer("image/png") };
  };




  /* ══ H1 — 원문 잔류 방지 (2026-08-24 수정 완료) ══
   * 최초 판독과 최종 관문이 같은 OCR 모델이라 실명이 상관된다. 최초에 못 본
   * 문구는 번역되지 않고, 같은 모델의 관문이 또 놓치면 LEFTOVER 0 으로 통과했다.
   * 이제 ① 관문을 전체+띠 교차 판독으로 올리고 ② 모델과 무관한 픽셀 탐지로
   * "원본의 모든 문자 영역이 설명되는가"를 따로 본다. */

  /**
   * 글자꼴 잉크 대역 — 통짜 사각형이 아니라 **획으로 이뤄진 낱자**가 늘어선 모양.
   * 탐지기는 채움비가 1.0 인 덩어리를 글자로 보지 않는다(도형·띠와 구분해야 하므로),
   * 그래서 실제 글자처럼 테두리+가로획으로 그린다.
   */
  const glyphRow = (
    ctx: import("@napi-rs/canvas").SKRSContext2D,
    y: number,
    color: string,
    { h = 22, w = 10, gap = 20, from = 50, to = 350 } = {},
  ): void => {
    ctx.fillStyle = color;
    for (let x = from; x < to; x += gap) {
      ctx.fillRect(x, y, w, 2);
      ctx.fillRect(x, y + h - 2, w, 2);
      ctx.fillRect(x, y, 2, h);
      ctx.fillRect(x + w - 2, y, 2, h);
      ctx.fillRect(x + 2, y + ((h / 2) | 0), w - 4, 2);
    }
  };

  /** 원본: 번역 대상 대역 A + OCR 이 못 본 대역 B / 완성본: A 만 바뀐다 */
  const missedBand = (opts: { y: number; color: string; h?: number; w?: number; gap?: number; from?: number; to?: number }) => {
    const draw = (rendered: boolean): Buffer => {
      const c = createCanvas(W, H);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, W, H);
      glyphRow(ctx, 48, "#000000"); // 대역 A — 번역 대상(BOX)
      if (rendered) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(42, 42, 316, 36);
        glyphRow(ctx, 48, "#111111", { gap: 24 }); // A 만 한국어로 바뀜
      }
      glyphRow(ctx, opts.y, opts.color, opts); // 대역 B — 어떤 OCR 목에도 없다
      return c.toBuffer("image/png");
    };
    return { orig: draw(false), regen: draw(true) };
  };

  it("OCR 이 통째로 놓친 중국어 대역: 픽셀 탐지가 잡아 VERIFIED 금지 (UNEXPLAINED_TEXT)", async () => {
    const { orig, regen } = missedBand({ y: 240, color: "#000000" });
    mock = happyMock();
    mock.image = [imageResp(regen)];
    const r = await translateImageAuto(orig, "image/png");
    expect(r.status).not.toBe("VERIFIED");
    expect(r.status).toBe("NEEDS_REVIEW");
    if (r.status === "NEEDS_REVIEW") {
      expect(r.reasons.map((x) => x.code)).toContain("UNEXPLAINED_TEXT");
    }
  });

  it("작은 글자(높이 8px)로 놓친 중국어: 확신 낮음으로도 걸린다", async () => {
    const { orig, regen } = missedBand({ y: 300, color: "#000000", h: 8, w: 5, gap: 10, from: 60, to: 200 });
    mock = happyMock();
    mock.image = [imageResp(regen)];
    const r = await translateImageAuto(orig, "image/png");
    expect(r.status).toBe("NEEDS_REVIEW");
    if (r.status === "NEEDS_REVIEW") {
      const codes = r.reasons.map((x) => x.code);
      expect(codes.some((c) => c === "UNEXPLAINED_TEXT" || c === "LOW_CONFIDENCE_TEXT")).toBe(true);
    }
  });

  it("저대비 중국어(연회색): 확신 낮음으로 걸린다", async () => {
    const { orig, regen } = missedBand({ y: 300, color: "#b8b8b8" });
    mock = happyMock();
    mock.image = [imageResp(regen)];
    const r = await translateImageAuto(orig, "image/png");
    expect(r.status).toBe("NEEDS_REVIEW");
    if (r.status === "NEEDS_REVIEW") {
      const codes = r.reasons.map((x) => x.code);
      expect(codes.some((c) => c === "UNEXPLAINED_TEXT" || c === "LOW_CONFIDENCE_TEXT")).toBe(true);
    }
  });

  it("하단(하위 15%) 작은 중국어: 스펙·주의문구 자리 — 걸린다", async () => {
    const { orig, regen } = missedBand({ y: 370, color: "#222222", h: 10, w: 6, gap: 12, from: 60, to: 260 });
    mock = happyMock();
    mock.image = [imageResp(regen)];
    const r = await translateImageAuto(orig, "image/png");
    expect(r.status).toBe("NEEDS_REVIEW");
    if (r.status === "NEEDS_REVIEW") {
      const codes = r.reasons.map((x) => x.code);
      expect(codes.some((c) => c === "UNEXPLAINED_TEXT" || c === "LOW_CONFIDENCE_TEXT")).toBe(true);
    }
  });

  it("관문 교차 판독: 전체 판독이 놓쳐도 띠 판독이 잡으면 LEFTOVER 로 걸린다", async () => {
    mock = happyMock();
    // 최종 관문 호출 순서: 전체(빈 결과) → 띠 0(잔류 발견) → 띠 1·2
    mock.ocr = [
      [ocrItem(BOX, "强震深处")],
      [ocrItem(BOX_BAND0, "强震深处")],
      [],
      [],
      [], // 관문 전체 판독 — 못 봄
      [ocrItem([500, 100, 600, 500], "售后无忧")], // 관문 띠 판독 — 잡음
    ];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("NEEDS_REVIEW");
    if (r.status === "NEEDS_REVIEW") expect(r.reasons.map((x) => x.code)).toContain("LEFTOVER");
  });

  /* ══ H3 — 영문·브랜드·숫자·모델코드 보존 (2026-08-24 수정 완료) ══ */

  /** 원본에 라틴 장식 줄을 그린다. y 를 패치 rect(기본 y15~105) 밖/안으로 골라 쓴다 */
  const withDeco = (decoY: number, mode: "keep" | "erase" | "alter") => {
    const draw = (rendered: boolean): Buffer => {
      const c = createCanvas(W, H);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, W, H);
      glyphRow(ctx, 48, "#000000");
      if (rendered) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(42, 42, 316, 36);
        glyphRow(ctx, 48, "#111111", { gap: 24 });
      }
      const drawDeco = !rendered || mode === "keep" || mode === "alter";
      if (drawDeco) {
        const shift = rendered && mode === "alter" ? 8 : 0;
        glyphRow(ctx, decoY, "#333333", { h: 12, w: 7, gap: 14, from: 150 + shift, to: 250 + shift });
      }
      return c.toBuffer("image/png");
    };
    return { orig: draw(false), regen: draw(true) };
  };
  const DECO_BOX: [number, number, number, number] = [290, 360, 330, 640]; // y116~132, x144~256

  it("패치 밖 영문 장식이 그대로면 VERIFIED (정상 보존)", async () => {
    const { orig, regen } = withDeco(120, "keep");
    mock = happyMock();
    mock.image = [imageResp(regen)];
    mock.transcribe = [
      [
        { box: BOX, text: "强震深处" },
        { box: DECO_BOX, text: "TRIPLE STIM" },
      ],
      [
        { box: BOX, text: "강렬한 진동" },
        { box: DECO_BOX, text: "TRIPLE STIM" }, // 그대로 남아 있다
      ],
    ];
    const r = await translateImageAuto(orig, "image/png");
    expect(r.status).toBe("VERIFIED");
    expect(imageHttp).toBe(1);
  });

  it("영문 장식이 완성본에서 사라지면 VERIFIED 금지 (DECOR_ALTERED)", async () => {
    const { orig, regen } = withDeco(120, "erase");
    mock = happyMock();
    mock.image = [imageResp(regen)];
    mock.transcribe = [
      [
        { box: BOX, text: "强震深处" },
        { box: DECO_BOX, text: "TRIPLE STIM" },
      ],
      [{ box: BOX, text: "강렬한 진동" }], // 장식이 사라져 안 읽힌다
    ];
    const r = await translateImageAuto(orig, "image/png");
    expect(r.status).not.toBe("VERIFIED");
    if (r.status === "NEEDS_REVIEW") expect(r.reasons.map((x) => x.code)).toContain("DECOR_ALTERED");
  });

  it("영문 장식이 자리를 옮기거나 변형되면 VERIFIED 금지 (DECOR_ALTERED)", async () => {
    const { orig, regen } = withDeco(120, "alter");
    mock = happyMock();
    mock.image = [imageResp(regen)];
    mock.transcribe = [
      [
        { box: BOX, text: "强震深处" },
        { box: DECO_BOX, text: "TRIPLE STIM" },
      ],
      [
        { box: BOX, text: "강렬한 진동" },
        { box: [290, 700, 330, 950], text: "TRIPLE STIM" }, // 엉뚱한 자리에서 읽힘
      ],
    ];
    const r = await translateImageAuto(orig, "image/png");
    expect(r.status).not.toBe("VERIFIED");
    if (r.status === "NEEDS_REVIEW") expect(r.reasons.map((x) => x.code)).toContain("DECOR_ALTERED");
  });


  it("모델이 한 문구를 번역하지 않고 원문을 남기면: NEEDS_REVIEW, 이미지 HTTP 1회 · 재요청 없음", async () => {
    // 전체 채택 경로 — 완성본 판독에 원문이 그대로 읽히면 확정 문구 매칭이 실패하고
    // 관문 교차 판독이 잔류를 센다. 어느 쪽이든 VERIFIED 는 불가.
    mock = happyMock();
    mock.transcribe = [
      [{ box: BOX, text: "强震深处" }], // 원본 판독
      [{ box: BOX, text: "强震深处" }], // 완성본 판독 — 번역 안 됨
    ];
    mock.ocr[4] = [ocrItem(BOX, "强震深处")]; // 관문 교차 판독이 잔류를 봄
    mock.renderedMeaning = [[{ ok: false, issues: ["중국어 잔존"] }]];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(imageHttp).toBe(1); // 실패해도 자동 재렌더 없음
    if (r.status === "NEEDS_REVIEW") {
      const codes = r.reasons.map((x) => x.code);
      expect(codes).toContain("TEXT_ALTERED"); // 확정 문구가 완성본에 없다
      expect(codes).toContain("LEFTOVER");
    }
  });

  /* ── 전체 채택 경로의 제품 무결성 관문 (2026-08-24 아키텍처 전환) ──
   * 픽셀 동일성 관문(패치 밖 0px·확장 링)은 패치 경로(수동·워터마크·GIF)로 물러났다.
   * 전체 채택에서 제품 모습을 지키는 관문은 두-이미지 무결성 심사다:
   * 제품 개수·형태·색상·구성 변화 = 실격, 판 재배치·글자 차이 = 허용. */

  it("제품 무결성 심사 실격(개수·형태·색상 변화): NEEDS_REVIEW(PRODUCT_CHANGED), 자동 VERIFIED 금지", async () => {
    mock = happyMock();
    mock.productCheck = [[{ ok: false, issues: ["제품이 2개→1개"], hard: ["제품이 2개→1개"] }]];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).not.toBe("VERIFIED");
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(imageHttp).toBe(1);
    if (r.status === "NEEDS_REVIEW") {
      const m = r.reasons.find((x) => x.code === "PRODUCT_CHANGED");
      expect(m).toBeDefined();
      expect(m!.detail).toContain("2개→1개");
    }
  });

  it("제품 무결성 심사가 불확실(ok:false, hard 미기재)해도 차단 — fail-closed", async () => {
    mock = happyMock();
    mock.productCheck = [[{ ok: false, issues: ["판단 불가"] }]];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("NEEDS_REVIEW");
    if (r.status === "NEEDS_REVIEW") expect(r.reasons.map((x) => x.code)).toContain("PRODUCT_CHANGED");
  });

  it("제품 무결성 응답 형식 오류: VERIFICATION_FAILED — 확인 못 했으면 통과가 아니다", async () => {
    mock = happyMock();
    mock.productCheck = [["깨진 응답" as unknown as { ok: boolean; issues: string[] }]];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("VERIFICATION_FAILED");
  });

  it("겹친 원문을 모델이 못 바꿔 잔존하면: 잔류·불일치로 차단 (전체 채택)", async () => {
    const { orig, regen } = withDeco(88, "keep");
    const OVERLAP_BOX: [number, number, number, number] = [215, 360, 255, 640];
    mock = happyMock();
    mock.image = [imageResp(regen)];
    mock.transcribe = [
      [
        { box: BOX, text: "强震深处" },
        { box: OVERLAP_BOX, text: "TRIPLE STIM" },
      ],
      [
        { box: BOX, text: "强震深处" }, // 완성본에도 원문 그대로
        { box: OVERLAP_BOX, text: "TRIPLE STIM" },
      ],
    ];
    mock.renderedMeaning = [[{ ok: false, issues: ["중국어 잔존"] }]];
    const r = await translateImageAuto(orig, "image/png");
    expect(r.status).toBe("NEEDS_REVIEW");
    if (r.status === "NEEDS_REVIEW") {
      expect(r.reasons.map((x) => x.code)).toContain("TEXT_ALTERED");
    }
  });

  it("관문에서 외국어 잔존: 부분 성공이라도 NEEDS_REVIEW(LEFTOVER), 이미지 HTTP 1회", async () => {
    mock = happyMock();
    mock.ocr = [
      [ocrItem(BOX, "强震深处")],
      [ocrItem(BOX_BAND0, "强震深处")],
      [],
      [],
      [ocrItem([850, 100, 950, 500], "售后无忧")], // 관문이 놓친 원문을 찾음
    ];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(imageHttp).toBe(1); // 잔존해도 자동 재렌더 없음
    if (r.status === "NEEDS_REVIEW") {
      expect(r.reasons.map((x) => x.code)).toContain("LEFTOVER");
      expect(r.data).not.toBeNull(); // 후보는 보존
    }
  });

  it("판독이 잘림을 발견(강렬한 진동→강렬한): NEEDS_REVIEW(TEXT_ALTERED), 이미지 HTTP 1회", async () => {
    mock = happyMock();
    mock.transcribe = [
      [{ box: BOX, text: "强震深处" }],
      [{ box: BOX, text: "강렬한" }], // 뒷말 잘림
    ];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(imageHttp).toBe(1);
    if (r.status === "NEEDS_REVIEW") expect(r.reasons.map((x) => x.code)).toContain("TEXT_ALTERED");
  });

  it("숫자 변조: NEEDS_REVIEW(NUMBER_CHANGED), 이미지 HTTP 1회", async () => {
    mock = happyMock();
    mock.ocr[0] = [ocrItem(BOX, "不低于53MIN")];
    mock.ocr[1] = [ocrItem(BOX_BAND0, "不低于53MIN")];
    mock.translate = [["53MIN 이상"]];
    mock.transcribe = [
      [{ box: BOX, text: "不低于53MIN" }],
      [{ box: BOX, text: "35MIN 이상" }], // 모델이 숫자를 뒤집음
    ];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(imageHttp).toBe(1);
    if (r.status === "NEEDS_REVIEW") expect(r.reasons.map((x) => x.code)).toContain("NUMBER_CHANGED");
  });

  it("없던 문구 생성: NEEDS_REVIEW(NEW_TEXT), 이미지 HTTP 1회", async () => {
    mock = happyMock();
    mock.transcribe = [
      [{ box: BOX, text: "强震深处" }],
      [
        { box: BOX, text: "강렬한 진동" },
        { box: [700, 100, 780, 400], text: "정품 보증 도장" }, // 지어낸 문구
      ],
    ];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(imageHttp).toBe(1);
    if (r.status === "NEEDS_REVIEW") expect(r.reasons.map((x) => x.code)).toContain("NEW_TEXT");
  });

  it("안전 필터 거부: NEEDS_REVIEW(SAFETY_BLOCKED), 이미지 HTTP 1회 · 재요청 없음", async () => {
    mock = happyMock();
    mock.image = [{ candidates: [{ content: { parts: [] }, finishReason: "SAFETY" }], promptFeedback: { blockReason: "SAFETY" } } as Json];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(imageHttp).toBe(1);
    if (r.status === "NEEDS_REVIEW") {
      expect(r.reasons.map((x) => x.code)).toContain("SAFETY_BLOCKED");
      expect(r.data).toBeNull();
    }
  });

  it("429: RETRYABLE(RATE_LIMITED), 이미지 HTTP 1회 · 상태 코드와 무관하게 재요청 없음", async () => {
    mock = happyMock();
    mock.image = [{ status: 429 }];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("RETRYABLE");
    expect(imageHttp).toBe(1);
    if (r.status === "RETRYABLE") expect(r.reasons.map((x) => x.code)).toContain("RATE_LIMITED");
  });

  it("500: RETRYABLE(SERVER_ERROR), 이미지 HTTP 1회", async () => {
    mock = happyMock();
    mock.image = [{ status: 500 }];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("RETRYABLE");
    expect(imageHttp).toBe(1);
    if (r.status === "RETRYABLE") expect(r.reasons.map((x) => x.code)).toContain("SERVER_ERROR");
  });

  it("재생성 비율 불일치: NEEDS_REVIEW(RATIO_MISMATCH), 이미지 HTTP 1회", async () => {
    mock = happyMock();
    mock.image = [imageResp(REGEN_WRONG_RATIO)];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(imageHttp).toBe(1);
    if (r.status === "NEEDS_REVIEW") expect(r.reasons.map((x) => x.code)).toContain("RATIO_MISMATCH");
  });

  it("교차 OCR 불일치: 렌더는 하되 NEEDS_REVIEW(OCR_DISAGREEMENT)", async () => {
    mock = happyMock();
    mock.ocr[1] = []; // 띠 판독이 그 문구를 못 봄
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(imageHttp).toBe(1);
    if (r.status === "NEEDS_REVIEW") expect(r.reasons.map((x) => x.code)).toContain("OCR_DISAGREEMENT");
  });

  it("밀집 그리드(30문구+): 렌더 1회 후 무조건 NEEDS_REVIEW(DENSE_GRID)", async () => {
    // 30개의 가짜 문구 — 좌표는 전부 같은 글자 대역 안 (대비 필터 통과)
    // 라벨에 접미사를 붙여 포함관계를 없앤다 — "字1" ⊂ "字11" 이면 판독 중복으로 합쳐진다
    const many = Array.from({ length: 30 }, (_, i) => ocrItem([100, 100 + i * 25, 200, 120 + i * 25], `字${i}호`));
    mock = happyMock();
    mock.ocr = [many, many, [], [], []];
    mock.translate = [many.map((_, i) => `문구${i}호`)];
    mock.meaning = [many.map(() => ({ ok: true, issues: [] }))];
    mock.renderedMeaning = [many.map(() => ({ ok: true, issues: [] }))];
    mock.transcribe = [
      many.map((m, i) => ({ box: m.box, text: `字${i}호` })),
      many.map((m, i) => ({ box: m.box, text: `문구${i}호` })),
    ];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(imageHttp).toBe(1);
    if (r.status === "NEEDS_REVIEW") expect(r.reasons.map((x) => x.code)).toContain("DENSE_GRID");
  });

  it("박스 안 추가 문구 환각: NEEDS_REVIEW(EXTRA_TEXT), 이미지 HTTP 1회", async () => {
    mock = happyMock();
    mock.transcribe = [
      [{ box: BOX, text: "强震深处" }],
      [{ box: BOX, text: "강렬한 진동 정품 보증" }], // 기대 옆에 없던 말이 붙음
    ];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(imageHttp).toBe(1);
    if (r.status === "NEEDS_REVIEW") {
      expect(r.reasons.map((x) => x.code)).toContain("EXTRA_TEXT");
      expect(r.reasons.find((x) => x.code === "EXTRA_TEXT")?.detail).toContain("정품보증");
    }
  });


  it("GIF: 패치 밖 보존을 픽셀로 증명 못 하므로 자동 VERIFIED 금지 — NEEDS_REVIEW(GIF_UNVERIFIED)", { timeout: 30_000 }, async () => {
    const gif = await sharp(ORIG_PNG).gif().toBuffer();
    mock = happyMock();
    // 국소 편집(2026-08-31): 띠를 잘라 보내므로 응답도 그 크기여야 한다
    mock.image = ["echo"];
    // 정지 띠 재생성본의 원문 잔류 검사가 판독을 한 번 더 쓴다
    mock.transcribe = [
      [{ box: BOX, text: "强震深处" }], // 원본 판독
      [{ box: BOX, text: "강렬한 진동" }], // 띠 재생성본 잔류 검사
      [{ box: BOX, text: "강렬한 진동" }], // 완성본 판독
    ];
    const r = await translateImageAuto(gif, "image/gif");
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(imageHttp).toBe(1);
    if (r.status === "NEEDS_REVIEW") {
      expect(r.reasons.map((x) => x.code)).toContain("GIF_UNVERIFIED");
      expect(r.data).not.toBeNull(); // 후보(GIF)는 보존 — 육안 확인 대상
    }
  });

  it("GIF: 글자가 작게 그려진 띠는 채택하되 GIF_SMALL_TEXT 사유로 알린다 — 자동 흐름엔 재시도 예산이 없다", { timeout: 30_000 }, async () => {
    const gif = await sharp(ORIG_PNG).gif().toBuffer();
    mock = happyMock();
    mock.image = ["shrink"];
    mock.transcribe = [
      [{ box: BOX, text: "强震深处" }],
      [{ box: BOX, text: "강렬한 진동" }],
      [{ box: BOX, text: "강렬한 진동" }],
    ];
    const r = await translateImageAuto(gif, "image/gif");
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(imageHttp).toBe(1); // 작아졌다고 자동으로 더 두드리지 않는다 — 원본당 1회
    if (r.status === "NEEDS_REVIEW") {
      const small = r.reasons.find((x) => x.code === "GIF_SMALL_TEXT");
      expect(small?.detail).toContain("强震深处");
      expect(small?.detail).toMatch(/\d+%/);
      expect(r.data).not.toBeNull(); // 작은 한국어가 중국어 원문보다 낫다 — 후보는 남긴다
    }
  });

  it("GIF: 예산을 넘긴 번역은 직전 답과 초과량을 보여 주며 두 번까지 줄인다", { timeout: 30_000 }, async () => {
    const gif = await sharp(ORIG_PNG).gif().toBuffer();
    mock = happyMock();
    mock.image = ["echo"];
    mock.transcribe = [
      [{ box: BOX, text: "强震深处" }],
      [{ box: BOX, text: "강렬한 진동" }],
      [{ box: BOX, text: "강렬한 진동" }],
    ];
    // BOX 320×40px → GIF(tight) 예산 12자. 1차 20자 → 1차 줄이기 14자(아직 초과) → 2차 줄이기 6자.
    // 실측(2026-09-02 마리아 0018): 「大头爆震 更大更刺激」이 예산 12자에 17자로 나와
    // 그대로 렌더됐고 글자가 원문의 52% 로 작아졌다 — 줄이기 1회로는 못 잡았다.
    mock.translate = [["아주 강렬하고 깊숙한 진동 자극 느낌"], ["강렬하고 깊숙한 진동 자극"], ["강렬한 진동"]];
    const r = await translateImageAuto(gif, "image/gif");
    const asks = textPrompts.filter((p) => p.includes("한국어로 번역하세요"));
    expect(asks).toHaveLength(3);
    expect(asks[1]).toContain("직전 답");
    expect(asks[1]).toContain("아주 강렬하고 깊숙한 진동 자극 느낌");
    expect(asks[1]).toMatch(/\d+자 초과/);
    expect(asks[2]).toContain("강렬하고 깊숙한 진동 자극");
    expect(asks[2]).toMatch(/\d+자 초과/);
    expect("boxes" in r && r.boxes[0]?.ko).toBe("강렬한 진동");
  });

  it("GIF: 교정 재번역도 띠 예산을 쓴다 — 느슨한 정지 이미지 예산으로 교정하면 넘친 문구가 그대로 렌더된다", { timeout: 30_000 }, async () => {
    // 실측(2026-09-02 exp10): 「大头爆震 更大更刺激」 띠 예산 15자인데 교정문 18자가 그대로
    // 렌더 단계로 갔다 — 교정 요청문이 정지 이미지 예산(21자)을 싣고 있었다.
    const gif = await sharp(ORIG_PNG).gif().toBuffer();
    mock = happyMock();
    mock.image = ["echo"];
    mock.transcribe = [
      [{ box: BOX, text: "强震深处" }],
      [{ box: BOX, text: "강렬한 진동" }],
      [{ box: BOX, text: "강렬한 진동" }],
    ];
    mock.translate = [["살떨리는 초강력 진동"]];
    mock.correct = [["강렬한 진동"]];
    mock.meaning = [[{ ok: false, issues: ["과장: 살떨리는"] }], [{ ok: true, issues: [] }]];
    await translateImageAuto(gif, "image/gif");
    const first = textPrompts.find((p) => p.includes("한국어로 번역하세요"))!;
    const budget = Number(first.match(/최대 (\d+)자/)![1]);
    expect(budget).toBeLessThan(18); // 정지 이미지 예산(18)이 아니라 띠 예산
    const corr = textPrompts.find((p) => p.includes("교정 번역을 만드세요"))!;
    expect(corr).toContain(`최대 ${budget}자`);
  });

  const gifTranscribe = () => [
    [{ box: BOX, text: "强震深处" }],
    [{ box: BOX, text: "강렬한 진동" }],
    [{ box: BOX, text: "강렬한 진동" }],
  ];

  it("GIF 다시 만들기: 승인된 문구는 재번역하지 않고 그대로 쓴다", { timeout: 30_000 }, async () => {
    // 실측(2026-09-02 exp10·11): 이 자산은 VERIFIED 문구 "인체공학 설계"를 갖고 있는데 재렌더가
    // 매번 처음부터 번역해 "인체 마스터"를 만들었고, 다음 실행은 「强震蜜豆」 재번역이 의미
    // 검수에 걸려 렌더까지 못 갔다(호출 0회). 사람이 승인한 문구가 출발점이어야 한다.
    const gif = await sharp(ORIG_PNG).gif().toBuffer();
    mock = happyMock();
    mock.image = ["echo"];
    mock.transcribe = gifTranscribe();
    mock.translate = [["엉뚱한 번역"]];
    const r = await translateImageAuto(gif, "image/gif", { phraseMemory: new Map([["强震深处", "강렬한 진동"]]) });
    expect(textPrompts.filter((p) => p.includes("한국어로 번역하세요"))).toHaveLength(0); // 전부 기억에서
    expect("boxes" in r && r.boxes[0]?.ko).toBe("강렬한 진동");
  });

  it("GIF: 기억 문구가 띠 예산을 넘으면 그 문구를 직전 답으로 보여 주며 줄인다 — 새로 짓지 않는다", { timeout: 30_000 }, async () => {
    const gif = await sharp(ORIG_PNG).gif().toBuffer();
    mock = happyMock();
    mock.image = ["echo"];
    mock.transcribe = gifTranscribe();
    mock.translate = [["강렬한 깊은 진동"]]; // 줄이기 응답 (예산 9자 안, 너무 짧지 않음)
    mock.transcribe[1] = [{ box: BOX, text: "강렬한 깊은 진동" }];
    mock.transcribe[2] = [{ box: BOX, text: "강렬한 깊은 진동" }];
    const r = await translateImageAuto(gif, "image/gif", {
      phraseMemory: new Map([["强震深处", "아주 강렬하고 깊숙한 진동 자극 느낌"]]),
    });
    const asks = textPrompts.filter((p) => p.includes("한국어로 번역하세요"));
    expect(asks).toHaveLength(1);
    expect(asks[0]).toContain("직전 답");
    expect(asks[0]).toContain("아주 강렬하고 깊숙한 진동 자극 느낌");
    expect("boxes" in r && r.boxes[0]?.ko).toBe("강렬한 깊은 진동");
  });

  it("정지 이미지는 기억 문구를 쓰지 않는다 — 정지 이미지 경로는 그대로", async () => {
    mock = happyMock();
    await translateImageAuto(ORIG_PNG, "image/png", { phraseMemory: new Map([["强震深处", "강렬한 진동"]]) });
    const asks = textPrompts.filter((p) => p.includes("한국어로 번역하세요"));
    expect(asks.length).toBeGreaterThanOrEqual(1);
    expect(asks[0]).toContain("强震深处");
  });

  it("GIF 번역 요청문에만 용어집(蜜豆·伸缩)과 '완결된 명사구' 규칙이 실린다", { timeout: 30_000 }, async () => {
    // 실측(exp11): 「强震蜜豆 伸缩人体」 → "강력 진동과 수축 자극" — 蜜豆(부위)·伸缩(왕복)을 못 옮겨
    // 의미 검수에 두 번 걸렸다. 정지 이미지 요청문은 건드리지 않는다.
    const gif = await sharp(ORIG_PNG).gif().toBuffer();
    mock = happyMock();
    mock.image = ["echo"];
    mock.transcribe = gifTranscribe();
    await translateImageAuto(gif, "image/gif");
    const gifAsk = textPrompts.find((p) => p.includes("한국어로 번역하세요"))!;
    expect(gifAsk).toContain("蜜豆");
    expect(gifAsk).toContain("완결된 명사구");
    textPrompts = [];
    mock = happyMock();
    await translateImageAuto(ORIG_PNG, "image/png");
    const stillAsk = textPrompts.find((p) => p.includes("한국어로 번역하세요"))!;
    expect(stillAsk).not.toContain("蜜豆");
    expect(stillAsk).not.toContain("완결된 명사구");
  });

  it("GIF: 교정이 또 실격이면 한 번 더 교정한다(텍스트 호출만) — 렌더 없이 검수함으로 보내는 것보다 싸다", { timeout: 30_000 }, async () => {
    // 실측(exp11): 1차 오역 → 교정 1회 → 또 실격 → 이미지 호출 0회로 검수함행. 운영자가 손으로
    // 고쳐 다시 눌러야 했다. 텍스트 호출(≈$0.0001) 한 번이면 대부분 넘어간다.
    const gif = await sharp(ORIG_PNG).gif().toBuffer();
    mock = happyMock();
    mock.image = ["echo"];
    mock.transcribe = gifTranscribe();
    mock.translate = [["살떨리는 초강력 진동"]];
    mock.correct = [["여전히 살떨리는 진동"], ["강렬한 진동"]];
    mock.meaning = [[{ ok: false, issues: ["과장: 살떨리는"] }], [{ ok: false, issues: ["여전히 과장"] }], [{ ok: true, issues: [] }]];
    const r = await translateImageAuto(gif, "image/gif");
    expect(textPrompts.filter((p) => p.includes("교정 번역을 만드세요"))).toHaveLength(2);
    expect("boxes" in r && r.boxes[0]?.ko).toBe("강렬한 진동");
    expect(imageHttp).toBe(1);
  });

  it("GIF: 패치 밖이 원본과 같음을 픽셀로 확인해 사유에 적는다 — 운영자는 띠 안만 보면 된다", { timeout: 30_000 }, async () => {
    const gif = await sharp(ORIG_PNG).gif().toBuffer();
    mock = happyMock();
    mock.image = ["echo"];
    mock.transcribe = gifTranscribe();
    const r = await translateImageAuto(gif, "image/gif");
    expect(r.status).toBe("NEEDS_REVIEW");
    if (r.status === "NEEDS_REVIEW") {
      const u = r.reasons.find((x) => x.code === "GIF_UNVERIFIED");
      expect(u?.detail).toMatch(/패치 밖.*원본과 같음/);
    }
  });

  it("GIF: 줄인 답이 예산의 60% 도 안 되면 너무 짧다 — 예산에 가깝게 한 번 더 받는다", { timeout: 30_000 }, async () => {
    // 실측(exp12): 예산 15자에 17자 → "대형헤드 폭풍진동"(9자)로 깎아 更大更刺激 이 통째로 사라졌다
    // (MEANING_MISMATCH). "초과한 만큼만" 줄이라고 해도 모델은 절반을 잘라 낸다.
    const gif = await sharp(ORIG_PNG).gif().toBuffer();
    mock = happyMock();
    mock.image = ["echo"];
    mock.transcribe = gifTranscribe();
    mock.translate = [["아주 강렬하고 깊숙한 진동 자극 느낌"], ["강한 진동"], ["강렬한 깊은 진동"]];
    mock.transcribe[1] = [{ box: BOX, text: "강렬한 깊은 진동" }];
    mock.transcribe[2] = [{ box: BOX, text: "강렬한 깊은 진동" }];
    const r = await translateImageAuto(gif, "image/gif");
    const asks = textPrompts.filter((p) => p.includes("한국어로 번역하세요"));
    expect(asks).toHaveLength(3);
    expect(asks[2]).toMatch(/너무 짧/);
    expect(asks[2]).toContain("강한 진동");
    expect("boxes" in r && r.boxes[0]?.ko).toBe("강렬한 깊은 진동");
  });

  it("GIF: 직접 그린 문구는 GIF_LOCAL_TEXT 사유로 알린다 — 서체가 바뀐 자리를 운영자가 본다", { timeout: 30_000 }, async () => {
    // 픽스처: 검은 막대(글자) 바로 위 한 줄까지 움직이는 2프레임 GIF, 배경 흰색 단색
    const c1 = createCanvas(W, H); const x1 = c1.getContext("2d");
    x1.fillStyle = "#ffffff"; x1.fillRect(0, 0, W, H); x1.fillStyle = "#000000";
    for (let x = 40; x < 360; x += 12) x1.fillRect(x, 40, 4, 40); // 세로 줄무늬 = 획(잉크 1/3)
    x1.fillStyle = "#4040ff"; x1.fillRect(0, 0, W, 40);
    const c2 = createCanvas(W, H); const x2 = c2.getContext("2d");
    x2.drawImage(c1, 0, 0); x2.fillStyle = "#ff4040"; x2.fillRect(0, 0, W, 40);
    const gif = await sharp([c1.toBuffer("image/png"), c2.toBuffer("image/png")], { join: { animated: true } }).gif({ delay: [100, 100] }).toBuffer();
    mock = happyMock();
    mock.transcribe = gifTranscribe();
    const r = await translateImageAuto(gif, "image/gif");
    expect(imageHttp).toBe(0);
    expect(r.status).toBe("NEEDS_REVIEW");
    if (r.status === "NEEDS_REVIEW") {
      expect(r.reasons.find((x) => x.code === "GIF_LOCAL_TEXT")?.detail).toContain("强震深处");
      expect(r.data).not.toBeNull();
    }
  });

  it("GIF 재렌더: 저장된 판독 좌표(knownBoxes)를 주면 판독을 다시 하지 않는다 — 같은 GIF 는 항상 같은 띠", { timeout: 30_000 }, async () => {
    // 실측(exp10 vs exp12): 판독 좌표가 실행마다 몇 px 달라 「回弹设计」 띠가 생겼다 안 생겼다 했다.
    const gif = await sharp(ORIG_PNG).gif().toBuffer();
    mock = happyMock();
    mock.image = ["echo"];
    mock.transcribe = gifTranscribe();
    // 기준: 저장 좌표 없이 한 번 — 렌더 전 교차 판독(전체+띠) + 완성본 관문 판독
    await translateImageAuto(gif, "image/gif");
    const baseline = textPrompts.filter((p) => p.includes("모두 찾아주세요")).length;
    textPrompts = [];
    mock = happyMock();
    mock.image = ["echo"];
    mock.transcribe = gifTranscribe();
    const known = [{ box: BOX, zh: "强震深处", ko: "예전 후보", bg: "#ffffff", fg: "#000000", bold: true, solid_bg: true }];
    const r = await translateImageAuto(gif, "image/gif", { knownBoxes: known });
    const ocrCalls = textPrompts.filter((p) => p.includes("모두 찾아주세요")).length;
    expect(ocrCalls).toBeLessThan(baseline); // 렌더 전 판독이 사라졌다(완성본 관문 판독만 남는다)
    expect(ocrCalls).toBe(baseline - 4);
    expect("boxes" in r && r.boxes[0]?.zh).toBe("强震深处");
    expect("boxes" in r && r.boxes[0]?.ko).toBe("강렬한 진동"); // 문구는 새로(기억 없음) — 좌표만 재사용
  });

  it("정지 이미지는 knownBoxes 를 무시한다 — 정지 이미지 경로는 그대로", async () => {
    mock = happyMock();
    await translateImageAuto(ORIG_PNG, "image/png", { knownBoxes: [{ box: BOX, zh: "强震深处", ko: "", bg: "#fff", fg: "#000" }] });
    expect(textPrompts.filter((p) => p.includes("모두 찾아주세요")).length).toBeGreaterThan(0);
  });

  it("GIF: 처음 보는 문구는 후보 3개를 받아 심사로 고른다 — 한 번에 하나만 받으면 어색한 답이 그대로 간다", { timeout: 30_000 }, async () => {
    // 실측(exp12): 처음 보는 문구 8개 중 3개가 어색했다("1스틱 2기능", "클리진동 체형왕복").
    const gif = await sharp(ORIG_PNG).gif().toBuffer();
    mock = happyMock();
    mock.image = ["echo"];
    mock.transcribe = gifTranscribe();
    mock.translate = [[["강진 심부", "강렬한 진동", "깊은 곳 강진"]]];
    mock.judge = [[1]];
    const r = await translateImageAuto(gif, "image/gif");
    const ask = textPrompts.find((p) => p.includes("한국어로 번역하세요"))!;
    expect(ask).toContain("후보 3개");
    const judge = textPrompts.find((p) => p.includes("가장 알맞은 후보의 번호"))!;
    expect(judge).toContain("강진 심부");
    expect(judge).toContain("강렬한 진동");
    expect("boxes" in r && r.boxes[0]?.ko).toBe("강렬한 진동");
  });

  it("정지 이미지 번역 요청문은 후보 3개를 묻지 않는다", async () => {
    mock = happyMock();
    await translateImageAuto(ORIG_PNG, "image/png");
    const ask = textPrompts.find((p) => p.includes("한국어로 번역하세요"))!;
    expect(ask).not.toContain("후보 3개");
  });

  it("GIF 띠 예산은 실제로 만들어질 띠 폭에서 나온다 — 띠가 위아래로 넓어진 행에 걸린 움직임이 가로 폭을 막는다", { timeout: 30_000 }, async () => {
    // 실측 13 「大头爆震」: 글자 행의 정지 여백으로 센 폭 360px 로 17자를 줬는데 실제 띠는 313px —
    // 띠가 위아래로 넓어지면서(growFlat) 그 행들이 옆 움직임에 걸려 가로로 덜 넓어졌다. 글자가 양
    // 가장자리에 닿아 이음매에 두 번 걸렸다.
    const still = await sharp(ORIG_PNG).gif().toBuffer();
    // 글자(y40~80) 오른쪽 위 x370~380·y15~25 에 움직이는 덩어리 — 글자 행 여백은 못 보지만 띠는 걸린다
    const c2 = createCanvas(W, H); const x2 = c2.getContext("2d");
    x2.drawImage(await (async () => { const { loadImage } = await import("@napi-rs/canvas"); return loadImage(ORIG_PNG); })(), 0, 0);
    x2.fillStyle = "#ff0000"; x2.fillRect(370, 15, 10, 10);
    const moving = await sharp([ORIG_PNG, c2.toBuffer("image/png")], { join: { animated: true } }).gif({ delay: [100, 100] }).toBuffer();
    const budgetOf = async (gif: Buffer) => {
      mock = happyMock(); mock.image = ["echo"]; mock.transcribe = gifTranscribe(); textPrompts = [];
      await translateImageAuto(gif, "image/gif");
      const ask = textPrompts.find((p) => p.includes("한국어로 번역하세요"))!;
      return Number(ask.match(/최대 (\d+)자/)![1]);
    };
    const a = await budgetOf(still);
    const b = await budgetOf(moving);
    expect(b).toBeLessThan(a);
  });

  it("GIF: 원문에 숫자가 없는데 숫자를 나열한 답('1스틱 2용도')은 받지 않는다", { timeout: 30_000 }, async () => {
    // 실측 12·13: 「一棒两用」 줄이기가 두 번 다 "1스틱 2용도"를 냈다 — 요청문에 금지 예시로 적어도 낸다(규칙 4).
    const gif = await sharp(ORIG_PNG).gif().toBuffer();
    mock = happyMock();
    mock.image = ["echo"];
    mock.transcribe = gifTranscribe();
    mock.translate = [["1스틱 2용도 아주 긴 답변입니다"], ["1스틱 2용도 기능"], ["강렬한 진동"]];
    const r = await translateImageAuto(gif, "image/gif");
    expect("boxes" in r && r.boxes[0]?.ko).toBe("강렬한 진동");
  });

  it("GIF: 제품 무결성 심사가 '남은 중국어'만 문제 삼으면 PRODUCT_CHANGED 로 올리지 않는다 — 잔류 관문이 따로 잡는다", { timeout: 30_000 }, async () => {
    // 실측 12·13·14 세 번 다 "남은 중국어" 를 제품 변화로 hard 판정했다 — 요청문에 무시하라고 적어도 낸다(규칙 4).
    const gif = await sharp(ORIG_PNG).gif().toBuffer();
    mock = happyMock();
    mock.image = ["echo"];
    mock.transcribe = gifTranscribe();
    mock.productCheck = [[{ ok: false, issues: ["번역되지 않은 중국어가 남아있음"], hard: ["오른쪽 아래 상자에 번역되지 않은 중국어 텍스트가 남아있음"] }]];
    const r = await translateImageAuto(gif, "image/gif");
    if (r.status === "NEEDS_REVIEW") expect(r.reasons.map((x) => x.code)).not.toContain("PRODUCT_CHANGED");
    else expect(r.status).toBe("NEEDS_REVIEW");
  });

  it("GIF: 제품 무결성 심사가 진짜 제품 변화를 말하면 PRODUCT_CHANGED 는 그대로", { timeout: 30_000 }, async () => {
    const gif = await sharp(ORIG_PNG).gif().toBuffer();
    mock = happyMock();
    mock.image = ["echo"];
    mock.transcribe = gifTranscribe();
    mock.productCheck = [[{ ok: false, issues: ["제품이 2개→1개"], hard: ["제품이 2개→1개"] }]];
    const r = await translateImageAuto(gif, "image/gif");
    expect(r.status).toBe("NEEDS_REVIEW");
    if (r.status === "NEEDS_REVIEW") expect(r.reasons.map((x) => x.code)).toContain("PRODUCT_CHANGED");
  });

  it("정지 이미지의 줄이기는 그대로다 — 직전 답 되먹임·2차 줄이기는 GIF 전용", async () => {
    mock = happyMock();
    // 정지 이미지 예산 18자. 1차 20자 → 줄이기 1회 14자 → 채택, 2차 없음
    mock.translate = [["아주 강렬하고 깊숙한 진동 자극 느낌"], ["강렬하고 깊숙한 진동 자극"], ["강렬한 진동"]];
    await translateImageAuto(ORIG_PNG, "image/png");
    const asks = textPrompts.filter((p) => p.includes("한국어로 번역하세요"));
    expect(asks).toHaveLength(2);
    expect(asks[1]).not.toContain("직전 답");
  });

  it("첫 텍스트 요청이 429(월 한도): 즉시 RETRYABLE — 텍스트 HTTP 1회, 이미지 0회, 재시도 0회", async () => {
    mock = happyMock();
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      if (String(url).includes(IMAGE_MODEL)) imageHttp++;
      else textHttp++;
      return { ok: false, status: 429, json: async () => ({}) } as unknown as Response;
    }) as typeof fetch;
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("RETRYABLE");
    if (r.status === "RETRYABLE") expect(r.reasons.map((x) => x.code)).toContain("RATE_LIMITED");
    expect(textHttp).toBe(1); // 띠 폴백·이중 확인·재시도 전부 없이 즉시 중단 (live1 은 12회였다)
    expect(imageHttp).toBe(0);
  });

  it("첫 텍스트 요청이 403(인증): 즉시 RETRYABLE(AUTH_ERROR) — 텍스트 HTTP 1회", async () => {
    mock = happyMock();
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      if (String(url).includes(IMAGE_MODEL)) imageHttp++;
      else textHttp++;
      return { ok: false, status: 403, json: async () => ({}) } as unknown as Response;
    }) as typeof fetch;
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("RETRYABLE");
    if (r.status === "RETRYABLE") expect(r.reasons.map((x) => x.code)).toContain("AUTH_ERROR");
    expect(textHttp).toBe(1);
    expect(imageHttp).toBe(0);
  });

  it("모델이 확정 문구를 바꿔치기(의미 유사): NEEDS_REVIEW(TEXT_ALTERED), 이미지 HTTP 1회", async () => {
    mock = happyMock();
    mock.transcribe = [
      [{ box: BOX, text: "强震深处" }],
      [{ box: BOX, text: "강한 진동" }], // "강렬한 진동"과 의미는 비슷하지만 다른 문구
    ];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(imageHttp).toBe(1);
    if (r.status === "NEEDS_REVIEW") expect(r.reasons.map((x) => x.code)).toContain("TEXT_ALTERED");
  });

  it("문구는 그대로인데 완성본 의미 대조가 실격: NEEDS_REVIEW(MEANING_MISMATCH), 이미지 HTTP 1회", async () => {
    mock = happyMock();
    mock.renderedMeaning = [[{ ok: false, issues: ["성적 표현 강화"] }]];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(imageHttp).toBe(1);
    if (r.status === "NEEDS_REVIEW") {
      const m = r.reasons.find((x) => x.code === "MEANING_MISMATCH");
      expect(m).toBeDefined();
      expect(m?.detail).toContain("성적 표현 강화");
    }
  });
});

/* ── 수동 재렌더 경로도 이미지 HTTP 1회 (2026-08-24 리뷰에서 발견) ──
 * 어드민 문구 수정 재렌더(updateAssetTranslation → renderTranslatedImage)는
 * translateImageAuto 를 거치지 않아 예산 스코프 밖에서 돌고 있었다. 지금은 어느
 * 갈래든 1회지만 그건 REGEN_ATTEMPTS=1 이라는 상수에 기댄 것이라, 루프가 하나만
 * 늘어도 상한이 뚫린다. 예산을 구조로 못 박았는지 실제 HTTP 수로 단언한다. */
const { renderTranslatedImage } = await import("./imageTranslate");

describe("renderTranslatedImage — 수동 경로 이미지 HTTP 상한", () => {
  it("문구 수정 재렌더도 이미지 HTTP 정확히 1회", async () => {
    mock = happyMock();
    const boxes = [{ box: BOX, zh: "强震深处", ko: "강렬한 진동", bg: "#ffffff", fg: "#000000" }] as Parameters<typeof renderTranslatedImage>[2];
    const r = await renderTranslatedImage(ORIG_PNG, "image/png", boxes);
    expect(r.data.byteLength).toBeGreaterThan(0);
    expect(imageHttp).toBe(1);
  });

  it("예산 스코프가 실제로 걸려 있다 — 같은 렌더 안에서 2회째 요청은 차단된다", async () => {
    mock = happyMock();
    // 어드민 지시(dx/scale)가 있으면 mustOverlay → eraseThenDraw 경로를 타고,
    // 그 안에서도 이미지 호출은 1회를 넘지 못한다
    const boxes = [
      { box: BOX, zh: "强震深处", ko: "강렬한 진동", bg: "#ffffff", fg: "#000000", mode: "erase" as const, dx: 3 },
    ] as Parameters<typeof renderTranslatedImage>[2];
    await renderTranslatedImage(ORIG_PNG, "image/png", boxes).catch(() => undefined);
    expect(imageHttp).toBeLessThanOrEqual(1);
  });
});

/* ══ live10 실측 대응 회귀 (2026-08-24) ══ */
const { dedupeOcrBoxes, phraseId } = await import("./imageTranslate");
const { preRenderMappingIssues } = await import("./translateVerify");

describe("live10 회귀 — 중복 판독·추적 누락·매핑 사고", () => {
  it("띠마다 공백이 다른 같은 문구는 하나로 합쳐진다 (live10 #04 실측)", () => {
    const b = (box: [number, number, number, number], zh: string) =>
      ({ box, zh, ko: "", bg: "#fff", fg: "#000" }) as unknown as Parameters<typeof dedupeOcrBoxes>[0][number];
    const out = dedupeOcrBoxes([
      b([678, 108, 693, 386], "产品尺寸:单位 (cm)"),
      b([679, 107, 692, 385], "产品尺寸: 单位 (cm)"), // 공백만 다름
      b([679, 248, 693, 386], "单位 (cm)"), // 조각 판독
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].zh).toContain("产品尺寸"); // 조각이 아니라 온전한 쪽이 남는다
  });

  it("짧은 낱말이 긴 문구에 들어간 것은 합치지 않는다 — 约 ⊂ 约70分贝", () => {
    const b = (box: [number, number, number, number], zh: string) =>
      ({ box, zh, ko: "", bg: "#fff", fg: "#000" }) as unknown as Parameters<typeof dedupeOcrBoxes>[0][number];
    const out = dedupeOcrBoxes([b([300, 100, 320, 200], "约"), b([300, 300, 320, 500], "约70分贝")]);
    expect(out).toHaveLength(2);
  });

  it("패치 ID 는 순서가 아니라 원문+박스로 만들어진다 — 배열이 재정렬돼도 대응 유지", () => {
    const a = phraseId({ box: [100, 100, 200, 900], zh: "强震深处" });
    const b = phraseId({ box: [100, 100, 200, 900], zh: "强 震深处" }); // 공백만 다름
    const c = phraseId({ box: [300, 100, 400, 900], zh: "强震深处" }); // 자리 다름
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("렌더 전 셀 복제 감지: 이미지 HTTP 0회로 차단 (live10 #04 대비)", async () => {
    mock = happyMock();
    // 숫자가 다른 원문이 같은 번역으로 붙었다 = 값이 뭉개진 셀 복제 사고
    mock.ocr[0] = [ocrItem(BOX, "尺寸2CM"), ocrItem([300, 100, 400, 900], "噪音50分贝")];
    mock.ocr[1] = [ocrItem(BOX_BAND0, "尺寸2CM")];
    mock.translate = [["크기 2CM", "크기 2CM"]]; // 50 이 사라지고 앞 셀 내용이 복제됨
    mock.meaning = [[{ ok: true, issues: [] }, { ok: true, issues: [] }]];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(imageHttp).toBe(0); // 유료 호출 전에 잡는다
    if (r.status === "NEEDS_REVIEW") expect(r.reasons.map((x) => x.code)).toContain("DUPLICATE_TRANSLATION");
  });

  it("렌더 전 숫자 소실 감지: 이미지 HTTP 0회로 차단", async () => {
    mock = happyMock();
    mock.ocr[0] = [ocrItem(BOX, "小于50分贝")];
    mock.ocr[1] = [ocrItem(BOX_BAND0, "小于50分贝")];
    mock.translate = [["소음 미만"]]; // 50 이 사라졌다
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(imageHttp).toBe(0);
    if (r.status === "NEEDS_REVIEW") expect(r.reasons.map((x) => x.code)).toContain("NUMBER_CHANGED");
  });

  it("soft 지적만 있으면 렌더까지 진입한다 — 과민 차단 제거 (이미지 1회 유지)", async () => {
    mock = happyMock();
    mock.meaning = [[{ ok: true, issues: ["반복 표현 생략"], hard: [] }]];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("VERIFIED");
    expect(imageHttp).toBe(1);
  });

  it("hard 지적은 렌더 전에 막는다 — 이미지 0회", async () => {
    mock = happyMock();
    mock.translate = [["쾌락의 하모니"]];
    mock.correct = [["즐거운 화음"]];
    mock.meaning = [
      [{ ok: false, issues: ["성적 표현 강화"], hard: ["성적 표현 강화"] }],
      [{ ok: false, issues: ["여전히 과장"], hard: ["여전히 과장"] }],
    ];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    expect(r.status).toBe("NEEDS_REVIEW");
    expect(imageHttp).toBe(0);
    if (r.status === "NEEDS_REVIEW") expect(r.reasons.map((x) => x.code)).toContain("MEANING_UNCERTAIN");
  });

  it("2차 검수는 교정된 문구만 다시 본다 — 1차 통과 문구가 뒤집히지 않는다", async () => {
    mock = happyMock();
    mock.ocr[0] = [ocrItem(BOX, "强震深处"), ocrItem([300, 100, 400, 900], "柔软咬合")];
    mock.ocr[1] = [ocrItem(BOX_BAND0, "强震深处")];
    mock.translate = [["강렬한 진동", "부드러운 밀착"]];
    mock.correct = [["부드럽게 무는 밀착"]]; // 실패한 1건만 교정 대상
    mock.meaning = [
      [{ ok: true, issues: [], hard: [] }, { ok: false, issues: ["누락"], hard: ["누락"] }],
      // 2차 응답은 **1개**만 온다 — 전체를 재심사하면 개수가 어긋나 형식 오류가 났을 것
      [{ ok: true, issues: [], hard: [] }],
    ];
    mock.transcribe = [
      [{ box: BOX, text: "强震深处" }, { box: [300, 100, 400, 900], text: "柔软咬合" }],
      [{ box: BOX, text: "강렬한 진동" }, { box: [300, 100, 400, 900], text: "부드럽게 무는 밀착" }],
    ];
    mock.renderedMeaning = [[{ ok: true, issues: [], hard: [] }, { ok: true, issues: [], hard: [] }]];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    // 2차가 1건만 심사했으므로 형식 오류 없이 렌더까지 간다
    expect(r.status).not.toBe("VERIFICATION_FAILED");
    expect(imageHttp).toBe(1);
  });
});

describe("live11 회귀 — 판독 커버리지·중복·429 관측성", () => {
  it("색상 라벨을 두 번 읽어도(酒红 ⊂ 酒红色) 하나로 합쳐 동의 번역 오차단이 없다", async () => {
    const b = (box: [number, number, number, number], zh: string) =>
      ({ box, zh, ko: "", bg: "#fff", fg: "#000" }) as unknown as Parameters<typeof dedupeOcrBoxes>[0][number];
    // live11 #01 실측 좌표
    const out = dedupeOcrBoxes([b([512, 477, 577, 616], "酒红色"), b([550, 480, 577, 567], "酒红")]);
    expect(out).toHaveLength(1);
    expect(out[0].zh).toBe("酒红色"); // 온전한 쪽이 남는다
  });

  it("한 글자 낱말은 여전히 합치지 않는다 — 约 ⊄ 约70分贝", () => {
    const b = (box: [number, number, number, number], zh: string) =>
      ({ box, zh, ko: "", bg: "#fff", fg: "#000" }) as unknown as Parameters<typeof dedupeOcrBoxes>[0][number];
    expect(dedupeOcrBoxes([b([300, 100, 320, 200], "约"), b([300, 100, 320, 500], "约70分贝")])).toHaveLength(2);
  });

  it("전체 채택 경로는 완성본을 교차 판독한다 — 작은 글자 누락으로 오차단되지 않게", async () => {
    mock = happyMock();
    await translateImageAuto(ORIG_PNG, "image/png");
    const reads = textPrompts.filter((p) => p.includes("그대로 옮겨 적어주세요"));
    // 원본 1회 + 완성본 전체 1회 + 완성본 띠 3회
    expect(reads.length).toBe(5);
  });

  it("429 사유에 quota 종류·Retry-After 가 실린다 — 분당/일간/월간 판단 근거", async () => {
    mock = happyMock();
    const realFetch2 = globalThis.fetch;
    globalThis.fetch = (async () =>
      ({
        ok: false,
        status: 429,
        headers: { get: (k: string) => (k.toLowerCase() === "retry-after" ? "37" : null) },
        json: async () => ({ error: { status: "RESOURCE_EXHAUSTED", message: "Quota exceeded for quota metric 'Generate requests per minute'" } }),
      }) as unknown as Response) as typeof fetch;
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    globalThis.fetch = realFetch2;
    expect(r.status).toBe("RETRYABLE");
    if (r.status === "RETRYABLE") {
      const d = r.reasons.find((x) => x.code === "RATE_LIMITED")!.detail;
      expect(d).toContain("RESOURCE_EXHAUSTED");
      expect(d).toContain("per minute");
      expect(d).toContain("retry-after=37");
    }
  });
});

/* ══ live11 #01 — dedupe 가 먼저 잡고, 좌표 충돌 차단은 그 실패 시에만 ══
 * 두 방어는 역할이 다르다:
 *   1선 dedupeOcrBoxes — 같은 글자를 두 번 읽은 것을 **합쳐서 없앤다** (정상 처리)
 *   2선 preRenderMappingIssues — 1선이 놓친 좌표 충돌만 **차단한다** (fail-closed)
 * 동의어(떨어진 두 라벨이 같은 번역)는 어느 쪽에도 걸리지 않아야 한다. */
describe("live11 #01 — 판독 중복은 병합으로, 잔여 충돌만 차단", () => {
  const FIX = JSON.parse(
    fs.readFileSync(path.join(process.cwd(), "src/lib/__fixtures__/ocrBoxes.json"), "utf8"),
  ) as Record<string, { box: [number, number, number, number]; zh: string; ko: string }[]>;

  it("1선: live11 #01 실측 박스가 5개 → 4개로 합쳐진다 (酒红 ⊂ 酒红色)", () => {
    const raw = FIX["live11-01"].map((b) => ({ ...b, bg: "#fff", fg: "#000" })) as never[];
    expect(raw).toHaveLength(5);
    const dd = dedupeOcrBoxes(raw);
    expect(dd).toHaveLength(4);
    const zhs = dd.map((b: { zh: string }) => b.zh);
    expect(zhs).toContain("酒红色");
    expect(zhs).not.toContain("酒红"); // 조각 쪽이 사라진다
  });

  it("2선: 병합 뒤에는 중복이 전달되지 않아 차단 사유가 없다", () => {
    const dd = dedupeOcrBoxes(FIX["live11-01"].map((b) => ({ ...b, bg: "#fff", fg: "#000" })) as never[]);
    const m = preRenderMappingIssues(
      (dd as unknown as { zh: string; ko: string; box: [number, number, number, number] }[]).map((b) => ({
        zh: b.zh,
        ko: b.ko,
        box: b.box,
      })),
    );
    expect(m.duplicates).toEqual([]);
    expect(m.numberLoss).toEqual([]);
  });

  it("2선은 1선이 실패했을 때만 막는다 — 병합 안 된 겹침은 차단", () => {
    const m = preRenderMappingIssues([
      { zh: "酒红色", ko: "버건디", box: [512, 477, 577, 616] },
      { zh: "酒红", ko: "버건디", box: [550, 480, 577, 567] },
    ]);
    expect(m.duplicates).toHaveLength(1);
    expect(m.duplicates[0]).toContain("좌표 충돌");
  });

  it("파이프라인 관통: #01 실측 판독으로 렌더까지 간다 (오차단 없음)", async () => {
    const fx = FIX["live11-01"];
    mock = happyMock();
    // 원본 판독(전체)이 5개를 그대로 돌려주고, 띠에도 같은 것이 잡힌 상황
    mock.ocr = [
      fx.map((b) => ocrItem(b.box, b.zh)),
      [ocrItem(fx[0].box, fx[0].zh)],
      [],
      [],
      [], // 관문 — 잔류 없음
    ];
    mock.translate = [["2가지 컬러", "선택하는 행복한 삶", "버건디", "퍼플"]]; // 합쳐져 4개
    mock.meaning = [fx.slice(0, 4).map(() => ({ ok: true, issues: [] }))];
    mock.renderedMeaning = [fx.slice(0, 4).map(() => ({ ok: true, issues: [] }))];
    mock.transcribe = [
      fx.map((b) => ({ box: b.box, text: b.zh })),
      [
        { box: fx[0].box, text: "2가지 컬러" },
        { box: fx[1].box, text: "선택하는 행복한 삶" },
        { box: fx[2].box, text: "버건디" },
        { box: fx[3].box, text: "퍼플" },
      ],
    ];
    const r = await translateImageAuto(ORIG_PNG, "image/png");
    // DUPLICATE_TRANSLATION 으로 렌더 전에 막히지 않는다 = 이미지 호출이 나갔다
    expect(imageHttp).toBe(1);
    if (r.status === "NEEDS_REVIEW") {
      expect(r.reasons.map((x) => x.code)).not.toContain("DUPLICATE_TRANSLATION");
    }
  });
});

/**
 * GIF 오류 분류 (2026-08-31 운영 실측).
 *
 * tryBuildGifPatch 의 catch 가 모든 오류를 삼키고 null 을 돌려줘서, GIF 의
 * 429·타임아웃·안전필터 거부가 전부 일반 문구("GIF 정지 패치 실패")로 바뀌고
 * FAILED 로 분류됐다 — 운영자의 "재시도 승인" 흐름이 GIF 에는 아예 안 떴다.
 * 월 한도 초과로 전 GIF 가 죽었을 때 정지 이미지는 RETRYABLE 로 살아났는데
 * GIF 만 FAILED 로 굳은 실사례가 이것이다.
 */
describe("GIF 오류 분류 — 일시 오류는 RETRYABLE 로 살아남는다", () => {
  const gifOf = async (): Promise<Buffer> =>
    sharp(ORIG_PNG).gif().toBuffer();

  it("GIF 이미지 호출이 429 면 FAILED 가 아니라 RETRYABLE", async () => {
    mock = happyMock();
    mock.image = [{ status: 429 }];
    const r = await translateImageAuto(await gifOf(), "image/gif");
    expect(r.status).toBe("RETRYABLE");
    if (r.status === "RETRYABLE") {
      expect(r.reasons.map((x) => x.code)).toContain("RATE_LIMITED");
    }
  });

  it("GIF 안전필터 거부는 NEEDS_REVIEW(SAFETY_BLOCKED) — 재시도 대상이 아니다", async () => {
    mock = happyMock();
    mock.image = [
      { candidates: [{ content: { parts: [] }, finishReason: "PROHIBITED_CONTENT" }] } as unknown as Json,
    ];
    const r = await translateImageAuto(await gifOf(), "image/gif");
    expect(r.status).toBe("NEEDS_REVIEW");
    if (r.status === "NEEDS_REVIEW") {
      expect(r.reasons.map((x) => x.code)).toContain("SAFETY_BLOCKED");
    }
  });
});
