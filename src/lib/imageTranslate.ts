import "server-only";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { createCanvas, loadImage, GlobalFonts, type SKRSContext2D, type Canvas } from "@napi-rs/canvas";

/**
 * 상품 이미지 속 중국어 → 한국어 번역.
 *
 * 공통 1·2단계 (모든 형식):
 *   1) 추출 — Gemini 가 중국어 위치(좌표)·배경/글자색을 읽는다 (번역 없이)
 *   2) 번역 — 추출된 문구 목록만 텍스트 모델로 번역 (순서 1:1, 뒤섞임 차단)
 *
 * 3단계 렌더는 형식별로 다르다:
 *   - JPG/PNG: 이미지 생성 모델이 "글자만 한국어로 바뀐 이미지"를 다시 그린다.
 *     원본 서체의 디자인 느낌까지 재현되어 오버레이보다 훨씬 자연스럽다.
 *     실패 시 오버레이(글자 영역 덮어쓰기 + 프리텐다드) 폴백.
 *   - GIF: 오버레이 방식 — 재생성은 프레임마다 그림이 미묘하게 달라져
 *     애니메이션이 떨린다. 글자가 프레임 고정이므로 1회 결과를 전 프레임 적용.
 *
 * 실측 근거 (실상품 이미지로 검증):
 * - 단색 배경은 배경색 사각형, 사진/그라데이션 배경은 주변 픽셀 보간으로
 *   지워야 자국이 안 남는다. 반대로 쓰면 각각 패치 자국·색 뭉개짐이 생겼다.
 * - 한국어가 중국어보다 길어 넘치기 쉬움 → 프롬프트에서 길이 제한 + 크기 자동 축소.
 * - AppleGothic 등에 없는 기호(⩽)가 네모로 깨짐 → 가까운 기호로 치환.
 * - 번역문에 한자가 남으면(伸縮) 폰트에 없어 네모로 깨짐 → 검출 후 재번역.
 */

const MODEL = "gemini-3.6-flash";
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

/* ── Gemini 호출 공통 ──────────────────────────────────── */

interface GeminiPart {
  text?: string;
  inline_data?: { mime_type: string; data: string };
  inlineData?: { mimeType?: string; data?: string };
}

/** 텍스트/이미지 모델 공용 호출 — 일시 오류(429·5xx·타임아웃) 재시도 포함 */
async function callGemini(
  model: string,
  parts: GeminiPart[],
  generationConfig: Record<string, unknown>,
): Promise<GeminiPart[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 미설정");

  let lastNote = "응답 없음";
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) await sleep(RETRY_DELAY_MS[attempt - 2] ?? 4_000);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          signal: ctrl.signal,
          headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
          body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig }),
        },
      );
      if (!res.ok) {
        lastNote = `API 오류 ${res.status}`;
        if (RETRYABLE_STATUS.has(res.status)) continue;
        throw new Error(lastNote);
      }
      const json = (await res.json()) as {
        candidates?: { content?: { parts?: GeminiPart[] } }[];
      };
      return json.candidates?.[0]?.content?.parts ?? [];
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("API 오류")) throw e;
      lastNote = ctrl.signal.aborted ? "시간 초과" : e instanceof Error ? e.message : String(e);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${lastNote} (${MAX_ATTEMPTS}회 시도)`);
}

function textOf(parts: GeminiPart[]): string {
  return parts.map((p) => p.text ?? "").join("").trim();
}

function jsonArrayOf(parts: GeminiPart[]): unknown {
  const m = textOf(parts).match(/\[[\s\S]*\]/);
  return m ? JSON.parse(m[0]) : [];
}

/* ── 1단계: 글자 추출 (번역 없이) ───────────────────────── */

/**
 * 읽기와 번역을 분리하는 이유: 한 번에 시키면 모델이 가끔 원문과 무관한
 * 문구(같은 상품의 다른 이미지에서 나올 법한 카피)를 번역이라고 뱉는다
 * (실운영에서 발생 — GIF 하나가 대표이미지 문구 목록을 그대로 받아갔다).
 * 원문만 추출한 뒤 그 목록을 텍스트 모델로 번역하면 순서가 1:1 로 묶여
 * 이런 뒤섞임이 구조적으로 불가능해진다.
 */
const EXTRACT_PROMPT = `이 이미지 안의 외국어 텍스트(중국어·일본어)를 모두 찾아주세요. 번역은 하지 마세요.

