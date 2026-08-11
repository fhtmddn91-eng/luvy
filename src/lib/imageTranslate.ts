import "server-only";
import path from "node:path";
import crypto from "node:crypto";
import sharp from "sharp";
import { createCanvas, loadImage, GlobalFonts, type SKRSContext2D, type Canvas, type Image } from "@napi-rs/canvas";

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

/**
 * 문구 처리 방식 — 어드민이 항목별로 고른다.
 *  translate: 한국어로 바꾼다(기본)
 *  keep: 손대지 않고 원문 그대로 둔다
 *  erase: 원문을 지우고 아무것도 쓰지 않는다 (글자가 너무 많을 때 정리용)
 */
export type BoxMode = "translate" | "keep" | "erase";
const BOX_MODES: BoxMode[] = ["translate", "keep", "erase"];

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

  /* ── 어드민 수동 조정 (없으면 자동) ── */
  mode?: BoxMode;
  /** 위치 보정 — 0~1000 정규화 단위 (좌우/상하) */
  dx?: number;
  dy?: number;
  /** 글자 크기 배율 (0.5~2.5) */
  scale?: number;
  /** 굵기 고정 — 없으면 원문 굵기·크기로 자동 선택 */
  weight?: FontWeight;
}

/** 어드민이 손댄 항목인가 — 재생성 모델이 못 지키므로 오버레이로 그려야 한다 */
export function hasManualOverride(b: OcrBox): boolean {
  return (
    (b.mode !== undefined && b.mode !== "translate") ||
    (b.dx !== undefined && b.dx !== 0) ||
    (b.dy !== undefined && b.dy !== 0) ||
    (b.scale !== undefined && b.scale !== 1) ||
    b.weight !== undefined
  );
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

export function isFontWeight(v: unknown): v is FontWeight {
  return typeof v === "string" && v in FONT_FAMILIES;
}

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
    const mode = BOX_MODES.includes(r.mode as BoxMode) ? (r.mode as BoxMode) : undefined;
    // 지움(erase)은 번역문이 없어도 성립한다 — 원문만 지우는 항목이라서
    if (!zh || (!ko && mode !== "erase") || ko.length > 200) continue;
    const bg = String(r.bg ?? "");
    const fg = String(r.fg ?? "");
    const num = (v: unknown, min: number, max: number): number | undefined => {
      const n = Number(v);
      return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
    };
    out.push({
      box: [ymin, xmin, ymax, xmax],
      zh: zh.slice(0, 200),
      ko,
      bg: HEX.test(bg) ? bg : "#ffffff",
      fg: HEX.test(fg) ? fg : "#000000",
      bold: Boolean(r.bold),
      solid_bg: r.solid_bg !== false, // 불명확하면 단색 취급(사각형 덮기가 더 안전)
      ...(mode ? { mode } : {}),
      ...(num(r.dx, -1000, 1000) !== undefined ? { dx: num(r.dx, -1000, 1000) } : {}),
      ...(num(r.dy, -1000, 1000) !== undefined ? { dy: num(r.dy, -1000, 1000) } : {}),
      ...(num(r.scale, 0.5, 2.5) !== undefined ? { scale: num(r.scale, 0.5, 2.5) } : {}),
      ...(isFontWeight(r.weight) ? { weight: r.weight } : {}),
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
- **한 줄 안에 외국어와 숫자·단위가 붙어 있으면 그 줄 전체를 한 항목으로** 잡고,
  box 도 줄 전체를 감싸게 하세요 (예: "不低于53MIN" 을 "不低于" 와 "53MIN" 으로
  쪼개지 말 것 — 쪼개면 한쪽을 고칠 때 다른 쪽이 훼손됩니다)

제외 대상:
- 로고·브랜드명 (라틴 문자 브랜드 포함)
- 영어·한국어 문장
- 숫자·단위만 단독으로 있는 것 (216g, 56dB, 3.7V 처럼 외국어가 섞이지 않은 것)

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
- 한국 성인용품 도매몰 상세페이지에서 실제로 쓰는 자연스러운 표현으로
- **숫자·단위·모델명은 원문 그대로 유지** (53MIN, 3.7V, SHD-S549 등을 절대 바꾸거나 빼지 마세요)
- **원문 글자수를 넘지 않게** 짧게. 이미지 안에 들어가야 하므로 길면 글씨가 작아져 안 읽힙니다
- 중국어 의성어·의태어를 소리 나는 대로 옮기지 마세요.
  한국에서 쓰는 말로 바꿉니다 (拍打→탭·두드림, 咬合→흡입·조임, 抠震→자극)
- 설명하듯 늘이지 말고 상품 카피처럼 끊어 씁니다
  (나쁨: "한 손 한가득 착감기는 그립" / 좋음: "한 손 그립")
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
/** 이미지에서 중국어·일본어 문구와 좌표를 뽑는다 (번역 전 / 번역 후 검수 공용) */
async function extractForeign(data: Buffer, mime: string): Promise<OcrBox[]> {
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
  return parseOcrBoxes(
    Array.isArray(rawItems)
      ? rawItems.map((r) => ({ ...(r as Record<string, unknown>), ko: (r as Record<string, unknown>).zh }))
      : [],
  ).filter((b) => isForeignSource(b.zh));
}

export async function ocrImage(data: Buffer, mime: string): Promise<OcrBox[]> {
  const extracted = await extractForeign(data, mime);
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

/**
 * 이미 뽑아 둔 좌표는 그대로 두고 문구만 다시 번역한다.
 *
 * 번역 지침이 바뀌었을 때 기존 번역본을 손보는 용도. OCR 을 다시 돌리면
 * 좌표가 미묘하게 달라져 어드민이 맞춰 둔 위치·크기 조정이 어긋난다.
 * 어드민이 손댄 항목(위치·크기·지움 등)은 그대로 둔다.
 */
export async function retranslateBoxes(boxes: OcrBox[]): Promise<OcrBox[]> {
  const targets = boxes
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.zh && !hasManualOverride(b));
  if (targets.length === 0) return boxes;

  const koList = await translateTexts(targets.map(({ b }) => b.zh));
  const bad = koList.map((ko, i) => (hasHanzi(ko) ? i : -1)).filter((i) => i >= 0);
  if (bad.length > 0) {
    try {
      const repaired = await translateTexts(bad.map((i) => targets[i].b.zh), true);
      bad.forEach((orig, j) => {
        if (repaired[j] && !hasHanzi(repaired[j])) koList[orig] = repaired[j];
      });
    } catch {
      // 보정 실패 시 이번 번역 그대로 — 아래에서 빈 값이면 옛 문구를 지킨다
    }
  }

  const next = boxes.slice();
  targets.forEach(({ i }, k) => {
    const ko = koList[k];
    // 새 번역이 비었거나 원문 그대로면 기존 문구를 지킨다 (퇴보 방지)
    if (ko && ko !== next[i].zh) next[i] = { ...next[i], ko };
  });
  return next;
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

/**
 * 지우기 — 배경을 **주변 픽셀에서 직접 읽어** 채운다.
 *
 * 예전에는 모델이 알려준 bg 색으로 사각형을 칠했는데, 실제 배경과 조금만
 * 달라도 "네모 박스를 씌운 듯한" 자국이 남았다(실사용 지적: 배경 없는 제목에
 * 검은 박스, 사진 위 흰 박스). 모델 값을 믿지 않고 박스 바로 바깥의 테두리
 * 픽셀을 표본으로 삼는다.
 *  - 테두리가 **모든 변에서 같은 한 색**이면(단색 카드·버튼) 그 색으로 채운다
 *  - 조금이라도 변하면(그라데이션·사진) 네 변에서 이중선형 보간해 결을 잇는다
 */
export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* ── 테두리가 진짜 "한 색"인지 판정 ──────────────────────────────
 *
 * 예전 판정은 네 변의 표본을 한 통에 섞어 퍼짐만 봤다. 그래서 은은한
 * 그라데이션(노란 띠)이나 흐린 사진 배경이 "단색"으로 통과했고, 그 위에
 * 상수색 사각형을 칠해 **글자를 네모에 담아 덧붙인 자국**이 남았다
 * (운영 이미지 737개 문구 중 258개에서 경계 단차 확인).
 *
 * 이제 두 가지를 따로 본다.
 *  1. 한 변 안에서 색이 흐르는가 (사진·좌우 그라데이션)
 *  2. 변끼리 색이 다른가 (위아래 그라데이션)
 * 둘 중 하나라도 걸리면 단색이 아니다 → 보간으로 결을 잇는다.
 */

/** 마주보는 변끼리 색 차이 판정 기준 (0~255). 이보다 크면 배경이 흐르는 것 */
const FLAT_GAP = 3;

/**
 * 테두리 표본이 배경 대표색에서 이만큼 넘게 벗어나면 배경이 아니라
 * **다른 물체**(화살표·도형·옆 줄의 글자)로 본다. 사진의 명암은 이보다 가깝다.
 */
const FOREIGN_OBJECT = 48;

/**
 * 한 변의 대표색.
 * 글자 획이 걸친 자리는 cleanEdge 가 이웃 값으로 바꾼 뒤에 잰다 —
 * 획 하나에 끌려가면 배경색을 잘못 집는다.
 */
export function edgeColor(series: number[][] | null): [number, number, number] | null {
  if (!series || series.length < 3) return null;
  return [0, 1, 2].map((c) =>
    Math.round(median(cleanEdge(series.map((s) => s[c])))),
  ) as [number, number, number];
}

const gap = (a: [number, number, number], b: [number, number, number]): number =>
  Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));

/** 네 변 표본 전체의 대표색 — 이 박스 주변의 "배경은 대체로 이 색" */
export function backgroundRef(sides: (number[][] | null)[]): [number, number, number] {
  const all = sides.filter((s): s is number[][] => s !== null).flat();
  if (all.length === 0) return [255, 255, 255];
  return [0, 1, 2].map((c) => median(all.map((s) => s[c]))) as [number, number, number];
}

/**
 * 변에서 **다른 물체**가 물린 자리를 배경 대표색으로 되돌린다.
 *
 * cleanEdge 는 좁은 이웃만 보므로 획 하나는 지우지만, 변을 길게 덮는 것
 * (화살표·도형·바로 아래 줄의 큰 글자)은 그대로 남는다. 그 값을 보간에 넣으면
 * 색이 박스 전체로 늘어나 줄무늬가 됐다(실사례: 노란 화살표 옆 "기능형").
 * 사진의 명암은 배경 대표색에서 그리 멀지 않지만 다른 물체는 훨씬 멀다 —
 * 이 차이로 갈라 사진의 결은 살리고 물체만 걷어낸다.
 */
export function stripForeign(series: number[][], ref: [number, number, number]): number[][] {
  return series.map((s) =>
    Math.max(...[0, 1, 2].map((c) => Math.abs(s[c] - ref[c]))) > FOREIGN_OBJECT
      ? [...ref]
      : s,
  );
}

export type EraseFill =
  /** 네 변이 한 색 — 그 색으로 평평하게 칠한다 */
  | { how: "flat"; color: [number, number, number] }
  /** 색이 흐른다 — 네 변에서 보간해 결을 잇는다 */
  | { how: "blend" };

/**
 * 지운 자리를 무엇으로 채울지. sides 는 [위, 아래, 왼쪽, 오른쪽] 순서.
 *
 * 두 가지가 핵심이다.
 *
 * 1. **다른 물체를 걷어낸 뒤에** 판단한다. 배경은 단색인데 변에 화살표나 옆 줄
 *    글자만 물린 경우, 걷어내기 전에 보면 "색이 흐른다"로 오판한다.
 * 2. 판단은 변 **안의** 흔들림이 아니라 **마주보는 변끼리의 색 차이**로 한다.
 *    진짜 그라데이션은 위↔아래(또는 왼쪽↔오른쪽) 색이 다르다는 게 신호다.
 *    변 안의 흔들림으로 재면, 배경은 평평한데 장식 글자가 변을 스친 경우까지
 *    보간으로 넘어가 그 색이 박스 전체로 늘어난다(실사례: "기능형" 세로 줄무늬).
 */
export function planErase(sides: (number[][] | null)[]): EraseFill {
  const ref = backgroundRef(sides);
  const med = sides.map((s) => edgeColor(s && stripForeign(s, ref)));

  const spread = (a: number, b: number): number =>
    med[a] && med[b] ? gap(med[a]!, med[b]!) : 0;
  // 위↔아래, 왼쪽↔오른쪽
  const varies = Math.max(spread(0, 1), spread(2, 3)) > FLAT_GAP;
  if (varies) return { how: "blend" };

  const known = med.filter((m): m is [number, number, number] => m !== null);
  const color = (
    known.length > 0
      ? [0, 1, 2].map((c) => Math.round(median(known.map((m) => m[c]))))
      : [...ref]
  ) as [number, number, number];
  return { how: "flat", color };
}

/**
 * 네 변 각각의 색 흐름. 변을 따라가는 **순서 있는** 표본이라야
 * "이 변 안에서 색이 흐르는가"를 잴 수 있다.
 * 각 지점은 바깥 1~3px 의 중앙값 — 글자가 테두리에 닿아도 덜 오염된다.
 */
export function sampleSides(
  d: Uint8ClampedArray,
  W: number,
  H: number,
  b: PxBox,
): (number[][] | null)[] {
  const x0 = Math.round(b.x0);
  const y0 = Math.round(b.y0);
  const x1 = Math.round(b.x1);
  const y1 = Math.round(b.y1);
  const px = (x: number, y: number, c: number) =>
    x < 0 || y < 0 || x >= W || y >= H ? NaN : d[(y * W + x) * 4 + c];

  /** 변을 따라가며 각 지점의 색을 읽는다. 지점마다 바깥 1~3px 의 중앙값 */
  const side = (at: (t: number, o: number) => [number, number], n: number) => {
    const out: number[][] = [];
    const step = Math.max(1, Math.floor(n / 64));
    for (let t = 0; t < n; t += step) {
      const rgb: number[] = [];
      for (let c = 0; c < 3; c++) {
        const depth = [1, 2, 3].map((o) => px(...at(t, o), c)).filter((v) => !Number.isNaN(v));
        if (depth.length === 0) break;
        rgb.push(median(depth));
      }
      if (rgb.length === 3) out.push(rgb);
    }
    return out.length >= 3 ? out : null;
  };

  return [
    side((t, o) => [x0 + t, y0 - o], x1 - x0), // 위
    side((t, o) => [x0 + t, y1 + o], x1 - x0), // 아래
    side((t, o) => [x0 - o, y0 + t], y1 - y0), // 왼쪽
    side((t, o) => [x1 + o, y0 + t], y1 - y0), // 오른쪽
  ];
}

/**
 * 한 변에서 읽은 값들 중 이웃과 크게 어긋나는 것(=테두리에 걸친 글자 획)을
 * 이웃 중앙값으로 바꾼다. 그라데이션은 이웃끼리 완만해 그대로 남는다.
 */
export function cleanEdge(raw: number[], window = 4, tol = 28): number[] {
  const out = raw.slice();
  for (let i = 0; i < raw.length; i++) {
    const lo = Math.max(0, i - window);
    const hi = Math.min(raw.length - 1, i + window);
    const m = median(raw.slice(lo, hi + 1));
    if (Math.abs(raw[i] - m) > tol) out[i] = m;
  }
  return out;
}

/** 네 변에서 이중선형 보간 — 그라데이션·사진 배경의 결을 잇는다 */
function eraseBilinear(d: Uint8ClampedArray, W: number, H: number, b: PxBox): void {
  const x0 = Math.max(1, Math.round(b.x0));
  const y0 = Math.max(1, Math.round(b.y0));
  const x1 = Math.min(W - 1, Math.round(b.x1));
  const y1 = Math.min(H - 1, Math.round(b.y1));
  const spanX = Math.max(1, x1 - x0);
  const spanY = Math.max(1, y1 - y0);
  const px = (x: number, y: number, c: number) => d[(y * W + x) * 4 + c];

  // 보간에 쓰는 네 변을 먼저 정리한다 — 글자 획이 섞인 채로 늘리면 줄무늬가 된다
  const edges = [0, 1, 2].map((c) => ({
    left: cleanEdge(Array.from({ length: y1 - y0 }, (_, k) => px(x0 - 1, y0 + k, c))),
    right: cleanEdge(Array.from({ length: y1 - y0 }, (_, k) => px(x1, y0 + k, c))),
    top: cleanEdge(Array.from({ length: x1 - x0 }, (_, k) => px(x0 + k, y0 - 1, c))),
    bottom: cleanEdge(Array.from({ length: x1 - x0 }, (_, k) => px(x0 + k, y1, c))),
  }));

  // 변에 물린 다른 물체(화살표·도형·옆 줄 글자)를 걷어낸다 — 그대로 늘리면 줄무늬가 된다
  const ref = [0, 1, 2].map((c) =>
    median([...edges[c].left, ...edges[c].right, ...edges[c].top, ...edges[c].bottom]),
  ) as [number, number, number];
  for (const key of ["left", "right", "top", "bottom"] as const) {
    const n = edges[0][key].length;
    for (let k = 0; k < n; k++) {
      const off = Math.max(...[0, 1, 2].map((c) => Math.abs(edges[c][key][k] - ref[c])));
      if (off > FOREIGN_OBJECT) {
        for (let c = 0; c < 3; c++) edges[c][key][k] = ref[c];
      }
    }
  }

  for (let y = y0; y < y1; y++) {
    const ty = (y - y0) / spanY;
    for (let x = x0; x < x1; x++) {
      const tx = (x - x0) / spanX;
      const i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) {
        const e = edges[c];
        const horiz = e.left[y - y0] * (1 - tx) + e.right[y - y0] * tx;
        const vert = e.top[x - x0] * (1 - ty) + e.bottom[x - x0] * ty;
        // 가로·세로 보간의 평균 — 한쪽만 쓰면 반대 방향 결이 뭉개진다
        d[i + c] = Math.round((horiz + vert) / 2);
      }
      d[i + 3] = 255;
    }
  }
}

/* ── 획만 지우기 ───────────────────────────────────────────────
 *
 * 예전에는 문구 자리를 **사각형으로 칠했다**. 배경이 조금이라도 흐르면 그
 * 사각형이 그대로 보여서, 번역문이 배경에 얹힌 게 아니라 네모에 담겨 덧붙은
 * 것처럼 보였다. 칠하는 색을 아무리 잘 골라도 사각형인 이상 자국은 남는다.
 *
 * 그래서 사각형을 없앤다. 글자 **획이 있는 픽셀만** 배경으로 되돌리고,
 * 나머지는 원본 픽셀을 그대로 둔다. 자국이 남을 사각형 자체가 없어진다.
 *
 * 배경 추정은 "획은 가늘다"는 성질을 쓴다. 글자 높이의 절반쯤 되는 창으로
 * 백분위 필터를 돌리면 가는 획은 사라지고 배경의 결(그라데이션·사진·질감)은
 * 남는다. 밝은 배경이면 위쪽 분위, 어두운 배경이면 아래쪽 분위를 집는다.
 */

/** 배경 추정 창의 최대 크기 (px) */
const PLATE_WIN_MAX = 121;
/** 배경과 이만큼 넘게 다른 픽셀을 획으로 본다 (0~255) */
const GLYPH_DIFF = 22;
/** 획이 박스의 이 비율을 넘으면 획을 가려낸 게 아니다 — 예전 방식으로 되돌린다 */
const GLYPH_MAX_COVER = 0.62;

/**
 * 슬라이딩 창 백분위 필터 한 방향(가로 또는 세로).
 *
 * 값을 4단계로 묶은 히스토그램으로 창을 굴린다. 고른 칸의 **평균**을 돌려주므로
 * 단색 배경에서는 원래 값이 그대로 나온다(묶음 때문에 색이 어긋나지 않는다).
 * p=0.95 는 최댓값, p=0.05 는 최솟값에 가깝되 티끌 하나에 끌려가지 않는다.
 */
export function percentilePass(
  src: Uint8Array,
  w: number,
  h: number,
  win: number,
  p: number,
  vertical: boolean,
): Uint8Array {
  const half = Math.max(1, win >> 1);
  const len = vertical ? h : w;
  const lines = vertical ? w : h;
  const stride = vertical ? 1 : w;
  const step = vertical ? w : 1;

  const hist = new Uint16Array(64);
  const sum = new Float64Array(64);
  const out = new Uint8Array(w * h);
  let n = 0;

  for (let l = 0; l < lines; l++) {
    hist.fill(0);
    sum.fill(0);
    n = 0;
    const base = l * stride;
    const add = (v: number) => { hist[v >> 2]++; sum[v >> 2] += v; n++; };
    const del = (v: number) => { hist[v >> 2]--; sum[v >> 2] -= v; n--; };

    for (let i = 0; i <= Math.min(half, len - 1); i++) add(src[base + i * step]);
    for (let i = 0; i < len; i++) {
      if (i > 0) {
        const rm = i - half - 1;
        if (rm >= 0) del(src[base + rm * step]);
        const ad = i + half;
        if (ad < len) add(src[base + ad * step]);
      }
      const need = Math.max(1, Math.round(n * p));
      let acc = 0;
      let b = 0;
      for (; b < 63; b++) { acc += hist[b]; if (acc >= need) break; }
      out[base + i * step] = hist[b] > 0 ? Math.round(sum[b] / hist[b]) : 0;
    }
  }
  return out;
}

/**
 * 배경만 남긴 판(plate)을 만든다.
 *
 * 밝은 배경 위의 어두운 글자는 **닫힘**(넓히기 → 좁히기)으로 지운다. 넓히기가
 * 획을 배경 밝기로 덮고, 좁히기가 넓어진 만큼 되돌려 배경의 밝기·결을 지킨다.
 * 어두운 배경 위의 밝은 글자는 반대로 **열림**. 창이 획 굵기보다 커야 하므로
 * 글자 높이에 맞춰 잡는다 — 큰 제목일수록 창도 커진다.
 */
export function backgroundPlate(
  src: Uint8Array,
  w: number,
  h: number,
  win: number,
  bgIsLight: boolean,
): Uint8Array {
  const hi = 0.95;
  const lo = 0.05;
  const grow = (a: Uint8Array, p: number) =>
    percentilePass(percentilePass(a, w, h, win, p, false), w, h, win, p, true);
  return bgIsLight ? grow(grow(src, hi), lo) : grow(grow(src, lo), hi);
}

/**
 * 획이 있는 픽셀만 배경으로 되돌린다.
 * 획을 가려내지 못하면(글자가 영역을 꽉 채움) false — 부르는 쪽이 예전 방식을 쓴다.
 */
export function eraseGlyphs(
  d: Uint8ClampedArray,
  W: number,
  H: number,
  box: { x0: number; y0: number; x1: number; y1: number },
): boolean {
  const bh = box.y1 - box.y0;
  // 창은 획 굵기보다 넉넉히 커야 한다 — 작으면 굵은 제목의 획 속이 안 지워져
  // 원문이 유령처럼 비친다(실사례: "持私密性爱的纯粹"가 한글 뒤로 비쳤다)
  const win = Math.min(PLATE_WIN_MAX, Math.max(7, Math.round(bh * 0.9)) | 1);
  const pad = win; // 창이 박스 바깥 배경까지 보게 여유를 둔다
  const rx0 = Math.max(0, box.x0 - pad);
  const ry0 = Math.max(0, box.y0 - pad);
  const rx1 = Math.min(W, box.x1 + pad);
  const ry1 = Math.min(H, box.y1 + pad);
  const rw = rx1 - rx0;
  const rh = ry1 - ry0;
  if (rw < 3 || rh < 3) return false;

  // 배경이 글자보다 밝은지 — 밝으면 위쪽 분위를, 어두우면 아래쪽 분위를 집는다
  const lum: number[] = [];
  for (let y = ry0; y < ry1; y += 2) {
    for (let x = rx0; x < rx1; x += 2) {
      const i = (y * W + x) * 4;
      lum.push((d[i] * 3 + d[i + 1] * 6 + d[i + 2]) / 10);
    }
  }
  const bgIsLight = median(lum) >= 128;

  const plate: Uint8Array[] = [];
  for (let c = 0; c < 3; c++) {
    const ch = new Uint8Array(rw * rh);
    for (let y = 0; y < rh; y++) {
      for (let x = 0; x < rw; x++) ch[y * rw + x] = d[((ry0 + y) * W + rx0 + x) * 4 + c];
    }
    plate.push(backgroundPlate(ch, rw, rh, win, bgIsLight));
  }

  // 획 마스크 — 배경 추정치와 많이 다른 픽셀
  const mask = new Uint8Array(rw * rh);
  let hits = 0;
  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const k = (y - ry0) * rw + (x - rx0);
      const i = (y * W + x) * 4;
      const diff = Math.max(
        Math.abs(d[i] - plate[0][k]),
        Math.abs(d[i + 1] - plate[1][k]),
        Math.abs(d[i + 2] - plate[2][k]),
      );
      if (diff > GLYPH_DIFF) { mask[k] = 255; hits++; }
    }
  }
  const area = (box.x1 - box.x0) * (box.y1 - box.y0);
  if (hits === 0 || hits > area * GLYPH_MAX_COVER) return false;

  // 획을 두 겹 넓힌다 — 안티에일리어싱된 획 끝(옅은 테두리)까지 덮어야 잔상이 없다
  let grown: Uint8Array = mask;
  for (let r = 0; r < 2; r++) grown = dilate1(grown, rw, rh);
  const alpha = boxBlur(boxBlur(grown, rw, rh), rw, rh);

  /*
   * 채우기는 **주변에서 번져 들어오게** 한다.
   *
   * 배경 판(plate)을 그대로 칠하면 창 크기 때문에 실제 배경보다 밝거나 어두워져
   * 원문이 유령처럼 비친다(실사례: 사진 위 큰 제목에 흰 글자 자국이 남았다).
   * 획 주변의 진짜 픽셀에서 한 겹씩 번져 들어오면 그 자리의 배경 밝기·결이
   * 그대로 이어진다.
   */
  const filled = inpaint(
    [0, 1, 2].map((c) => {
      const ch = new Uint8Array(rw * rh);
      for (let y = 0; y < rh; y++) {
        for (let x = 0; x < rw; x++) ch[y * rw + x] = d[((ry0 + y) * W + rx0 + x) * 4 + c];
      }
      return ch;
    }),
    grown,
    rw,
    rh,
  );

  for (let y = box.y0; y < box.y1; y++) {
    for (let x = box.x0; x < box.x1; x++) {
      const k = (y - ry0) * rw + (x - rx0);
      const a = alpha[k] / 255;
      if (a === 0) continue;
      const i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) d[i + c] = Math.round(d[i + c] * (1 - a) + filled[c][k] * a);
      d[i + 3] = 255;
    }
  }
  return true;
}

