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
 *  - 테두리가 거의 균일하면(단색 카드·버튼) 그 색으로 채운다 → 경계가 안 보인다
 *  - 테두리가 변하면(그라데이션·사진) 네 변에서 이중선형 보간해 결을 잇는다
 */
export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 배경으로 볼 수 없을 만큼 튀는 표본으로 판단하는 기준 (0~255) */
const OUTLIER = 24;

export function borderUniformity(samples: number[][]): { uniform: boolean; color: [number, number, number] } {
  if (samples.length === 0) return { uniform: true, color: [255, 255, 255] };
  /*
   * 평균이 아니라 중앙값을 쓴다.
   * 글자가 박스 테두리에 닿아 있으면 표본에 글자 획이 섞여 들어오는데,
   * 평균은 그것에 끌려가고 표준편차도 커져 "그라데이션"으로 오판한다.
   * 그러면 보간이 글자 색을 박스 전체로 늘려 줄무늬를 만든다(실사례:
   * "직경 3CM" 줄이 지워지지 않고 획이 늘어나 한글과 겹쳐 보였다).
   * 중앙값은 표본 절반이 배경이면 배경색을 그대로 집는다.
   */
  const color = [0, 1, 2].map((c) => Math.round(median(samples.map((s) => s[c])))) as [
    number,
    number,
    number,
  ];
  const dev = samples.map((s) =>
    Math.max(Math.abs(s[0] - color[0]), Math.abs(s[1] - color[1]), Math.abs(s[2] - color[2])),
  );
  const kept = samples.filter((_, i) => dev[i] <= OUTLIER);
  const spread = kept.length
    ? Math.sqrt(
        kept.reduce((t, s) => t + [0, 1, 2].reduce((u, c) => u + (s[c] - color[c]) ** 2, 0) / 3, 0) /
          kept.length,
      )
    : Infinity;
  return {
    // 표본 절반 이상이 한 색에 모이고 퍼짐이 작으면 단색 — 그 색으로 칠해도 티가 안 난다
    uniform: kept.length >= samples.length * 0.5 && spread <= 10,
    color,
  };
}

/**
 * 박스 바깥 1~3px 링의 픽셀 표본.
 * 1px 만 보면 글자가 테두리에 닿았을 때 표본이 통째로 오염된다.
 */
function sampleBorder(d: Uint8ClampedArray, W: number, H: number, b: PxBox): number[][] {
  const x0 = Math.round(b.x0);
  const y0 = Math.round(b.y0);
  const x1 = Math.round(b.x1);
  const y1 = Math.round(b.y1);
  const out: number[][] = [];
  const at = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    out.push([d[i], d[i + 1], d[i + 2]]);
  };
  const stepX = Math.max(1, Math.floor((x1 - x0) / 24));
  const stepY = Math.max(1, Math.floor((y1 - y0) / 24));
  for (let o = 1; o <= 3; o++) {
    for (let x = x0; x <= x1; x += stepX) { at(x, y0 - o); at(x, y1 + o); }
    for (let y = y0; y <= y1; y += stepY) { at(x0 - o, y); at(x1 + o, y); }
  }
  return out;
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