반드시 포함:
- 작은 글씨·장식 문구·세로쓰기 문구도 빠짐없이 (1688 이미지에는 일본어 장식 문구도 흔합니다)
- 여러 줄로 쓰인 문구는 한 덩어리로 묶지 말고 줄 단위로 각각 항목을 만드세요

제외 대상:
- 로고·브랜드명 (라틴 문자 브랜드 포함)
- 영어·한국어 문장
- 숫자·단위만 있는 것 (216g, 56dB, 3.7V 등)

각 텍스트마다 JSON 배열 원소로:
- box: [ymin, xmin, ymax, xmax] — 글자가 실제 차지한 영역, 0~1000 정규화
- zh: 원문 그대로
- bg: 텍스트 뒤 배경색 hex
- fg: 글자색 hex
- bold: 굵은 글씨면 true
- solid_bg: 배경이 단색(흰 카드·버튼·띠 등)이면 true, 사진/그라데이션 위면 false

외국어 텍스트가 없으면 빈 배열. JSON 배열만 출력.`;

/* ── 2단계: 문구 목록 번역 ─────────────────────────────── */

/** 번역문에 한자가 남았는지 — 프리텐다드에 없는 한자는 네모로 깨진다(실사례: 伸縮) */
export function hasHanzi(s: string): boolean {
  return /[㐀-䶿一-鿿]/.test(s);
}

/** 원문이 실제 번역 대상(중국어·일본어)인지 — 영어 브랜드 워터마크가
 * 추출에 섞여 들어와 한글로 덮이는 사고 방지 (실측: LAYLA VIBRATOR) */
export function isForeignSource(s: string): boolean {
  return hasHanzi(s) || /[぀-ゟ゠-ヿ]/.test(s);
}

/**
 * 글자 영역의 최소 대비(명암 표준편차).
 *
 * 모델이 글자가 없는 매끈한 제품 사진에서 글자를 봤다고 하는 오탐이 있었다
 * (실사례: 민무늬 핑크 손잡이에 关/开/震 → 제품 몸통에 엉뚱한 글자가 그려짐).
 * 실측 분포: 진짜 글자 37~92, 오탐 13~15 → 22 로 자른다.
 */
const MIN_TEXT_STDDEV = 22;

/** 원본에서 각 박스의 대비를 재 오탐(글자 없는 영역)을 걸러낸다 */
async function filterByContrast(
  data: Buffer,
  mime: string,
  boxes: OcrBox[],
): Promise<OcrBox[]> {
  const src = mime === "image/gif" ? await sharp(data, { page: 0, pages: 1 }).png().toBuffer() : data;
  const meta = await sharp(src).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) return boxes;

  const kept: OcrBox[] = [];
  for (const b of boxes) {
    const [ymin, xmin, ymax, xmax] = b.box;
    const left = Math.max(0, Math.floor((xmin / 1000) * W));
    const top = Math.max(0, Math.floor((ymin / 1000) * H));
    const width = Math.min(W - left, Math.max(1, Math.ceil(((xmax - xmin) / 1000) * W)));
    const height = Math.min(H - top, Math.max(1, Math.ceil(((ymax - ymin) / 1000) * H)));
    if (width < 3 || height < 3) continue;
    try {
      const stats = await sharp(src)
        .extract({ left, top, width, height })
        .greyscale()
        .stats();
      if ((stats.channels[0]?.stdev ?? 0) >= MIN_TEXT_STDDEV) kept.push(b);
    } catch {
      kept.push(b); // 측정 실패 시엔 살려둔다 (어드민이 문구 수정으로 지울 수 있다)
    }
  }
  return kept;
}

function translatePrompt(items: string[], strict: boolean): string {
  return `중국 상품 상세페이지 이미지에서 추출한 문구 목록입니다. 각각 한국어로 번역하세요.