/** 마스크를 한 겹 넓힌다 (8이웃) */
function dilate1(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (let dy = -1; dy <= 1 && !v; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          if (src[yy * w + xx]) { v = 255; break; }
        }
      }
      out[y * w + x] = v;
    }
  }
  return out;
}

/**
 * 마스크 자리를 주변 배경에서 한 겹씩 번져 채운다.
 *
 * 가장자리부터 안쪽으로 채워 들어가므로 획이 굵어도 메워지고, 채운 값이
 * 바로 옆 실제 배경에서 나오기 때문에 그라데이션·사진의 결이 이어진다.
 * 다 채운 뒤 몇 번 고르게 펴서 획 한가운데에 능선이 지지 않게 한다.
 */
export function inpaint(
  channels: Uint8Array[],
  mask: Uint8Array,
  w: number,
  h: number,
): Uint8Array[] {
  const out = channels.map((c) => Float32Array.from(c));
  const known = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) known[i] = mask[i] ? 0 : 1;

  const nbr = [-1, 1, -w, w, -w - 1, -w + 1, w - 1, w + 1];
  for (let round = 0; round < 512; round++) {
    const justFilled: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        if (known[k]) continue;
        let n = 0;
        const acc = [0, 0, 0];
        for (const o of nbr) {
          const j = k + o;
          if (j < 0 || j >= w * h) continue;
          // 가로로 감기는 것 방지
          if (Math.abs(((j % w) - (k % w))) > 1) continue;
          if (!known[j]) continue;
          for (let c = 0; c < 3; c++) acc[c] += out[c][j];
          n++;
        }
        if (n === 0) continue;
        for (let c = 0; c < 3; c++) out[c][k] = acc[c] / n;
        justFilled.push(k);
      }
    }
    if (justFilled.length === 0) break;
    for (const k of justFilled) known[k] = 1;
  }

  // 채운 자리만 몇 번 고르게 편다
  for (let pass = 0; pass < 3; pass++) {
    const snap = out.map((c) => Float32Array.from(c));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        if (!mask[k]) continue;
        let n = 0;
        const acc = [0, 0, 0];
        for (const o of nbr) {
          const j = k + o;
          if (j < 0 || j >= w * h) continue;
          if (Math.abs(((j % w) - (k % w))) > 1) continue;
          for (let c = 0; c < 3; c++) acc[c] += snap[c][j];
          n++;
        }
        if (!n) continue;
        for (let c = 0; c < 3; c++) out[c][k] = acc[c] / n;
      }
    }
  }
  return out.map((c) => Uint8Array.from(c, (v) => Math.round(v)));
}

