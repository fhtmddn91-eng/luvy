import "server-only";
import path from "node:path";
import sharp from "sharp";
import { createCanvas, loadImage, GlobalFonts, type SKRSContext2D } from "@napi-rs/canvas";

/**
 * 상품 이미지 속 중국어 → 한국어 번역.
 *
 * 방식: 이미지를 다시 그리는 생성형이 아니라 "글자 영역만 덮어쓰기" —
 *   1) Gemini 가 중국어 위치(좌표)·번역·배경/글자색을 읽어주고
 *   2) 서버가 그 좌표만 지운 뒤 프리텐다드로 한국어를 얹는다.
 * 제품 사진 픽셀은 건드리지 않으므로 실물과 달라질 위험이 없다.
 * GIF 는 글자가 프레임마다 같으므로 OCR 1회 결과를 전 프레임에 적용한다.
 *
 * 실측 근거 (실상품 이미지로 프로토타입 검증):
 * - 단색 배경은 배경색 사각형, 사진/그라데이션 배경은 주변 픽셀 보간으로
 *   지워야 자국이 안 남는다. 반대로 쓰면 각각 패치 자국·색 뭉개짐이 생겼다.
 * - 한국어가 중국어보다 길어 넘치기 쉬움 → 프롬프트에서 길이 제한 + 크기 자동 축소.
 * - AppleGothic 등에 없는 기호(⩽)가 네모로 깨짐 → 가까운 기호로 치환.
 */

const MODEL = "gemini-3.6-flash";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const TIMEOUT_MS = 90_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = [1_000, 4_000];
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 박스를 글자 크기의 6% 만큼 바깥으로 — 모델 좌표가 딱 붙어 원문 잔상이 남는다 */
const BOX_PAD = 0.06;

export interface OcrBox {
  /** [ymin, xmin, ymax, xmax] — 0~1000 정규화 좌표 */
  box: [number, number, number, number];
  zh: string;
  ko: string;
  /** 배경색/글자색 hex */
  bg: string;
  fg: string;
  bold?: boolean;
  /** 단색 배경(카드·버튼·띠)이면 true, 사진·그라데이션 위면 false */
  solid_bg?: boolean;
}

/* ── 폰트 ──────────────────────────────────────────────── */

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");
const FONT_FAMILIES = {
  ExtraBold: "Pretendard ExtraBold",
  Bold: "Pretendard Bold",
  SemiBold: "Pretendard SemiBold",
  Regular: "Pretendard Regular",
} as const;
export type FontWeight = keyof typeof FONT_FAMILIES;

let fontsReady = false;
function ensureFonts(): void {
  if (fontsReady) return;
  for (const w of Object.keys(FONT_FAMILIES) as FontWeight[]) {
    GlobalFonts.registerFromPath(path.join(FONT_DIR, `Pretendard-${w}.otf`), FONT_FAMILIES[w]);
  }
  fontsReady = true;
}

/** 원문 굵기 + 글자 높이(px)로 프리텐다드 굵기를 고른다 — 제목/소제목/본문 위계 재현 */
export function pickWeight(bold: boolean | undefined, boxHeightPx: number): FontWeight {
  if (bold) return boxHeightPx >= 45 ? "ExtraBold" : "Bold";
  return boxHeightPx >= 45 ? "SemiBold" : "Regular";
}

/** 폰트에 없는 특수기호를 가까운 기호로 (⩽ 가 네모로 깨진 실사례) */
export function sanitizeSymbols(s: string): string {
  return s.replace(/⩽/g, "≤").replace(/⩾/g, "≥").replace(/、/g, ", ");
}

/* ── OCR 응답 검증 ─────────────────────────────────────── */

const HEX = /^#[0-9a-f]{3,8}$/i;

/** 모델 응답을 신뢰하지 않는다 — 좌표·색상이 형식에 안 맞는 항목은 버린다 */
export function parseOcrBoxes(raw: unknown): OcrBox[] {
  if (!Array.isArray(raw)) return [];
  const out: OcrBox[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const box = r.box;
    if (!Array.isArray(box) || box.length !== 4) continue;
    const nums = box.map(Number);
    if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 1000)) continue;
    const [ymin, xmin, ymax, xmax] = nums;
    if (ymax <= ymin || xmax <= xmin) continue;
    const zh = String(r.zh ?? "").trim();
    const ko = String(r.ko ?? "").trim();
    if (!zh || !ko || ko.length > 200) continue;
    const bg = String(r.bg ?? "");
    const fg = String(r.fg ?? "");
    out.push({
      box: [ymin, xmin, ymax, xmax],
      zh: zh.slice(0, 200),
      ko,
      bg: HEX.test(bg) ? bg : "#ffffff",
      fg: HEX.test(fg) ? fg : "#000000",
      bold: Boolean(r.bold),
      solid_bg: r.solid_bg !== false, // 불명확하면 단색 취급(사각형 덮기가 더 안전)
    });
    if (out.length >= 60) break;
  }
  return out;
}