규칙:
- 한국 성인용품 도매몰 상세페이지에서 쓰는 자연스러운 표현으로
- 원문 글자수의 1.5배를 넘지 않게 짧게
- 한자·중국어 문자를 답에 절대 남기지 마세요. 모든 단어를 한글로 씁니다 (예: 伸缩→신축)${
    strict ? "\n- 이전 답에 한자가 남아 있었습니다. 이번에는 반드시 순수 한글+숫자+영문만 사용하세요." : ""
  }
- 과장·의학적 효능 표현 금지
- 입력과 같은 개수, 같은 순서의 JSON 문자열 배열만 출력

입력 (${items.length}개):
${JSON.stringify(items)}`;
}

async function translateTexts(items: string[], strict = false): Promise<string[]> {
  const parts = await callGemini(MODEL, [{ text: translatePrompt(items, strict) }], {
    maxOutputTokens: 4000,
    responseMimeType: "application/json",
    thinkingConfig: { thinkingLevel: "minimal" },
  });
  const raw = jsonArrayOf(parts);
  if (!Array.isArray(raw) || raw.length !== items.length) {
    throw new Error(`번역 결과 개수 불일치 (${items.length} → ${Array.isArray(raw) ? raw.length : "?"})`);
  }
  return raw.map((s) => String(s ?? "").trim().slice(0, 200));
}

/**
 * 이미지에서 중국어 텍스트를 찾아 번역한다 (추출 → 번역 2단계).
 * GIF 는 Gemini 가 받지 않으므로 첫 프레임을 PNG 로 뽑아 보낸다
 * (이 상세 GIF 들은 글자가 고정이고 제품만 움직이는 구조 — 실물로 확인).
 */
export async function ocrImage(data: Buffer, mime: string): Promise<OcrBox[]> {
  let sendData = data;
  let sendMime = mime;
  if (mime === "image/gif") {
    sendData = await sharp(data, { page: 0, pages: 1 }).png().toBuffer();
    sendMime = "image/png";
  }

  const parts = await callGemini(
    MODEL,
    [
      { inline_data: { mime_type: sendMime, data: sendData.toString("base64") } },
      { text: EXTRACT_PROMPT },
    ],
    {
      maxOutputTokens: 8000,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: "minimal" },
    },
  );
  // ko 는 아직 없다 — zh 를 임시로 채워 좌표·색 검증만 통과시킨다
  const rawItems = jsonArrayOf(parts);
  const extracted = parseOcrBoxes(
    Array.isArray(rawItems)
      ? rawItems.map((r) => ({ ...(r as Record<string, unknown>), ko: (r as Record<string, unknown>).zh }))
      : [],
  ).filter((b) => isForeignSource(b.zh));
  if (extracted.length === 0) return [];

  // 글자가 없는 영역을 글자로 착각한 오탐을 대비로 걸러낸다
  const solid = await filterByContrast(data, mime, extracted);
  if (solid.length === 0) return [];

  const koList = await translateTexts(solid.map((b) => b.zh));

  // 한자가 남은 항목만 한 번 더 강하게 재번역 (남으면 폰트에서 네모로 깨진다)
  const bad = koList.map((ko, i) => (hasHanzi(ko) ? i : -1)).filter((i) => i >= 0);
  if (bad.length > 0) {
    try {
      const repaired = await translateTexts(bad.map((i) => solid[i].zh), true);
      bad.forEach((orig, j) => {
        if (!hasHanzi(repaired[j]) && repaired[j]) koList[orig] = repaired[j];
      });
    } catch {
      // 보정 실패 시 원래 번역 유지 — 어드민이 문구 수정으로 고칠 수 있다
    }
  }

  return solid
    .map((b, i) => ({ ...b, ko: koList[i] }))
    .filter((b) => b.ko && b.ko !== b.zh);
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

/**
 * 연속 중복 프레임 병합 계획 — sharp 는 재조립 때 똑같은 연속 프레임을
 * 지연시간 합산 없이 떨어뜨려 그 구간 재생이 빨라진다(실측: 15→12프레임).
 * 우리가 먼저 병합하며 지연시간을 합쳐 원본 재생 속도를 유지한다.
 * delay 0 은 브라우저가 100ms 로 취급하므로 합산도 100 기준.
 */
export function mergeDuplicateFrames(
  hashes: string[],
  delays: number[],
): { keep: number[]; delays: number[] } {
  const keep: number[] = [];
  const outDelays: number[] = [];
  for (let i = 0; i < hashes.length; i++) {
    const eff = delays[i] || 100;
    if (keep.length > 0 && hashes[i] === hashes[keep[keep.length - 1]]) {
      outDelays[outDelays.length - 1] += eff;
    } else {
      keep.push(i);
      outDelays.push(eff);
    }
  }
  return { keep, delays: outDelays };
}

async function renderGif(data: Buffer, boxes: OcrBox[]): Promise<{ data: Buffer; mime: string }> {
  const meta = await sharp(data, { animated: true }).metadata();
  const pages = meta.pages ?? 1;
  const width = meta.width ?? 0;
  const height = meta.pageHeight ?? meta.height ?? 0;
  if (!width || !height) throw new Error("GIF 크기를 읽을 수 없습니다.");

  const frames: Buffer[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < pages; i++) {
    const png = await sharp(data, { page: i, pages: 1 }).png().toBuffer();
    const img = await loadImage(png);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    paintBoxes(ctx, width, height, boxes);
    const buf = canvas.toBuffer("image/png");
    frames.push(buf);
    hashes.push(crypto.createHash("md5").update(buf).digest("hex"));
  }

  const srcDelays = Array.isArray(meta.delay) ? meta.delay : new Array(pages).fill(100);
  const merged = mergeDuplicateFrames(hashes, srcDelays);
  const keptFrames = merged.keep.map((i) => frames[i]);

  const out = await sharp(keptFrames, { join: { animated: true } })
    .gif({ delay: merged.delays, loop: meta.loop ?? 0 })
    .toBuffer();
  return { data: out, mime: "image/gif" };
}

/* ── 정지 이미지: 이미지 모델 재생성 ─────────────────────── */

/**
 * JPG/PNG 는 오버레이 대신 이미지 생성 모델로 "글자만 한국어인 이미지"를
 * 다시 그린다 — 원본 서체의 디자인 느낌까지 재현되어 훨씬 자연스럽다
 * (실상품 이미지로 품질 검증 완료. 제품 사진도 육안 동일 수준).
 * 번역 문구는 우리가 확정해서 넘긴다 — 모델 임의 번역은 어색했고(실측),
 * 문구를 고정해야 어드민의 "문구 수정 → 재생성" 흐름이 성립한다.
 * GIF 는 프레임마다 그림이 미묘하게 달라져 애니메이션이 떨리므로 제외.
 */
const IMAGE_MODEL = "gemini-3.1-flash-image";

function regenPrompt(boxes: OcrBox[]): string {
  const tlist = boxes
    .filter((b) => b.ko.trim())
    .map((b) => `- "${b.zh}" → "${sanitizeSymbols(b.ko)}"`)
    .join("\n");
  return `이 이미지를 다시 생성하되, 이미지 안의 외국어 텍스트를 아래에 지정한 한국어로 정확히 바꿔주세요.