/** 3×3 평균 — 마스크 가장자리를 부드럽게 만든다 */
function boxBlur(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let t = 0;
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          t += src[yy * w + xx];
          c++;
        }
      }
      out[y * w + x] = Math.round(t / c);
    }
  }
  return out;
}

/** 박스 영역의 원문을 지운다 (배경을 주변에서 추정해 채움) */
function eraseRegion(ctx: SKRSContext2D, width: number, height: number, b: PxBox): void {
  const x0 = Math.max(0, Math.round(b.x0));
  const y0 = Math.max(0, Math.round(b.y0));
  const x1 = Math.min(width, Math.round(b.x1));
  const y1 = Math.min(height, Math.round(b.y1));
  if (x1 - x0 < 2 || y1 - y0 < 2) return;

  const img = ctx.getImageData(0, 0, width, height);
  if (eraseGlyphs(img.data, width, height, { x0, y0, x1, y1 })) {
    ctx.putImageData(img, 0, 0);
    return;
  }

  // 획을 못 가려냈을 때만(글자가 박스를 꽉 채운 경우) 예전처럼 영역을 칠한다
  const plan = planErase(sampleSides(img.data, width, height, b));
  if (plan.how === "blend") {
    eraseBilinear(img.data, width, height, b);
    ctx.putImageData(img, 0, 0);
    return;
  }
  ctx.fillStyle = `rgb(${plan.color[0]},${plan.color[1]},${plan.color[2]})`;
  ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
}