/** 박스 영역의 원문을 지운다 (배경을 주변에서 추정해 채움) */
function eraseRegion(ctx: SKRSContext2D, width: number, height: number, b: PxBox): void {
  const x0 = Math.max(0, Math.round(b.x0));
  const y0 = Math.max(0, Math.round(b.y0));
  const x1 = Math.min(width, Math.round(b.x1));
  const y1 = Math.min(height, Math.round(b.y1));
  if (x1 - x0 < 2 || y1 - y0 < 2) return;

  const img = ctx.getImageData(0, 0, width, height);
  const { uniform, color } = borderUniformity(sampleBorder(img.data, width, height, b));
  if (uniform) {
    ctx.fillStyle = `rgb(${color[0]},${color[1]},${color[2]})`;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    return;
  }
  eraseBilinear(img.data, width, height, b);
  ctx.putImageData(img, 0, 0);
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
    eraseRegion(ctx, width, height, b);
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
    // 프레임마다 그 프레임의 원본 픽셀 기준으로 잔여 획을 판단한다
    paintBoxes(ctx, width, height, boxes, ctx.getImageData(0, 0, width, height).data.slice());
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

function regenPrompt(boxes: OcrBox[]): string {
  // 유지·지움으로 지정한 항목은 재생성 대상에서 빼야 모델이 건드리지 않는다
  const tlist = boxes
    .filter((b) => (b.mode ?? "translate") === "translate" && b.ko.trim())
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

/**
 * 씨앗으로 지목된 사각형과 맞닿은 사각형들을 전부 끌어모은다(전이적).
 *
 * 왜 필요한가: 재생성 패치는 박스마다 여유를 두고 칠하므로 이웃 박스 영역을
 * 침범한다. 검수에 걸린 박스만 원본으로 되돌리면, 이웃이 침범해 그려 놓은
 * 글자는 되돌림 범위 밖이라 그대로 남고, 그 위에 다시 그리게 된다 →
 * 같은 문구가 두 번 찍힌다(실사례: "직경 3CM"이 작게·크게 이중 렌더).
 * 맞닿은 것끼리 한 덩어리로 묶어 함께 되돌리고 함께 다시 그려야 한다.
 */
export function groupTouching(rects: PxBox[], seed: number[]): number[] {
  const touches = (a: PxBox, b: PxBox) =>
    a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
  const chosen = new Set(seed);
  for (let grew = true; grew; ) {
    grew = false;
    for (let i = 0; i < rects.length; i++) {
      if (chosen.has(i)) continue;
      for (const j of chosen) {
        if (touches(rects[i], rects[j])) {
          chosen.add(i);
          grew = true;
          break;
        }
      }
    }
  }
  return [...chosen].sort((a, b) => a - b);
}

/** 재생성 패치가 실제로 칠하는 사각형 (박스 + 합성 여유) */
function patchRect(it: OcrBox, W: number, H: number): PxBox {
  const p = toPixelBox(it.box, W, H);
  const { padX, padY } = compositeParams(p.x1 - p.x0, p.y1 - p.y0);
  return {
    x0: Math.max(0, p.x0 - padX),
    y0: Math.max(0, p.y0 - padY),
    x1: Math.min(W, p.x1 + padX),
    y1: Math.min(H, p.y1 + padY),
  };
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
  const active = boxes.filter((b) => {
    const mode = b.mode ?? "translate";
    if (mode === "keep") return false; // 손대지 않음
    return mode === "erase" || b.ko.trim().length > 0;
  });
  const useOverlay = (b: OcrBox): boolean => {
    // 어드민이 지움·위치·크기·굵기를 손댄 항목은 재생성이 지킬 수 없다
    if (hasManualOverride(b)) return true;
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
  if (overlayBoxes.length > 0) paintBoxes(ctx, W, H, overlayBoxes, origPixels);

  // 자동 검수 — 재생성이 문구를 빠뜨리거나 뭉갠 박스를 잡아 재처리한다
  if (verify && patchBoxes.length > 0) {
    try {
      const flags = await detectForeignText(canvas.toBuffer("image/png"));
      const seed = patchBoxes
        .map((b, i) => (flags.some((f) => flaggedHits(f, b)) ? i : -1))
        .filter((i) => i >= 0);
      if (seed.length > 0) {
        // 패치 영역이 맞닿은 이웃까지 함께 되돌린다 — 안 그러면 이웃이 흘린
        // 글자가 남아 그 위에 다시 그려진다(같은 문구 이중 렌더)
        const rects = patchBoxes.map((b) => patchRect(b, W, H));
        const bad = groupTouching(rects, seed).map((i) => patchBoxes[i]);
        const horiz = bad.filter((b) => !isVerticalBox(b.box, W, H));

        const img = ctx.getImageData(0, 0, W, H);
        for (const it of bad) restoreOne(img.data, origPixels, it, W, H);
        ctx.putImageData(img, 0, 0);
        // 세로쓰기는 원본 유지 (오버레이가 세로를 못 그림)
        if (horiz.length > 0) paintBoxes(ctx, W, H, horiz, origPixels);

        // 재처리 뒤에도 남으면 깨진 이미지를 내보내느니 전체를 오버레이로 다시
        // 만든다 — 모델 호출이 없어 결과가 항상 같고, 실측에서 가장 깨끗했다
        const after = await detectForeignText(canvas.toBuffer("image/png"));
        if (active.some((b) => after.some((f) => flaggedHits(f, b)))) {
          return renderStill(originalData, mime, active);
        }
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
  /**
   * 이미지 모델로 글자 영역을 다시 그리게 할지.
   *
   * 기본은 끔. 재생성은 결과가 매번 달라서 같은 이미지도 됐다 깨졌다 한다 —
   * 실측에서 원문이 안 지워진 채 한글이 겹쳐 그려지거나 같은 문구가 두 번
   * 찍히는 사고가 났다. 지우기를 픽셀 기반으로 고친 뒤로는 덧그리기 쪽이
   * 원본 배지·장식까지 그대로 남기면서 결과도 항상 같다.
   */
  opts: { regenerate?: boolean } = {},
): Promise<{ data: Buffer; mime: string }> {
  ensureFonts();
  if (mime === "image/gif") return renderGif(data, boxes);
  if (!opts.regenerate) return renderStill(data, mime, boxes);
  try {
    return await regenerateStill(data, mime, boxes);
  } catch (e) {
    // 이미지 모델 실패(한도·비율 붕괴 등) 시 오버레이 방식으로라도 결과를 준다
    console.warn(`[imageTranslate] 재생성 실패 — 오버레이 폴백: ${e instanceof Error ? e.message : e}`);
    return renderStill(data, mime, boxes);
  }
}