교체할 문구 (반드시 이 번역을 그대로, 하나도 빠짐없이 사용):
${tlist}

규칙:
- 제품 사진, 모델 사진, 배경, 색상, 레이아웃, 장식, 로고는 원본 픽셀과 완전히 동일하게 유지
- 각 문구는 원문이 있던 바로 그 자리에, 같은 크기·굵기·색·정렬로
- 세로쓰기 문구는 세로쓰기 그대로 유지
- 라틴 문자 브랜드명과 영어 문장은 그대로 유지
- 위 목록에 없는 글자·워터마크·도장은 다시 그리지 말고 원본 그대로 둘 것 (왜곡 금지)
- 지정한 번역 외의 다른 문구를 만들어내지 말 것
- 이미지의 가로세로 비율과 구도를 원본 그대로 유지`;
}

/**
 * 재생성본에서 "글자 영역만" 오려 원본에 합성한다.
 *
 * 재생성은 그림 전체를 다시 그리므로 글자 밖 배경에도 미세한 재생성
 * 잡음이 남는다(실사용 지적: "글자 뒤가 지글지글"). 글자 박스(여유 포함)
 * 안쪽만 재생성본을 쓰고 나머지는 원본 픽셀을 그대로 두면, 원본 보존과
 * 자연스러운 글자를 동시에 얻는다. 경계는 페더링으로 티가 안 나게 섞는다.
 */
export function compositeParams(bw: number, bh: number): { padX: number; padY: number; feather: number } {
  // 한국어가 원문보다 길어질 수 있어 가로 여유를 넉넉히,
  // 재생성 글자가 원문 박스보다 위아래로 밀릴 수 있어 세로 여유는 더 넉넉히
  // (여유가 모자라면 글자 끝이 페더링에 잘려 희미해진다 — 실측)
  const padX = Math.max(18, bw * 0.25);
  const padY = Math.max(16, bh * 0.5);
  return { padX, padY, feather: Math.min(12, Math.max(6, Math.min(padX, padY) * 0.5)) };
}

/**
 * 재생성 모델은 작은 가로 글씨를 자주 뭉갠다(실사례: 일본어 장식 문구가
 * 가짜 글자로 깨짐). 작은 가로 글씨는 재생성 패치 대신 오버레이로 확정
 * 렌더한다. 세로쓰기는 반대로 재생성이 잘 그리고 오버레이는 못 그리므로
 * 항상 재생성 패치를 쓴다.
 */
const SMALL_BOX_PX = 24;

export function isVerticalBox(box: [number, number, number, number], W: number, H: number): boolean {
  const [ymin, xmin, ymax, xmax] = box;
  const bw = ((xmax - xmin) / 1000) * W;
  const bh = ((ymax - ymin) / 1000) * H;
  return bh > bw * 2.5;
}

export function isSmallOverlayBox(box: [number, number, number, number], W: number, H: number): boolean {
  const [ymin, , ymax] = box;
  const bh = ((ymax - ymin) / 1000) * H;
  return bh < SMALL_BOX_PX && !isVerticalBox(box, W, H);
}

/**
 * 여백을 옆 내용에 닿기 전까지로 줄인다.
 *
 * 번역 대상이 아닌 것(숫자·단위)이 바로 옆에 붙어 있으면 여백이 그것을
 * 덮어버린다 — 실사례: "不低于53MIN"에서 "不低于"를 "최소"로 바꾸며 옆의
 * "5"를 지워 "최소 3MIN"(53분→3분)이 됐다. 스펙 오류는 치명적이라
 * 바깥으로 한 칸씩 나가며 글자다운 대비가 나오면 거기서 멈춘다.
 */
export function safePad(
  colHasContent: (offset: number) => boolean,
  maxPad: number,
): number {
  for (let d = 1; d <= maxPad; d++) {
    if (colHasContent(d)) return Math.max(0, d - 2);
  }
  return maxPad;
}

/** 세로 구간에서 한 열의 명암 표준편차 — 글자가 있으면 높다 */
function columnStdev(
  px: Uint8ClampedArray,
  W: number,
  x: number,
  y0: number,
  y1: number,
): number {
  if (x < 0 || x >= W || y1 <= y0) return 0;
  let sum = 0;
  let sq = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    const i = (y * W + x) * 4;
    const v = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    sum += v;
    sq += v * v;
    n++;
  }
  if (n === 0) return 0;
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sq / n - mean * mean));
}

/**
 * 문구 바로 옆에 다른 내용(번역 대상이 아닌 숫자·단위 등)이 붙어 있는가.
 *
 * 이런 문구에 재생성 패치를 쓰면 안 된다 — 재생성은 줄 전체를 다시 그리므로
 * 패치 경계에서 글자가 어긋난다. 실사례 "不低于53MIN": 여백이 넓으면 "5"를
 * 덮어 53분→3분이 되고, 여백을 줄이면 재생성이 그린 "최소53"과 원본 "53MIN"이
 * 겹쳐 "최소5353MIN"이 된다. 둘 다 스펙 오류라, 이런 박스는 오버레이로
 * 정확히 박스 안에서만 처리한다.
 */
export function isCrowdedBox(
  nearestContentPx: number,
  boxHeightPx: number,
): boolean {
  return nearestContentPx < Math.max(10, boxHeightPx * 0.45);
}

/** 박스 좌우에서 가장 가까운 내용까지의 거리(px) */
function nearestContentDistance(
  origPixels: Uint8ClampedArray,
  b: PxBox,
  W: number,
  H: number,
  limit: number,
): number {
  const ty0 = Math.max(0, Math.round(b.y0));
  const ty1 = Math.min(H, Math.round(b.y1));
  const th = MIN_TEXT_STDDEV * 0.8;
  let best = limit;
  for (let d = 1; d <= limit; d++) {
    if (
      columnStdev(origPixels, W, Math.round(b.x1) + d, ty0, ty1) > th ||
      columnStdev(origPixels, W, Math.round(b.x0) - d, ty0, ty1) > th
    ) {
      best = d;
      break;
    }
  }
  return best;
}

/** 박스 하나를 재생성본→원본 위에 페더링 패치 */
function patchOne(
  od: Uint8ClampedArray,
  rd: Uint8ClampedArray,
  it: OcrBox,
  W: number,
  H: number,
): void {
  const b = toPixelBox(it.box, W, H);
  const { padX, padY, feather } = compositeParams(b.x1 - b.x0, b.y1 - b.y0);
  const x0 = Math.max(0, Math.round(b.x0 - padX));
  const y0 = Math.max(0, Math.round(b.y0 - padY));
  const x1 = Math.min(W, Math.round(b.x1 + padX));
  const y1 = Math.min(H, Math.round(b.y1 + padY));

  for (let y = y0; y < y1; y++) {
    // 가장자리로 갈수록 원본 비중을 높인다 (경계 티 제거)
    const ay = Math.min(1, Math.min(y - y0, y1 - 1 - y) / feather);
    for (let x = x0; x < x1; x++) {
      const ax = Math.min(1, Math.min(x - x0, x1 - 1 - x) / feather);
      const a = Math.max(0, Math.min(ay, ax));
      if (a <= 0) continue;
      const i = (y * W + x) * 4;
      od[i] = Math.round(rd[i] * a + od[i] * (1 - a));
      od[i + 1] = Math.round(rd[i + 1] * a + od[i + 1] * (1 - a));
      od[i + 2] = Math.round(rd[i + 2] * a + od[i + 2] * (1 - a));
    }
  }
}

/** 박스 영역을 원본 픽셀로 되돌린다 (검수에서 걸린 세로쓰기 등) */
function restoreOne(
  od: Uint8ClampedArray,
  origPixels: Uint8ClampedArray,
  it: OcrBox,
  W: number,
  H: number,
): void {
  const b = toPixelBox(it.box, W, H);
  const { padX, padY } = compositeParams(b.x1 - b.x0, b.y1 - b.y0);
  const x0 = Math.max(0, Math.round(b.x0 - padX));
  const y0 = Math.max(0, Math.round(b.y0 - padY));
  const x1 = Math.min(W, Math.round(b.x1 + padX));
  const y1 = Math.min(H, Math.round(b.y1 + padY));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      od[i] = origPixels[i];
      od[i + 1] = origPixels[i + 1];
      od[i + 2] = origPixels[i + 2];
      od[i + 3] = 255;
    }
  }
}

/* ── 자동 검수: 완성본에 외국어·깨진 글자가 남았는지 ───────── */

const VERIFY_PROMPT = `이 이미지에서 한국어·영어·숫자가 아닌 글자(중국어, 일본어, 획이 깨지거나 뭉개져 읽을 수 없는 글자)가 보이는 영역을 모두 찾아주세요.