/* ── Gemini OCR ────────────────────────────────────────── */

const OCR_PROMPT = `이 이미지의 중국어 텍스트를 모두 찾아 한국어로 번역하세요.

제외 대상 (건드리지 말 것):
- 로고·브랜드명 (라틴 문자 브랜드 포함)
- 이미 영어·한국어인 문장
- 숫자·단위만 있는 것 (216g, 56dB, 3.7V 등)

번역 규칙:
- **원문과 비슷한 길이로 짧게.** 원문 글자수의 1.5배를 넘기지 마세요.
- 한국 성인용품 도매몰 상세페이지에서 쓰는 자연스러운 표현으로.
- 과장·의학적 효능 표현 금지.

각 중국어 텍스트마다 JSON 배열 원소로:
- box: [ymin, xmin, ymax, xmax] — 글자가 실제 차지한 영역, 0~1000 정규화
- zh: 원문
- ko: 한국어 번역 (짧게)
- bg: 텍스트 뒤 배경색 hex
- fg: 글자색 hex
- bold: 원문이 굵은 글씨면 true
- solid_bg: 배경이 단색(흰 카드·버튼·띠 등)이면 true, 사진/그라데이션 위면 false

중국어가 없으면 빈 배열. JSON 배열만 출력.`;

/**
 * 이미지에서 중국어 텍스트를 찾아 번역한다.
 * GIF 는 Gemini 가 받지 않으므로 첫 프레임을 PNG 로 뽑아 보낸다
 * (이 상세 GIF 들은 글자가 고정이고 제품만 움직이는 구조 — 실물로 확인).
 */