/**
 * 지우기 영역의 좌우 여백을 옆 내용에 닿기 전까지로 제한한다.
 *
 * toPixelBox 의 기본 6% 여백이 바로 옆 숫자를 덮은 실사례가 있다
 * ("不低于53MIN" → "최소 3MIN", 53분이 3분으로). 원본 픽셀을 알고 있을 때는
 * 옆 내용까지의 거리만큼만 넓힌다.
 */
function clampedPixelBox(
  it: OcrBox,
  width: number,
  height: number,
  origPixels?: Uint8ClampedArray,
): PxBox {
  const padded = toPixelBox(it.box, width, height);
  if (!origPixels) return padded;

  const [ymin, xmin, ymax, xmax] = it.box;
  const rawX0 = (xmin / 1000) * width;
  const rawX1 = (xmax / 1000) * width;
  const ty0 = Math.max(0, Math.round((ymin / 1000) * height));
  const ty1 = Math.min(height, Math.round((ymax / 1000) * height));
  const th = MIN_TEXT_STDDEV * 0.8;

  const hasRight = (d: number) =>
    columnStdev(origPixels, width, Math.round(rawX1) + d, ty0, ty1) > th;
  const hasLeft = (d: number) =>
    columnStdev(origPixels, width, Math.round(rawX0) - d, ty0, ty1) > th;

  const wantLeft = Math.max(0, Math.round(rawX0 - padded.x0));
  const wantRight = Math.max(0, Math.round(padded.x1 - rawX1));
  /*
   * 붙어 있는 잔여 획은 덮되, 빈 칸 뒤의 옆 항목은 건드리지 않는다.
   * 좌우 상한을 넉넉히 주면 띄어쓰기 없이 붙은 옆 글자를 먹는다 —
   * 25% 로 올리거나 한 칸만 더 넓혀도 "버건디" 옆 "/BURGUNDY" 를 먹었다(실측).
   * 가로는 지금 폭 그대로 두고, 잘려 남는 획은 아래 세로 확장이 받아낸다.
   */
  const leftoverCap = Math.min(24, Math.round((rawX1 - rawX0) * 0.15));
  const padLeft = hasLeft(1)
    ? extendOverLeftover(hasLeft, leftoverCap)
    : safePad(hasLeft, wantLeft);
  const padRight = hasRight(1)
    ? extendOverLeftover(hasRight, leftoverCap)
    : safePad(hasRight, wantRight);

  const x0 = Math.max(0, Math.round(rawX0) - padLeft);
  const x1 = Math.min(width, Math.round(rawX1) + padRight);

  /*
   * 상하도 같은 원리로 잔여 획까지 지운다.
   * 좌표가 글자 높이를 짧게 잡으면 받침·삐침이 박스 아래로 남아, 그 위에
   * 한글을 그리면 밑줄처럼 비친다(실사례: 제목 "초고속 진동 바이브" 아래 잔상).
   * 다만 바로 아래 줄까지 삼키면 안 되므로 빈 줄이 나오면 거기서 멈추고,
   * 넓히는 양도 글자 높이의 20% 이내로 묶는다.
   */
  const rawY0 = (ymin / 1000) * height;
  const rawY1 = (ymax / 1000) * height;
  const hasBelow = (d: number) =>
    rowStdev(origPixels, width, height, Math.round(rawY1) + d, x0, x1) > th;
  const hasAbove = (d: number) =>
    rowStdev(origPixels, width, height, Math.round(rawY0) - d, x0, x1) > th;
  const wantUp = Math.max(0, Math.round(rawY0 - padded.y0));
  const wantDown = Math.max(0, Math.round(padded.y1 - rawY1));
  const capY = Math.min(14, Math.max(6, Math.round((rawY1 - rawY0) * 0.35)));
  // 붙어 있는 잔여 획은 넘어가며 덮고(extend), 떨어져 있으면 원래 여백만큼(safePad).
  // 둘 중 큰 쪽 — 어느 한쪽만 쓰면 받침이 남거나 여백이 사라진다.
  // +1: extendOverLeftover 는 마지막 내용 위치를 돌려주므로 그 줄까지 포함시킨다.
  // 위아래는 옆 글자를 먹을 위험이 없어(줄 사이 여백이 있다) 한 줄 더 잡아도 안전하다.
  const over = (has: (d: number) => boolean): number => {
    const e = extendOverLeftover(has, capY);
    return e > 0 ? e + 1 : 0;
  };
  const padUp = Math.max(safePad(hasAbove, wantUp), over(hasAbove));
  const padDown = Math.max(safePad(hasBelow, wantDown), over(hasBelow));

  return {
    x0,
    y0: Math.max(0, Math.round(rawY0) - padUp),
    x1,
    y1: Math.min(height, Math.round(rawY1) + padDown),
  };
}

/** 한 프레임에 번역 박스들을 그린다 (원문 지우기 + 한국어 얹기) */
/**
 * 원문에서 같은 크기였던 문구끼리 묶는다 (높이 차이가 tol 이내면 한 묶음).
 *
 * 왜: 렌더 크기를 박스마다 따로 맞추면, 원문에서 같은 12px 이던 줄들이
 * 좌표 오차 때문에 15·13·17px 로 제각각 나온다(실사용 지적). 원문 높이로
 * 먼저 묶어 두고 묶음마다 하나의 크기를 쓰면 원본의 위계가 그대로 산다.
 */
export function groupBySize(heights: number[], tol = 0.18): number[] {
  const order = heights.map((_, i) => i).sort((a, b) => heights[a] - heights[b]);
  const group = new Array<number>(heights.length).fill(0);
  let g = -1;
  let anchor = 0;
  for (const i of order) {
    if (g < 0 || heights[i] > anchor * (1 + tol)) {
      g++;
      anchor = heights[i];
    }
    group[i] = g;
  }
  return group;
}

/**
 * 묶음마다 하나의 글자 크기를 정한다.
 *
 * 묶음 안에서는 다 들어가야 하므로 가장 작은 쪽에 맞춘다. 다만 번역문이
 * 유난히 길어 혼자 많이 줄여야 하는 항목은 묶음에서 빼고 제 크기를 쓴다 —
 * 그 하나 때문에 같은 줄들이 전부 작아지면 그게 더 어색하다.
 */
export function unifySizes(groups: number[], fitted: number[], floor = 0.75): number[] {
  const out = fitted.slice();
  const byGroup = new Map<number, number[]>();
  groups.forEach((g, i) => {
    const list = byGroup.get(g);
    if (list) list.push(i);
    else byGroup.set(g, [i]);
  });
  for (const idx of byGroup.values()) {
    if (idx.length < 2) continue;
    const mid = median(idx.map((i) => fitted[i]));
    const inRange = idx.filter((i) => fitted[i] >= mid * floor);
    if (inRange.length < 2) continue;
    const unified = Math.min(...inRange.map((i) => fitted[i]));
    for (const i of inRange) out[i] = unified;
  }
  return out;
}