각 영역마다 JSON 배열 원소로:
- box: [ymin, xmin, ymax, xmax] — 0~1000 정규화

없으면 빈 배열. JSON 배열만 출력.`;

async function detectForeignText(png: Buffer): Promise<[number, number, number, number][]> {
  const parts = await callGemini(
    MODEL,
    [{ inline_data: { mime_type: "image/png", data: png.toString("base64") } }, { text: VERIFY_PROMPT }],
    {
      maxOutputTokens: 2000,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: "minimal" },
    },
  );
  const raw = jsonArrayOf(parts);
  if (!Array.isArray(raw)) return [];
  const out: [number, number, number, number][] = [];
  for (const r of raw) {
    const box = (r as Record<string, unknown>)?.box;
    if (!Array.isArray(box) || box.length !== 4) continue;
    const nums = box.map(Number);
    if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 1000)) continue;
    out.push(nums as [number, number, number, number]);
  }
  return out;
}

/** 검수에서 걸린 영역이 우리 박스와 겹치는가 (걸린 영역의 중심이 박스 안) */
function flaggedHits(flag: [number, number, number, number], it: OcrBox): boolean {
  const cy = (flag[0] + flag[2]) / 2;
  const cx = (flag[1] + flag[3]) / 2;
  const [ymin, xmin, ymax, xmax] = it.box;
  const my = (ymax - ymin) * 0.3;
  const mx = (xmax - xmin) * 0.3;
  return cy >= ymin - my && cy <= ymax + my && cx >= xmin - mx && cx <= xmax + mx;
}

/**
 * 원본 + 재생성본 + 좌표로 최종 합성본을 만든다 (기존 번역본 소급 보정에도 사용).
 *
 * 1) 큰 글씨·세로쓰기: 재생성본에서 패치 (자연스러운 서체)
 * 2) 작은 가로 글씨: 오버레이로 확정 렌더 (재생성이 뭉개는 영역 — 실측)
 * 3) verify=true 면 완성본을 모델로 검수 — 외국어·깨진 글자가 남은 박스는
 *    가로쓰기 → 오버레이 재처리, 세로쓰기 → 원본 복원. 검수 실패는 무시.
 */
export async function compositeTranslatedStill(
  originalData: Buffer,
  regenData: Buffer,
  mime: string,
  boxes: OcrBox[],
  verify = true,
): Promise<{ data: Buffer; mime: string }> {
  ensureFonts();
  const meta = await sharp(originalData).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) throw new Error("이미지 크기를 읽을 수 없습니다.");

  const [orig, regen] = await Promise.all([loadImage(originalData), loadImage(regenData)]);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(orig, 0, 0, W, H);
  const origPixels = ctx.getImageData(0, 0, W, H).data.slice();

  const regenCanvas = createCanvas(W, H);
  const rctx = regenCanvas.getContext("2d");
  rctx.drawImage(regen, 0, 0, W, H);
  const rd = rctx.getImageData(0, 0, W, H).data;

  // 재생성 패치가 위험한 박스(작은 가로 글씨, 옆에 내용이 붙은 문구)는
  // 오버레이로 — 박스 안에서만 정확히 지우고 그린다
  const active = boxes.filter((b) => b.ko.trim());
  const useOverlay = (b: OcrBox): boolean => {
    if (isSmallOverlayBox(b.box, W, H)) return true;
    if (isVerticalBox(b.box, W, H)) return false; // 세로쓰기는 오버레이가 못 그린다
    const px = toPixelBox(b.box, W, H);
    const dist = nearestContentDistance(origPixels, px, W, H, 40);
    return isCrowdedBox(dist, px.y1 - px.y0);
  };
  const patchBoxes = active.filter((b) => !useOverlay(b));
  const overlayBoxes = active.filter(useOverlay);

  const out = ctx.getImageData(0, 0, W, H);
  for (const it of patchBoxes) patchOne(out.data, rd, it, W, H);
  ctx.putImageData(out, 0, 0);
  if (overlayBoxes.length > 0) paintBoxes(ctx, W, H, overlayBoxes);

  // 자동 검수 — 재생성이 문구를 빠뜨리거나 뭉갠 박스를 잡아 재처리한다
  if (verify && patchBoxes.length > 0) {
    try {
      const flags = await detectForeignText(canvas.toBuffer("image/png"));
      const bad = patchBoxes.filter((b) => flags.some((f) => flaggedHits(f, b)));
      if (bad.length > 0) {
        const horiz = bad.filter((b) => !isVerticalBox(b.box, W, H));
        const vert = bad.filter((b) => isVerticalBox(b.box, W, H));
        // 걸린 박스는 먼저 원본으로 복원 — 재생성 패치가 여유 영역에 흘린
        // 글자 조각까지 지운다 (복원 없이 덧칠하면 조각이 남는다 — 실측)
        const img = ctx.getImageData(0, 0, W, H);
        for (const it of bad) restoreOne(img.data, origPixels, it, W, H);
        ctx.putImageData(img, 0, 0);
        if (horiz.length > 0) paintBoxes(ctx, W, H, horiz);
        void vert; // 세로쓰기는 원본 유지 (오버레이가 세로를 못 그림)
      }
    } catch {
      // 검수는 보강 장치 — 실패해도 합성 결과는 그대로 쓴다
    }
  }

  if (mime === "image/png") return { data: canvas.toBuffer("image/png"), mime };
  return { data: canvas.toBuffer("image/jpeg", 95), mime: "image/jpeg" };
}

async function regenerateStill(
  data: Buffer,
  mime: string,
  boxes: OcrBox[],
): Promise<{ data: Buffer; mime: string }> {
  const meta = await sharp(data).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) throw new Error("이미지 크기를 읽을 수 없습니다.");

  const parts = await callGemini(
    IMAGE_MODEL,
    [
      { inline_data: { mime_type: mime, data: data.toString("base64") } },
      { text: regenPrompt(boxes) },
    ],
    { responseModalities: ["TEXT", "IMAGE"] },
  );
  const imgPart = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
  const b64 = imgPart?.inlineData?.data ?? imgPart?.inline_data?.data;
  if (!b64) {
    throw new Error(`이미지 모델이 이미지를 반환하지 않음${textOf(parts) ? `: ${textOf(parts).slice(0, 120)}` : ""}`);
  }
  const out = Buffer.from(b64, "base64");

  // 비율이 5% 이상 어긋나면 구도가 달라진 것 — 폐기하고 오버레이로 폴백
  const om = await sharp(out).metadata();
  const ow = om.width ?? 0;
  const oh = om.height ?? 0;
  if (!ow || !oh || Math.abs(ow / oh - W / H) / (W / H) > 0.05) {
    throw new Error(`재생성 비율 불일치 (${W}x${H} → ${ow}x${oh})`);
  }

  // 원본 크기로 복원한 뒤, 글자 영역만 원본에 합성한다 —
  // 재생성본을 통째로 쓰면 글자 밖 배경에 재생성 잡음이 남는다(실사용 지적)
  const resizedRegen = await sharp(out).resize(W, H, { fit: "fill" }).png().toBuffer();
  return compositeTranslatedStill(data, resizedRegen, mime, boxes);
}

/** 번역 이미지를 만든다. 문구 수정 후 재생성에도 그대로 쓴다. */
export async function renderTranslatedImage(
  data: Buffer,
  mime: string,
  boxes: OcrBox[],
): Promise<{ data: Buffer; mime: string }> {
  ensureFonts();
  if (mime === "image/gif") return renderGif(data, boxes);
  try {
    return await regenerateStill(data, mime, boxes);
  } catch (e) {
    // 이미지 모델 실패(한도·비율 붕괴 등) 시 오버레이 방식으로라도 결과를 준다
    console.warn(`[imageTranslate] 재생성 실패 — 오버레이 폴백: ${e instanceof Error ? e.message : e}`);
    return renderStill(data, mime, boxes);
  }
}