export async function ocrImage(data: Buffer, mime: string): Promise<OcrBox[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 미설정");

  let sendData = data;
  let sendMime = mime;
  if (mime === "image/gif") {
    sendData = await sharp(data, { page: 0, pages: 1 }).png().toBuffer();
    sendMime = "image/png";
  }

  let lastNote = "OCR 응답 없음";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) await sleep(RETRY_DELAY_MS[attempt - 2] ?? 4_000);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        signal: ctrl.signal,
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [
            {
              role: "user",
              parts: [
                { inline_data: { mime_type: sendMime, data: sendData.toString("base64") } },
                { text: OCR_PROMPT },
              ],
            },
          ],
          generationConfig: {
            maxOutputTokens: 8000,
            responseMimeType: "application/json",
            thinkingConfig: { thinkingLevel: "minimal" },
          },
        }),
      });
      if (!res.ok) {
        lastNote = `OCR API 오류 ${res.status}`;
        if (RETRYABLE_STATUS.has(res.status)) continue;
        throw new Error(lastNote);
      }
      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
      };
      const text = (json.candidates?.[0]?.content?.parts ?? [])
        .map((p) => p.text ?? "")
        .join("")
        .trim();
      const m = text.match(/\[[\s\S]*\]/);
      return parseOcrBoxes(m ? JSON.parse(m[0]) : []);
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("OCR API 오류")) throw e;
      lastNote = ctrl.signal.aborted ? "OCR 시간 초과" : e instanceof Error ? e.message : String(e);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${lastNote} (${MAX_ATTEMPTS}회 시도)`);
}

/* ── 렌더링 ────────────────────────────────────────────── */

interface PxBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function toPixelBox(
  box: [number, number, number, number],
  width: number,
  height: number,
): PxBox {
  const [ymin, xmin, ymax, xmax] = box;
  let x0 = (xmin / 1000) * width;
  let y0 = (ymin / 1000) * height;
  let x1 = (xmax / 1000) * width;
  let y1 = (ymax / 1000) * height;
  const px = (x1 - x0) * BOX_PAD;
  const py = (y1 - y0) * BOX_PAD;
  x0 = Math.max(0, x0 - px);
  y0 = Math.max(0, y0 - py);
  x1 = Math.min(width, x1 + px);
  y1 = Math.min(height, y1 + py);
  return { x0, y0, x1, y1 };
}

/** 사진·그라데이션 배경: 박스 좌우 바깥 픽셀을 줄마다 읽어 가로 보간으로 지운다 */
function eraseGradient(ctx: SKRSContext2D, width: number, height: number, b: PxBox): void {
  const x0 = Math.round(b.x0);
  const y0 = Math.round(b.y0);
  const x1 = Math.round(b.x1);
  const y1 = Math.round(b.y1);
  const xl = Math.max(0, x0 - 3);
  const xr = Math.min(width - 1, x1 + 3);
  const img = ctx.getImageData(0, Math.max(0, y0), width, Math.min(height, y1) - Math.max(0, y0));
  const d = img.data;
  const span = Math.max(1, x1 - x0);
  for (let row = 0; row < img.height; row++) {
    const li = (row * width + xl) * 4;
    const ri = (row * width + xr) * 4;
    for (let x = x0; x < Math.min(width, x1); x++) {
      const t = (x - x0) / span;
      const idx = (row * width + x) * 4;
      d[idx] = Math.round(d[li] * (1 - t) + d[ri] * t);
      d[idx + 1] = Math.round(d[li + 1] * (1 - t) + d[ri + 1] * t);
      d[idx + 2] = Math.round(d[li + 2] * (1 - t) + d[ri + 2] * t);
      d[idx + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, Math.max(0, y0));
}

/** 한 프레임에 번역 박스들을 그린다 (원문 지우기 + 한국어 얹기) */
function paintBoxes(
  ctx: SKRSContext2D,
  width: number,
  height: number,
  boxes: OcrBox[],
): void {
  for (const it of boxes) {
    const ko = sanitizeSymbols(it.ko).trim();
    if (!ko) continue; // 어드민이 비운 문구 = 이 항목은 번역하지 않음

    const b = toPixelBox(it.box, width, height);
    const bw = b.x1 - b.x0;
    const bh = b.y1 - b.y0;
    if (bw < 4 || bh < 4) continue;

    if (it.solid_bg !== false) {
      ctx.fillStyle = it.bg;
      ctx.fillRect(b.x0, b.y0, bw, bh);
    } else {
      eraseGradient(ctx, width, height, b);
    }

    const family = FONT_FAMILIES[pickWeight(it.bold, bh)];
    let size = Math.floor(bh);
    let metrics!: TextMetrics;
    while (size > 6) {
      ctx.font = `${size}px "${family}"`;
      metrics = ctx.measureText(ko);
      const textH = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
      if (metrics.width <= bw * 0.94 && textH <= bh * 0.82) break;
      size -= 1;
    }
    ctx.font = `${size}px "${family}"`;
    metrics = ctx.measureText(ko);
    const textH = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    ctx.fillStyle = it.fg;
    ctx.fillText(
      ko,
      b.x0 + (bw - metrics.width) / 2,
      b.y0 + (bh - textH) / 2 + metrics.actualBoundingBoxAscent,
    );
  }
}

async function renderStill(data: Buffer, mime: string, boxes: OcrBox[]): Promise<{ data: Buffer; mime: string }> {
  const img = await loadImage(data);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  paintBoxes(ctx, img.width, img.height, boxes);
  // PNG 는 투명도 보존을 위해 PNG 유지, 나머지는 JPEG
  if (mime === "image/png") return { data: canvas.toBuffer("image/png"), mime };
  return { data: canvas.toBuffer("image/jpeg", 90), mime: "image/jpeg" };
}

async function renderGif(data: Buffer, boxes: OcrBox[]): Promise<{ data: Buffer; mime: string }> {
  const meta = await sharp(data, { animated: true }).metadata();
  const pages = meta.pages ?? 1;
  const width = meta.width ?? 0;
  const height = meta.pageHeight ?? meta.height ?? 0;
  if (!width || !height) throw new Error("GIF 크기를 읽을 수 없습니다.");

  const frames: Buffer[] = [];
  for (let i = 0; i < pages; i++) {
    const png = await sharp(data, { page: i, pages: 1 }).png().toBuffer();
    const img = await loadImage(png);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    paintBoxes(ctx, width, height, boxes);
    frames.push(canvas.toBuffer("image/png"));
  }

  const out = await sharp(frames, { join: { animated: true } })
    .gif({ delay: meta.delay, loop: meta.loop ?? 0 })
    .toBuffer();
  return { data: out, mime: "image/gif" };
}

/** 번역 박스를 이미지에 합성한다. 문구 수정 후 재렌더에도 그대로 쓴다. */
export async function renderTranslatedImage(
  data: Buffer,
  mime: string,
  boxes: OcrBox[],
): Promise<{ data: Buffer; mime: string }> {
  ensureFonts();
  if (mime === "image/gif") return renderGif(data, boxes);
  return renderStill(data, mime, boxes);
}