function paintBoxes(
  ctx: SKRSContext2D,
  width: number,
  height: number,
  boxes: OcrBox[],
  origPixels?: Uint8ClampedArray,
  /** skipErase: 이미 글자가 지워진 그림(모델 지우기 결과) 위에 그릴 때 */
  opts: { skipErase?: boolean } = {},
): void {
  interface Plan {
    it: OcrBox;
    ko: string;
    b: PxBox;
    bw: number;
    bh: number;
    family: string;
    vertical: boolean;
    fitted: number;
  }

  const plans: Plan[] = [];
  for (const it of boxes) {
    const mode = it.mode ?? "translate";
    if (mode === "keep") continue; // 손대지 않음 — 원문 그대로

    const ko = sanitizeSymbols(it.ko).trim();
    // 번역 모드인데 문구가 비어 있으면 건드리지 않는다 (실수로 지워지는 사고 방지)
    if (mode === "translate" && !ko) continue;

    const b = clampedPixelBox(it, width, height, origPixels);
    const bw = b.x1 - b.x0;
    const bh = b.y1 - b.y0;
    if (bw < 4 || bh < 4) continue;

    // 원문 지우기 — 배경은 주변 픽셀에서 읽는다(모델의 bg 색은 어긋나 박스 자국이 남았다).
    // 지우기는 먼저 전부 끝낸다 — 나중에 지우면 이미 그린 옆 문구를 덮을 수 있다.
    if (!opts.skipErase) eraseRegion(ctx, width, height, b);
    if (mode === "erase") continue; // erase 모드는 여기까지

    plans.push({
      it,
      ko,
      b,
      bw,
      bh,
      family: FONT_FAMILIES[it.weight ?? pickWeight(it.bold, bh)],
      vertical: isVerticalBox(it.box, width, height),
      fitted: 0,
    });
  }

  // 박스에 들어가는 최대 크기를 먼저 구한다
  for (const p of plans) {
    let size = Math.floor(p.bh);
    while (size > 6) {
      ctx.font = `${size}px "${p.family}"`;
      const m = ctx.measureText(p.ko);
      const textH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
      if (m.width <= p.bw * 0.94 && textH <= p.bh * 0.82) break;
      size -= 1;
    }
    p.fitted = size;
  }

  // 원문에서 같은 크기였던 가로쓰기 문구끼리 크기를 통일한다
  const flat = plans.filter((p) => !p.vertical);
  if (flat.length > 1) {
    const heights = flat.map((p) => ((p.it.box[2] - p.it.box[0]) / 1000) * height);
    const unified = unifySizes(groupBySize(heights), flat.map((p) => p.fitted));
    flat.forEach((p, i) => (p.fitted = unified[i]));
  }

  for (const p of plans) {
    const { it, ko, b, bw, bh, family } = p;
    // 위치 보정 — 정규화(0~1000) 단위를 픽셀로 환산해 더한다
    const offX = ((it.dx ?? 0) / 1000) * width;
    const offY = ((it.dy ?? 0) / 1000) * height;
    ctx.fillStyle = it.fg;

    // 세로쓰기 문구는 글자를 세로로 쌓는다 — 가로로 쓰면 좁은 박스에
    // 밀려 들어가 아주 작아진다(수동 조정한 세로 문구에서 발생)
    if (p.vertical) {
      // 공백은 세로로 쌓을 때 빈 칸만 만들어 어색하다 — 빼고 글자만 쌓는다
      const chars = [...ko].filter((c) => c.trim());
      const cell = Math.min(bw, bh / Math.max(1, chars.length));
      const vsize = Math.max(6, Math.round(cell * 0.9 * (it.scale ?? 1)));
      ctx.font = `${vsize}px "${family}"`;
      const startY = b.y0 + (bh - cell * chars.length) / 2 + offY;
      chars.forEach((ch, ci) => {
        const m = ctx.measureText(ch);
        const h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
        ctx.fillText(
          ch,
          b.x0 + (bw - m.width) / 2 + offX,
          startY + cell * ci + (cell - h) / 2 + m.actualBoundingBoxAscent,
        );
      });
      continue;
    }

    // 통일된 크기에 어드민 배율을 곱한다 (키우거나 줄일 수 있게)
    const size = Math.max(6, Math.round(p.fitted * (it.scale ?? 1)));
    ctx.font = `${size}px "${family}"`;
    const metrics = ctx.measureText(ko);
    const textH = metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent;
    ctx.fillText(
      ko,
      b.x0 + (bw - metrics.width) / 2 + offX,
      b.y0 + (bh - textH) / 2 + metrics.actualBoundingBoxAscent + offY,
    );
  }
}

async function renderStill(data: Buffer, mime: string, boxes: OcrBox[]): Promise<{ data: Buffer; mime: string }> {
  const img = await loadImage(data);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  // 원본 픽셀을 함께 넘겨야 박스 밖으로 삐져나온 잔여 획까지 지운다 —
  // 안 넘기면 좌표 그대로만 지워 받침·삐침이 남는다(실측: "직경 3CM" 아래 잔상)
  const origPixels = ctx.getImageData(0, 0, img.width, img.height).data.slice();
  paintBoxes(ctx, img.width, img.height, boxes, origPixels);
  // PNG 는 투명도 보존을 위해 PNG 유지, 나머지는 JPEG
  if (mime === "image/png") return { data: canvas.toBuffer("image/png"), mime };
  return { data: canvas.toBuffer("image/jpeg", 90), mime: "image/jpeg" };
}

/**
 * 이미 글자가 지워진 그림 위에 문구만 그린다.
 *
 * 모델 지우기 결과에 쓴다 — 여기서 eraseRegion 을 또 돌리면 안 된다.
 * 지워진 자리엔 획이 없어 획 지우개가 빈손이 되고, 그러면 폴백이
 * 사각형을 칠해 모처럼 깨끗해진 배경에 도로 자국을 낸다.
 */
async function drawTextOnly(
  data: Buffer,
  mime: string,
  boxes: OcrBox[],
): Promise<{ data: Buffer; mime: string }> {
  const img = await loadImage(data);
  const canvas = createCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  paintBoxes(ctx, img.width, img.height, boxes, undefined, { skipErase: true });
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

/** GIF 정지 패치의 오려낼 영역 — 재생성 글자가 원문 박스보다 살짝 클 수 있어 여유를 둔다 */
function gifPatchRect(b: OcrBox, W: number, H: number): PxBox & { feather: number } {
  const p = toPixelBox(b.box, W, H);
  const padX = Math.max(12, (p.x1 - p.x0) * 0.25);
  const padY = Math.max(10, (p.y1 - p.y0) * 0.5);
  return {
    x0: Math.max(0, Math.round(p.x0 - padX)),
    y0: Math.max(0, Math.round(p.y0 - padY)),
    x1: Math.min(W, Math.round(p.x1 + padX)),
    y1: Math.min(H, Math.round(p.y1 + padY)),
    feather: Math.min(10, Math.max(5, Math.min(padX, padY) * 0.5)),
  };
}

/**
 * 이 영역이 모든 프레임에서 정지해 있는가.
 * GIF 팔레트·디더링 노이즈를 감안해 "크게 달라진 픽셀이 1% 미만"이면 정지로 본다.
 */
export function regionIsStatic(
  frames: Uint8Array[],
  W: number,
  rect: { x0: number; y0: number; x1: number; y1: number },
  tol = 32,
  maxMovedFrac = 0.01,
): boolean {
  const base = frames[0];
  const area = Math.max(1, (rect.x1 - rect.x0) * (rect.y1 - rect.y0));
  for (let f = 1; f < frames.length; f++) {
    const cur = frames[f];
    let moved = 0;
    for (let y = rect.y0; y < rect.y1; y++) {
      for (let x = rect.x0; x < rect.x1; x++) {
        const i = (y * W + x) * 4;
        const d = Math.max(
          Math.abs(cur[i] - base[i]),
          Math.abs(cur[i + 1] - base[i + 1]),
          Math.abs(cur[i + 2] - base[i + 2]),
        );
        if (d > tol) moved++;
      }
    }
    if (moved / area > maxMovedFrac) return false;
  }
  return true;
}

/** 재생성본에서 글자 영역만 페더링된 알파로 오려낸 오버레이(RGBA raw) */
function buildPatchOverlay(
  regen: Uint8Array,
  W: number,
  H: number,
  rects: (PxBox & { feather: number })[],
): Buffer {
  const out = Buffer.alloc(W * H * 4); // 알파 0 = 투명
  for (const r of rects) {
    for (let y = r.y0; y < r.y1; y++) {
      for (let x = r.x0; x < r.x1; x++) {
        const edge = Math.min(x - r.x0 + 1, r.x1 - x, y - r.y0 + 1, r.y1 - y);
        const a = Math.round(Math.min(1, edge / r.feather) * 255);
        const i = (y * W + x) * 4;
        if (a > out[i + 3]) {
          out[i] = regen[i];
          out[i + 1] = regen[i + 1];
          out[i + 2] = regen[i + 2];
          out[i + 3] = a;
        }
      }
    }
  }
  return out;
}

/** 정지 패치를 못 쓸 만큼 프레임이 많은 GIF — 메모리를 아끼고 바로 오버레이로 */
const GIF_PATCH_MAX_PAGES = 60;

/**
 * GIF 정지 패치 — 첫 프레임만 모델로 재생성해 글자 영역을 오려 두고,
 * 모든 프레임에 같은 픽셀을 얹는다.
 *
 * 프레임마다 모델을 돌리면 그림이 미묘하게 달라져 애니메이션이 떨린다.
 * 같은 패치를 얹으면 떨림이 원천적으로 없다. 글자 자리가 움직이는 문구는
 * 패치가 그 움직임을 얼려버리므로 그 문구만 오버레이로 넘긴다 —
 * 실측에서 "문구는 정지인데 여유 영역이 아래 제품 애니메이션에 걸리는"
 * 경우가 흔해서, 전부-아니면-전무가 아니라 문구 단위로 가른다.
 */
async function tryBuildGifPatch(
  data: Buffer,
  boxes: OcrBox[],
  W: number,
  H: number,
  pages: number,
): Promise<{ patch: Image; overlayBoxes: OcrBox[] } | null> {
  try {
    if (pages > GIF_PATCH_MAX_PAGES) return null;
    const targets = boxes.filter((b) => (b.mode ?? "translate") === "translate" && b.ko.trim());
    if (targets.length === 0) return null;

    const raws: Uint8Array[] = [];
    for (let i = 0; i < pages; i++) {
      raws.push(
        new Uint8Array(await sharp(data, { page: i, pages: 1 }).ensureAlpha().raw().toBuffer()),
      );
    }
    const still = targets.filter((b) => regionIsStatic(raws, W, gifPatchRect(b, W, H)));
    if (still.length === 0) return null;
    const moving = targets.filter((b) => !still.includes(b));

    const frame0 = await sharp(data, { page: 0, pages: 1 }).png().toBuffer();
    for (let attempt = 1; attempt <= REGEN_ATTEMPTS; attempt++) {
      const regenPng = await callImageEdit(frame0, "image/png", regenPrompt(still), W, H);
      if (await leftoverInBoxes(regenPng, "image/png", still)) continue;
      const regenRaw = new Uint8Array(await sharp(regenPng).ensureAlpha().raw().toBuffer());
      const overlay = buildPatchOverlay(regenRaw, W, H, still.map((b) => gifPatchRect(b, W, H)));
      const png = await sharp(overlay, { raw: { width: W, height: H, channels: 4 } })
        .png()
        .toBuffer();
      return { patch: await loadImage(png), overlayBoxes: moving };
    }
    return null;
  } catch (e) {
    console.warn(
      `[imageTranslate] GIF 정지 패치 실패 — 오버레이 폴백: ${e instanceof Error ? e.message : e}`,
    );
    return null;
  }
}

async function renderGif(data: Buffer, boxes: OcrBox[]): Promise<{ data: Buffer; mime: string }> {
  const meta = await sharp(data, { animated: true }).metadata();
  const pages = meta.pages ?? 1;
  const width = meta.width ?? 0;
  const height = meta.pageHeight ?? meta.height ?? 0;
  if (!width || !height) throw new Error("GIF 크기를 읽을 수 없습니다.");

  // 글자 자리가 정지해 있으면 모델 재생성 품질을 GIF 에도 쓴다.
  // 수동 조정본은 지시를 지켜야 하므로 프레임별 오버레이 유지.
  const patched = mustOverlay(boxes)
    ? null
    : await tryBuildGifPatch(data, boxes, width, height, pages);
  // 패치가 안 됐으면 전 문구를, 됐으면 움직여서 못 얹은 문구만 오버레이로
  const overlayBoxes = patched ? patched.overlayBoxes : boxes;

  const frames: Buffer[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < pages; i++) {
    const png = await sharp(data, { page: i, pages: 1 }).png().toBuffer();
    const img = await loadImage(png);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    if (patched) ctx.drawImage(patched.patch, 0, 0); // 모든 프레임에 같은 픽셀 — 떨림 없음
    if (overlayBoxes.length > 0) {
      // 프레임마다 그 프레임의 원본 픽셀 기준으로 잔여 획을 판단한다
      paintBoxes(ctx, width, height, overlayBoxes, ctx.getImageData(0, 0, width, height).data.slice());
    }
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
/**
 * 이미지 편집 모델 (원본을 주고 글자 영역만 다시 그리게 한다).
 * Imagen 계열은 predict 방식의 텍스트→이미지라 편집에 못 쓴다.
 * 환경변수로 바꿔 끼울 수 있게 열어 둔다.
 */
const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";
/**
 * 재생성 시도 횟수 — 검수에서 걸리면 다시 뽑는다.
 * 모델은 매번 다르게 그리므로 한 번 어긋나도 다음 판은 멀쩡한 경우가 많다.
 * 3회로 돌려본 결과 3번째에 성공하는 경우는 드물었고(대부분 같은 버릇으로
 * 재실패), 시도마다 생성비가 나가므로 2회로 줄였다. 실패해도 부분 보정·띠·
 * 오버레이 사다리가 받아준다.
 */
const REGEN_ATTEMPTS = 2;

function regenPrompt(boxes: OcrBox[]): string {
  // 유지·지움으로 지정한 항목은 재생성 대상에서 빼야 모델이 건드리지 않는다
  const tlist = boxes
    .filter((b) => (b.mode ?? "translate") === "translate" && b.ko.trim())
    .map((b) => `- "${b.zh}" → "${sanitizeSymbols(b.ko)}"`)
    .join("\n");
  return `이 이미지의 중국어·일본어 글자를 아래 한국어로 바꾼 이미지를 만들어 주세요.

바꿀 문구 (반드시 이 번역 그대로, 하나도 빠짐없이):
${tlist}

가장 중요한 규칙:
- 원문 글자는 반드시 지우고 그 자리에 한국어만 남긴다. 원문을 그대로 두고 옆이나 아래에 한국어를 덧붙이면 안 된다.
- 결과 이미지에 중국어·일본어가 한 글자라도 남으면 실패다. 표·스펙 목록처럼 작은 글씨가 빽빽한 칸도 빠짐없이 바꾼다.

절대 규칙:
- 글자 말고는 전부 원본 그대로 — 제품 사진, 모델, 배경, 그라데이션, 장식, 도형, 아이콘, 로고, 배지, 띠, 레이아웃, 가로세로 비율, 해상도
- 각 문구는 원문이 있던 자리에 원문과 같은 서체 느낌·크기·굵기·색·정렬로
- 세로쓰기는 세로쓰기 그대로
- 라틴 문자 브랜드명·모델명·숫자·단위(mm, MIN, MAH, dB 등)는 그대로 둘 것
- 위 목록에 없는 글자는 다시 그리지 말고 원본 그대로 둘 것
- 목록에 없는 문구를 새로 만들어 넣지 말 것
- 띠·배지·버튼의 위치와 모양을 옮기거나 바꾸지 말 것`;
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

/**
 * 박스 밖으로 이어지는 "같은 글자의 잔여분"까지만 지우기 영역을 넓힌다.
 *
 * 모델 좌표가 글자 끝을 살짝 짧게 잡으면 원문 마지막 획이 남는다
 * (실사례: "1050MAH" 의 H 가 남아 "1050MAHH"). 붙어 있는 내용은 통과시키되,
 * 빈 칸(2px 이상)이 나오면 거기서 멈춰 옆 항목은 건드리지 않는다.
 * 넓히는 양은 박스 폭의 15% 이내로 제한 — 옆 단어를 통째로 삼키지 않도록.
 */
export function extendOverLeftover(
  colHasContent: (offset: number) => boolean,
  maxExtend: number,
): number {
  let gap = 0;
  for (let d = 1; d <= maxExtend; d++) {
    if (colHasContent(d)) {
      gap = 0;
    } else {
      gap++;
      if (gap >= 2) return d - gap;
    }
  }
  return maxExtend;
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

/** 가로 구간에서 한 행의 명암 표준편차 — 글자가 있으면 높다 */
function rowStdev(
  px: Uint8ClampedArray,
  W: number,
  H: number,
  y: number,
  x0: number,
  x1: number,
): number {
  if (y < 0 || y >= H || x1 <= x0) return 0;
  let sum = 0;
  let sq = 0;
  let n = 0;
  for (let x = x0; x < x1; x++) {
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










/** 이미지 모델 편집 호출 공통부 — 비율 검증까지 마친 원본 크기 PNG 를 돌려준다 */
async function callImageEdit(
  data: Buffer,
  mime: string,
  prompt: string,
  W: number,
  H: number,
): Promise<Buffer> {
  const parts = await callGemini(
    IMAGE_MODEL,
    [
      { inline_data: { mime_type: mime, data: data.toString("base64") } },
      { text: prompt },
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
  return sharp(out).resize(W, H, { fit: "fill" }).png().toBuffer();
}

/**
 * 글자 박스들을 세로로 뭉쳐 "전체 폭 띠"로 만든다.
 *
 * 안전 필터에 걸린 이미지용 — 필터는 사진(화보)을 보고 거부하는데, 글자는
 * 대부분 사진이 없는 위·아래 띠에 있다. 띠만 잘라 보내면 통과한다.
 * 띠 최소 높이를 보장하는 이유: 이미지 모델은 극단적인 가로 비율(10:1 띠)을
 * 못 그려서 비율 검증에서 전부 반려된다.
 */
export function textBands(
  targets: OcrBox[],
  W: number,
  H: number,
  pad = 24,
  joinGap = 48,
): { y0: number; y1: number; boxes: OcrBox[] }[] {
  if (targets.length === 0) return [];
  const spans = targets
    .map((b) => ({ b, y0: (b.box[0] / 1000) * H, y1: (b.box[2] / 1000) * H }))
    .sort((a, z) => a.y0 - z.y0);

  // 1) 세로로 가까운 문구끼리 뭉친다
  const clusters: { y0: number; y1: number; boxes: OcrBox[] }[] = [];
  for (const s of spans) {
    const last = clusters[clusters.length - 1];
    if (last && s.y0 - last.y1 < joinGap) {
      last.y1 = Math.max(last.y1, s.y1);
      last.boxes.push(s.b);
    } else {
      clusters.push({ y0: s.y0, y1: s.y1, boxes: [s.b] });
    }
  }

  // 2) 여유 + 최소 높이(가로 비율 2.5:1 이내) 보장
  const minH = W * 0.4;
  for (const c of clusters) {
    c.y0 -= pad;
    c.y1 += pad;
    const short = minH - (c.y1 - c.y0);
    if (short > 0) {
      c.y0 -= short / 2;
      c.y1 += short / 2;
    }
    c.y0 = Math.max(0, Math.round(c.y0));
    c.y1 = Math.min(H, Math.round(c.y1));
  }

  // 3) 넓히다 겹쳐진 띠는 다시 합친다
  const merged: typeof clusters = [];
  for (const c of clusters) {
    const last = merged[merged.length - 1];
    if (last && c.y0 <= last.y1) {
      last.y1 = Math.max(last.y1, c.y1);
      last.boxes.push(...c.boxes);
    } else {
      merged.push(c);
    }
  }
  return merged;
}

const clamp1k = (v: number): number => Math.max(0, Math.min(1000, Math.round(v)));

/** 원본 기준 박스 좌표를 띠(잘라낸 부분) 기준 좌표로 옮긴다 — 띠 안 검수용 */
function shiftBoxToBand(b: OcrBox, y0: number, bandH: number, H: number): OcrBox {
  const [ymin, xmin, ymax, xmax] = b.box;
  const py0 = (ymin / 1000) * H - y0;
  const py1 = (ymax / 1000) * H - y0;
  return { ...b, box: [clamp1k((py0 / bandH) * 1000), xmin, clamp1k((py1 / bandH) * 1000), xmax] };
}

/**
 * 글자 띠만 잘라 하나씩 재생성하고, 띠 안에서도 글자 영역만 오려 원본에 얹는다.
 *
 * 실측: 화보 이미지 10장이 안전 필터에 걸려 모델이 이미지를 반환하지 않았다.
 * 필터는 사진을 보고 거부하므로, 사진이 안 든 글자 띠는 통과한다.
 *
 * 띠를 통째로 얹으면 안 된다 — 띠에 딸려 들어간 소품(케이블·설명서)까지
 * 모델이 다시 그려 위치가 밀리고 유령 글자가 생겼다(실측). GIF 정지 패치와
 * 같은 방식으로 글자 영역만 페더링해 얹으면 나머지는 원본 픽셀 그대로다.
 * 통과 못 한 띠만 오버레이로 — 띠 단위라 최악의 경우도 부분 오버레이다.
 */
export async function regenerateByBands(
  data: Buffer,
  mime: string,
  boxes: OcrBox[],
): Promise<{ data: Buffer; mime: string }> {
  const meta = await sharp(data).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) throw new Error("이미지 크기를 읽을 수 없습니다.");

  const targets = boxes.filter((b) => (b.mode ?? "translate") === "translate" && b.ko.trim());
  const bands = textBands(targets, W, H);
  const totalBand = bands.reduce((s, b) => s + (b.y1 - b.y0), 0);
  // 띠가 이미지 대부분을 덮으면 전체 재생성과 다를 게 없다 — 거부도 그대로 재현된다
  if (bands.length === 0 || totalBand / H > 0.85) {
    throw new Error("글자 띠가 이미지 대부분을 덮음");
  }

  const img = await loadImage(data);
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);
  const origPixels = ctx.getImageData(0, 0, W, H).data.slice();

  const overlayLater: OcrBox[] = [];
  for (const band of bands) {
    const bandH = band.y1 - band.y0;
    const crop = await sharp(data)
      .extract({ left: 0, top: band.y0, width: W, height: bandH })
      .png()
      .toBuffer();
    const shifted = band.boxes.map((b) => shiftBoxToBand(b, band.y0, bandH, H));
    let ok = false;
    for (let attempt = 1; attempt <= 2 && !ok; attempt++) {
      try {
        const outPng = await callImageEdit(crop, "image/png", regenPrompt(band.boxes), W, bandH);
        if ((await flaggedBoxes(outPng, "image/png", shifted)).length > 0) continue;
        // 글자 영역만 오려 얹는다 — 띠에 딸려 들어간 소품은 원본 유지
        const regenRaw = new Uint8Array(await sharp(outPng).ensureAlpha().raw().toBuffer());
        const overlay = buildPatchOverlay(regenRaw, W, bandH, shifted.map((b) => gifPatchRect(b, W, bandH)));
        const patchPng = await sharp(overlay, { raw: { width: W, height: bandH, channels: 4 } })
          .png()
          .toBuffer();
        ctx.drawImage(await loadImage(patchPng), 0, band.y0);
        ok = true;
      } catch {
        // 이 띠는 다음 시도 — 두 번 다 안 되면 오버레이로
      }
    }
    if (!ok) overlayLater.push(...band.boxes);
  }
  if (overlayLater.length > 0) paintBoxes(ctx, W, H, overlayLater, origPixels);

  if (mime === "image/png") return { data: canvas.toBuffer("image/png"), mime };
  return { data: canvas.toBuffer("image/jpeg", 90), mime: "image/jpeg" };
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

  // 모델이 만든 그림을 그대로 쓴다. 글자 영역만 오려 붙이던 예전 방식은
  // 결국 "네모를 덧대는" 자국을 남겨서 버렸다 — 모델은 원문 획을 지우고
  // 그 자리 배경까지 다시 그리므로, 통째로 쓸 때가 가장 자연스럽다.
  const png = await callImageEdit(data, mime, regenPrompt(boxes), W, H);
  if (mime === "image/png") return { data: png, mime };
  return { data: await sharp(png).jpeg({ quality: 95 }).toBuffer(), mime: "image/jpeg" };
}

/**
 * 이미지 모델에 문구 교체를 통째로 맡기면 안 되는 경우.
 *
 * 모델은 "이 문구를 저 자리에 이 크기로" 같은 지시를 지키지 못한다. 어드민이
 * 위치·크기·굵기를 손봤거나 "지움"으로 표시했다면 그 지시가 결과의 전부이므로
 * 교체를 맡길 수 없다 — 대신 모델에게 지우기만 시키고 글자는 우리가 그린다.
 * 바꿀 문구가 아예 없을 때도 마찬가지.
 */
export function mustOverlay(boxes: OcrBox[]): boolean {
  if (boxes.some((b) => hasManualOverride(b) || b.mode === "erase")) return true;
  return !boxes.some((b) => (b.mode ?? "translate") === "translate" && b.ko.trim());
}

/** 원본에서 없어져야 하는 항목 — 번역해 갈아끼울 것 + 지우라고 표시된 것 */
export function eraseTargets(boxes: OcrBox[]): OcrBox[] {
  return boxes.filter(
    (b) => b.mode === "erase" || ((b.mode ?? "translate") === "translate" && b.ko.trim()),
  );
}

function erasePrompt(targets: OcrBox[]): string {
  const list = targets.map((b) => `- "${b.zh}"`).join("\n");
  return `이 이미지에서 아래 글자만 깨끗이 지운 이미지를 만들어 주세요.

지울 글자:
${list}

가장 중요한 규칙:
- 지우는 것은 글자 획뿐이다. 글자가 올라앉은 색 띠·배지·버튼·리본·말풍선·장식은
  절대 지우지 말고 그대로 둔다 — 그 위의 글자만 지워 "빈 띠", "빈 배지"로 만든다
- 지운 자리는 글자가 처음부터 없던 것처럼 바로 뒤의 색·그라데이션·사진이 이어지게 메운다
- 지운 자리를 다른 것으로 채우지 말 것 — 도장·스티커·도형·그림·무늬를 새로
  만들어 넣으면 실패다. 글자만 사라진 원래 배경이어야 한다
- 어떤 글자도 새로 그려 넣지 말 것 — 번역문·대체 문구 금지

절대 규칙:
- 지우기 말고는 전부 원본 그대로 — 제품 사진, 모델, 배경, 장식, 도형, 아이콘, 로고, 배지, 띠, 레이아웃, 가로세로 비율, 해상도
- 위 목록에 없는 글자·로고·워터마크는 그대로 둘 것`;
}

/** 모델에게 지우기만 시킨다 — 원본 크기 PNG 반환. 글자는 호출한 쪽이 그린다. */
async function eraseViaModel(data: Buffer, mime: string, targets: OcrBox[]): Promise<Buffer> {
  const meta = await sharp(data).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) throw new Error("이미지 크기를 읽을 수 없습니다.");
  return callImageEdit(data, mime, erasePrompt(targets), W, H);
}

/**
 * 모델 지우기가 글자만 지웠는지 — 지운 자리에 뭔가 지어내는 사고 검출.
 *
 * 실측: "源头工厂" 빨간 글자를 지우랬더니 그 자리에 빨간 도장 그림을 만들어
 * 넣었다. 프롬프트로 금지해도 재발해 픽셀로 검사한다. 글자만 지웠다면 박스
 * 안에서 달라지는 픽셀은 원래 획 언저리뿐이라 대개 3분의 2를 넘지 않는다 —
 * 도장·장식을 지어냈다면 박스 대부분이 달라진다.
 */
export function inventedInBox(
  orig: Uint8Array,
  clean: Uint8Array,
  W: number,
  box: { x0: number; y0: number; x1: number; y1: number },
  tol = 40,
  maxChangedFrac = 0.65,
): boolean {
  const x0 = Math.max(0, Math.round(box.x0));
  const y0 = Math.max(0, Math.round(box.y0));
  const x1 = Math.round(box.x1);
  const y1 = Math.round(box.y1);
  const area = Math.max(1, (x1 - x0) * (y1 - y0));
  let changed = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      const d = Math.max(
        Math.abs(clean[i] - orig[i]),
        Math.abs(clean[i + 1] - orig[i + 1]),
        Math.abs(clean[i + 2] - orig[i + 2]),
      );
      if (d > tol) changed++;
    }
  }
  return changed / area > maxChangedFrac;
}

/** 검수에서 걸린 영역이 우리 박스와 겹치는가 (걸린 영역의 중심이 박스 안) */
export function flaggedHits(flag: [number, number, number, number], it: OcrBox): boolean {
  const cy = (flag[0] + flag[2]) / 2;
  const cx = (flag[1] + flag[3]) / 2;
  const [ymin, xmin, ymax, xmax] = it.box;
  const my = (ymax - ymin) * 0.3;
  const mx = (xmax - xmin) * 0.3;
  return cy >= ymin - my && cy <= ymax + my && cx >= xmin - mx && cx <= xmax + mx;
}

/**
 * 우리가 바꾸라고 시킨 자리에 아직 원문이 남았는지.
 *
 * "이미지에 중국어가 하나라도 보이면 실패"로 보면 안 된다 — 제품 포장·간판·
 * 로고처럼 사진 안에 찍힌 중국어는 번역 대상이 아닌데 검수가 그것까지 집어낸다.
 * 실제로 그렇게 만들었더니 멀쩡한 결과가 4장 중 4장 다 버려졌다.
 *
 * 검사에는 OCR 과 같은 추출기를 쓴다. "외국어로 보이나?"를 모델이 판단하게 했더니
 * 작은 한글까지 깨진 글자로 집어냈고, 정작 "제头工厂"처럼 반만 번역된 것은 놓쳤다.
 */
const TRANSCRIBE_PROMPT = `이 이미지에 보이는 글자를 줄 단위로 모두 그대로 옮겨 적어주세요. 번역하지 마세요.

각 줄마다 JSON 배열 원소로:
- box: [ymin, xmin, ymax, xmax] — 0~1000 정규화
- text: 보이는 그대로 (잘렸으면 잘린 채로, 없는 글자를 채워 넣지 말 것)

글자가 없으면 빈 배열. JSON 배열만 출력.`;

/** 완성본에 실제로 찍힌 글자를 줄 단위로 읽어온다 (원문 잔류·잘림 검사 공용) */
async function transcribeText(
  data: Buffer,
  mime: string,
): Promise<{ box: [number, number, number, number]; text: string }[]> {
  const parts = await callGemini(
    MODEL,
    [{ inline_data: { mime_type: mime, data: data.toString("base64") } }, { text: TRANSCRIBE_PROMPT }],
    { maxOutputTokens: 8000, responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "minimal" } },
  );
  const raw = jsonArrayOf(parts);
  if (!Array.isArray(raw)) return [];
  const out: { box: [number, number, number, number]; text: string }[] = [];
  for (const r of raw) {
    const row = r as Record<string, unknown>;
    const box = row?.box;
    const text = String(row?.text ?? "");
    if (!Array.isArray(box) || box.length !== 4 || !text) continue;
    const nums = box.map(Number);
    if (nums.some((n) => !Number.isFinite(n) || n < 0 || n > 1000)) continue;
    out.push({ box: nums as [number, number, number, number], text });
  }
  return out;
}

/** 비교용 정규화 — 공백·문장부호는 모델이 흘리기 쉬워 뺀다 */
const forCompare = (s: string): string => s.replace(/[\s.,·:;!?()[\]{}'"“”‘’\-–—/+]/g, "");

/**
 * 기대한 문구가 실제로 다 찍혔는지 0~1 로 — 순서를 지킨 최장 공통 부분수열 비율.
 *
 * 실사례: "쉴 새 없는 파도처럼" 이 자리에 안 맞자 모델이 "쉴 새 없는 ㅈ" 로 잘라
 * 그렸다. 중국어가 아니라 검수를 그냥 통과했다. 글자 수로만 보면 잘림을 놓치므로
 * (모델이 다른 말을 지어내도 길이는 맞을 수 있다) 순서까지 보는 비율을 쓴다.
 */
export function textCoverage(expected: string, observed: string): number {
  const e = forCompare(expected);
  const o = forCompare(observed);
  if (e.length === 0) return 1;
  if (o.length === 0) return 0;
  // LCS 길이 (행 하나만 굴린다)
  let prev = new Uint16Array(o.length + 1);
  let cur = new Uint16Array(o.length + 1);
  for (let i = 1; i <= e.length; i++) {
    for (let j = 1; j <= o.length; j++) {
      cur[j] = e[i - 1] === o[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  return prev[o.length] / e.length;
}

/** 이 아래로 떨어지면 문구가 잘렸거나 딴 말이 찍힌 것 (OCR 오차 여유 포함) */
const COVERAGE_MIN = 0.8;

/**
 * 뒤가 잘렸는지 — 찍힌 글자가 기대 문구의 "앞부분 그대로"인데 짧을 때.
 *
 * 비율만 보면 짧은 문구의 잘림을 놓친다: "앞뒤 10단계 진동, 쉼 없는 자극"에서
 * "자극"이 날아가도 12자 중 10자라 0.83 이라 통과했다(실측). 앞부분이 정확히
 * 일치하면서 뒤가 없는 건 OCR 오차가 아니라 잘림이므로 따로 잡는다.
 * 한 글자 차이는 OCR 이 끝 글자를 흘린 것일 수 있어 두 글자부터 본다.
 */
export function truncatedTail(expected: string, observed: string, minMissing = 2): boolean {
  const e = forCompare(expected);
  const o = forCompare(observed);
  return o.length > 0 && e.length - o.length >= minMissing && e.startsWith(o);
}

/**
 * 다시 손봐야 하는 문구를 고른다 — 원문이 남았거나, 번역문이 잘렸거나.
 *
 * 두 검사 모두 "완성본에 찍힌 글자"에서 나오므로 모델 호출은 한 번이다.
 */
async function flaggedBoxes(
  out: Buffer,
  mime: string,
  targets: OcrBox[],
  /** 번역문이 다 찍혔는지도 볼지. 글자를 아직 안 그린 "지우기 결과"에는 끈다 */
  checkCoverage = true,
): Promise<OcrBox[]> {
  try {
    const lines = await transcribeText(out, mime);
    if (lines.length === 0) return [];
    return targets.filter((b) => {
      const hits = lines.filter((l) => flaggedHits(l.box, b));
      if (hits.some((l) => isForeignSource(l.text))) return true; // 원문 잔류
      if (!checkCoverage || hits.length === 0) return false; // 못 읽은 자리는 건드리지 않는다
      const seen = hits.map((l) => l.text).join(" ");
      return textCoverage(b.ko, seen) < COVERAGE_MIN || truncatedTail(b.ko, seen);
    });
  } catch {
    // 검수 자체가 실패하면 결과를 살린다 (검수는 보강 장치일 뿐)
    return [];
  }
}

async function leftoverInBoxes(
  out: Buffer,
  mime: string,
  targets: OcrBox[],
  checkCoverage = true,
): Promise<boolean> {
  return (await flaggedBoxes(out, mime, targets, checkCoverage)).length > 0;
}

/** 번역 이미지를 만든다. 문구 수정 후 재생성에도 그대로 쓴다. */
export async function renderTranslatedImage(
  data: Buffer,
  mime: string,
  boxes: OcrBox[],
  /**
   * false 로 주면 이미지 모델을 쓰지 않고 글자를 직접 그린다(오버레이).
   *
   * 기본은 모델 재생성이다. 오버레이는 원문 획을 지운 자리를 우리가 메워야
   * 해서 배경이 흐르는 곳마다 덧댄 자국이 남았다 — 어떤 색으로 메울지를
   * 아무리 고쳐도 없앨 수 없는 한계였다. 모델은 배경까지 다시 그리므로
   * 자국이 아예 생기지 않는다(실상품 이미지로 확인).
   */
  opts: { regenerate?: boolean } = {},
): Promise<{ data: Buffer; mime: string }> {
  ensureFonts();
  if (mime === "image/gif") return renderGif(data, boxes);
  if (opts.regenerate === false) return renderStill(data, mime, boxes);

  const removals = eraseTargets(boxes);
  if (removals.length === 0) return renderStill(data, mime, boxes); // 지울 것도 그릴 것도 없다

  // 어드민이 위치·크기·굵기를 손댔거나 "지움"을 표시했으면 문구 교체를 모델에
  // 맡길 수 없다. 대신 지우기만 시키고, 그 위에 지시대로 우리가 그린다 —
  // 지우기는 모델이 자국 없이 잘하고, 지시는 우리가 그려야 정확히 지켜진다.
  if (mustOverlay(boxes)) {
    const om = await sharp(data).metadata();
    const W = om.width ?? 0;
    const H = om.height ?? 0;
    const origRaw = W && H ? new Uint8Array(await sharp(data).ensureAlpha().raw().toBuffer()) : null;
    let reason = "";
    for (let attempt = 1; attempt <= REGEN_ATTEMPTS; attempt++) {
      try {
        const cleaned = await eraseViaModel(data, mime, removals);
        if (await leftoverInBoxes(cleaned, "image/png", removals, false)) {
          reason = "원문이 남음";
          continue;
        }
        if (origRaw) {
          const cleanRaw = new Uint8Array(await sharp(cleaned).ensureAlpha().raw().toBuffer());
          if (removals.some((b) => inventedInBox(origRaw, cleanRaw, W, toPixelBox(b.box, W, H)))) {
            reason = "지운 자리에 장식을 지어냄";
            continue;
          }
        }
        return drawTextOnly(cleaned, mime, boxes);
      } catch (e) {
        reason = e instanceof Error ? e.message : String(e);
      }
    }
    console.warn(`[imageTranslate] 모델 지우기 실패(${REGEN_ATTEMPTS}회) — 오버레이 폴백: ${reason}`);
    return renderStill(data, mime, boxes);
  }

  // 모델은 가끔 원문을 지우지 않고 한국어를 덧붙인다(빽빽한 스펙표에서 관측).
  // 검수에서 걸리면 한 번 더 뽑고, 그래도 남으면 오버레이로 내려간다 —
  // 중국어가 남은 이미지를 내보내느니 자국이 조금 있는 편이 낫다.
  const verifyTargets = boxes.filter((b) => (b.mode ?? "translate") === "translate" && b.ko.trim());
  let reason = "";
  let refused = false;
  for (let attempt = 1; attempt <= REGEN_ATTEMPTS; attempt++) {
    try {
      const out = await regenerateStill(data, mime, boxes);
      const flagged = await flaggedBoxes(out.data, out.mime, verifyTargets);
      if (flagged.length === 0) return out;
      // 소수만 걸렸으면 그 문구만 오버레이로 고친다 — 한 문구 때문에
      // 재생성 전체를 버리는 게 실측 폴백 7건 중 대부분의 원인이었다
      if (flagged.length <= Math.max(1, Math.floor(verifyTargets.length / 3))) {
        console.warn(`[imageTranslate] 재생성에 ${flagged.length}개 문구 잔류 — 그 문구만 오버레이 보정`);
        return renderStill(out.data, out.mime, flagged);
      }
      reason = `원문이 남음 (${flagged.length}/${verifyTargets.length})`;
    } catch (e) {
      reason = e instanceof Error ? e.message : String(e);
      // 안전 필터 거부는 같은 그림을 다시 보내도 똑같이 거부한다 — 즉시 띠 모드로
      if (reason.includes("반환하지 않음")) {
        refused = true;
        break;
      }
    }
  }
  if (refused) {
    try {
      return await regenerateByBands(data, mime, boxes);
    } catch (e) {
      reason = `띠 재생성도 실패: ${e instanceof Error ? e.message : e}`;
    }
  }
  console.warn(`[imageTranslate] 재생성 실패(${REGEN_ATTEMPTS}회) — 오버레이 폴백: ${reason}`);
  return renderStill(data, mime, boxes);
}
