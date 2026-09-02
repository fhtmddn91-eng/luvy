import "server-only";
import path from "node:path";
import crypto from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  mergeOcrPasses,
  numbersPreserved,
  newTextLines,
  extraTextInBox,
  outsidePatchDiff,
  buildMeaningPrompt,
  buildRenderedMeaningPrompt,
  renderedTextMatches,
  parseMeaningVerdicts,
  buildCorrectiveRetranslatePrompt,
  correctionRejected,
  meaningFailureDetail,
  detectTextLikeRegions,
  isLowConfidenceRegion,
  unexplainedTextRegions,
  buildPreserveList,
  rectHitsPreserved,
  preservedPixelDiff,
  preservedTextIntact,
  blocksRender,
  preRenderMappingIssues,
  matchExpectedLine,
  matchExpectedSegments,
  parseSingleVerdict,
  unexpectedOutputLines,
  forCompareText,
  buildProductIntegrityPrompt,
  buildBandQualityPrompt,
  type CorrectionItem,
  type PreservedItem,
  type TextLikeRegion,
} from "./translateVerify";
import type { ReviewReason } from "./productPublishGate";


/**
 * 자동 흐름의 이미지 API HTTP 요청 상한 — **원본당 1회** (설계 2026-08-24 v2.1).
 * 정의: 캐시 미스이고 렌더 전 검수를 통과한 원본당 최대 1회. 렌더 전 실패·캐시
 * 적중은 0회다. 실패해도 상태 코드와 무관하게 자동 재요청하지 않는다 — 예전
 * 재시도 사다리(장당 6회, HTTP 12회)가 주 ₩10만 사고의 뿌리였다.
 */
const MAX_IMAGE_CALLS_PER_ASSET = 1;
/** 출력 1K 공식 단가 $0.067/이미지 + 입력 토큰(미측정) — 로그 표기용 추정치 */
const IMAGE_CALL_COST_USD = 0.067;
const imageBudget = new AsyncLocalStorage<{ left: number; used: number }>();
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
// 429(월 지출 한도 포함)는 재시도하지 않는다 — 같은 실행 안에서는 다음 요청도
// 반드시 429 라서, 재시도는 요청 수만 12배로 불렸다(live1 실측: 429 를 12회 반복).
// 인증 오류(401·403)도 같다. 5xx·타임아웃만 일시 오류로 본다.
const RETRYABLE_STATUS = new Set([500, 502, 503, 504]);
/** 이후 호출도 성공할 수 없는 오류 — 띠 폴백·재추출 없이 즉시 중단해야 한다 */
export function isFatalApiError(msg: string): boolean {
  return /API 오류 (429|401|403)/.test(msg);
}
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
  /**
   * 반투명 워터마크(회사명·상호 도장) — OCR 이 자동으로 지움 표시한 항목.
   * 예전에는 번역 대상에서 제외해 그대로 남겼는데, 완성본에 한자가 희미하게
   * 남는 게 결함으로 보인다는 피드백에 따라 지운다. 번역하지 않고 지우기만
   * 하며(mode=erase), 어드민 수동 지움과 달리 기본 재생성 경로를 그대로 탄다.
   */
  wm?: boolean;

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
  // 워터마크 자동 지움(wm + erase)은 어드민 지시가 아니다 — 수동 취급하면
  // 워터마크가 있는 모든 이미지가 오버레이 경로로 빠져 글자 품질이 떨어진다
  const modeTouched = b.mode !== undefined && b.mode !== "translate" && !(b.wm === true && b.mode === "erase");
  return (
    modeTouched ||
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
      ...(r.wm === true ? { wm: true } : {}),
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
  /** attempts: 이미지 호출은 시간 초과가 잦아 3회면 장당 4분 넘게 붙잡는다 — 줄여 쓸 수 있게 */
  opts: { attempts?: number } = {},
): Promise<GeminiPart[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 미설정");

  // 이미지 모델은 상태 코드와 무관하게 HTTP 1회 — 429·5xx·타임아웃도 재요청하지
  // 않는다(오류·타임아웃 요청의 과금 여부를 공식 문서로 확인하지 못해, 절감을
  // 과금 가정이 아니라 요청 수 제한에 건다). 텍스트 모델 재시도는 유지.
  const isImage = model === IMAGE_MODEL;
  const maxAttempts = isImage ? 1 : (opts.attempts ?? MAX_ATTEMPTS);
  let lastNote = "응답 없음";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) await sleep(RETRY_DELAY_MS[attempt - 2] ?? 4_000);
    // 예산 차감은 HTTP 요청 직전 — "논리 호출"이 아니라 실제 요청 수를 센다
    if (isImage) {
      const b = imageBudget.getStore();
      if (b) {
        if (b.left <= 0) throw new Error(`이미지 호출 예산 소진(장당 ${MAX_IMAGE_CALLS_PER_ASSET}회) — 원본 유지`);
        b.left--;
        b.used++;
      }
    }
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
        // 상태 코드만 남기면 429 가 분당인지 일간·월간인지 알 수 없어 운영자가 언제
        // 재시도할지 판단할 수 없다 (live11 실측: 429 3장인데 종류 미상). 본문의
        // error.status/message 와 Retry-After 헤더를 함께 싣는다 — 키는 요청 헤더에만
        // 있고 응답 본문엔 없으므로 비밀값 유출 경로가 아니다.
        let detail = "";
        try {
          const body = (await res.json()) as { error?: { status?: string; message?: string } };
          const st = body.error?.status ?? "";
          const msg = (body.error?.message ?? "").slice(0, 160);
          const retry = res.headers?.get?.("retry-after") ?? "";
          detail = [st, msg, retry ? `retry-after=${retry}` : ""].filter(Boolean).join(" | ");
        } catch {
          /* 본문이 JSON 이 아니면 상태 코드만 */
        }
        lastNote = `API 오류 ${res.status}${detail ? ` (${detail})` : ""}`;
        if (RETRYABLE_STATUS.has(res.status)) continue;
        throw new Error(lastNote);
      }
      type SafetyRating = { category?: string; probability?: string };
      const json = (await res.json()) as {
        candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string; safetyRatings?: SafetyRating[] }[];
        promptFeedback?: { blockReason?: string; safetyRatings?: SafetyRating[] };
      };
      const out = json.candidates?.[0]?.content?.parts ?? [];
      if (out.length === 0) {
        // 안전 필터 차단은 "글자 없음"이 아니다 — 빈 배열로 돌려주면 OCR 이
        // "번역할 텍스트가 없다"로 오판한다 (운영 신고: 중국어가 선명한 이미지
        // 4장이 "찾지 못했습니다"로 반려). 이유를 실어 던져 호출자가 가르게 한다.
        //
        // blockReason(프롬프트 자체 차단)과 finishReason=SAFETY(생성 중단)는 다른
        // 신호다 — 뭉뚱그리면 어느 단계에서 걸렸는지 알 수 없어 국소 폴백의
        // 대상 선정을 튜닝할 수 없다. safetyRatings 도 같이 남긴다.
        const block = json.promptFeedback?.blockReason;
        const finish = json.candidates?.[0]?.finishReason;
        const reason = block ?? finish;
        if (reason && reason !== "STOP") {
          const ratings = (json.promptFeedback?.safetyRatings ?? json.candidates?.[0]?.safetyRatings ?? [])
            .filter((r) => r.probability && r.probability !== "NEGLIGIBLE")
            .map((r) => `${(r.category ?? "").replace("HARM_CATEGORY_", "")}:${r.probability}`)
            .join(",");
          const kind = block ? "block=프롬프트 차단" : "finish=생성 중단";
          throw new Error(`모델 거부(${reason}) [${kind}${ratings ? ` | ${ratings}` : ""}]`);
        }
      }
      return out;
    } catch (e) {
      // 같은 입력엔 같은 거부가 돌아온다 — 재시도 낭비 없이 바로 알린다
      if (e instanceof Error && (e.message.startsWith("API 오류") || e.message.startsWith("모델 거부"))) throw e;
      lastNote = ctrl.signal.aborted ? "시간 초과" : e instanceof Error ? e.message : String(e);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`${lastNote} (${maxAttempts}회 시도)`);
}

function textOf(parts: GeminiPart[]): string {
  return parts.map((p) => p.text ?? "").join("").trim();
}

function jsonArrayOf(parts: GeminiPart[]): unknown {
  const m = textOf(parts).match(/\[[\s\S]*\]/);
  return m ? JSON.parse(m[0]) : [];
}

/**
 * 객체 배열 JSON 응답을 관대하게 파싱한다 — 온전한 원소만 건진다.
 *
 * 문구가 많은 이미지(실측 37개)는 응답이 토큰 한도에서 잘려 마지막 원소가
 * 깨진 채 온다. 통째 JSON.parse 는 전부 버리고, 그 결과 검수가 "판독 실패 —
 * 무검수 통과"로 짤림·잔류를 그대로 내보냈다(운영 신고). null 은 "JSON 이
 * 아예 없음"(거부·빈 응답) — 빈 배열(글자 없음)과 구분해야 한다.
 *
 * 번역처럼 입력과 1:1 순서 대응이 필요한 곳에는 쓰면 안 된다 — 중간 원소가
 * 빠지면 어긋난 번역이 조용히 붙는다. 좌표를 각자 들고 다니는 OCR·검수 전용.
 */
export function parseJsonArrayLoose(text: string): unknown[] | null {
  const open = text.match(/\[[\s\S]*/);
  if (!open) return null;
  const closed = text.match(/\[[\s\S]*\]/);
  if (closed) {
    try {
      const full = JSON.parse(closed[0]);
      if (Array.isArray(full)) return full;
    } catch {
      /* 아래에서 원소 단위로 건진다 */
    }
  }
  const rows: unknown[] = [];
  for (const om of open[0].matchAll(/\{[^{}]*\}/g)) {
    try {
      rows.push(JSON.parse(om[0]));
    } catch {
      /* 깨진 원소는 버린다 — 좌표·문구가 온전한 것만 쓴다 */
    }
  }
  return rows;
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
- 사진 위에 반투명하게 깔린 중국어 워터마크(회사명·상호 도장)도 빠짐없이 —
  이런 항목은 wm: true 로 표시하세요 (번역하지 않고 지우는 대상입니다)
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
- wm: 반투명 워터마크면 true (아니면 생략)

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
      // 흑백 명도 편차만 보면 "분홍 배경 위 분홍 글씨"처럼 색상으로만 구분되는
      // 문구가 0에 가깝게 나와 진짜 글자를 오탐으로 버렸다(운영 신고: 장식
      // 문구 이미지가 "글자 없음" 반려). 채널별 편차의 최댓값으로 본다 —
      // 민 배경은 어느 채널이든 편차가 작으므로 오탐 필터 기능은 그대로다.
      const stats = await sharp(src).extract({ left, top, width, height }).stats();
      const spread = Math.max(...stats.channels.slice(0, 3).map((c) => c?.stdev ?? 0));
      // 워터마크는 반투명이라 대비가 원래 약하다 — 일반 기준을 적용하면
      // 정작 지워야 할 워터마크가 "글자 없음"으로 빠진다. 완전 민 배경만 거른다.
      if (spread >= (b.wm ? 6 : MIN_TEXT_STDDEV)) kept.push(b);
    } catch {
      kept.push(b); // 측정 실패 시엔 살려둔다 (어드민이 문구 수정으로 지울 수 있다)
    }
  }
  return kept;
}

/**
 * 이 박스에 무리 없이 들어가는 한국어 글자 수.
 *
 * 예전 규칙은 "원문 글자수를 넘지 마라"였는데, 운영 데이터 732개 문구를 재보니
 * **91%가 이걸 어겼다** — 한국어는 원문보다 길어지는 게 정상이라(중앙값 1.31배)
 * 지킬 수 없는 규칙이었고, 지켜지지 않는 규칙은 모델에게 "여기 규칙은 대충 봐도
 * 된다"고 가르친다. 실측 분포에 맞춰 다시 잡았다:
 *   - 원문 대비 1.6배 (95퍼센타일이 2.25배, 여기서 자르면 상위 2.3%만 걸린다)
 *   - 박스 수용량(폭÷높이) 대비 2.2배 — 글자가 박스 높이의 절반 크기까지
 *     줄어드는 선. 이보다 길면 깨알이 되거나 모델이 뒷말을 잘라버린다(실사례).
 * 둘 중 큰 값을 쓴다 — 넓은 박스에서 굳이 짧게 쥐어짤 이유는 없다.
 */
export function charBudget(
  box: [number, number, number, number],
  W: number,
  H: number,
  zhLen: number,
  /**
   * tight: **GIF 띠 전용**으로 더 조인 예산.
   *
   * 기본 예산은 "글자가 박스 높이의 절반까지 작아져도 된다"(수용량 ×2.2)를
   * 허용한다. 정지 이미지는 판 전체를 다시 그리므로 모델이 줄바꿈·자간으로
   * 흡수하지만, GIF 는 **띠 폭이 정지 영역에 갇혀** 있어 넓힐 수가 없다.
   * 그러면 모델이 글자를 줄여 넣는 수밖에 없다 — 실측(2026-09-02):
   * 「多种频率」(4자)를 「다양한 진동 모드」(8자)로 옮긴 띠에서 글자가 원본의
   * **61%** 로 작아졌다. 자리에 안 들어갈 문구는 이미지 단계가 아니라 **번역
   * 단계에서** 짧게 만드는 게 규칙 1이다("진동 모드"면 원래 크기로 들어간다).
   */
  tight = false,
): number {
  const [ymin, xmin, ymax, xmax] = box;
  const bw = ((xmax - xmin) / 1000) * W;
  const bh = ((ymax - ymin) / 1000) * H;
  // 세로쓰기는 글자를 쌓으므로 폭÷높이가 수용량이 아니다 — 원문 기준만 본다
  const vertical = bh > bw * 2.5;
  if (tight) {
    // 원본 글자 크기를 유지하며 들어갈 수 있는 만큼 (수용량 ×1.2 = 살짝의 자간 압축)
    const cap = vertical || bh <= 0 ? 0 : Math.ceil((bw / bh) * 1.2);
    return Math.max(4, Math.ceil(zhLen * 1.2), cap);
  }
  const capacity = vertical || bh <= 0 ? 0 : Math.ceil((bw / bh) * 2.2);
  return Math.max(6, Math.ceil(zhLen * 1.6), capacity);
}

interface TranslateOpts {
  /** 항목별 최대 글자 수 — 이미지에 들어갈 자리가 정해져 있다 */
  budgets?: number[];
  /** 앞선 답에 한자가 남았을 때 */
  strict?: boolean;
  /** 앞선 답이 길이 예산을 넘었을 때 */
  shorten?: boolean;
}

function translatePrompt(items: string[], opts: TranslateOpts): string {
  const { budgets, strict, shorten } = opts;
  const list = budgets
    ? items.map((t, i) => `${i + 1}. "${t}" → 최대 ${budgets[i]}자`).join("\n")
    : JSON.stringify(items);
  return `중국 상품 상세페이지 이미지에서 추출한 문구 목록입니다. 각각 한국어로 번역하세요.

규칙:
- 한국 성인용품 도매몰 상세페이지에서 실제로 쓰는 자연스러운 표현으로
- **숫자·단위·모델명은 원문 그대로 유지** (53MIN, 3.7V, SHD-S549 등을 절대 바꾸거나 빼지 마세요)
- **항목마다 적힌 "최대 N자"를 공백 포함해서 지키세요.** 원문이 있던 자리에 그대로
  들어가야 합니다. 넘치면 글씨가 깨알이 되거나 뒷말이 잘려 나갑니다${
    shorten ? "\n- 이전 답이 이 한도를 넘었습니다. 뜻을 지키되 더 짧은 말로 바꾸세요." : ""
  }
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
${list}`;
}

async function translateTexts(items: string[], opts: TranslateOpts = {}): Promise<string[]> {
  const parts = await callGemini(MODEL, [{ text: translatePrompt(items, opts) }], {
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
 * 검수 지적을 반영한 교정 재번역 — 실패 문구 전체를 **배치 텍스트 요청 1회**로.
 * live2 실측(2026-08-24): 지적 없이 같은 프롬프트로 재번역하니 5문구 × 2회가
 * 글자 하나 안 다른 동일 답이었다 — 검수 기준이 번역기의 자연 출력보다 높은
 * 문구는 지적을 되먹이지 않으면 영원히 통과할 수 없다.
 */
async function retranslateWithIssues(items: CorrectionItem[]): Promise<string[]> {
  const parts = await callGemini(MODEL, [{ text: buildCorrectiveRetranslatePrompt(items) }], {
    maxOutputTokens: 4000,
    responseMimeType: "application/json",
    thinkingConfig: { thinkingLevel: "minimal" },
  });
  const raw = jsonArrayOf(parts);
  if (!Array.isArray(raw) || raw.length !== items.length) {
    throw new Error(`교정 재번역 개수 불일치 (${items.length} → ${Array.isArray(raw) ? raw.length : "?"})`);
  }
  return raw.map((s) => String(s ?? "").trim().slice(0, 200));
}

/**
 * 예산을 넘긴 문구만 골라 한 번 더 짧게 받는다.
 *
 * 길이 문제를 여기서 잡는 게 핵심이다 — 글자 수 검사는 공짜이고 재번역은
 * 텍스트 호출(거의 무료)인 반면, 길어서 이미지 생성이 잘리면 그림을 통째로
 * 다시 뽑아야 한다(장당 ~$0.04). 싼 단계에서 막아 비싼 단계를 살린다.
 */
function overBudget(koList: string[], budgets: number[]): number[] {
  return koList.map((ko, i) => ([...ko].length > budgets[i] ? i : -1)).filter((i) => i >= 0);
}

/**
 * 이미지에서 중국어 텍스트를 찾아 번역한다 (추출 → 번역 2단계).
 * GIF 는 Gemini 가 받지 않으므로 첫 프레임을 PNG 로 뽑아 보낸다
 * (이 상세 GIF 들은 글자가 고정이고 제품만 움직이는 구조 — 실물로 확인).
 */
/** OCR 띠 분할 [시작, 높이] 비율 — 겹치게 잘라 경계에 걸린 문구도 어느 한 띠에는 온전히 들어가게 */
export const OCR_BANDS: [number, number][] = [
  [0, 0.45],
  [0.3, 0.45],
  [0.55, 0.45],
];

/** 띠 안(0~1000) 좌표를 전체 이미지 기준으로 되돌린다 */
export function remapBandBox(
  box: [number, number, number, number],
  topFrac: number,
  heightFrac: number,
): [number, number, number, number] {
  const [ymin, xmin, ymax, xmax] = box;
  const map = (y: number) => Math.min(1000, Math.round((topFrac + (y / 1000) * heightFrac) * 1000));
  return [map(ymin), xmin, map(ymax), xmax];
}

/** 겹친 띠에서 같은 문구가 두 번 잡힌 것 제거 — 같은 원문이 세로로 겹치면 중복 */
export function dedupeBandBoxes(boxes: OcrBox[]): OcrBox[] {
  const overlapY = (a: [number, number, number, number], b: [number, number, number, number]) => {
    const inter = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
    const minH = Math.max(1, Math.min(a[2] - a[0], b[2] - b[0]));
    return inter / minH;
  };
  const area = (b: [number, number, number, number]) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const out: OcrBox[] = [];
  for (const b of boxes) {
    const i = out.findIndex((o) => o.zh === b.zh && overlapY(o.box, b.box) > 0.5);
    if (i < 0) {
      out.push(b);
    } else if (area(b.box) > area(out[i].box)) {
      out[i] = b; // 더 큰 박스 = 문구가 온전히 들어온 띠 쪽을 남긴다
    }
  }
  return out;
}

/** 비교용 정규화 — OCR 이 띠마다 공백·문장부호를 다르게 붙여 온다 */
const zhKey = (s: string): string => s.replace(/[\s,.:;()（）·、，。：；]/g, "");

/**
 * 교차 판독 결과의 중복·조각 제거 (2026-08-24 live10 실측).
 *
 * dedupeBandBoxes 는 원문 **완전 일치**만 봐서, 같은 문구를 띠마다 다른 공백으로
 * 돌려주면("产品尺寸:单位 (cm)" vs "产品尺寸: 单位 (cm)") 중복이 그대로 살아남았다.
 * 조각 박스("单位 (cm)")도 마찬가지다. 실측 live10: #04 에 중복쌍 5개, #06 에 5개,
 * #02 에 1개. 중복은 ① 렌더 프롬프트에 같은 문구를 두 번 실어 모델을 헷갈리게 하고
 * ② 서로를 이웃 박스로 취급해 패치 사각형을 제 중복에 대고 잘라낸다.
 *
 * 같은(또는 포함 관계인) 원문이 세로로 겹치면 하나로 본다 — 더 넓은 박스를 남긴다
 * (조각이 아니라 문구 전체가 들어온 판독).
 */
export function dedupeOcrBoxes(boxes: OcrBox[]): OcrBox[] {
  const areaOf = (b: [number, number, number, number]) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
  const out: OcrBox[] = [];
  for (const b of boxes) {
    const kb = zhKey(b.zh);
    if (!kb) {
      out.push(b);
      continue;
    }
    const i = out.findIndex((o) => {
      const ko = zhKey(o.zh);
      if (!ko) return false;
      let same = ko === kb;
      if (!same && (ko.includes(kb) || kb.includes(ko))) {
        // 포함 관계는 "조각 판독"일 때만 같은 문구로 본다.
        // 짧은 낱말이 긴 문구에 우연히 들어가는 경우를 막는다 —
        // "约" ⊂ "约70分贝" 는 서로 다른 문구다(실측: 밀집 그리드가 통째로 한 문구로
        // 뭉쳐 번역 개수가 어긋났다).
        const [shortS, longS] = ko.length <= kb.length ? [ko, kb] : [kb, ko];
        // 실측 기준 두 가지:
        //  · "单位cm"(4자) ⊂ "产品尺寸单位cm"(7자) = 0.57 — 같은 줄의 조각 판독
        //  · "酒红"(2자) ⊂ "酒红色"(3자) = 0.67 — 색상 라벨을 두 번 읽은 것 (live11 #01)
        // 2자 미만(한 글자)은 우연 포함이 너무 흔해 제외한다.
        same = shortS.length >= 2 && shortS.length >= longS.length * 0.5;
      }
      if (!same) return false;
      const inter = Math.min(o.box[2], b.box[2]) - Math.max(o.box[0], b.box[0]);
      const minH = Math.max(1, Math.min(o.box[2] - o.box[0], b.box[2] - b.box[0]));
      return inter / minH > 0.5;
    });
    if (i < 0) out.push(b);
    else if (areaOf(b.box) > areaOf(out[i].box)) out[i] = b;
  }
  return out;
}

/** OCR 한 번 — 빈 응답·비JSON 응답은 "글자 없음"이 아니라 실패로 던진다 */
async function extractOnce(sendData: Buffer, sendMime: string): Promise<OcrBox[]> {
  const parts = await callGemini(
    MODEL,
    [
      { inline_data: { mime_type: sendMime, data: sendData.toString("base64") } },
      { text: EXTRACT_PROMPT },
    ],
    {
      // 8000 에서는 문구가 많은 이미지(실측 37개)의 응답이 중간에서 잘렸다
      maxOutputTokens: 16000,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingLevel: "minimal" },
    },
  );
  const text = textOf(parts);
  if (!text.trim()) throw new Error("모델 거부(빈 응답)");
  const rawItems = parseJsonArrayLoose(text);
  if (rawItems === null) throw new Error(`판독 불가 응답: ${text.slice(0, 80)}`);
  // ko 는 아직 없다 — zh 를 임시로 채워 좌표·색 검증만 통과시킨다
  return parseOcrBoxes(
    rawItems.map((r) => ({ ...(r as Record<string, unknown>), ko: (r as Record<string, unknown>).zh })),
  ).filter((b) => isForeignSource(b.zh));
}

/**
 * 이미지에서 중국어·일본어 문구와 좌표를 뽑는다 (번역 전 / 번역 후 검수 공용).
 *
 * 안전 필터는 글자가 아니라 사진(제품·인물)을 보고 거부한다 — 예전에는 거부가
 * 빈 배열로 둔갑해 "번역할 중국어 텍스트를 찾지 못했습니다"로 나갔다(운영 신고:
 * 중국어가 선명한 4장 반려). 전체가 거부되면 가로 띠로 잘라 다시 읽는다 —
 * 띠에는 사진이 덜 담겨 대부분 통과한다(띠 재생성과 같은 원리, 텍스트 호출이라
 * 비용은 무시 수준). 띠까지 전부 실패하면 그대로 실패를 알린다 — 조용히
 * "글자 없음"으로 넘어가는 길은 없다.
 */
/** GIF 는 첫 프레임 PNG 로 보낸다 — Gemini 가 GIF 를 받지 않는다 */
async function ocrSource(data: Buffer, mime: string): Promise<{ sendData: Buffer; sendMime: string }> {
  if (mime !== "image/gif") return { sendData: data, sendMime: mime };
  return { sendData: await sharp(data, { page: 0, pages: 1 }).png().toBuffer(), sendMime: "image/png" };
}

/** 가로 띠 3개로 잘라 각각 판독한다 — 교차 OCR 의 두 번째 눈 + 안전 필터 우회 공용 */
async function extractByBands(sendData: Buffer, sendMime: string): Promise<{ boxes: OcrBox[]; ok: number }> {
  void sendMime;
  const meta = await sharp(sendData).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) return { boxes: [], ok: 0 };

  const found: OcrBox[] = [];
  let ok = 0;
  for (const [top, h] of OCR_BANDS) {
    const cropTop = Math.round(top * H);
    const cropH = Math.min(H - cropTop, Math.round(h * H));
    if (cropH < 8) continue;
    try {
      const crop = await sharp(sendData)
        .extract({ left: 0, top: cropTop, width: W, height: cropH })
        .png()
        .toBuffer();
      const got = await extractOnce(crop, "image/png");
      ok++;
      found.push(...got.map((b) => ({ ...b, box: remapBandBox(b.box, cropTop / H, cropH / H) })));
    } catch {
      /* 이 띠도 거부 — 다음 띠에 기회를 준다 */
    }
  }
  return { boxes: dedupeBandBoxes(found), ok };
}

async function extractForeign(data: Buffer, mime: string): Promise<OcrBox[]> {
  const { sendData, sendMime } = await ocrSource(data, mime);

  try {
    return await extractOnce(sendData, sendMime);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 한도 초과·인증 오류는 띠로 잘라 보내도 똑같이 실패한다 — 요청 낭비 없이 즉시 중단
    if (isFatalApiError(msg)) throw e;
    const { boxes, ok } = await extractByBands(sendData, sendMime);
    if (ok === 0) throw e; // 전부 실패 — 원인을 그대로 알린다 (어드민이 재시도 판단)
    console.warn(`[imageTranslate] 전체 OCR 실패(${msg}) — 띠 ${ok}/${OCR_BANDS.length}개로 판독`);
    return boxes;
  }
}

/**
 * 최종 관문용 교차 판독 — 전체 1회 + 띠(상·중·하) 를 **둘 다** 돌려 합친다 (H1).
 *
 * 전체 한 번만 읽던 시절, 최초 판독이 놓친 문구를 관문도 같이 놓쳤다. 같은
 * 모델이라 실명이 상관되기 때문이다. 띠로 잘라 보내면 글자가 상대적으로 커져
 * 작은 글자·하단 문구가 살아난다 — 최초 판독이 쓰는 방식과 같은 강도로 맞춘다.
 * 텍스트 호출 3~4회 추가(장당 ₩1 미만)이고 이미지 호출은 늘지 않는다.
 */
async function extractForeignCross(data: Buffer, mime: string): Promise<OcrBox[]> {
  const { sendData, sendMime } = await ocrSource(data, mime);
  const full = await extractOnce(sendData, sendMime).catch((e) => {
    if (isFatalApiError(e instanceof Error ? e.message : String(e))) throw e;
    return [] as OcrBox[];
  });
  const bands = await extractByBands(sendData, sendMime);
  // 어느 쪽이든 찾은 건 다 센다 — 관문은 "놓치지 않는 것"이 목적이라 합집합이 맞다
  return mergeOcrPasses(full, bands.boxes).merged;
}

export async function ocrImage(data: Buffer, mime: string): Promise<OcrBox[]> {
  const extracted = await extractForeign(data, mime);
  return (await translateExtracted(data, mime, extracted)).boxes;
}

/**
 * 번역 결과를 채택/탈락으로 가른다.
 *
 * 탈락에는 성격이 전혀 다른 두 가지가 섞여 있고, 이 둘을 구분하지 않은 것이
 * 실사례(2026-08-27 감사)의 뿌리다.
 *  - **정상 무변경**: 원문에 바꿀 외국어가 없다(USB·숫자·모델코드). 번역문이
 *    원문과 같은 게 맞으므로 조용히 빼도 된다.
 *  - **번역 실패**: 외국어인데 번역이 비었거나 원문이 그대로 돌아왔다(에코).
 *    이걸 같이 조용히 빼면 남는 박스가 0개가 되어 "외국어 없음"(노출 허용)으로
 *    판정됐다 — 중국어 원본이 "검증 완료"로 손님에게 나가고 그 오판이 sha256
 *    캐시에 저장돼 같은 바이트의 모든 자산에 번졌다.
 *
 * 한자 재번역 보정이 한자만 보기 때문에(hasHanzi), 가나 전용 일본어는 보정
 * 자체가 안 돌아 에코가 그대로 여기까지 온다 — isForeignSource 로 함께 잡는다.
 */
export function pickTranslated(
  solid: OcrBox[],
  koList: string[],
): { boxes: OcrBox[]; untranslated: string[] } {
  const boxes: OcrBox[] = [];
  const untranslated: string[] = [];
  solid.forEach((b, i) => {
    const ko = koList[i] ?? "";
    if (ko && ko !== b.zh) {
      boxes.push({ ...b, ko });
      return;
    }
    // 바꿀 외국어가 없는 문구는 무변경이 정상 — 검수로 보내면 멀쩡한 이미지가 쏟아진다
    if (isForeignSource(b.zh)) untranslated.push(b.zh);
  });
  return { boxes, untranslated };
}

/** 추출된 문구 목록을 오탐 필터 → 번역(예산·한자·축약 보정)까지 끌고 간다 */
async function translateExtracted(
  data: Buffer,
  mime: string,
  extracted: OcrBox[],
): Promise<{ boxes: OcrBox[]; untranslated: string[] }> {
  if (extracted.length === 0) return { boxes: [], untranslated: [] };

  // 글자가 없는 영역을 글자로 착각한 오탐을 대비로 걸러낸다
  const kept = await filterByContrast(data, mime, extracted);
  if (kept.length === 0) return { boxes: [], untranslated: [] };

  // 워터마크는 번역하지 않는다 — 지우기만 한다. 남기면 "완성본에 한자가
  // 희미하게 남는다"는 결함이 되고, 한국어로 바꾸는 건 남의 상호를 우리
  // 이미지에 다시 박는 셈이라 지우는 게 맞다.
  const wmBoxes: OcrBox[] = kept
    .filter((b) => b.wm)
    .map((b) => ({ ...b, mode: "erase" as const, ko: "" }));
  const solid = kept.filter((b) => !b.wm);
  if (solid.length === 0) return { boxes: wmBoxes, untranslated: [] };

  // 문구마다 "자리에 들어갈 수 있는 글자 수"를 계산해 번역 단계에서부터 지키게 한다
  const meta = await sharp(mime === "image/gif" ? await sharp(data, { page: 0, pages: 1 }).png().toBuffer() : data).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  // GIF 는 띠 폭을 넓힐 수 없으므로 번역 단계에서부터 짧게 잡는다 (위 tight 주석)
  const tight = mime === "image/gif";
  const budgets = solid.map((b) => charBudget(b.box, W, H, [...b.zh].length, tight));

  const koList = await translateTexts(solid.map((b) => b.zh), { budgets });

  // 한자가 남은 항목만 한 번 더 강하게 재번역 (남으면 폰트에서 네모로 깨진다)
  const bad = koList.map((ko, i) => (hasHanzi(ko) ? i : -1)).filter((i) => i >= 0);
  if (bad.length > 0) {
    try {
      const repaired = await translateTexts(
        bad.map((i) => solid[i].zh),
        { budgets: bad.map((i) => budgets[i]), strict: true },
      );
      bad.forEach((orig, j) => {
        if (!hasHanzi(repaired[j]) && repaired[j]) koList[orig] = repaired[j];
      });
    } catch {
      // 보정 실패 시 원래 번역 유지 — 어드민이 문구 수정으로 고칠 수 있다
    }
  }

  // 자리보다 긴 문구만 한 번 더 짧게 — 텍스트 호출은 거의 무료이고,
  // 여기서 못 잡으면 이미지 생성이 뒷말을 잘라 그림을 통째로 다시 뽑아야 한다
  const long = overBudget(koList, budgets);
  if (long.length > 0) {
    try {
      const shorter = await translateTexts(
        long.map((i) => solid[i].zh),
        { budgets: long.map((i) => budgets[i]), shorten: true },
      );
      long.forEach((orig, j) => {
        const s = shorter[j];
        // 더 짧아졌고 한자가 없을 때만 채택 — 아니면 원래 번역이 낫다
        if (s && !hasHanzi(s) && [...s].length < [...koList[orig]].length) koList[orig] = s;
      });
    } catch {
      // 줄이기 실패는 치명적이지 않다 — 렌더 쪽 두 줄 배치·검수가 받아준다
    }
  }

  const picked = pickTranslated(solid, koList);
  return { boxes: [...picked.boxes, ...wmBoxes], untranslated: picked.untranslated };
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
    .filter(({ b }) => b.zh && !b.wm && !hasManualOverride(b));
  if (targets.length === 0) return boxes;

  const koList = await translateTexts(targets.map(({ b }) => b.zh));
  const bad = koList.map((ko, i) => (hasHanzi(ko) ? i : -1)).filter((i) => i >= 0);
  if (bad.length > 0) {
    try {
      const repaired = await translateTexts(bad.map((i) => targets[i].b.zh), { strict: true });
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

/** 병합 결과 — 줄 구조를 살려서 그리기 위해 원래 줄들을 함께 넘긴다 */
export type MergedBox = OcrBox & { lines?: string[] };

/**
 * 세로로 겹쳐 잡힌 "같은 문단의 줄들"을 한 덩어리로 합친다.
 *
 * OCR 이 문단을 줄 단위로 잡을 때 줄 박스끼리 세로로 살짝 겹치면, 각 박스
 * 중앙에 그린 번역문이 포개져 읽을 수 없게 된다(실사례: GIF 부제 두 줄).
 * 겹침 면적은 얼마 안 돼서 면적 기준으로는 못 잡는다 — "가로로 나란하고,
 * 세로로 겹치고, 색·굵기가 같은" 줄들을 문단으로 보고 union 박스에 줄들을
 * 차례로 그린다. 색이 다른 줄(빨간 제목 + 검정 부제)은 합치면 색이 뭉개지므로
 * 놔둔다. 수동 조정한 박스는 운영자가 자리를 정한 것이므로 건드리지 않는다.
 */
export function mergeOverlappingBoxes(boxes: OcrBox[], W: number, H: number): MergedBox[] {
  const eligible = (b: OcrBox) =>
    (b.mode ?? "translate") === "translate" &&
    b.ko.trim() !== "" &&
    !hasManualOverride(b) &&
    !isVerticalBox(b.box, W, H);

  /** 가로 구간이 어느 정도 겹치는가 (좁은 쪽 폭 대비) */
  const xOverlap = (a: OcrBox, b: OcrBox): number => {
    const iv = Math.min(a.box[3], b.box[3]) - Math.max(a.box[1], b.box[1]);
    if (iv <= 0) return 0;
    return iv / Math.max(1, Math.min(a.box[3] - a.box[1], b.box[3] - b.box[1]));
  };
  const sameStyle = (a: OcrBox, b: OcrBox): boolean =>
    a.fg.toLowerCase() === b.fg.toLowerCase() && (a.bold ?? false) === (b.bold ?? false);
  /** 세로로 실제 겹치는가 — 겹치지 않는 줄은 그대로 둬도 충돌하지 않는다 */
  const yTouch = (a: OcrBox, b: OcrBox): boolean => a.box[0] < b.box[2] && b.box[0] < a.box[2];

  const used = new Array(boxes.length).fill(false);
  const out: MergedBox[] = [];
  for (let i = 0; i < boxes.length; i++) {
    if (used[i]) continue;
    if (!eligible(boxes[i])) {
      out.push(boxes[i]);
      continue;
    }
    const members = [boxes[i]];
    let grew = true;
    while (grew) {
      grew = false;
      for (let j = 0; j < boxes.length; j++) {
        if (used[j] || j === i || !eligible(boxes[j]) || members.includes(boxes[j])) continue;
        const hit = members.some(
          (m) => yTouch(m, boxes[j]) && xOverlap(m, boxes[j]) >= 0.3 && sameStyle(m, boxes[j]),
        );
        if (!hit) continue;
        used[j] = true;
        members.push(boxes[j]);
        grew = true;
      }
    }
    if (members.length > 1) {
      // 읽는 순서(위→아래, 왼→오른쪽)로 줄을 정렬해 union 박스에 담는다
      members.sort((a, z) => a.box[0] - z.box[0] || a.box[1] - z.box[1]);
      out.push({
        ...members[0],
        box: [
          Math.min(...members.map((m) => m.box[0])),
          Math.min(...members.map((m) => m.box[1])),
          Math.max(...members.map((m) => m.box[2])),
          Math.max(...members.map((m) => m.box[3])),
        ],
        zh: members.map((m) => m.zh).join(" "),
        ko: members.map((m) => m.ko.trim()).join(" "),
        lines: members.map((m) => m.ko.trim()),
      });
    } else {
      out.push(boxes[i]);
    }
  }
  return out;
}

/**
 * 두 줄로 나눌 위치 — 가운데에서 가장 가까운 공백.
 * 나눌 공백이 없거나 어느 한쪽이 너무 짧으면 null (한 줄 유지).
 */
export function splitTwoLines(ko: string): [string, string] | null {
  const mid = ko.length / 2;
  let best = -1;
  let bd = Infinity;
  for (let i = 1; i < ko.length - 1; i++) {
    if (ko[i] !== " ") continue;
    const d = Math.abs(i - mid);
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  if (best < 0) return null;
  const a = ko.slice(0, best).trim();
  const b = ko.slice(best + 1).trim();
  if (a.length < 2 || b.length < 2) return null;
  return [a, b];
}

function hexToRgb(hex: string): [number, number, number] | null {
  if (!HEX.test(hex)) return null;
  let h = hex.slice(1);
  if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join("");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const luma = (c: [number, number, number]): number => 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];

/**
 * 글자색이 배경에 묻히면 외곽선 색을, 충분히 읽히면 null 을 돌려준다.
 *
 * 오버레이는 OCR 이 읽은 원문 글자색을 그대로 쓰는데, 원문이 흰 글씨였고
 * 지운 배경도 밝으면 흰 바탕에 흰 글씨가 된다(운영 스크린샷 신고). 색을
 * 바꾸면 디자인이 달라지므로 색은 지키고 얇은 외곽선으로 떠받친다.
 */
export function contrastStroke(fgHex: string, bg: [number, number, number]): string | null {
  const fg = hexToRgb(fgHex);
  if (!fg) return null;
  const lf = luma(fg);
  if (Math.abs(lf - luma(bg)) >= 70) return null;
  return lf > 140 ? "#222222" : "#ffffff";
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
    /** 그릴 줄들 — 두 줄 배치가 유리하면 2개 */
    lines: string[];
    b: PxBox;
    bw: number;
    bh: number;
    family: string;
    vertical: boolean;
    fitted: number;
  }

  // 겹치는 박스를 먼저 합친다 — 안 합치면 번역문이 포개져 그려진다
  const mergedBoxes = mergeOverlappingBoxes(boxes, width, height);

  const plans: Plan[] = [];
  for (const it of mergedBoxes) {
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
      lines: it.lines && it.lines.length > 1 ? it.lines : [ko],
      b,
      bw,
      bh,
      family: FONT_FAMILIES[it.weight ?? pickWeight(it.bold, bh)],
      vertical: isVerticalBox(it.box, width, height),
      fitted: 0,
    });
  }

  /** 여러 줄이 박스에 들어가는 최대 글자 크기 (안 들어가면 6까지 줄인다) */
  const fitLines = (p: Plan, lines: string[]): number => {
    let size = Math.floor(p.bh);
    while (size > 6) {
      ctx.font = `${size}px "${p.family}"`;
      let maxW = 0;
      let totalH = 0;
      for (const ln of lines) {
        const m = ctx.measureText(ln);
        maxW = Math.max(maxW, m.width);
        totalH += m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
      }
      totalH += (lines.length - 1) * size * 0.3; // 줄 간격
      if (maxW <= p.bw * 0.94 && totalH <= p.bh * 0.82) break;
      size -= 1;
    }
    return size;
  };

  // 박스에 들어가는 최대 크기를 먼저 구한다.
  // 긴 문구가 한 줄로 우겨넣어져 깨알만해지면(실사례: 병합된 부제), 박스가
  // 충분히 높을 때 두 줄로 나눠 본다 — 눈에 띄게 커질 때만 채택한다.
  for (const p of plans) {
    p.fitted = fitLines(p, p.lines);
    if (p.vertical || p.lines.length > 1) continue;
    if (p.fitted >= p.bh * 0.45) continue; // 한 줄로도 충분히 크다
    const two = splitTwoLines(p.ko);
    if (!two) continue;
    const size2 = fitLines(p, two);
    if (size2 >= p.fitted * 1.35) {
      p.lines = two;
      p.fitted = size2;
    }
  }

  // 원문에서 같은 크기였던 가로쓰기 문구끼리 크기를 통일한다
  // (두 줄로 나눈 문구는 크기 기준이 달라 통일 대상에서 뺀다)
  const flat = plans.filter((p) => !p.vertical && p.lines.length === 1);
  if (flat.length > 1) {
    const heights = flat.map((p) => ((p.it.box[2] - p.it.box[0]) / 1000) * height);
    const unified = unifySizes(groupBySize(heights), flat.map((p) => p.fitted));
    flat.forEach((p, i) => (p.fitted = unified[i]));
  }

  // 지운 배경과 글자색의 대비 확인용 — 박스 영역 평균색 (지우기가 끝난 현재 캔버스)
  const avgBg = (b: PxBox): [number, number, number] => {
    const w = Math.max(1, Math.min(width, b.x1) - b.x0);
    const h = Math.max(1, Math.min(height, b.y1) - b.y0);
    const d = ctx.getImageData(b.x0, b.y0, w, h).data;
    let r = 0;
    let g = 0;
    let bl = 0;
    for (let i = 0; i < d.length; i += 4) {
      r += d[i];
      g += d[i + 1];
      bl += d[i + 2];
    }
    const n = Math.max(1, d.length / 4);
    return [r / n, g / n, bl / n];
  };

  for (const p of plans) {
    const { it, ko, b, bw, bh, family } = p;
    // 위치 보정 — 정규화(0~1000) 단위를 픽셀로 환산해 더한다
    const offX = ((it.dx ?? 0) / 1000) * width;
    const offY = ((it.dy ?? 0) / 1000) * height;
    ctx.fillStyle = it.fg;
    const stroke = contrastStroke(it.fg, avgBg(b));

    // 세로쓰기 문구는 글자를 세로로 쌓는다 — 가로로 쓰면 좁은 박스에
    // 밀려 들어가 아주 작아진다(수동 조정한 세로 문구에서 발생)
    if (p.vertical) {
      // 공백은 세로로 쌓을 때 빈 칸만 만들어 어색하다 — 빼고 글자만 쌓는다
      const chars = [...ko].filter((c) => c.trim());
      const cell = Math.min(bw, bh / Math.max(1, chars.length));
      const vsize = Math.max(6, Math.round(cell * 0.9 * (it.scale ?? 1)));
      ctx.font = `${vsize}px "${family}"`;
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = Math.max(1, vsize * 0.05);
        ctx.lineJoin = "round";
      }
      const startY = b.y0 + (bh - cell * chars.length) / 2 + offY;
      chars.forEach((ch, ci) => {
        const m = ctx.measureText(ch);
        const h = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
        const cx = b.x0 + (bw - m.width) / 2 + offX;
        const cy = startY + cell * ci + (cell - h) / 2 + m.actualBoundingBoxAscent;
        if (stroke) ctx.strokeText(ch, cx, cy);
        ctx.fillText(ch, cx, cy);
      });
      continue;
    }

    // 통일된 크기에 어드민 배율을 곱한다 (키우거나 줄일 수 있게)
    const size = Math.max(6, Math.round(p.fitted * (it.scale ?? 1)));
    ctx.font = `${size}px "${family}"`;
    const gap = size * 0.3; // 줄 간격
    const measured = p.lines.map((ln) => {
      const m = ctx.measureText(ln);
      return { ln, w: m.width, asc: m.actualBoundingBoxAscent, h: m.actualBoundingBoxAscent + m.actualBoundingBoxDescent };
    });
    const blockH = measured.reduce((s, m) => s + m.h, 0) + gap * (measured.length - 1);
    let y = b.y0 + (bh - blockH) / 2 + offY;
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(1, size * 0.05);
      ctx.lineJoin = "round";
    }
    for (const m of measured) {
      const tx = b.x0 + (bw - m.w) / 2 + offX;
      if (stroke) ctx.strokeText(m.ln, tx, y + m.asc);
      ctx.fillText(m.ln, tx, y + m.asc);
      y += m.h + gap;
    }
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
export function gifPatchRect(b: OcrBox, W: number, H: number, mx = 1, my = 1): PxBox & { feather: number } {
  const p = toPixelBox(b.box, W, H);
  const padX = Math.max(12, (p.x1 - p.x0) * 0.25) * mx;
  const padY = Math.max(10, (p.y1 - p.y0) * 0.5) * my;
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

/**
 * 이 영역을 정지로 볼 수 있는가 — **비율이 아니라 절대 크기**로 판단한다.
 *
 * 왜 바꿨나: 예전 기준은 "움직인 픽셀 0개"였다. 그건 "1% 허용했더니 그만큼이
 * 얼어붙었다"는 사고(띠 넓이의 1% = 수백~수천 픽셀)에서 나온 반작용인데,
 * 실측(2026-09-01)에서 그 반작용이 과했다는 것이 드러났다 — M18 의
 * 「全面覆盖」·「大头爆震」은 글자도 배경도 **99.8~100% 정지**인데 잡티 9픽셀
 * 때문에 통째로 버려졌다. 눈에 띄는지는 "몇 %"가 아니라 "몇 픽셀이 뭉쳐
 * 있는가"로 정해진다. 9픽셀이 흩어져 얼어붙는 건 보이지 않고, 500픽셀 덩어리는
 * 보인다.
 *
 * 그래서 두 조건을 함께 본다: 움직인 픽셀 총수 ≤ maxPx **그리고** 가장 큰
 * 연결 덩어리 ≤ maxBlob. 압축·디더링 잡티는 흩어진 점이라 통과하고, 진짜
 * 애니메이션은 덩어리라 걸린다.
 */
export function regionStaticEnough(
  moved: Uint8Array,
  W: number,
  rect: { x0: number; y0: number; x1: number; y1: number },
  maxPx = 24,
  maxBlob = 8,
): boolean {
  const w = rect.x1 - rect.x0, h = rect.y1 - rect.y0;
  if (w <= 0 || h <= 0) return false;
  let total = 0;
  const local = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = (rect.y0 + y) * W + rect.x0;
    for (let x = 0; x < w; x++) {
      if (!moved[row + x]) continue;
      local[y * w + x] = 1;
      if (++total > maxPx) return false; // 총량 초과 — 더 볼 것 없다
    }
  }
  if (total === 0) return true;
  // 가장 큰 연결 덩어리 (8-이웃)
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let k0 = 0; k0 < local.length; k0++) {
    if (!local[k0] || seen[k0]) continue;
    let size = 0;
    stack.push(k0);
    seen[k0] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      size++;
      if (size > maxBlob) return false;
      const x = k % w, y = (k / w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nk = ny * w + nx;
          if (local[nk] && !seen[nk]) { seen[nk] = 1; stack.push(nk); }
        }
      }
    }
  }
  return true;
}

/**
 * 프레임 배열에서 "프레임0과 달라진 적 있는 픽셀" 마스크를 만든다 (테스트·재사용용).
 * 운영 경로는 buildMovedMask 로 **프레임을 하나씩 읽어** 같은 마스크를 만든다 —
 * 전 프레임을 메모리에 올리면 긴 GIF 에서 수백 MB 가 되어, 그것 때문에 프레임
 * 60장 상한을 두고 있었다(실측: 표본 47장 중 5장이 90~137프레임이라 통째로 배제).
 */
export function movedMaskFromFrames(frames: Uint8Array[], W: number, H: number, tol = 32): Uint8Array {
  const mask = new Uint8Array(W * H);
  const base = frames[0];
  for (let f = 1; f < frames.length; f++) {
    const cur = frames[f];
    for (let p = 0; p < W * H; p++) {
      if (mask[p]) continue;
      const i = p * 4;
      if (
        Math.abs(cur[i] - base[i]) > tol ||
        Math.abs(cur[i + 1] - base[i + 1]) > tol ||
        Math.abs(cur[i + 2] - base[i + 2]) > tol
      ) mask[p] = 1;
    }
  }
  return mask;
}

/**
 * 패치 사각형이 이웃 박스 코어를 침범하지 않게 여백만 잘라낸다.
 *
 * 자기 코어(core)는 절대 줄이지 않는다 — 잘라낼 수 있는 건 여백뿐이다.
 * 이웃 코어가 자기 코어와 겹쳐 있으면(밀집 그리드) 가를 수 없으므로 그대로
 * 둔다 — 그 경우는 기존 동작과 같다.
 */
export function clipRectAgainst(
  r: PxBox & { feather: number },
  core: PxBox,
  avoid: PxBox[],
): PxBox & { feather: number } {
  let { x0, y0, x1, y1 } = r;
  for (const a of avoid) {
    if (a.x1 <= x0 || a.x0 >= x1 || a.y1 <= y0 || a.y0 >= y1) continue; // 안 겹침
    // 코어를 침범하지 않는 방향으로만 줄인다 (이웃이 어느 쪽에 있는가).
    // 반드시 정수로 자른다 — toPixelBox 의 실수 좌표가 시작점(x0/y0)에 들어가면
    // buildPatchOverlay 의 버퍼 인덱스가 전부 소수가 되어 **패치가 통째로
    // 조용히 사라진다** (실측 #9: pasteBack 줄이 중국어 원문 그대로 나감).
    if (a.y0 >= core.y1 && a.y0 < y1) y1 = Math.floor(a.y0);
    else if (a.y1 <= core.y0 && a.y1 > y0) y0 = Math.ceil(a.y1);
    else if (a.x0 >= core.x1 && a.x0 < x1) x1 = Math.floor(a.x0);
    else if (a.x1 <= core.x0 && a.x1 > x0) x0 = Math.ceil(a.x1);
    // 어느 조건도 안 맞으면 코어끼리 겹친 것 — 가를 수 없다
  }
  // feather 를 **자른 뒤 두께에 맞춰 다시 잡는다.**
  // buildPatchOverlay 의 알파는 `min(1, edge/feather)` 이고 edge 최댓값은
  // 두께의 절반이다. 잘려서 두께가 2×feather 보다 얇아지면 어느 픽셀도 255 에
  // 닿지 못해 **패치 전체가 반투명**으로 얹힌다 — 원문·워터마크가 유령처럼
  // 비쳐 나오는, 무결 원칙이 금지하는 덧그린 흔적이 된다 (2026-08-27 감사).
  const feather = Math.max(0, Math.min(r.feather, Math.floor(Math.min(x1 - x0, y1 - y0) / 2)));
  return { x0, y0, x1, y1, feather };
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
    // 시작 좌표가 실수면 버퍼 인덱스가 전부 소수가 되어 아무것도 안 그려진다 —
    // 좌표는 여기서 한 번 더 정수로 못 박는다 (실측 #9: 패치 통째 유실)
    for (let y = Math.max(0, Math.ceil(r.y0)); y < r.y1; y++) {
      for (let x = Math.max(0, Math.ceil(r.x0)); x < r.x1; x++) {
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

/**
 * 패치를 얹었을 때 경계가 보일지 — 패치 테두리 띠에서 원본과 재생성본의 색 차이.
 *
 * 패치 합성은 글자 밖 픽셀 드리프트를 막지만, 패치 **안의 배경**은 모델이 다시
 * 그린 배경이다. 단색 배경에선 차이가 없는데 사진·그라데이션 위에서는 어긋나서
 * 페더 몇 픽셀로는 사각형 자국이 그대로 보인다(운영 스크린샷 신고). 테두리
 * 띠의 색이 원본과 같으면 이어 붙어도 티가 안 나고, 다르면 반드시 티가 난다 —
 * 그래서 테두리만 재면 "얹어도 되는 패치"를 공짜로 가릴 수 있다.
 */
/* ── 국소 이음매 판정 — 평균(seamGap)이 놓친 "끊긴 경계" 검출 (2026-08-24) ──
 *
 * 배경(실측): live3 에서 채택된 A点震颤顶撞 패치의 오른쪽 경계에서 배경 대각선이
 * 눈에 보이게 끊겼는데 seamGap 은 10.8(상한 48)로 통과했다 — 평균은 국소 단차
 * (그 경계의 p99 92, 연속 50px)를 깨끗한 나머지 경계에 희석시킨다.
 *
 * 지표: 경계 픽셀쌍(패치 안쪽 regen ↔ 바로 바깥 orig)의 색 점프에서 **원본에
 * 원래 있던 점프**(orig 안쪽 ↔ orig 바깥)를 뺀 증가분(음수는 0). 원본 경계를
 * 차감하므로 글자·무늬가 원래 경계에 걸쳐 있어도 벌점이 없다. 합성은 경계를
 * feather 로 뭉개지만 A 사례가 증명하듯 단차 94는 feather 로 안 사라진다 —
 * 여기서는 feather 전 최악값으로 잰다(보수적).
 *
 * 판정 3개 (max 는 게이트가 아니라 진단용 — 1px 스파이크로 거부하지 않는다):
 *   ① p99(전체 경계 증가분) ≤ 60
 *      실측: 합격군 최대 39(柔软) vs 불량군 최소 92(A) — 양쪽 여유를 두고 중간.
 *   ② Δ>48 연속 run ≤ 8px — "끊긴 선"은 이어진다.
 *      실측: 합격군 run 0, 합성 짧은 노이즈 3 vs 불량군 16~50.
 *   ③ Δ>32 연속 run ≤ 24px — 은은한 색 띠는 p99·run(48) 을 다 피한다.
 *      실측: 합격군 최대 9 vs 색띠 픽스처 194 · live1 불량 51.
 * run 은 변(edge) 단위로 센다 — 모서리를 돌며 이어붙이지 않는다.
 * 이미지 테두리에 붙은 변은 바깥 픽셀이 없어 잴 수 없다(건너뜀).
 */
export const SEAM_LOCAL_P99_MAX = 60;
export const SEAM_LOCAL_HIGH = 48;
export const SEAM_LOCAL_RUN_HIGH_MAX = 8;
export const SEAM_LOCAL_MID = 32;
export const SEAM_LOCAL_RUN_MID_MAX = 24;

export interface SeamLocalStats {
  ok: boolean;
  p99: number;
  runHigh: number;
  runMid: number;
  /** 진단용 — 판정에 쓰지 않는다 (1px 노이즈로 거부 금지) */
  max: number;
  n: number;
}

/** 운영(chooseSafePatchRect)과 테스트가 이 함수 하나를 같이 쓴다 — 산식 복제 금지 */
export function seamLocalOk(
  orig: Uint8Array,
  regen: Uint8Array,
  W: number,
  H: number,
  r: { x0: number; y0: number; x1: number; y1: number },
): SeamLocalStats {
  const x0 = Math.round(r.x0);
  const y0 = Math.round(r.y0);
  const x1 = Math.round(r.x1);
  const y1 = Math.round(r.y1);
  const maxCh = (a: Uint8Array, ai: number, b: Uint8Array, bi: number) =>
    Math.max(Math.abs(a[ai] - b[bi]), Math.abs(a[ai + 1] - b[bi + 1]), Math.abs(a[ai + 2] - b[bi + 2]));
  const edges: number[][] = [];
  const walk = (len: number, idxIn: (t: number) => number, idxOut: (t: number) => number) => {
    const e: number[] = [];
    for (let t = 0; t < len; t++) {
      const ii = idxIn(t);
      const io = idxOut(t);
      e.push(Math.max(0, maxCh(regen, ii, orig, io) - maxCh(orig, ii, orig, io)));
    }
    edges.push(e);
  };
  const cy0 = Math.max(0, y0);
  const cy1 = Math.min(H, y1);
  const cx0 = Math.max(0, x0);
  const cx1 = Math.min(W, x1);
  if (x0 - 1 >= 0) walk(cy1 - cy0, (t) => ((cy0 + t) * W + x0) * 4, (t) => ((cy0 + t) * W + x0 - 1) * 4);
  if (x1 < W) walk(cy1 - cy0, (t) => ((cy0 + t) * W + x1 - 1) * 4, (t) => ((cy0 + t) * W + x1) * 4);
  if (y0 - 1 >= 0) walk(cx1 - cx0, (t) => (y0 * W + cx0 + t) * 4, (t) => ((y0 - 1) * W + cx0 + t) * 4);
  if (y1 < H) walk(cx1 - cx0, (t) => ((y1 - 1) * W + cx0 + t) * 4, (t) => (y1 * W + cx0 + t) * 4);

  const all = edges.flat().sort((a, b) => a - b);
  const n = all.length;
  const p99 = n ? all[Math.min(n - 1, Math.floor(n * 0.99))] : 0;
  const max = n ? all[n - 1] : 0;
  let runHigh = 0;
  let runMid = 0;
  for (const e of edges) {
    let rh = 0;
    let rm = 0;
    for (const d of e) {
      rh = d > SEAM_LOCAL_HIGH ? rh + 1 : 0;
      rm = d > SEAM_LOCAL_MID ? rm + 1 : 0;
      if (rh > runHigh) runHigh = rh;
      if (rm > runMid) runMid = rm;
    }
  }
  const ok = p99 <= SEAM_LOCAL_P99_MAX && runHigh <= SEAM_LOCAL_RUN_HIGH_MAX && runMid <= SEAM_LOCAL_RUN_MID_MAX;
  return { ok, p99, runHigh, runMid, max, n };
}

export function seamGap(
  orig: Uint8Array,
  regen: Uint8Array,
  W: number,
  H: number,
  r: { x0: number; y0: number; x1: number; y1: number },
  band = 3,
): number {
  // gifPatchRect 는 소수 좌표를 준다 — 반올림 없이 인덱스로 쓰면 raw[소수]=undefined
  // 로 전부 NaN 이 되고, NaN>SEAM_MAX 는 false 라 이 검사가 통째로 죽는다
  // (2026-08-24 live1 재현으로 발견 — 그동안 이음새 검사는 사실상 무검사였다).
  const x0 = Math.round(r.x0);
  const y0 = Math.round(r.y0);
  const x1 = Math.round(r.x1);
  const y1 = Math.round(r.y1);
  let n = 0;
  let s = 0;
  const add = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    s += Math.max(
      Math.abs(regen[i] - orig[i]),
      Math.abs(regen[i + 1] - orig[i + 1]),
      Math.abs(regen[i + 2] - orig[i + 2]),
    );
    n++;
  };
  for (let d = 0; d < band; d++) {
    for (let x = x0; x < x1; x++) {
      add(x, y0 + d);
      add(x, y1 - 1 - d);
    }
    for (let y = y0 + band; y < y1 - band; y++) {
      add(x0 + d, y);
      add(x1 - 1 - d, y);
    }
  }
  return n === 0 ? 0 : s / n;
}

/**
 * 이 값을 넘으면 패치를 얹지 않고 로컬 지우기+오버레이로 강등한다.
 *
 * 운영 이미지 109쌍(624박스) 실측 분포: p50=4.1 p75=18.3 p90=29.7 p95=36.6 p99=58.3.
 * 처음엔 "바닥 노이즈와 어긋남의 경계"로 보고 14로 잡았다가 실물 재렌더에서
 * **멀쩡하던 이미지가 오히려 나빠졌다**(제목 자간이 벌어지고 부제에 지우개 자국).
 * 30%가 강등돼 오버레이의 고질적 자국을 도로 불러온 것이다.
 *
 * 페더(5~10px)가 어지간한 어긋남은 이미 가려준다는 걸 그때 알았다. 그래서 이
 * 값은 "페더로도 못 가리는" 극단만 잡도록 상위 1~2%(p99 언저리)에 둔다.
 * 오버레이는 최후 수단이지 기본값이 아니다 — 강등은 드물어야 한다.
 */
const SEAM_MAX = 48;

/**
 * 띠 **안쪽** 배경 밝기가 원본과 얼마나 달라도 되는가.
 * 실측(2026-09-01, 운영 GIF 2장·띠 10개): 정상 8개는 0.1~3.3, 밝은 사각형
 * 자국이 눈에 보인 2개는 12.4·13.7. 8 이면 둘을 안전하게 가른다.
 */
const BAND_INNER_MAX = 8;

/**
 * 프레임 수 상한. 예전 60 은 **전 프레임을 메모리에 올리던 구조** 때문이었다 —
 * 750×1920 × 137프레임 = 약 500MB. 이제 프레임을 하나씩 읽어 움직임 마스크만
 * 누적하므로(마스크 = W×H 바이트) 메모리가 프레임 수와 무관하다.
 * 실측(표본 47장): 90~137프레임짜리 5장(10.6%)이 이 상한 때문에 통째로 배제됐다.
 * 상한은 이제 렌더 시간 보호용이다.
 */
const GIF_PATCH_MAX_PAGES = 200;

/**
 * 어드민 승인 재렌더에서 GIF 정지 띠에 쓸 수 있는 이미지 호출 상한.
 *
 * 자동 흐름은 원본당 1회라 정지 띠가 둘 이상으로 갈리면(사이에 애니메이션이
 * 있어 못 합치는 경우) 첫 띠만 그려지고 나머지는 원문으로 남는다. 문제는
 * 재렌더를 눌러도 예산이 또 1회라 **매번 같은 첫 띠만 다시 그렸다** — 돈은
 * 나가는데 남은 띠는 영영 번역이 안 됐다(2026-09-01 마리아 GIF 실측: 정지
 * 라벨 2개 중 1개만 번역된 후보가 반복 생산됨). 안전 폴백(MAX_FALLBACK_CALLS)과
 * 같은 구조로, 운영자가 명시로 승인한 재렌더에서만 띠별 호출을 허용한다.
 * 6 = 띠 3개 × 시도 2회 — 관문 불합격 재시도(BAND_ATTEMPTS)까지 덮는 값이다.
 */
const MAX_GIF_BAND_CALLS = 10;

/**
 * 실제 예산 = 띠 수 + 재시도 여유 3 (상한 MAX_GIF_BAND_CALLS).
 *
 * 고정 6 이었을 때, 띠가 6개인 GIF 는 재시도가 한 번만 나도 마지막 띠가 호출을
 * 못 받아 그 문구가 통째로 원문으로 남았다(실측 마리아 0018: 「360°贴合」·
 * 「回弹设计」이 중국어로 남았고 사유도 "움직이는 화면 위"로 잘못 보고됐다).
 * 띠 수는 그림마다 다르므로 예산도 그림에 맞춰야 한다.
 */
export function gifBandBudgetFor(bands: number): number {
  return Math.min(MAX_GIF_BAND_CALLS, bands + 3);
}

/**
 * 띠 하나가 그림에서 차지해도 되는 최대 면적.
 *
 * GIF 는 **국소 편집**이다. 띠가 커지면 모델이 제품 사진까지 다시 그리는데,
 * GIF 경로에는 정지 이미지의 제품 무결성 심사가 없었다(fullAdopt 일 때만 돌았다).
 * 큰 띠는 "글자만 고친다"는 전제를 깨므로 아예 만들지 않는다.
 * 실측(운영 GIF 5장) 정상 띠의 최대 면적 비율은 28% 였다. 절반을 넘으면
 * "글자 띠"가 아니라 사실상 전체 재생성이므로 거부한다.
 */
const MAX_GIF_BAND_AREA = 0.5;

/**
 * 한 그림에서 만들 수 있는 띠 개수 상한 — 스펙표처럼 문구가 수십 개인 GIF 에서
 * 호출이 폭주하지 않게. 넘치면 글자를 많이 담은 띠부터 쓰고 나머지는 원문 유지.
 */
const MAX_GIF_BANDS = 12;

/**
 * 프레임 × 픽셀 예산 — 프레임 수만 보면 큰 그림에서 메모리가 터진다.
 * (790×1920 × 200프레임 = 3억 픽셀). 렌더 단계는 프레임 PNG 를 모아 인코딩하므로
 * 여기가 실제 한계다.
 */
const MAX_GIF_TOTAL_PIXELS = 250_000_000;

/** 띠 하나에 허용하는 재생성 시도 — 관문 불합격 시 재시도 (예산 안에서만) */
const BAND_ATTEMPTS = 2;

/**
 * 모델이 글자를 또렷하게 그리는 최소 글자 높이 — 이보다 작으면 띠를 확대해 보낸다.
 * 실측(2026-09-01): 1회 시도에 성공한 띠 9개는 글자 41~94px, 실패한 띠는 22px 이었다.
 */
const TARGET_GLYPH_PX = 44;

/**
 * 띠 패치에 대상 원문이 그대로 남았는지 — 텍스트 모델(사실상 공짜)로 확인.
 * 실패하면 null(잔존 미상) — 채택은 하되 육안 관문이 남아 있다.
 */
async function bandLeftoverZh(patch: Buffer, mapped: OcrBox[]): Promise<string[] | null> {
  try {
    const lines = await transcribeText(await sharp(patch).png().toBuffer(), "image/png");
    return findLeftoverZh(lines.map((l) => l.text), mapped);
  } catch {
    return null;
  }
}

/**
 * GIF 띠 재생성본 채택 전 검사 — 텍스트 모델(사실상 공짜)로 두 가지를 본다.
 *  1) 대상 원문(한자)이 그대로 남았는가
 *  2) 기대 문구에 없는 한글 덩어리가 읽히는가 — 겹침 인쇄·헛글자.
 *     실측(2026-09-01 마리아 GIF): 제목 띠 재생성본이 "인체용"을 두 번 겹쳐
 *     그려 "인체용 단계" 같은 헛글자로 읽혔는데 잔존 검사(한자만 봄)는
 *     통과했다. 무결 원칙: 깨끗하지 않으면 원본 유지가 바닥이다.
 * 판독 실패는 null(문제 미확인) — 채택하되 육안 관문이 남아 있다.
 */
async function bandPatchProblem(
  patch: Buffer,
  mapped: OcrBox[],
  /** 이 그림의 **다른** 확정 문구 — 띠 여백에 이웃 글자가 걸쳐 읽혀도 헛글자가 아니다 */
  neighborKo: string[] = [],
): Promise<string | null> {
  let lines: { text: string }[];
  try {
    lines = await transcribeText(await sharp(patch).png().toBuffer(), "image/png");
  } catch {
    return null;
  }
  const left = findLeftoverZh(lines.map((l) => l.text), mapped);
  if (left.length > 0) return `원문 잔류: ${left.join(", ").slice(0, 60)}`;
  const norm = (s: string) => s.replace(/[^0-9A-Za-z가-힣]/g, "");
  // 띠는 글자 주위 여백까지 잘라내므로 crop 에 **이웃 문구의 일부**가 들어온다.
  // 그걸 헛글자로 세면 멀쩡한 결과가 거부된다 — 실측(2026-09-01 재생 감사):
  // 운영 결과물 4장 중 3장이 이웃 문구 때문에 통째로 거부됐다.
  const allowed = [...mapped.map((b) => b.ko), ...neighborKo];
  const joined = norm(allowed.join(""));
  const extras = lines
    .map((l) => norm(l.text))
    .filter((t) => t.length >= 2 && /[가-힣]/.test(t))
    // 줄이 문구 경계를 걸치거나(이어 읽음) 문구 일부만 읽혀도 정상 — 이어 붙인
    // 전체나 개별 문구의 부분 문자열이면 통과. 어디에도 없는 한글만 헛글자다.
    .filter((t) => !joined.includes(t) && !allowed.some((k) => norm(k).includes(t)));
  if (extras.length > 0) return `문구 밖 글자: ${extras.join(", ").slice(0, 60)}`;
  return null;
}

/**
 * 띠 재생성본 육안 심사 — 그림을 보고 겹침·뭉갬·잘림·덧댄 자국을 잡는다.
 *
 * 글자 내용 검사(bandPatchProblem)를 통과해도 **모양**이 깨질 수 있다:
 * 실측(2026-09-01 마리아 GIF) 제목이 두 겹으로 찍혀 획이 뭉갰는데 판독은
 * 정상으로 읽어 그대로 채택됐고, 운영자가 문구를 손수 '원문 그대로'로 돌려야
 * 했다. 자동 흐름이 스스로 걸러야 재렌더 버튼 한 번으로 깨끗한 결과가 나온다.
 *
 * 호출 실패·형식 오류는 null(판단 불가) — 텍스트 검사와 육안 검수가 남아 있어
 * 여기서 막으면 텍스트 모델 장애가 GIF 번역을 통째로 세운다.
 */
async function bandVisualProblem(patch: Buffer, mapped: OcrBox[]): Promise<string | null> {
  const expected = mapped
    .filter((b) => (b.mode ?? "translate") === "translate" && b.ko.trim())
    .map((b) => b.ko.trim());
  if (expected.length === 0) return null;
  try {
    const png = await sharp(patch).png().toBuffer();
    const parts = await callGemini(
      MODEL,
      [
        { inline_data: { mime_type: "image/png", data: png.toString("base64") } },
        { text: buildBandQualityPrompt(expected) },
      ],
      { maxOutputTokens: 1500, responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "minimal" } },
    );
    const v = parseSingleVerdict(textOf(parts));
    if (!v || v.ok) return null;
    const said = (v.hard.length > 0 ? v.hard : v.issues).join(", ").trim();
    return `글자 품질 불합격: ${said || "확인 불가"}`.slice(0, 80);
  } catch {
    return null;
  }
}

/** 띠 채택 관문 — 글자 내용(공짜) → 모양(공짜 시각 심사) 순서로 본다 */
async function bandProblem(
  patch: Buffer,
  mapped: OcrBox[],
  neighborKo: string[] = [],
): Promise<string | null> {
  return (await bandPatchProblem(patch, mapped, neighborKo)) ?? (await bandVisualProblem(patch, mapped));
}

/**
 * 정지 띠 고르기 — 글자 박스를 띠로 묶되 **띠 전체가 모든 프레임에서 정지**인
 * 것만 남긴다.
 *
 * 박스 하나하나가 정지여도 띠로 묶으면 그 사이 여백에 애니메이션이 걸릴 수 있다.
 * 띠를 통째로 얹는 방식이라 띠 안이 움직이면 그 부분이 전 프레임에 얼어붙는다 —
 * 그래서 박스가 아니라 **띠 단위로** 정지를 확인하고, 띠가 움직이면 붙어 있던
 * 이웃 때문에 통째로 버리지 않고 박스 하나씩 다시 본다.
 */
export function staticBandsOf(
  boxes: OcrBox[],
  /** 첫 프레임 RGBA raw — 글자 범위 측정에 쓴다 */
  frame0: Uint8Array,
  /** 프레임0과 달라진 적 있는 픽셀 마스크 (W*H) */
  moved: Uint8Array,
  W: number,
  H: number,
): { band: BandRect; boxes: OcrBox[] }[] {
  // **완전 정지만** 허용한다 (maxMovedFrac 0). 기본값 1% 를 쓰면 띠 넓이의
  // 1%까지 움직여도 통과해 그만큼이 전 프레임에 얼어붙는다 — 실측(gifB):
  // 좌상 라벨 띠가 통과해 그 영역 움직임이 13.7%→5.4% 로 얼었다.
  // 색상 팔레트 잡음은 tol 32 가 흡수하므로 진짜 정지 영역은 0 으로도 통과한다.
  const isStill = (b: BandRect) =>
    regionStaticEnough(moved, W, { x0: b.left, y0: b.top, x1: b.left + b.width, y1: b.top + b.height });

  // 문구마다 **실제 글자 범위**를 재둔다. 판독 박스는 획 끝을 자주 자르고
  // (실측 오버슈트 0~5px), 그만큼이 패치 밖에 남으면 원문 조각이 그대로 보인다
  // — M18 「쿠션 설계 다채로운 자세 체감」의 오버슈트가 정확히 4px 이었고,
  // 여백 4px 짜리 띠에서 실제로 획이 남았다(2026-09-01 실측으로 재현).
  const glyphOf = new Map<OcrBox, { x0: number; y0: number; x1: number; y1: number }>();
  const glyph = (b: OcrBox) => {
    const cached = glyphOf.get(b);
    if (cached) return cached;
    const [y1, x1, y2, x2] = b.box;
    const v = glyphExtent(frame0, W, H, {
      x0: (x1 / 1000) * W, y0: (y1 / 1000) * H, x1: (x2 / 1000) * W, y1: (y2 / 1000) * H,
    });
    glyphOf.set(b, v);
    return v;
  };
  /** 이 문구를 안전하게 덮으려면 최소 몇 px 여백이 필요한가 (오버슈트 + 여유 1px) */
  const needPad = (b: OcrBox) => {
    const [y1, x1, y2, x2] = b.box;
    const g = glyph(b);
    return Math.ceil(Math.max(
      (x1 / 1000) * W - g.x0, (y1 / 1000) * H - g.y0,
      g.x1 - (x2 / 1000) * W, g.y1 - (y2 / 1000) * H, 0,
    )) + 1;
  };

  // 여백 사다리 — 넓은 것부터. **하한은 문구가 요구하는 값**(오버슈트+1px)이다.
  // 고정 하한(8px)을 두면 오버슈트가 작은 문구까지 싸잡아 버린다 — 실측:
  // 「360° 밀착핏」은 오버슈트 4px 인데 정지 여백이 6px 이라, 5px 만 있으면
  // 안전하게 덮이는데도 8px 하한 때문에 원문으로 남았다.
  const PADS_PX = [45, 32, 24, 18, 14, 11, 8];
  // 그룹 전체를 **하나로 담는** 사각형이어야 한다. clusterBands 는 여백이 좁아지면
  // 그룹을 여러 조각으로 쪼개는데, 예전엔 그중 **첫 조각만** 띠로 쓰면서 나머지
  // 문구는 띠 밖에 남겨둔 채 "이 띠가 번역했다"고 취급했다 — 실측(2026-09-01 M18):
  // 띠가 담은 글자까지의 여백이 L-105·B-90(음수), 즉 글자 절반이 패치 밖이라
  // 그 자리에 중국어 원문이 그대로 드러났다. 조각들의 합집합을 쓴다.
  const stillBandFor = (group: OcrBox[]): BandRect | null => {
    const need = Math.max(...group.map(needPad));
    // need 보다 좁은 여백은 시도하지 않는다(획이 남는다). 사다리에 need 가
    // 없으면 마지막 단으로 붙여 "딱 필요한 만큼"이라도 시도한다.
    const ladder = [...PADS_PX.filter((p) => p >= need), need];
    for (const pad of ladder) {
      const parts = clusterBands(group, W, H, BAND_PAD_PERMIL, pad);
      if (parts.length === 0) continue;
      const band: BandRect = {
        left: Math.min(...parts.map((p) => p.left)),
        top: Math.min(...parts.map((p) => p.top)),
        width: 0,
        height: 0,
      };
      band.width = Math.max(...parts.map((p) => p.left + p.width)) - band.left;
      band.height = Math.max(...parts.map((p) => p.top + p.height)) - band.top;
      if (isStill(band)) return band;
    }
    return null;
  };

  const out: { band: BandRect; boxes: OcrBox[] }[] = [];
  for (const band of clusterBands(boxes, W, H)) {
    const inBand = boxes.filter((b) => boxInBand(b, band, W, H));
    if (inBand.length === 0) continue;
    const whole = stillBandFor(inBand);
    if (whole) {
      out.push({ band: whole, boxes: inBand });
      continue;
    }
    // 묶음이 안 되면 박스 하나씩 — 붙어 있던 이웃 때문에 통째로 버리지 않는다
    for (const b of inBand) {
      const solo = stillBandFor([b]);
      if (solo) out.push({ band: solo, boxes: [b] });
    }
  }
  if (out.length === 0) return out;

  // 흩어진 정지 띠를 하나로 합칠 수 있으면 합친다 — 자동 흐름은 이미지 호출이
  // 1회뿐이라, 띠가 둘로 갈리면 한쪽 문구가 통째로 원문에 남는다(실측 gifB).
  // 합친 사각형까지 완전 정지일 때만 — 아니면 원래대로 나눠 둔다.
  if (out.length > 1) {
    const L = Math.min(...out.map((g) => g.band.left));
    const T = Math.min(...out.map((g) => g.band.top));
    const R = Math.max(...out.map((g) => g.band.left + g.band.width));
    const B = Math.max(...out.map((g) => g.band.top + g.band.height));
    const merged: BandRect = { left: L, top: T, width: R - L, height: B - T };
    if (isStill(merged)) return [{ band: merged, boxes: out.flatMap((g) => g.boxes) }];
  }
  // 띠는 자기가 담은 글자를 **전부** 덮어야 한다 — 반쪽만 덮으면 덮이지 않은
  // 획이 원문 그대로 드러난다(무결 원칙 위반). 못 덮는 문구는 그 띠에서 빼서
  // 원문 유지로 돌린다 — 번역했다고 잘못 세는 것이 더 나쁘다.
  // 납작한 띠(가로세로비가 큰 띠)는 세로로 넓혀 준다.
  //
  // 실측(2026-09-01 M18/M19): 1회 시도에 성공한 띠 9개는 전부 가로세로비 1.4~3.6·
  // 글자 41~94px 이었고, 실패한 띠는 비 7.9·글자 22px 하나뿐이었다. 모델은
  // 납작한 조각 안에서 작은 글자를 그리다 획을 뭉갠다. 정지가 유지되는 한
  // 세로 여백을 더 줘서 그릴 공간을 만든다 — 호출 수는 그대로다.
  const FLAT_RATIO = 4;
  /**
   * 번역문이 원문보다 길면 띠를 **가로로** 넓힌다.
   *
   * 한국어는 원문보다 길어지는 게 정상이다(중앙값 1.31배). 폭이 고정이면 모델은
   * 글자를 줄여 넣을 수밖에 없다 — 실측(2026-09-01): 「多种频率」(4자)를
   * 「다양한 진동 모드」(8자)로 바꾼 띠에서 글자가 원본의 **61%** 로 작아졌고,
   * 69~84% 인 띠가 넷 더 있었다(정상은 92~97%). 정지가 유지되는 만큼 넓혀
   * 모델이 원래 크기로 쓸 공간을 준다.
   */
  const growWide = (band: BandRect, bs: OcrBox[]): BandRect => {
    const zh = bs.reduce((n, b) => n + b.zh.replace(/\s/g, "").length, 0);
    const ko = bs.reduce((n, b) => n + b.ko.replace(/\s/g, "").length, 0);
    if (zh === 0 || ko <= zh * 1.15) return band;
    const want = Math.round(band.width * Math.min(1.8, ko / zh));
    let b = band;
    while (b.width < want) {
      const left = Math.max(0, b.left - 1);
      const right = Math.min(W, b.left + b.width + 1);
      const next: BandRect = { left, top: b.top, width: right - left, height: b.height };
      if (next.width === b.width || !isStill(next)) break;
      b = next;
    }
    return b;
  };
  const growFlat = (band: BandRect): BandRect => {
    if (band.width / band.height < FLAT_RATIO) return band;
    let b = band;
    for (let i = 0; i < 24; i++) {
      const top = Math.max(0, b.top - 1);
      const bottom = Math.min(H, b.top + b.height + 1);
      const next: BandRect = { left: b.left, top, width: b.width, height: bottom - top };
      if (next.height === b.height || !isStill(next)) break;
      b = next;
      if (b.width / b.height < FLAT_RATIO) break; // 충분히 두꺼워졌다
    }
    return b;
  };
  for (let i = 0; i < out.length; i++) {
    out[i] = { ...out[i], band: growWide(growFlat(out[i].band), out[i].boxes) };
  }

  // 띠는 담은 글자를 **전부** 덮어야 한다 — 반쪽만 덮으면 덮이지 않은 획이
  // 원문 그대로 드러난다. 판독 박스가 아니라 **실제 글자 범위**로 본다.
  const fits = (b: OcrBox, band: BandRect): boolean => {
    const g = glyph(b);
    return (
      g.x0 - 1 >= band.left - 0.5 && g.y0 - 1 >= band.top - 0.5 &&
      g.x1 + 1 <= band.left + band.width + 0.5 && g.y1 + 1 <= band.top + band.height + 0.5
    );
  };

  const covered = out
    .map((g) => ({ band: g.band, boxes: g.boxes.filter((b) => fits(b, g.band)) }))
    .filter((g) => g.boxes.length > 0);
  out.length = 0;
  out.push(...covered);

  // 겹치는 띠를 없앤다 — 이게 "글자가 두 겹으로 찍힘"의 진짜 원인이었다.
  // 실측(2026-09-01 마리아 0019): 제목 띠(y159~207)와 부제 띠(y187~247)가 세로로
  // 겹쳤고, 겹친 자리에 패치를 두 번 얹어 부제 패치가 그린 제목 꼬리가 제목
  // 패치 위에 덧찍혔다. 육안 판정기는 띠 하나만 보므로 이걸 잡을 수 없다 —
  // 겹침은 애초에 만들지 않는 것이 답이다.
  const resolved = resolveBandOverlaps(out, W, H, isStill);

  // 띠 여백에 **이웃 글자**가 들어오면 모델이 그것까지 손대 헛글자를 만든다 —
  // 실측(2026-09-01 M18): 「쿠션 설계」 띠의 여백에 위쪽 「360°贴合」이 걸쳤고,
  // 모델이 그걸 "360새름"으로 깨뜨려 띠 전체가 버려졌다(관문은 제대로 잡았다).
  // 이웃 글자 코어를 피해 **여백만** 잘라낸다 — 자기 글자는 절대 줄이지 않는다.
  // 정지 이미지 경로의 clipRectAgainst 와 같은 발상을 띠에 적용한 것.
  const clipped = resolved.map((g) => {
    const gs = g.boxes.map(glyph);
    const own = {
      x0: Math.min(...gs.map((k) => k.x0)), y0: Math.min(...gs.map((k) => k.y0)),
      x1: Math.max(...gs.map((k) => k.x1)), y1: Math.max(...gs.map((k) => k.y1)),
    };
    const avoid = boxes.filter((b) => !g.boxes.includes(b)).map(glyph);
    const r = clipRectAgainst(
      { x0: g.band.left, y0: g.band.top, x1: g.band.left + g.band.width, y1: g.band.top + g.band.height, feather: 0 },
      { x0: own.x0, y0: own.y0, x1: own.x1, y1: own.y1 },
      avoid,
    );
    const band: BandRect = { left: r.x0, top: r.y0, width: r.x1 - r.x0, height: r.y1 - r.y0 };
    return band.width > 0 && band.height > 0 ? { band, boxes: g.boxes } : g;
  });

  // 자르고 나서 글자를 못 덮게 된 문구는 빼낸다(원문 유지) — 반쪽 패치 금지
  const final = clipped
    .map((g) => ({ band: g.band, boxes: g.boxes.filter((b) => fits(b, g.band)) }))
    .filter((g) => g.boxes.length > 0);

  // 글자를 많이 담은 띠부터 — 호출을 가장 값진 띠에 먼저 쓴다
  return final.sort((a, b) => b.boxes.length - a.boxes.length);
}

/**
 * 이 띠의 어느 변이 **다른 띠와 맞닿아 있나**(이음매).
 * 맞닿은 변을 페더하면 양쪽 패치가 그 줄에서 반투명해져 아래 원문이 드러난다.
 */
export function seamSidesOf(
  band: BandRect,
  others: BandRect[],
  tol = 1,
): { left: boolean; top: boolean; right: boolean; bottom: boolean } {
  const out = { left: false, top: false, right: false, bottom: false };
  const R = band.left + band.width, B = band.top + band.height;
  for (const o of others) {
    if (o === band) continue;
    const oR = o.left + o.width, oB = o.top + o.height;
    const xOverlap = band.left < oR && o.left < R;
    const yOverlap = band.top < oB && o.top < B;
    if (yOverlap) {
      if (Math.abs(band.left - oR) <= tol) out.left = true;
      if (Math.abs(R - o.left) <= tol) out.right = true;
    }
    if (xOverlap) {
      if (Math.abs(band.top - oB) <= tol) out.top = true;
      if (Math.abs(B - o.top) <= tol) out.bottom = true;
    }
  }
  return out;
}

/**
 * 원문 글자의 **실제 범위** — 판독 박스는 획 끝을 자주 자른다(실측 오버슈트 1~5px).
 *
 * 앞선 두 시도가 실패한 이유는 배경을 **전역으로** 추정했기 때문이다:
 *  - 잉크 범위 확장: 그라데이션 위에서 확장이 멈추지 않아 상한까지 번졌다
 *  - 경계 절단 검사: 카드 테두리·그림자를 글자로 오인해 멀쩡한 띠를 전부 거부했다
 *
 * 그래서 두 가지를 바꿨다.
 *  ① **국소 배경**(주변 13px 창의 중앙값)과 비교한다. 획은 창보다 얇아 중앙값이
 *     배경으로 잡히고, 그라데이션은 부드러워 애초에 튀지 않는다.
 *  ② 판독 박스 **안쪽의 확실한 획에서 시작해 이어진 것만** 따라간다. 카드
 *     테두리는 글자와 이어져 있지 않으므로 딸려오지 않는다.
 * 원본 픽셀만 보므로 호출 0회다.
 */
export function glyphExtent(
  raw: Uint8Array,
  W: number,
  H: number,
  core: { x0: number; y0: number; x1: number; y1: number },
  maxGrow = 8,
  radius = 6,
  tol = 30,
): { x0: number; y0: number; x1: number; y1: number } {
  const rx0 = Math.max(0, Math.floor(core.x0) - maxGrow);
  const ry0 = Math.max(0, Math.floor(core.y0) - maxGrow);
  const rx1 = Math.min(W, Math.ceil(core.x1) + maxGrow);
  const ry1 = Math.min(H, Math.ceil(core.y1) + maxGrow);
  const rw = rx1 - rx0, rh = ry1 - ry0;
  if (rw <= 2 || rh <= 2) return core;

  const lum = (x: number, y: number) => {
    const i = (y * W + x) * 4;
    return 0.299 * raw[i] + 0.587 * raw[i + 1] + 0.114 * raw[i + 2];
  };
  // 국소 배경과의 차이 — 창(2*radius+1)보다 얇은 획만 튄다
  const outlier = new Uint8Array(rw * rh);
  const win: number[] = [];
  for (let y = ry0; y < ry1; y++) {
    for (let x = rx0; x < rx1; x++) {
      win.length = 0;
      for (let dy = -radius; dy <= radius; dy += 2) {
        const yy = Math.max(0, Math.min(H - 1, y + dy));
        for (let dx = -radius; dx <= radius; dx += 2) {
          win.push(lum(Math.max(0, Math.min(W - 1, x + dx)), yy));
        }
      }
      win.sort((a, b) => a - b);
      const med = win[win.length >> 1];
      if (Math.abs(lum(x, y) - med) > tol) outlier[(y - ry0) * rw + (x - rx0)] = 1;
    }
  }

  // 박스 안쪽(1px 침식)의 획을 씨앗으로, 이어진 것만 따라간다
  const seen = new Uint8Array(rw * rh);
  const stack: number[] = [];
  const push = (x: number, y: number) => {
    const i = (y - ry0) * rw + (x - rx0);
    if (x < rx0 || y < ry0 || x >= rx1 || y >= ry1 || seen[i] || !outlier[i]) return;
    seen[i] = 1;
    stack.push(x, y);
  };
  for (let y = Math.ceil(core.y0) + 1; y < Math.floor(core.y1) - 1; y++) {
    for (let x = Math.ceil(core.x0) + 1; x < Math.floor(core.x1) - 1; x++) push(x, y);
  }
  const out = { x0: core.x0, y0: core.y0, x1: core.x1, y1: core.y1 };
  while (stack.length) {
    const y = stack.pop()!, x = stack.pop()!;
    if (x < out.x0) out.x0 = x;
    if (y < out.y0) out.y0 = y;
    if (x + 1 > out.x1) out.x1 = x + 1;
    if (y + 1 > out.y1) out.y1 = y + 1;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) push(x + dx, y + dy);
  }
  return out;
}

/**
 * 띠 두 개가 **가까운가** — 이 거리 안이면 합치기를 시도한다.
 * 가까운 띠를 따로 두면 서로를 피해 깎여 여백이 사라지고, 글자 획이 패치 밖에
 * 남는다(실측 M18: 위아래로 붙은 두 줄이 서로 깎여 획이 잘렸다).
 */
const BAND_NEAR_PX = 14;
function bandsNear(a: BandRect, b: BandRect, gap = BAND_NEAR_PX): boolean {
  const dx = Math.max(0, Math.max(a.left - (b.left + b.width), b.left - (a.left + a.width)));
  const dy = Math.max(0, Math.max(a.top - (b.top + b.height), b.top - (a.top + a.height)));
  return dx <= gap && dy <= gap;
}

/** 띠 두 개가 픽셀로 겹치나 */
function bandsOverlap(a: BandRect, b: BandRect): boolean {
  return (
    a.left < b.left + b.width && b.left < a.left + a.width &&
    a.top < b.top + b.height && b.top < a.top + a.height
  );
}

/** 그 띠가 담은 글자들의 실제 자리(여백 없는 코어) */
function coreOf(boxes: OcrBox[], W: number, H: number): { x0: number; y0: number; x1: number; y1: number } {
  const xs0: number[] = [], ys0: number[] = [], xs1: number[] = [], ys1: number[] = [];
  for (const b of boxes) {
    const [y1, x1, y2, x2] = b.box;
    xs0.push((x1 / 1000) * W); ys0.push((y1 / 1000) * H);
    xs1.push((x2 / 1000) * W); ys1.push((y2 / 1000) * H);
  }
  return { x0: Math.min(...xs0), y0: Math.min(...ys0), x1: Math.max(...xs1), y1: Math.max(...ys1) };
}

/**
 * 겹치는 정지 띠 정리 — 같은 픽셀에 패치를 두 번 얹지 않게 만든다.
 *
 * 순서: ① 하나로 합칠 수 있으면 합친다(합집합도 완전 정지일 때만)
 *       ② 글자 자리가 세로/가로로 떨어져 있으면 그 사이에서 **잘라 나눈다**
 *          (자른 조각은 정지 띠의 부분집합이라 여전히 정지다 — 다시 확인할 필요 없음)
 *       ③ 글자 자리까지 겹치면(겹쳐 인쇄된 원본) 나눌 수 없다 — 글자를 더 많이
 *          담은 띠만 남기고 나머지는 원문 유지. 반쪽만 덮으면 원문이 비쳐 나온다.
 */
export function resolveBandOverlaps(
  groups: { band: BandRect; boxes: OcrBox[] }[],
  W: number,
  H: number,
  isStill: (b: BandRect) => boolean,
): { band: BandRect; boxes: OcrBox[] }[] {
  const out = groups.map((g) => ({ ...g }));
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      const a = out[i], b = out[j];
      if (!a || !b) continue;
      // 겹치거나 **가까우면** 합치기를 먼저 시도한다. 가까운 띠를 그대로 두면
      // 서로를 피해 깎이고(이웃 회피 클립), 그만큼 여백이 사라져 글자 획이
      // 패치 밖에 남는다 — 실측(M18): 「360°贴合」 바로 아래 「回弹设计」가
      // 서로 깎여 획이 잘렸다. 하나로 묶으면 여백도 넉넉하고 이음매도 없다.
      if (!bandsOverlap(a.band, b.band) && !bandsNear(a.band, b.band)) continue;

      // ① 합치기
      const L = Math.min(a.band.left, b.band.left);
      const T = Math.min(a.band.top, b.band.top);
      const R = Math.max(a.band.left + a.band.width, b.band.left + b.band.width);
      const B = Math.max(a.band.top + a.band.height, b.band.top + b.band.height);
      const merged: BandRect = { left: L, top: T, width: R - L, height: B - T };
      if (isStill(merged)) {
        out[i] = { band: merged, boxes: [...a.boxes, ...b.boxes] };
        out.splice(j, 1);
        j = i; // 합쳐진 띠로 나머지와 다시 견준다
        continue;
      }
      // 가깝기만 하고 못 합치면 그대로 둔다 — 겹치지 않으니 두 겹 인쇄는 없다
      if (!bandsOverlap(a.band, b.band)) continue;

      // ② 글자 자리 사이에서 잘라 나누기
      const ca = coreOf(a.boxes, W, H), cb = coreOf(b.boxes, W, H);
      const MARGIN = 2; // 코어를 스치지 않게 최소 여백
      const cut = (
        up: { band: BandRect; boxes: OcrBox[] },
        low: { band: BandRect; boxes: OcrBox[] },
        mid: number,
        axis: "y" | "x",
      ): boolean => {
        if (axis === "y") {
          const upB = Math.min(up.band.top + up.band.height, mid);
          const lowT = Math.max(low.band.top, mid);
          if (upB - up.band.top < 4 || low.band.top + low.band.height - lowT < 4) return false;
          up.band = { ...up.band, height: upB - up.band.top };
          low.band = { ...low.band, top: lowT, height: low.band.top + low.band.height - lowT };
        } else {
          const upR = Math.min(up.band.left + up.band.width, mid);
          const lowL = Math.max(low.band.left, mid);
          if (upR - up.band.left < 4 || low.band.left + low.band.width - lowL < 4) return false;
          up.band = { ...up.band, width: upR - up.band.left };
          low.band = { ...low.band, left: lowL, width: low.band.left + low.band.width - lowL };
        }
        return true;
      };
      let split = false;
      if (ca.y1 + MARGIN <= cb.y0 - MARGIN) split = cut(a, b, Math.round((ca.y1 + cb.y0) / 2), "y");
      else if (cb.y1 + MARGIN <= ca.y0 - MARGIN) split = cut(b, a, Math.round((cb.y1 + ca.y0) / 2), "y");
      else if (ca.x1 + MARGIN <= cb.x0 - MARGIN) split = cut(a, b, Math.round((ca.x1 + cb.x0) / 2), "x");
      else if (cb.x1 + MARGIN <= ca.x0 - MARGIN) split = cut(b, a, Math.round((cb.x1 + ca.x0) / 2), "x");
      if (split) continue;

      // ③ 나눌 수 없으면 하나만 남긴다
      const dropJ = a.boxes.length >= b.boxes.length;
      out.splice(dropJ ? j : i, 1);
      if (dropJ) j--;
      else { i--; break; }
    }
  }
  return out;
}

/**
 * 모델이 그린 띠를 얹을 수 있는 RGBA 로 만든다 — 크기 맞춤 + 경계 페더.
 *
 * **페더는 글자 없는 여백에서만 한다.** 반투명 가장자리가 글자 위에 걸리면 그
 * 아래 원문이 비쳐 나온다 — 실측(2026-09-01 마리아 0019): 제목·부제 띠의 맞닿은
 * 변과, 여백이 좁은 띠의 위아래에서 중국어 원문의 획이 유령처럼 떠올랐다.
 * 변마다 글자까지의 거리를 재서 그 안쪽으로만 넣고, 다른 띠와 맞닿은 변(이음매)은
 * 아예 페더하지 않는다(양쪽이 반투명해지면 원문이 그대로 드러난다).
 */
function featherBand(
  rgba: Buffer,
  band: BandRect,
  inBand: OcrBox[],
  W: number,
  H: number,
  allBands: BandRect[],
): Buffer {
  const core = coreOf(inBand, W, H);
  const gaps = {
    left: core.x0 - band.left,
    top: core.y0 - band.top,
    right: band.left + band.width - core.x1,
    bottom: band.top + band.height - core.y1,
  };
  const seam = seamSidesOf(band, allBands);
  const sides = {
    left: band.left > 0 && !seam.left && gaps.left >= 3,
    top: band.top > 0 && !seam.top && gaps.top >= 3,
    right: band.left + band.width < W && !seam.right && gaps.right >= 3,
    bottom: band.top + band.height < H && !seam.bottom && gaps.bottom >= 3,
  };
  const room = Math.min(
    ...([
      sides.left ? gaps.left : Infinity,
      sides.top ? gaps.top : Infinity,
      sides.right ? gaps.right : Infinity,
      sides.bottom ? gaps.bottom : Infinity,
    ] as number[]),
  );
  const feather = Math.max(
    0,
    Math.min(8, Math.floor(Math.min(band.width, band.height) / 4), Math.floor(room) - 1),
  );
  return applyEdgeFeather(rgba, band.width, band.height, feather, sides);
}

/**
 * 띠를 얹었을 때 경계에 네모 자국이 보이는가 — 정지 이미지 경로와 같은 기준.
 * 원본 프레임0 위에 이 띠만 합성해 경계 색차를 잰다(픽셀 계산, 호출 0회).
 * 불합격이면 재시도하거나 원문을 유지한다 — 덧그린 자국은 무결 원칙 위반이다.
 */
export function bandSeamProblem(
  origRaw: Uint8Array,
  bandRgba: Buffer,
  band: BandRect,
  W: number,
  H: number,
): string | null {
  const comp = Uint8Array.from(origRaw);
  for (let y = 0; y < band.height; y++) {
    for (let x = 0; x < band.width; x++) {
      const si = (y * band.width + x) * 4;
      const a = bandRgba[si + 3] / 255;
      if (a <= 0) continue;
      const di = ((band.top + y) * W + band.left + x) * 4;
      for (let c = 0; c < 3; c++) comp[di + c] = Math.round(bandRgba[si + c] * a + comp[di + c] * (1 - a));
    }
  }
  const r = { x0: band.left, y0: band.top, x1: band.left + band.width, y1: band.top + band.height };
  const gap = seamGap(origRaw, comp, W, H, r);
  if (gap > SEAM_MAX) return `이음매가 보입니다 (경계 색차 ${gap.toFixed(0)})`;
  const s = seamLocalOk(origRaw, comp, W, H, r);
  if (!s.ok) return `이음매가 보입니다 (경계 p99 ${s.p99}, 연속 ${Math.max(s.runHigh, s.runMid)}px)`;

  // 띠 **안쪽 배경**도 본다. 경계만 재면 "테두리는 원본에 맞추고 안쪽만 밝게"
  // 그린 결과가 통과한다 — 실측(2026-09-01 M19 「눈으로 보는 강력 진동」):
  // 경계 검사를 통과했는데 띠 자리에 밝은 사각형 자국이 남았다.
  // 띠는 대부분 배경이고 글자는 소수라 **중앙값**이 배경을 대표한다.
  // 실측 분리: 정상 띠 10개 중 8개가 0.1~3.3, 자국이 보인 2개가 12.4·13.7.
  const median = (buf: Uint8Array) => {
    const v: number[] = [];
    for (let y = band.top; y < band.top + band.height; y++) {
      for (let x = band.left; x < band.left + band.width; x++) {
        const i = (y * W + x) * 4;
        v.push(0.299 * buf[i] + 0.587 * buf[i + 1] + 0.114 * buf[i + 2]);
      }
    }
    v.sort((a, b) => a - b);
    return v[v.length >> 1];
  };
  const inner = Math.abs(median(comp) - median(origRaw));
  if (inner > BAND_INNER_MAX) return `덧댄 자국이 보입니다 (배경 밝기 차 ${inner.toFixed(0)})`;
  return null;
}

type GifPatchResult =
  /** keptOriginal: 정지가 아니거나 관문에 걸려 **원문을 그대로 둔** 문구(원문 한자) */
  | { patch: Image; overlayBoxes: OcrBox[]; keptOriginal: string[] }
  | { patch: null; reason: string };

/**
 * GIF 정지 패치 — 글자가 있는 **정지 띠만** 모델로 다시 그려 모든 프레임에
 * 같은 픽셀로 얹는다.
 *
 * 프레임마다 모델을 돌리면 그림이 미묘하게 달라져 애니메이션이 떨린다.
 * 같은 패치를 얹으면 떨림이 원천적으로 없다.
 *
 * 2026-08-31 전환: 예전에는 **프레임 전체**를 재생성한 뒤 원본 좌표대로 박스를
 * 오려 붙였는데, 정지 이미지에서 이미 폐기된 그 방식이 GIF 에만 남아 있었다 —
 * 모델이 한국어 길이에 맞춰 판을 다시 흘리므로(reflow) 오려낸 자리가 어긋나
 * 꼬리가 잘리고(경계 침범), 좌표 검수가 전량 불합격이었다. 실측(H007): 글자
 * 4개가 전부 완전 정지인데도 "GIF 정지 패치 실패"로 떨어졌다.
 * 이제 정지 이미지와 같은 국소 편집을 쓴다 — 글자 띠를 잘라 통째로 다시 그리고
 * 통째로 얹으므로 재조판이 띠 안에서 끝나 잘림이 구조적으로 없다.
 */
async function tryBuildGifPatch(
  data: Buffer,
  boxes: OcrBox[],
  W: number,
  H: number,
  pages: number,
  /** 운영자 승인 재렌더 — 정지 띠가 여럿이면 띠별 호출 허용 (상한 MAX_GIF_BAND_CALLS) */
  adminApproved: boolean,
): Promise<GifPatchResult> {
  try {
    if (pages > GIF_PATCH_MAX_PAGES) {
      return { patch: null, reason: `프레임이 너무 많습니다 (${pages}장)` };
    }
    if (pages * W * H > MAX_GIF_TOTAL_PIXELS) {
      return { patch: null, reason: `그림이 너무 큽니다 (${W}×${H} × ${pages}장)` };
    }
    const targets = boxes.filter((b) => (b.mode ?? "translate") === "translate" && b.ko.trim());
    if (targets.length === 0) return { patch: null, reason: "번역할 문구가 없습니다" };

    // 프레임을 **하나씩** 읽어 움직임 마스크만 누적한다. 전 프레임을 배열로
    // 들고 있으면 137프레임 GIF 에서 500MB 에 달해, 그 때문에 프레임 60장
    // 상한을 두고 통째로 배제하고 있었다(표본 47장 중 5장, 10.6%).
    const frame0 = new Uint8Array(
      await sharp(data, { page: 0, pages: 1 }).ensureAlpha().raw().toBuffer(),
    );
    const moved = new Uint8Array(W * H);
    for (let i = 1; i < pages; i++) {
      const cur = new Uint8Array(
        await sharp(data, { page: i, pages: 1 }).ensureAlpha().raw().toBuffer(),
      );
      for (let p2 = 0; p2 < W * H; p2++) {
        if (moved[p2]) continue;
        const k = p2 * 4;
        if (
          Math.abs(cur[k] - frame0[k]) > 32 ||
          Math.abs(cur[k + 1] - frame0[k + 1]) > 32 ||
          Math.abs(cur[k + 2] - frame0[k + 2]) > 32
        ) moved[p2] = 1;
      }
    }

    const keptOriginal: string[] = [];
    let groups = staticBandsOf(targets, frame0, moved, W, H);
    // 너무 큰 띠는 만들지 않는다 — 국소 편집 원칙(위 MAX_GIF_BAND_AREA 주석)
    const oversized = groups.filter((g) => (g.band.width * g.band.height) / (W * H) > MAX_GIF_BAND_AREA);
    if (oversized.length > 0) {
      groups = groups.filter((g) => !oversized.includes(g));
      for (const g of oversized) keptOriginal.push(...g.boxes.map((b) => `${b.zh} — 고칠 범위가 너무 넓습니다`));
    }
    // 띠가 너무 많으면 값진 것부터 (이미 글자 수 내림차순 정렬돼 있다)
    if (groups.length > MAX_GIF_BANDS) {
      for (const g of groups.slice(MAX_GIF_BANDS)) {
        keptOriginal.push(...g.boxes.map((b) => `${b.zh} — 문구가 너무 많습니다`));
      }
      groups = groups.slice(0, MAX_GIF_BANDS);
    }
    if (groups.length === 0) {
      // 글자가 움직이는 영상 위에 얹혀 있는 GIF — 정지 패치로는 손댈 수 없다.
      // 억지로 얹으면 그 자리의 영상이 전 프레임에 얼어붙는다.
      return { patch: null, reason: "글자가 움직이는 화면 위에 있어 자동 번역이 안 됩니다" };
    }

    const frame0Png = await sharp(data, { page: 0, pages: 1 }).png().toBuffer();
    const patchRgba = Buffer.alloc(W * H * 4); // 알파 0 = 투명
    const done: OcrBox[] = [];
    let lastFail = "";

    const renderBands = async () => {
    for (const { band, boxes: inBand } of groups) {
      // 자동 흐름은 원본당 이미지 HTTP 1회다 — 예산이 끝나면 남은 띠는 원문 유지로
      // 보고한다(운영자 재렌더에서 이어서 처리). 조용히 삼키지 않는다.
      const store = imageBudget.getStore();
      if (store && store.left <= 0) {
        lastFail = lastFail || "이미지 호출 한도 — 남은 띠는 원문 유지";
        // 남은 띠를 **사유와 함께** 남긴다. 예전엔 그냥 break 해서 이 문구들이
        // 뒤에서 "움직이는 화면 위"로 잘못 보고됐다 — 운영자는 예산이 모자랐다는
        // 사실을 알 수 없었고, 그래서 「다시 만들기」로 풀 수 있다는 것도 몰랐다
        // (실측 M18: 띠 6개 · 예산 6 이라 재시도가 나면 마지막 띠가 잘렸다).
        for (const g2 of groups.slice(groups.indexOf(groups.find((q) => q.band === band)!))) {
          keptOriginal.push(...g2.boxes.map((b) => `${b.zh} — 이미지 호출 한도`));
        }
        break;
      }
      const crop = await sharp(frame0Png).extract(band).png().toBuffer();
      const mapped = inBand.map((b) => remapBoxToBand(b, band, W, H));
      // 작은 글자는 **확대해서** 보낸다. 모델은 22px 짜리 글자를 그리다 획을
      // 뭉갠다(실측: 1회 성공한 띠는 전부 글자 41~94px, 실패한 띠는 22px).
      // 받은 그림을 다시 줄이면 모델의 미세 오차가 평균되어 오히려 또렷해진다.
      // 호출 수는 그대로다 — 규칙 1: 통과할 그림을 그리게 하는 쪽이 싸다.
      const minGlyphPx = Math.min(
        ...inBand.map((b) => ((b.box[2] - b.box[0]) / 1000) * H),
      );
      const baseScale = Math.max(1, Math.min(3, Math.ceil(TARGET_GLYPH_PX / Math.max(1, minGlyphPx))));

      // 관문을 통과할 때까지 최대 2회 — 겹침·뭉갬은 같은 프롬프트로도 다음
      // 시도에서 곧잘 사라지는 비결정 실패다(실측 2026-09-01). 2회로 못 만들면
      // 이 띠는 원문을 유지한다 — 깨진 그림을 채택하느니 원문이 낫다(무결 원칙).
      let accepted: Buffer | null = null; // 검사를 전부 통과한 띠(RGBA raw)
      let problem: string | null = null;
      for (let attempt = 1; attempt <= BAND_ATTEMPTS; attempt++) {
        const b2 = imageBudget.getStore();
        if (attempt > 1 && b2 && b2.left <= 0) break; // 예산 소진 — 직전 사유로 남긴다
        let out: Buffer;
        // 재시도는 **조건을 바꿔서** 한다 — 같은 조건 반복은 확률 재구매일 뿐이다.
        // 1차보다 한 단계 더 확대해 글자 그릴 공간을 넓힌다.
        const scale = Math.min(4, baseScale + (attempt - 1));
        const sendW = Math.round(band.width * scale);
        const sendH = Math.round(band.height * scale);
        try {
          const sendCrop =
            scale === 1 ? crop : await sharp(crop).resize(sendW, sendH, { kernel: "lanczos3" }).png().toBuffer();
          out = await callImageEdit(
            sendCrop,
            "image/png",
            bandRegenPrompt(mapped, { width: sendW, height: sendH }) +
              (attempt === 1 || !problem ? "" : bandRetryHint(problem)),
            sendW,
            sendH,
          );
        } catch (e) {
          const m = e instanceof Error ? e.message : String(e);
          // 429·5xx·타임아웃은 이 그림의 문제가 아니다 — 남은 띠도 똑같이 막히고,
          // "상태 코드와 무관하게 자동 재요청 금지" 규율에도 어긋난다. 즉시 올려
          // RETRYABLE 로 분류시킨다. 실측(2026-09-01): 월 지출 상한 초과 상태에서
          // 띠 3개 × 시도 2회 = 6번을 헛되이 두드렸다.
          // 띠가 하나뿐인 첫 시도도 원래 오류를 그대로 올린다 — 호출부 분류기가
          // 429·타임아웃(RETRYABLE)과 모델 거부를 갈라야 재시도 버튼이 뜬다.
          if (transientReason(m) || (attempt === 1 && groups.length === 1)) throw e;
          problem = m;
          continue;
        }
        problem = await bandProblem(
          out,
          mapped,
          targets.filter((t) => !inBand.includes(t)).map((t) => t.ko),
        );
        if (problem) continue;
        const rgba = await sharp(out)
          .resize(band.width, band.height, { fit: "fill" })
          .ensureAlpha()
          .raw()
          .toBuffer();
        // 이음매 검사 — 정지 이미지 경로와 같은 기준으로 "얹으면 네모가 보이는가"를
        // 픽셀로 본다(공짜). 모델이 띠 배경을 원본과 다른 밝기로 그리면 사각 자국이
        // 남는데, 글자 판독·육안 심사는 배경 밝기를 보지 않는다.
        // **페더를 넣기 전에** 본다 — 페더는 경계 1px 을 원본 쪽으로 섞어 증거를
        // 가린다. 실측: 배경이 90/230 으로 완전히 어긋난 패치도 페더 뒤에는 통과했다.
        // 실측(2026-09-01 운영 4장): seamGap 0.4~9.6 · p99 1~18 · run 0 — 정상
        // 결과는 한계(48)에 한참 못 미친다. 이 관문은 나쁜 패치만 잡는다.
        const seamProblem = bandSeamProblem(frame0, rgba, band, W, H);
        if (seamProblem) {
          problem = seamProblem;
          continue;
        }
        accepted = featherBand(rgba, band, inBand, W, H, groups.map((g) => g.band));
        break;
      }
      if (!accepted) {
        lastFail = problem ?? "글자 영역을 다시 그리지 못했습니다";
        // 왜 원문으로 남았는지 함께 남긴다 — 사유 없이 목록만 보면 운영자가
        // 무엇을 해야 할지(재시도인지·직접 올리기인지) 판단할 수 없다
        const why = lastFail.split("(")[0].trim().slice(0, 30);
        keptOriginal.push(...inBand.map((b) => `${b.zh} — ${why}`));
        continue;
      }
      const bandRgba = accepted;
      for (let y = 0; y < band.height; y++) {
        const src = y * band.width * 4;
        bandRgba.copy(patchRgba, ((band.top + y) * W + band.left) * 4, src, src + band.width * 4);
      }
      done.push(...inBand);
    }
    };

    if (adminApproved) {
      // 운영자 승인 재렌더 — 안전 폴백과 같은 별도 예산 스코프. 자동 흐름의
      // "원본당 1회"는 그대로 두고, 명시 승인에서만 띠별 호출을 허용한다.
      const bandBudget = { left: gifBandBudgetFor(groups.length), used: 0 };
      try {
        await imageBudget.run(bandBudget, renderBands);
      } finally {
        console.log(`[비용] GIF 띠 편집 ${bandBudget.used}회 ≈ $${(bandBudget.used * IMAGE_CALL_COST_USD).toFixed(3)}`);
      }
    } else {
      await renderBands();
    }

    if (done.length === 0) {
      return { patch: null, reason: lastFail || "글자 영역을 다시 그리지 못했습니다" };
    }
    const patchPng = await sharp(patchRgba, { raw: { width: W, height: H, channels: 4 } })
      .png()
      .toBuffer();
    const overlayBoxes = targets.filter((b) => !done.includes(b));
    // 띠에 못 들어간 문구(움직이는 화면 위)도 원문 유지로 함께 보고한다
    const missed = overlayBoxes
      .filter((b) => !keptOriginal.some((k) => k.startsWith(b.zh)))
      .map((b) => `${b.zh} — 움직이는 화면 위`);
    return { patch: await loadImage(patchPng), overlayBoxes, keptOriginal: [...keptOriginal, ...missed] };
  } catch (e) {
    // 삼키지 않는다 (2026-08-31 실측). 예전엔 여기서 null 로 뭉개서 429·타임아웃·
    // 안전필터 거부가 전부 "GIF 정지 패치 실패"(FAILED)로 굳었다 — 월 한도 초과
    // 때 정지 이미지는 RETRYABLE 로 살아나는데 GIF 만 재시도 승인 버튼이 안 떴다.
    // 원래 오류를 그대로 올려야 호출부 분류기(transientReason·모델 거부)가 일한다.
    throw e;
  }
}

async function renderGif(
  data: Buffer,
  boxes: OcrBox[],
  opts: { adminApproved?: boolean } = {},
): Promise<{ data: Buffer; mime: string; keptOriginal?: string[] }> {
  const meta = await sharp(data, { animated: true }).metadata();
  const pages = meta.pages ?? 1;
  const width = meta.width ?? 0;
  const height = meta.pageHeight ?? meta.height ?? 0;
  if (!width || !height) throw new Error("GIF 크기를 읽을 수 없습니다.");

  // 글자 자리가 정지해 있으면 모델 재생성 품질을 GIF 에도 쓴다.
  // 위치·크기 이동, 굵기 지정, 지우기 지시는 픽셀을 직접 만져야 지켜진다 —
  // 띠 편집으로는 보장할 수 없어 거부한다(원본 유지). 단 "원문 그대로(keep)"는
  // 예외다: keep 박스는 재생성 대상에서 빠져 원본 픽셀이 그대로 남으므로 띠
  // 편집이 지시를 정확히 지킨다. mustOverlay 처럼 keep 까지 거부하면 "깨지는
  // 문구만 원문으로 두고 나머지를 번역"하는 운영 동선이 GIF 에서 막힌다
  // (2026-09-01 마리아 GIF 실측: keep 2개 지정이 통째로 거부됐다).
  const gifUnservable = (b: OcrBox) =>
    (b.dx !== undefined && b.dx !== 0) ||
    (b.dy !== undefined && b.dy !== 0) ||
    (b.scale !== undefined && b.scale !== 1) ||
    b.weight !== undefined ||
    (b.mode === "erase" && !b.wm);
  const translatable = boxes.some((b) => (b.mode ?? "translate") === "translate" && b.ko.trim());
  const patched: GifPatchResult = boxes.some(gifUnservable)
    ? { patch: null, reason: "위치·크기·굵기·지우기 지시는 GIF 에서 지킬 수 없습니다" }
    : !translatable
      ? { patch: null, reason: "번역할 문구가 없습니다" }
      : await tryBuildGifPatch(data, boxes, width, height, pages, opts.adminApproved === true);
  // 정지 패치가 통째로 안 됐으면 프레임마다 로컬로 덧그리던 폴백을 없앴다 —
  // 잘림·겹침·네모가 전 프레임에 박제되던 경로였다(2026-08-22 신고).
  // 원본 유지가 바닥이고, 호출한 쪽이 실패로 받아 운영자 확인으로 넘긴다.
  // 사유를 실어 보낸다 — "정지 패치 실패"로 뭉뚱그리면 운영자가 무엇을 할 수
  // 있는지(재시도인지·직접 올리기인지) 판단할 수 없다.
  if (!patched.patch) throw new Error(`GIF 번역 실패 — ${patched.reason} (원본 유지)`);
  // 움직이는 문구·불합격 문구는 덧그리지 않고 원문 그대로 둔다 (관문이 잡아 재시도)
  if (patched.overlayBoxes.length > 0) {
    console.warn(`[imageTranslate] GIF 문구 ${patched.overlayBoxes.length}개 원문 유지(움직임·불합격) — 덧그리기 금지`);
  }
  const overlayBoxes: OcrBox[] = [];

  const frames: Buffer[] = [];
  const hashes: string[] = [];
  for (let i = 0; i < pages; i++) {
    const png = await sharp(data, { page: i, pages: 1 }).png().toBuffer();
    const img = await loadImage(png);
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    ctx.drawImage(patched.patch, 0, 0); // 모든 프레임에 같은 픽셀 — 떨림 없음
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

  // sharp 의 join 은 프레임 2장 미만이면 던진다 — 프레임 1장짜리 GIF 는 그대로 인코딩
  const out =
    keptFrames.length === 1
      ? await sharp(keptFrames[0]).gif().toBuffer()
      : await sharp(keptFrames, { join: { animated: true } })
          .gif({ delay: merged.delays, loop: meta.loop ?? 0 })
          .toBuffer();
  return { data: out, mime: "image/gif", keptOriginal: patched.keptOriginal };
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
export const IMAGE_MODEL = process.env.GEMINI_IMAGE_MODEL || "gemini-3.1-flash-image";
/**
 * 재생성 시도 횟수 — **1회** (설계 2026-08-24 v2.1). 재추첨은 확률 재구매일 뿐이고
 * 비용 사고의 뿌리였다. 실패하면 후보·사유를 보존하고 검수로 보낸다 —
 * 추가 1회는 운영자 승인으로만.
 */
const REGEN_ATTEMPTS = 1;

/** 운영자 개선 지시를 프롬프트에 실을 수 있는 형태 — 테스트에서 직접 검증한다 */
export function regenPromptWithHint(boxes: OcrBox[], hint?: string): string {
  return regenPrompt(boxes, hint);
}

function regenPrompt(boxes: OcrBox[], hint?: string): string {
  // 유지로 지정한 항목은 재생성 대상에서 빼야 모델이 건드리지 않는다
  const tlist = boxes
    .filter((b) => (b.mode ?? "translate") === "translate" && b.ko.trim())
    .map((b) => `- "${b.zh}" → "${sanitizeSymbols(b.ko)}"`)
    .join("\n");
  // 워터마크(wm)는 같은 호출에서 지우기까지 맡긴다 — 따로 지우면 호출이 배가 된다
  const elist = boxes
    .filter((b) => b.mode === "erase" && b.zh)
    .map((b) => `- "${b.zh}"`)
    .join("\n");
  // 프롬프트 버전 5 — 그림자·외곽선·장식 효과 유지 추가 (translateCache.PIPELINE_VERSION 과 함께 올린다)
  return `이 이미지의 중국어·일본어 글자를 아래 한국어로 바꾼 이미지를 만들어 주세요.

바꿀 문구 (반드시 이 번역 그대로, 하나도 빠짐없이):
${tlist}
${elist ? `
지울 문구 (반투명 워터마크 — 흔적 없이 지우고 그 자리에 아무것도 그리지 말 것):
${elist}
` : ""}
가장 중요한 규칙:
- 원문 글자는 반드시 지우고 그 자리에 한국어만 남긴다. 원문을 그대로 두고 옆이나 아래에 한국어를 덧붙이면 안 된다.
- 결과 이미지에 중국어·일본어가 한 글자라도 남으면 실패다. 표·스펙 목록처럼 작은 글씨가 빽빽한 칸도 빠짐없이 바꾼다.

절대 규칙:
- 글자 말고는 전부 원본 그대로 — 제품 사진, 모델, 배경, 그라데이션, 장식, 도형, 아이콘, 로고, 배지, 띠, 레이아웃, 가로세로 비율, 해상도
- 각 문구는 원문이 있던 자리에 원문과 같은 서체 느낌·크기·굵기·색·정렬·그림자·외곽선·장식 효과로
- 세로쓰기는 세로쓰기 그대로
- 라틴 문자 브랜드명·모델명·숫자·단위(mm, MIN, MAH, dB 등)는 그대로 둘 것
- 위 목록에 없는 글자는 다시 그리지 말고 원본 그대로 둘 것
- 목록에 없는 문구를 새로 만들어 넣지 말 것
- 띠·배지·버튼의 위치와 모양을 옮기거나 바꾸지 말 것${hintBlock(hint)}`;
}

/**
 * GIF 글자 띠 전용 프롬프트 — **관문이 재는 것을 그대로 지시한다.**
 *
 * 예전에는 띠 crop 에도 전체 이미지용 프롬프트(regenPrompt)를 그대로 썼다.
 * 거기엔 "제품 사진·모델·레이아웃을 지켜라" 같은, 40×200 픽셀 띠에는 뜻이 없는
 * 규칙만 있고 정작 관문이 떨어뜨리는 세 가지 — ① 네 변의 배경색이 원본과 같을 것
 * (이음매 관문) ② 같은 문구를 두 번 찍지 말 것(육안 관문) ③ 띠 밖으로 넘치지
 * 말 것(커버 검사) — 은 한마디도 없었다. 실측(2026-09-01 M18): 정지 띠 3개 중
 * 1개가 재시도 뒤에도 관문에 걸려 원문으로 남았다.
 *
 * 규칙 1(싼 단계에서 막는다)의 응용이다 — 관문에 걸려 버리는 호출($0.067)보다,
 * 애초에 통과할 그림을 그리게 지시하는 쪽이 싸다.
 */
export function bandRegenPrompt(boxes: OcrBox[], band: { width: number; height: number }): string {
  const list = boxes
    .filter((b) => (b.mode ?? "translate") === "translate" && b.ko.trim())
    .map((b) => `- "${b.zh}" → "${sanitizeSymbols(b.ko)}"`)
    .join("\n");
  return `이 그림은 상품 상세 이미지에서 **글자 부분만 잘라낸 ${band.width}×${band.height} 픽셀 띠**입니다.
같은 크기 그대로, 글자만 한국어로 바꾼 띠를 그려 주세요. 결과는 원본 이미지의 그 자리에 그대로 다시 끼워 넣습니다.

바꿀 문구 (이 번역 그대로, 각각 정확히 한 번씩):
${list}

가장 중요한 규칙:
- 원문 글자는 지우고 그 자리에 한국어만 남긴다. 원문 위에 한국어를 겹쳐 쓰지 않는다.
- **같은 문구를 두 번 그리면 실패다.** 한 번 쓴 글자를 조금 옮겨 다시 쓰거나, 흐린 잔상을 남기지 말 것.
- 결과에 중국어·일본어가 한 글자라도 남으면 실패다.
- 위 목록에 없는 글자를 새로 만들어 넣지 말 것.

이어 붙이기 규칙 (이게 지켜지지 않으면 네모 자국이 보여 통째로 버려집니다):
- 배경(색·밝기·그라데이션·무늬·질감)은 원본과 **완전히 같게** 그린다.
- 특히 **네 변의 가장자리 픽셀 색**이 원본과 조금이라도 달라지면 이어 붙인 자국이 그대로 보인다. 가장자리는 손대지 말 것.
- 띠 전체를 확대·축소·이동하지 말고, 여백이나 테두리·모서리 둥글림을 새로 만들지 말 것.
- 가장자리에서 잘린 채 걸쳐 있는 글자·도형은 잘린 그대로 둔다.

글자 규칙:
- 원문과 같은 서체 느낌·크기·굵기·색·정렬로. 그림자·외곽선·밑줄·형광펜 강조 같은 장식도 그대로.
- **글자 크기는 원문과 같게 유지한다.** 한국어가 조금 길어져도 크기를 줄이지 말고 자간을 좁혀 넣어라. 원문보다 눈에 띄게 작아지면 실패다. 도저히 안 들어갈 때만 아주 조금 줄인다.
- 원문에서 글자 색이 도중에 바뀌면(예: 앞 두 글자는 검정, 뒤는 빨강), 번역문에서는 **단어 경계**에서 바꾼다. 글자 수 비율로 잘라 단어 중간에서 색이 바뀌면 안 된다.
- 세로로 쓴 글자는 세로로, 가로는 가로로. 쓰는 방향을 바꾸지 말 것.
- 라틴 문자 브랜드명·모델명·숫자·단위(mm, MIN, MAH, dB 등)는 그대로 둔다.`;
}

/**
 * 띠 재시도 프롬프트 꼬리표 — **직전에 무엇이 틀렸는지**를 그대로 말해 준다.
 * 뭉뚱그린 "다시 그려라"로는 같은 실패를 반복했다(실측). 관문 사유별로 다르게 붙인다.
 */
export function bandRetryHint(problem: string): string {
  const head = "\n\n직전 시도는 아래 이유로 버려졌습니다. 이번에는 반드시 고쳐 주세요:\n";
  if (problem.includes("이음매")) {
    return `${head}- 배경 밝기·색이 원본과 달라 이어 붙인 자국(네모)이 보였습니다. 배경을 원본과 똑같이, 특히 네 변 가장자리 픽셀은 원본 그대로 두세요.`;
  }
  if (problem.includes("원문 잔류")) {
    return `${head}- 중국어 원문이 그대로 남아 있었습니다. 원문 획을 완전히 지우고 그 자리에 한국어만 쓰세요.`;
  }
  if (problem.includes("문구 밖 글자")) {
    return `${head}- 지시에 없는 글자가 섞였습니다. 위 목록의 문구만, 각각 정확히 한 번씩 쓰세요.`;
  }
  if (problem.includes("글자 품질")) {
    return `${head}- 글자가 겹쳐 찍히거나 획이 뭉개졌습니다. 각 문구를 정확히 한 번만, 겹침 없이 또렷한 획으로 쓰세요.`;
  }
  return `${head}- ${problem.slice(0, 120)}`;
}

/**
 * 운영자가 결과를 보고 적어 준 개선 지시.
 *
 * **절대 규칙 뒤에 붙인다** — 앞에 두면 "배경을 바꿔주세요" 같은 지시가 규칙을
 * 눌러 제품 사진이 바뀐다. 길이도 자른다: 긴 문장을 그대로 넣으면 지시가
 * 프롬프트 본문을 밀어내 번역 목록이 뒤로 흘러간다.
 */
function hintBlock(hint?: string): string {
  const h = (hint ?? "").trim().slice(0, 300);
  if (!h) return "";
  return `

운영자 개선 지시 (위 절대 규칙을 어기지 않는 선에서 반영):
${h}`;
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
  // 재시도 지정 없음 — 이미지 모델은 callGemini 가 상태 코드 무관 HTTP 1회로 강제한다
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
 * 재생성본에서 "글자 영역만" 오려 원본에 얹는다 — GIF 정지 패치와 같은 방식.
 *
 * 모델은 그림 전체를 다시 그린다. 통째로 쓰면 글자는 좋아도 글자 밖 픽셀
 * (제품 질감·로고·워터마크)까지 미세하게 달라진다 — 실측: 글자 밖 픽셀의
 * 5~15%가 밝기 10 이상 변했다. 글자 패치만 페더링으로 얹으면 글자 밖은
 * 원본과 바이트 단위로 같다. 패치 경계 사고(글자 넘침·원문 잔류)는 뒤의
 * 판독 검수(flaggedBoxes)가 잡는다 — 예전에 패치 방식을 접었던 건 이 검수가
 * 없던 시절 얘기다.
 */
export async function compositeTextPatches(
  original: Buffer,
  regenPng: Buffer,
  /** 모델이 다시 그린 영역의 박스들 — 호출한 쪽이 무엇을 얹을지 정한다 */
  targets: OcrBox[],
  W: number,
  H: number,
  /**
   * 패치가 침범하면 안 되는 이웃 박스들 — **바탕과 패치가 서로 다른 렌더일 때만**
   * 넘긴다(보정 합성·다중 시도 합성). 패치 여백(높이의 50%)이 이웃 글자 박스를
   * 덮으면 그 띠에 다른 렌더의 글자 조각이 실려 와 잔획·겹침이 남는다
   * (실측 e2e #7·#9·#11: 부제 윗줄에 흐릿한 획 띠 — 제목 패치 하단 경계에서
   * 정확히 잘림). 같은 렌더끼리는 겹쳐도 무해해서 기본은 안 자른다.
   */
  avoid?: OcrBox[],
  /** 호출한 쪽이 이미 고른(경계 검사 통과·이웃 clip 완료) 사각형 — 주면 그대로 쓴다 */
  rectsIn?: (PxBox & { feather: number })[],
): Promise<{ canvas: Canvas; rects: (PxBox & { feather: number })[] }> {
  let rects = rectsIn ?? targets.map((b) => gifPatchRect(b, W, H));
  if (!rectsIn && avoid && avoid.length > 0) {
    const avoidPx = avoid.map((b) => toPixelBox(b.box, W, H));
    rects = rects.map((r, i) => clipRectAgainst(r, toPixelBox(targets[i].box, W, H), avoidPx));
  }
  const regenRaw = new Uint8Array(await sharp(regenPng).ensureAlpha().raw().toBuffer());
  const overlay = buildPatchOverlay(regenRaw, W, H, rects);
  const overlayPng = await sharp(overlay, { raw: { width: W, height: H, channels: 4 } })
    .png()
    .toBuffer();
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(await loadImage(original), 0, 0, W, H);
  ctx.drawImage(await loadImage(overlayPng), 0, 0);
  // rects 를 함께 돌려준다 — "허용 패치 영역 밖은 원본 그대로" 검증(outsidePatchDiff)이
  // 실제로 얹은 사각형과 정확히 같은 영역으로 재야 한다 (v2.1 보강)
  return { canvas, rects };
}

/* ── 분리 성분(기본 사각형 비접촉) 허용 산식 — 해상도·글자 크기 독립 (2026-08-24 live3) ──
 *
 * 배경: 허용치를 절대 100px 로 뒀더니(live1 표본 53px 하나로 잡은 값) live3 에서
 * 모델이 글자를 크게 그려 "탭"의 ㅌ 윗획 조각이 104px 가 됐고, **4px 차이로**
 * 멀쩡한 렌더가 통째로 탈락했다. 조각 면적은 (획 길이 × 획 굵기)라 글자 높이의
 * 제곱에 비례한다 — 절대 픽셀은 애초에 기준이 될 수 없었다.
 *
 * 실측(운영 산출물, 모두 같은 원본 790×1288):
 *   live1 획 조각  area 53  bbox 16×4  길쭉함 4.00  h 30.3  area/h² 0.058  → 통과해야
 *   live3 ㅌ 윗획  area 104 bbox 18×7  길쭉함 2.57  h 31.7  area/h² 0.103  → 통과해야
 *   합성 배지      area 144 bbox 12×12 길쭉함 1.00  h 44.8  area/h² 0.072  → 거부해야
 * 여기서 나온 결론: **면적 비율만으로는 못 가른다.** 배지(0.072)가 live3 획(0.103)
 * 보다 오히려 작다. 획과 도형을 가르는 것은 길쭉함이다 — 획은 2.5~4.0, 배지는 1.0.
 * 그래서 판정은 [길쭉함] AND [면적 비율] 두 조건을 함께 본다.
 *
 * 산식 (h = 원문 글줄 두께):
 *   ① area < max(24, 0.03·h²)  → 모양 무관 통과 (자모 점·짧은 획)
 *      0.03 근거: 점 하나의 최대치 ≈ (h/6)² = 0.028·h². 글자 면적의 3% 이하만
 *      "모양 안 봐도 되는 티끌"로 인정한다. 절대 하한 24 는 안티에일리어싱 부스러기.
 *   ② 길쭉함(장변/단변) ≥ 2 여야 한다 — 아니면 거부 (배지·도장·색면 덩어리)
 *   ③ area < min(700, 0.18·h²)
 *      0.18 근거: 떨어져 나올 수 있는 한 획의 최대치 = 길이(≤ 글자 폭 ≈ h) ×
 *      굵기(≤ h/6) = 0.167·h². 여유 붙여 0.18 — **실측값에 맞춰 깎은 수가 아니라
 *      글자 기하에서 유도한 상한**이다. 검산: live1 53 < 165, live3 104 < 181
 *      (여유 74px — 4px 턱걸이였던 옛 기준과 다르다).
 *      절대 상한 700: 글자가 아무리 커도 이 이상의 독립 변화는 획으로 안 본다
 *      (h ≈ 62px 부터 상한이 먼저 걸린다). live3 조각을 2× 로 키운 416px 까지는
 *      여유가 있어 1×~2× 배율 판정이 뒤집히지 않는다.
 *
 * 배율 불변성: area 는 s², bbox 는 s, h 는 s 로 늘어 ①③의 비율과 ②의 길쭉함이
 * 모두 불변 → 같은 의미의 조각은 어느 배율에서도 같은 판정 (합성 회귀로 못 박음).
 * 절대 상한 700 만 배율 의존인데, 걸리면 **거부 방향**이라 안전하다.
 *
 * ── 기하만으로는 못 가른다 (합성 회귀가 잡아낸 구멍, 2026-08-24) ──
 * 링 안의 제품 도형이 후보 사각형에 잘리면 40×8(면적 320 = 0.16·h², 길쭉함 5.0)이
 * 되어 live3 획 조각(0.103·h², 2.57)과 상대 지표가 통째로 겹친다 — 면적·비율·
 * 길쭉함·채움비 어느 것으로도 구분이 안 된다. 실제 판별자는 **변화의 방향**이다:
 *   글자가 새로 그려지면 링 배경에 없던 잉크가 **생긴다** (원본=배경, 출력=진한 글자)
 *   제품 도형·배지가 뭉개지면 있던 잉크가 **사라진다** (원본=진한 도형, 출력=배경)
 * 그래서 분리 성분은 "잉크가 생긴 쪽"만 허용한다(④). 원문 획이 사라진 자리도
 * 여기서 거부되는데, 그건 "남은 중국어 획 청소"와 "제품 윤곽 훼손"을 픽셀만 보고
 * 구분할 수 없기 때문이다 — 애매하면 원본 유지 + 검수가 이 프로젝트의 바닥이다.
 */
const DETACHED_SPECK_MIN = 24;
const DETACHED_SHAPE_FREE_K = 0.03;
const DETACHED_GLYPH_K = 0.18;
const DETACHED_ABS_MAX_AREA = 700;
const DETACHED_ELONGATION_MIN = 2;
/** 잉크 증감 판정의 무시 구간 — 이 정도 밝기 차는 잡음으로 본다 (0~255 밝기) */
const DETACHED_INK_MARGIN = 8;

/** 분리 성분의 잉크 방향 — 링 배경 밝기에서 원본/모델출력이 각각 얼마나 떨어졌나 */
export interface DetachedInk {
  /** |원본 평균 밝기 − 링 배경 밝기| (0 이면 원본은 그냥 배경이었다) */
  origFromBg: number;
  /** |모델 출력 평균 밝기 − 링 배경 밝기| (크면 출력에 뚜렷한 잉크가 있다) */
  regenFromBg: number;
}

/** 운영(expansionRingOk)과 테스트가 이 함수 하나를 같이 쓴다 — 산식 복제 금지 */
export function detachedFragmentAllowed(
  area: number,
  bboxW: number,
  bboxH: number,
  /** 원문 글줄 두께(px) — OCR 박스의 짧은 변 (가로쓰기는 높이, 세로쓰기는 폭) */
  glyphHeightPx: number,
  ink: DetachedInk,
): boolean {
  const h = Math.max(0, glyphHeightPx);
  const h2 = h * h;
  // ③ 획 하나로 설명되는 면적 한도 (글자 크기 정규화 + 절대 상한) — 먼저 구한다.
  //    ① 의 하한이 이 한도를 넘지 못하게 묶어야 한다: 큰 제목 글자(h≈500)에서
  //    0.03·h² 는 7500px 나 돼 절대 상한을 통째로 삼켜 버린다 (테스트로 잡은 구멍)
  const cap = Math.min(DETACHED_ABS_MAX_AREA, DETACHED_GLYPH_K * h2);
  // ① 점·부스러기: 모양·방향을 안 봐도 되는 크기
  if (area < Math.min(cap, Math.max(DETACHED_SPECK_MIN, DETACHED_SHAPE_FREE_K * h2))) return true;
  // ④ 잉크가 생긴 변화만 글자로 인정 — 사라진 자리(제품 윤곽·배지 뭉갬)는 거부
  if (ink.regenFromBg <= ink.origFromBg + DETACHED_INK_MARGIN) return false;
  // ② 길쭉해야 획이다 — 정사각·원형 덩어리(배지·도장·색면)는 크기와 무관하게 거부
  const long = Math.max(bboxW, bboxH);
  const short = Math.max(1, Math.min(bboxW, bboxH));
  if (long < DETACHED_ELONGATION_MIN * short) return false;
  return area < cap;
}

/**
 * 확장 링 검증 — 확장 후보가 기본 사각형 밖으로 새로 담는 영역(링)에 "글자 획"
 * 이외의 변형(제품 윤곽·무늬·색)이 있으면 거부한다 (2026-08-24 v2.1 보강).
 *
 * 링은 채택되는 순간 모델 픽셀로 갈아끼워지므로 seam·edge 통과만으로는 부족하다.
 * 판별 규칙(live1 실측으로 보정 — 합격례 꼬리 성분: 안쪽 접촉·바깥 비접촉·채움비 0.62,
 * 비강 중앙값 3, strong 10.1%):
 *   a) 강한 변화(채널차>48) 비율 ≤ 35% — 배지·도형이 통째로 바뀌면 면적이 크다
 *   b) 강한 변화의 연결 성분(면적≥24)은 전부
 *      - 기본 사각형과 맞닿은 안쪽 경계에 닿아야 한다 (글자에서 이어져 나온 꼬리).
 *        비접촉 분리 성분은 글자 크기 정규화 산식(detachedFragmentAllowed)으로만 허용
 *      - 굵기(최소 변) > 12px 이면 채움비 ≤ 0.8 이어야 한다 (꽉 찬 덩어리 = 배지·도장·도형)
 *   c) 강한 변화를 뺀 배경 픽셀의 채널차 75퍼센타일 ≤ 12 — 무늬·색이 다시 그려졌으면
 *      잔잔한 차이가 깔린다. 링의 절반만 훼손돼도 잡히게 중앙값 대신 p75 (실측 p75 한 자리수)
 * 1px 수준의 미세한 윤곽 밀림까지는 못 잡는다 — 그건 완성본 검수·육안 승인 몫.
 */
function expansionRingOk(
  origRaw: Uint8Array,
  regenRaw: Uint8Array,
  W: number,
  H: number,
  base: PxBox,
  cand: PxBox,
  /** 원문 글줄 두께(px) — 분리 성분 허용 산식(detachedFragmentAllowed)의 정규화 기준 */
  glyphHeightPx: number,
): boolean {
  const x0 = Math.max(0, Math.round(cand.x0));
  const y0 = Math.max(0, Math.round(cand.y0));
  const x1 = Math.min(W, Math.round(cand.x1));
  const y1 = Math.min(H, Math.round(cand.y1));
  const inBase = (x: number, y: number) => x >= base.x0 && x < base.x1 && y >= base.y0 && y < base.y1;
  const rw = x1 - x0;
  const rh = y1 - y0;
  if (rw <= 0 || rh <= 0) return false;

  const strong = new Uint8Array(rw * rh);
  const diffs: number[] = [];
  /** 링의 "안 바뀐" 픽셀들의 출력 밝기 — 배경 기준값(중앙값)을 여기서 얻는다 */
  const bgLuma: number[] = [];
  const lumaAt = (raw: Uint8Array, i: number) => 0.299 * raw[i] + 0.587 * raw[i + 1] + 0.114 * raw[i + 2];
  let n = 0;
  let strongN = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (inBase(x, y)) continue;
      const i = (y * W + x) * 4;
      const d = Math.max(
        Math.abs(regenRaw[i] - origRaw[i]),
        Math.abs(regenRaw[i + 1] - origRaw[i + 1]),
        Math.abs(regenRaw[i + 2] - origRaw[i + 2]),
      );
      n++;
      if (d > 48) {
        strong[(y - y0) * rw + (x - x0)] = 1;
        strongN++;
      } else {
        diffs.push(d);
        bgLuma.push(lumaAt(regenRaw, i));
      }
    }
  }
  if (n < 32) return true; // 링이 사실상 없다
  if (strongN / n > 0.35) return false; // (a)
  diffs.sort((a, b) => a - b);
  const bgRef = median(bgLuma);
  // (c) 중앙값이 아니라 75퍼센타일 — 링의 절반만 다시 그려져도 중앙값은 깨끗한
  // 절반에 희석된다 (합성 회귀에서 실측). live1 합격례의 p75 는 한 자리수.
  if (diffs[Math.floor(diffs.length * 0.75)] > 12) return false;

  // (b) 강한 변화 성분의 기하 — BFS 로 안쪽 접촉·바깥 접촉·굵기·채움비를 잰다
  const bx0i = Math.max(0, Math.round(base.x0)) - x0;
  const by0i = Math.max(0, Math.round(base.y0)) - y0;
  const bx1i = Math.min(W, Math.round(base.x1)) - x0;
  const by1i = Math.min(H, Math.round(base.y1)) - y0;
  const touchesBaseEdge = (cx: number, cy: number): boolean =>
    // 기본 사각형 경계와 맞닿은 픽셀 — 이웃 4방향 중 하나가 base 안이면 접촉
    (cx + 1 >= bx0i && cx - 1 < bx1i && (cy === by1i || cy === by0i - 1)) ||
    (cy + 1 >= by0i && cy - 1 < by1i && (cx === bx1i || cx === bx0i - 1));
  const seen = new Uint8Array(rw * rh);
  for (let sy = 0; sy < rh; sy++) {
    for (let sx = 0; sx < rw; sx++) {
      const k0 = sy * rw + sx;
      if (!strong[k0] || seen[k0]) continue;
      const stack = [k0];
      seen[k0] = 1;
      let bxa = sx;
      let bxb = sx;
      let bya = sy;
      let byb = sy;
      let area = 0;
      let touchInner = false;
      let touchOuter = false;
      let origSum = 0;
      let regenSum = 0;
      while (stack.length) {
        const k = stack.pop()!;
        area++;
        const cx = k % rw;
        const cy = (k - cx) / rw;
        if (cx < bxa) bxa = cx;
        if (cx > bxb) bxb = cx;
        if (cy < bya) bya = cy;
        if (cy > byb) byb = cy;
        const pi = ((y0 + cy) * W + (x0 + cx)) * 4;
        origSum += lumaAt(origRaw, pi);
        regenSum += lumaAt(regenRaw, pi);
        if (touchesBaseEdge(cx, cy)) touchInner = true;
        if (cx === 0 || cy === 0 || cx === rw - 1 || cy === rh - 1) touchOuter = true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= rw || ny < 0 || ny >= rh) continue;
          const nk = ny * rw + nx;
          if (strong[nk] && !seen[nk]) {
            seen[nk] = 1;
            stack.push(nk);
          }
        }
      }
      if (area < 24) continue; // 티끌
      const w2 = bxb - bxa + 1;
      const h2 = byb - bya + 1;
      // 안쪽(기본 사각형) 비접촉 = 글자에서 이어진 게 아닌 독립 변화. 단 한글은
      // 자모가 끊겨 조각(점·가로획)이 떨어져 나온다(live1 실측 53px, live3 실측
      // ㅌ 윗획 104px) — 허용은 글자 크기 정규화 산식 하나로 판정한다.
      if (
        !touchInner &&
        !detachedFragmentAllowed(area, w2, h2, glyphHeightPx, {
          origFromBg: Math.abs(origSum / area - bgRef),
          regenFromBg: Math.abs(regenSum / area - bgRef),
        })
      ) {
        return false;
      }
      // 바깥 경계 접촉은 여기서 따로 보지 않는다 — 후보 사각형 "밖"의 연속 변화는
      // edgeCrossing(cand) 이 이미 막았다.
      void touchOuter;
      const minDim = Math.min(w2, h2);
      const fill = area / (w2 * h2);
      if (minDim > 12 && fill > 0.8) return false; // 꽉 찬 덩어리 — 배지·도장·도형
    }
  }
  return true;
}

/**
 * 패치 사각형 후보 사다리 — 임계값(SEAM_MAX·EDGE_CROSS_MAX)은 그대로 두고,
 * 모델이 한국어를 원문 박스보다 크게 그린 경우 사각형을 키워 글자를 통째로 담는다.
 * 실측(live1, 2026-08-24): "上下拍打G点"→"G점 두드림 자극"이 기본 사각형에서
 * edge=116.5(상한 45)로 탈락했지만 세로 2배 사각형에서는 edge=31.4·seam=17.1 로
 * 같은 임계값을 통과했다 — 글자가 큰 것이지 경계가 더러운 게 아니었다.
 * 키운 후보는 ① 이웃 박스 침범 금지(clipRectAgainst) ② 확장 링에 글자 획 외의
 * 변형 금지(expansionRingOk)를 다 통과해야 채택된다. 전부 실패하면 null —
 * 호출한 쪽이 원문 유지 + PATCH_REJECTED 로 검수에 보낸다.
 * regenerateStill 과 테스트가 이 함수 하나를 같이 쓴다 (알고리즘 복제 금지).
 */
export function chooseSafePatchRect(
  origRaw: Uint8Array,
  regenRaw: Uint8Array,
  W: number,
  H: number,
  b: OcrBox,
  othersPx: PxBox[],
  /** 편집 금지 영역(라틴·브랜드·숫자·모델코드) — 이걸 건드리는 후보는 쓰지 않는다 (H3) */
  preserved: PreservedItem[] = [],
): { rect: PxBox & { feather: number }; scaled: boolean; scale: [number, number] } | null {
  const RECT_CANDIDATES: [number, number][] = [[1, 1], [1, 1.5], [1, 2], [1.5, 2]];
  const base = gifPatchRect(b, W, H);
  const p = toPixelBox(b.box, W, H);
  // 글줄 두께 — 가로쓰기는 박스 높이, 세로쓰기는 박스 폭. 링 분리 성분 정규화 기준
  const glyphHeightPx = Math.max(1, Math.min(p.x1 - p.x0, p.y1 - p.y0));
  for (const [mx, my] of RECT_CANDIDATES) {
    const scaled = mx !== 1 || my !== 1;
    let r = gifPatchRect(b, W, H, mx, my);
    if (scaled) {
      r = { ...clipRectAgainst(r, p, othersPx), feather: r.feather };
      // 잘리고 나니 기본과 같다면 새 후보가 아니다
      if (r.x0 >= base.x0 && r.y0 >= base.y0 && r.x1 <= base.x1 && r.y1 <= base.y1) continue;
    }
    // 보존 영역을 삼키는 후보는 쓸 수 없다 — 그 픽셀이 모델 것으로 갈리면
    // 영문 장식·모델코드가 소실·변형된다. 기본 사각형부터 겹치면 중국어와
    // 장식이 안전하게 분리되지 않는 자리이므로 억지로 번역하지 않는다 (H3).
    const hit = rectHitsPreserved(r, W, H, preserved);
    if (hit) {
      console.log(`[imageTranslate] 보존 영역 겹침으로 후보 거부: ${b.zh.slice(0, 12)} ↔ "${hit.text.slice(0, 20)}"`);
      continue;
    }
    if (seamGap(origRaw, regenRaw, W, H, r) > SEAM_MAX) continue;
    if (edgeCrossing(origRaw, regenRaw, W, H, r) > EDGE_CROSS_MAX) continue;
    // 국소 이음매 — 평균(seamGap)이 희석시키는 "끊긴 경계"를 잡는다 (2026-08-24).
    // 실측: live3 채택본 A点 패치가 seamGap 10.8 로 통과했지만 경계 국소 p99 92·
    // 연속 50px 단차로 배경 대각선이 눈에 보이게 끊겨 있었다.
    const sl = seamLocalOk(origRaw, regenRaw, W, H, r);
    if (!sl.ok) {
      console.log(
        `[imageTranslate] 국소 이음매 거부: ${b.zh.slice(0, 12)} x${mx}/y${my} p99=${sl.p99} run48=${sl.runHigh} run32=${sl.runMid} (진단 max=${sl.max})`,
      );
      continue;
    }
    if (scaled && !expansionRingOk(origRaw, regenRaw, W, H, base, r, glyphHeightPx)) continue;
    return { rect: r, scaled, scale: [mx, my] };
  }
  return null;
}

/**
 * 번역 대상 문구 하나의 처리 결과. **모든 대상이 정확히 하나의 상태**를 가져야 한다 —
 * 렌더 목록에서 조용히 빠지는 문구를 막기 위한 추적표다 (live10 대응).
 */
export interface PhraseTrace {
  /** 순서가 아니라 (원문 + 박스)로 만든 안정 ID — 배열이 재정렬돼도 대응이 안 깨진다 */
  id: string;
  zh: string;
  ko: string;
  status: "translated" | "patch_rejected";
  rect?: { x0: number; y0: number; x1: number; y1: number };
  detail?: string;
}

/** 안정 패치 ID — 원문과 박스 좌표에서 만든다 (인덱스 의존 금지) */
export function phraseId(b: { zh: string; box: [number, number, number, number] }): string {
  return `${b.box.join(",")}|${b.zh.replace(/\s+/g, "").slice(0, 24)}`;
}

async function regenerateStill(
  data: Buffer,
  mime: string,
  boxes: OcrBox[],
  /** 편집 금지 영역 — 패치가 삼키면 영문·모델코드가 갈린다 (H3) */
  preserved: PreservedItem[] = [],
  /** 운영자 개선 지시 — 재생성 프롬프트에 실린다 */
  hint?: string,
): Promise<{
  data: Buffer;
  mime: string;
  pending: OcrBox[];
  /** 실제로 얹은 패치 사각형 — 이 밖의 픽셀은 원본과 같아야 한다(밖 변화 검증용) */
  patchRects: PxBox[];
  /** 인코딩 전 합성본(PNG 무손실) — JPEG 재압축 노이즈 없이 픽셀 단위 검증용 */
  compositePng: Buffer;
  /**
   * 확장 후보(기본 rect 아닌 것)로 얹은 패치 — 링 검증이 완벽하지 않아
   * (실측 미탐: 링 안 장식 진해짐·윤곽 6px 밀림) 자동 VERIFIED 금지 대상 (2026-08-24)
   */
  expanded: { zh: string; rect: PxBox; scale: [number, number] }[];
  /** 번역 대상 문구별 처리 결과 — 하나도 빠지면 안 된다 */
  trace: PhraseTrace[];
}> {
  const meta = await sharp(data).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) throw new Error("이미지 크기를 읽을 수 없습니다.");

  const png = await callImageEdit(data, mime, regenPrompt(boxes, hint), W, H);
  // 지움(워터마크) 박스도 패치 대상이다 — 빼면 모델이 지워 준 자리가 합성에서
  // 빠져 워터마크가 도로 남는다
  const targets = boxes.filter(
    (b) => ((b.mode ?? "translate") === "translate" && b.ko.trim()) || b.mode === "erase",
  );

  // 패치마다 "얹어도 되는지"를 가른다 — 배경을 다시 그린 패치를 그대로 얹으면
  // 사진·그라데이션 위에서 사각형 자국이 보이고(운영 신고), 글자가 패치 밖까지
  // 그려진 박스는 얹으면 꼬리가 페더에 걸려 흐릿하게 잘린다("깊은 진~" 무늬).
  // 불합격 박스는 pending 으로 올려 보정 경로(모델 지우기+직접 그리기)에 합류
  // 시킨다 — 예전처럼 로컬 지우개로 여기서 처리하면 그라데이션 배경에 흰
  // 얼룩이 남는다(실측 q1: 보라 배경 제목 뒤 흰 뭉개짐).
  const origRaw = new Uint8Array(await sharp(data).ensureAlpha().raw().toBuffer());
  const regenRaw = new Uint8Array(await sharp(png).ensureAlpha().raw().toBuffer());
  const clean: OcrBox[] = [];
  const chosenRects: (PxBox & { feather: number })[] = [];
  const pending: OcrBox[] = [];
  const expanded: { zh: string; rect: PxBox; scale: [number, number] }[] = [];
  // 문구별 추적 — 렌더 대상에서 조용히 빠지는 문구가 없도록 모든 대상에 상태를 남긴다.
  // id 는 순서가 아니라 (원문 + 박스 좌표)로 만든다 — 배열이 재정렬돼도 대응이 안 깨진다.
  const trace: PhraseTrace[] = [];
  // 사각형 선택은 chooseSafePatchRect 하나에 있다 — 후보 사다리·이웃 clip·확장 링
  // 검증 규칙과 그 이유는 함수 주석 참조. 테스트도 같은 함수를 직접 부른다.
  for (const b of targets) {
    const others = targets.filter((t) => t !== b).map((t) => toPixelBox(t.box, W, H));
    const picked = chooseSafePatchRect(origRaw, regenRaw, W, H, b, others, preserved);
    const id = phraseId(b);
    if (picked) {
      if (picked.scaled) {
        console.log(`[imageTranslate] 패치 사각형 확장 채택: ${b.zh.slice(0, 12)} x${picked.scale[0]}/y${picked.scale[1]}`);
        expanded.push({ zh: b.zh, rect: { x0: picked.rect.x0, y0: picked.rect.y0, x1: picked.rect.x1, y1: picked.rect.y1 }, scale: picked.scale });
      }
      clean.push(b);
      chosenRects.push(picked.rect);
      trace.push({ id, zh: b.zh, ko: b.ko, status: "translated", rect: { x0: picked.rect.x0, y0: picked.rect.y0, x1: picked.rect.x1, y1: picked.rect.y1 } });
    } else {
      pending.push(b);
      // 왜 못 얹었는지 수치를 남긴다 — "경계 실패"로 뭉뚱그리면 원인을 못 좁힌다
      const base = gifPatchRect(b, W, H);
      const sl = seamLocalOk(origRaw, regenRaw, W, H, base);
      trace.push({ id, zh: b.zh, ko: b.ko, status: "patch_rejected", detail: `국소p99=${sl.p99} run48=${sl.runHigh} edge=${edgeCrossing(origRaw, regenRaw, W, H, base).toFixed(0)}` });
    }
  }
  if (pending.length > 0) {
    console.warn(`[imageTranslate] 패치 경계 어긋남 ${pending.length}/${targets.length}건 — 원문 유지, 검수로`);
  }

  const { canvas, rects } = await compositeTextPatches(data, png, clean, W, H, undefined, chosenRects);
  const compositePng = canvas.toBuffer("image/png");
  return mime === "image/png"
    ? { data: compositePng, mime, pending, patchRects: rects, compositePng, expanded, trace }
    : { data: canvas.toBuffer("image/jpeg", 95), mime: "image/jpeg", pending, patchRects: rects, compositePng, expanded, trace };
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
  // 워터마크 자동 지움(wm)은 어드민 지시가 아니다 — 이것 때문에 오버레이로
  // 빠지면 워터마크 있는 모든 이미지의 글자가 오버레이 품질로 떨어진다
  if (boxes.some((b) => hasManualOverride(b) || (b.mode === "erase" && !b.wm))) return true;
  return !boxes.some((b) => (b.mode ?? "translate") === "translate" && b.ko.trim());
}

/**
 * 다른 문구 박스와 겹치는 워터마크는 지우지 않는다.
 *
 * 표·스펙을 가로지르는 워터마크의 지움 패치는 그 띠 안의 **이웃 글자까지
 * 모델이 다시 그린 픽셀**로 갈아끼운다 — 실측(m5 스펙표): 제품명·재질 칸
 * 글자가 유령처럼 겹치고 획이 변형됐다. 겹치는 워터마크는 희미하게 남는 쪽이
 * 글자가 깨지는 쪽보다 낫다. 떨어져 있는 워터마크만 지운다.
 */
export function dropRiskyWm(boxes: OcrBox[], margin = 25): OcrBox[] {
  const touches = (a: [number, number, number, number], b: [number, number, number, number]) =>
    a[0] - margin < b[2] && b[0] - margin < a[2] && a[1] - margin < b[3] && b[1] - margin < a[3];
  return boxes.filter(
    (b) => !b.wm || !boxes.some((o) => o !== b && !o.wm && touches(b.box, o.box)),
  );
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
    // 8000 에서는 문구 37개짜리 이미지의 응답이 잘려 검수 전체가 무너졌다(실측)
    { maxOutputTokens: 16000, responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "minimal" } },
  );
  const text = textOf(parts);
  if (!text.trim()) throw new Error("모델 거부(빈 응답)");
  // 잘린 응답에서도 온전한 줄은 건진다 — 통째 파싱 실패로 검수를 포기하면
  // 그 이미지는 무검수로 나간다 (짤림·잔류가 그대로 노출된 원인)
  const raw = parseJsonArrayLoose(text);
  if (raw === null) throw new Error(`판독 불가 응답: ${text.slice(0, 80)}`);
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

/** 비교용 정규화 — 공백·문장부호·장식부호(~ ⋯ ※ 등)는 모델이 흘리기 쉬워 뺀다.
 *  ~ 를 안 빼면 "깊은 진~"(잘린 채 물결로 마감) 이 "깊은 진동"의 앞부분으로
 *  인정되지 않아 잘림 검사(truncatedTail·brokenWordTail)를 전부 비껴갔다. */
const forCompare = (s: string): string => s.replace(/[\s.,·:;!?()[\]{}'"“”‘’\-–—/+~～⁓∼…⋯*※]/g, "");

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
 * 어절이 깨진 채 잘렸는지 — 한 글자 차이라도 잡는다.
 *
 * truncatedTail 은 OCR 이 끝 글자를 흘리는 오차 때문에 두 글자부터 본다. 그런데
 * 그 여유가 "짧게 눌러 헤드 모드 변경" → "…모드 변" 처럼 **어절 중간에서 한
 * 글자만 잘린 것**을 통과시켰다(운영 스크린샷 신고). 잘린 지점이 어절 중간이면
 * OCR 오차가 아니라 진짜 잘림이므로 한 글자부터 잡고, 어절 경계에서 끊겼으면
 * (통짜 어절 누락) 기존 truncatedTail 의 두 글자 기준에 맡긴다.
 */
export function brokenWordTail(expected: string, observed: string): boolean {
  const e = forCompare(expected);
  const o = forCompare(observed);
  if (!(o.length > 0 && e.length > o.length && e.startsWith(o))) return false;
  // 원문에서 o 의 마지막 글자가 나온 위치를 찾는다 (부호·공백은 비교에서 빠졌으므로 걸러 센다)
  let idx = -1;
  let taken = 0;
  for (let i = 0; i < expected.length && taken < o.length; i++) {
    if (forCompare(expected[i]).length > 0) {
      taken++;
      idx = i;
    }
  }
  if (idx < 0) return false;
  // 잘린 지점 뒤의 첫 실제 글자가 같은 어절인지 — 공백을 만나면 경계에서 끊긴 것
  for (let j = idx + 1; j < expected.length; j++) {
    const c = expected[j];
    if (/\s/.test(c)) return false;
    if (forCompare(c).length > 0) return true;
  }
  return false; // 남은 게 문장부호뿐 — 잘림 아님
}

/**
 * 잘린 글자가 낱자(자모)로 찍혔는지.
 *
 * "부드러운"이 획 중간에서 잘리면 OCR 이 "부드러ㄷ"처럼 마지막을 낱자로 읽는다
 * (운영 스크린샷: "전신 부드러ㄷ"). 이때는 찍힌 글자가 기대 문구의 앞부분
 * 그대로가 아니라서 prefix 기반 잘림 검사가 전부 빗나간다. 완성된 번역문이
 * 낱자로 끝나는 일은 없으므로, 기대 문구가 그 낱자로 끝나는 특수한 경우가
 * 아닌 한 잘림(또는 딴 글자)이다.
 */
export function choppedGlyphTail(expected: string, observed: string): boolean {
  const e = forCompare(expected);
  const o = forCompare(observed);
  if (!o) return false;
  const last = o[o.length - 1];
  return /[ㄱ-ㅎㅏ-ㅣ]/.test(last) && !e.endsWith(last);
}

/** 박스 영역의 밝기 표준편차 — 글자 획이 있으면 크고, 민 배경이면 작다 */
export function regionStdev(
  raw: Uint8Array,
  W: number,
  b: { x0: number; y0: number; x1: number; y1: number },
): number {
  let n = 0;
  let s = 0;
  let s2 = 0;
  // toPixelBox 는 소수 좌표를 준다 — 그대로 인덱스로 쓰면 전부 NaN
  const y0 = Math.max(0, Math.round(b.y0));
  const x0 = Math.max(0, Math.round(b.x0));
  const y1 = Math.round(b.y1);
  const x1 = Math.round(b.x1);
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      const l = 0.299 * raw[i] + 0.587 * raw[i + 1] + 0.114 * raw[i + 2];
      s += l;
      s2 += l * l;
      n++;
    }
  }
  if (n === 0) return 0;
  const m = s / n;
  return Math.sqrt(Math.max(0, s2 / n - m * m));
}

/**
 * 지운 자리에 잔상(유령 획·뭉개짐)이 남았는지 — 내부 거칠기 ÷ 주변 거칠기.
 *
 * 모델 지우기가 글자를 반쯤만 지우면 반투명 획·얼룩이 남는다(운영 신고:
 * 빨간 제품 이미지에서 "지웠더니 이미지가 뭉개짐"). 경계 검사(seamGap)는
 * 패치 테두리만 보므로 내부 잔상은 통과했다. 절대 편차로 보면 실크·그라데이션
 * 같은 질감 배경을 오탐하므로, 바로 바깥 링(같은 배경)과의 비율로 본다 —
 * 깨끗이 지웠으면 내부 질감 ≈ 주변 질감이다.
 */
export function ghostResidue(
  raw: Uint8Array,
  W: number,
  H: number,
  box: { x0: number; y0: number; x1: number; y1: number },
  /** 링 표본에서 제외할 영역 — 이웃 글자 박스가 링에 물리면 비율이 오염된다 */
  exclude: { x0: number; y0: number; x1: number; y1: number }[] = [],
): number {
  const bx0 = Math.max(0, Math.round(box.x0));
  const by0 = Math.max(0, Math.round(box.y0));
  const bx1 = Math.min(W, Math.round(box.x1));
  const by1 = Math.min(H, Math.round(box.y1));
  const w = bx1 - bx0;
  const h = by1 - by0;
  if (w < 12 || h < 12) return 0; // 너무 작으면 판정 무의미

  // 내부: 페더 경계를 피해 12% 안쪽만 본다
  const sx = Math.max(2, Math.round(w * 0.12));
  const sy = Math.max(2, Math.round(h * 0.12));
  const interior = regionStdev(raw, W, { x0: bx0 + sx, y0: by0 + sy, x1: bx1 - sx, y1: by1 - sy });

  // 링: 박스 밖 4~16px 띠 (다른 지움 박스와 겹치는 픽셀은 제외)
  const inBox = (x: number, y: number, b: { x0: number; y0: number; x1: number; y1: number }) =>
    x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1;
  let n = 0;
  let s = 0;
  let s2 = 0;
  for (let y = Math.max(0, by0 - 16); y < Math.min(H, by1 + 16); y++) {
    for (let x = Math.max(0, bx0 - 16); x < Math.min(W, bx1 + 16); x++) {
      if (inBox(x, y, { x0: bx0 - 4, y0: by0 - 4, x1: bx1 + 4, y1: by1 + 4 })) continue;
      if (exclude.some((b) => inBox(x, y, b))) continue;
      const i = (y * W + x) * 4;
      const l = 0.299 * raw[i] + 0.587 * raw[i + 1] + 0.114 * raw[i + 2];
      s += l;
      s2 += l * l;
      n++;
    }
  }
  if (n < 64) return 0; // 링 표본이 부족하면 판정하지 않는다
  const m = s / n;
  const ring = Math.sqrt(Math.max(0, s2 / n - m * m));
  return interior / Math.max(ring, 6);
}

/** 이 비율을 넘으면 지운 자리에 잔상이 남은 것 — 주변 질감의 배수 */
const GHOST_MAX = 2;

/**
 * 재생성 글자가 패치 경계를 삐져나갔는지 — 변을 4등분한 조각별 평균 채널차의 최댓값.
 *
 * 모델은 한국어가 원문보다 길면 박스 밖까지 글자를 그린다. 패치는 박스 크기로
 * 오려 붙이므로 삐져나간 꼬리가 페더에 걸려 **흐릿하게 사라지는 잘림**이 된다
 * (실측 q1: "강렬한 깊은 자극"의 "자극"이 반투명하게 바램 — 운영 신고
 * "깊은 진~"과 같은 무늬). 전체 둘레 평균(seamGap)은 한쪽 끝의 국소적 침범이
 * 희석돼 통과하므로, 변을 조각내 최댓값으로 본다.
 */
export function edgeCrossing(
  orig: Uint8Array,
  regen: Uint8Array,
  W: number,
  H: number,
  r: { x0: number; y0: number; x1: number; y1: number },
  band = 4,
): number {
  const x0 = Math.max(0, Math.round(r.x0));
  const y0 = Math.max(0, Math.round(r.y0));
  const x1 = Math.min(W, Math.round(r.x1));
  const y1 = Math.min(H, Math.round(r.y1));
  if (x1 - x0 < 8 || y1 - y0 < 8) return 0;

  const segMean = (sx0: number, sy0: number, sx1: number, sy1: number): number => {
    let n = 0;
    let s = 0;
    let os = 0;
    let os2 = 0;
    let rs = 0;
    let rs2 = 0;
    for (let y = Math.max(0, sy0); y < Math.min(H, sy1); y++) {
      for (let x = Math.max(0, sx0); x < Math.min(W, sx1); x++) {
        const i = (y * W + x) * 4;
        s += Math.max(
          Math.abs(regen[i] - orig[i]),
          Math.abs(regen[i + 1] - orig[i + 1]),
          Math.abs(regen[i + 2] - orig[i + 2]),
        );
        const lo = 0.299 * orig[i] + 0.587 * orig[i + 1] + 0.114 * orig[i + 2];
        const lr = 0.299 * regen[i] + 0.587 * regen[i + 1] + 0.114 * regen[i + 2];
        os += lo;
        os2 += lo * lo;
        rs += lr;
        rs2 += lr * lr;
        n++;
      }
    }
    if (n === 0) return 0;
    // "차이가 크다"만 보면 안 된다 — 모델 출력의 미세 드리프트는 윤곽·반짝이
    // 질감 위에서 큰 차이를 내지만, 그건 같은 질감이 밀린 것이라 조각의 편차
    // (거칠기)는 그대로다. 글자 꼬리가 새로 그려진 조각만 편차가 확 는다.
    // 편차가 늘지 않은 조각은 침범이 아니다 (실측: 드리프트 오탐으로 16/17
    // 강등 → 이 조건 추가 후 정상).
    const om = os / n;
    const rm = rs / n;
    const oStdev = Math.sqrt(Math.max(0, os2 / n - om * om));
    const rStdev = Math.sqrt(Math.max(0, rs2 / n - rm * rm));
    if (rStdev - oStdev < 15) return 0;
    return s / n;
  };

  let worst = 0;
  const quarters = (a: number, b: number) => {
    const q = (b - a) / 4;
    return [0, 1, 2, 3].map((k) => [Math.round(a + q * k), Math.round(a + q * (k + 1))] as const);
  };
  for (const [a, b] of quarters(x0, x1)) {
    worst = Math.max(worst, segMean(a, y0 - band, b, y0)); // 위
    worst = Math.max(worst, segMean(a, y1, b, y1 + band)); // 아래
  }
  for (const [a, b] of quarters(y0, y1)) {
    worst = Math.max(worst, segMean(x0 - band, a, x0, b)); // 왼쪽
    worst = Math.max(worst, segMean(x1, a, x1 + band, b)); // 오른쪽
  }
  return worst;
}

/** 이 값을 넘는 조각이 있으면 글자가 경계를 넘은 것 — 그 패치는 얹으면 잘려 보인다 */
const EDGE_CROSS_MAX = 45;

/**
 * 번역문이 들어가야 할 자리가 "지워진 채 방치"됐는지.
 *
 * 검수는 찍힌 글자를 읽어 대조하는데, 모델이 원문을 지우고 **아무것도 안 그리면**
 * 읽을 글자가 없어 "못 읽은 자리는 건드리지 않는다" 구멍으로 통과했다
 * (운영 스크린샷: 제목이 흰 뭉개짐으로 나감). 글자를 못 읽은 자리는 픽셀로
 * 한 번 더 본다 — 원본엔 획 대비가 있었는데 결과가 평탄하면 빈 자리다.
 * 결과에 획 대비가 남아 있으면(그렸는데 OCR 이 못 읽은 것) 건드리지 않는다.
 */
export function blankedBox(
  origRaw: Uint8Array,
  outRaw: Uint8Array,
  W: number,
  H: number,
  box: [number, number, number, number],
): boolean {
  const p = toPixelBox(box, W, H);
  if (p.x1 - p.x0 < 4 || p.y1 - p.y0 < 4) return false;
  const before = regionStdev(origRaw, W, p);
  const after = regionStdev(outRaw, W, p);
  return before >= MIN_TEXT_STDDEV && after < Math.min(12, before * 0.35);
}

/**
 * 판독이 못 읽은 번역 박스가 "원본과 사실상 같은 픽셀"인지 — 원문 잔류 검출.
 *
 * 번역 박스는 반드시 픽셀이 크게 변해야 한다(중국어 획 → 한국어 획). 판독이
 * 그 줄을 통째로 빠뜨리면(API 혼잡 때 실측) 글자 대조가 불가능한데, 원문이
 * 그대로면 재생성 드리프트뿐이라 강한 변화가 거의 없다. 실측(2026-08-18):
 *   원문 잔류 3건: 0.036 / 0.062 / 0.089
 *   같은 이미지의 정상 번역: 0.48 / 0.50
 *   운영 310박스 분포의 깨끗한 바닥: ~0.16 (그 아래 꼬리는 전부 알려진 결함 장)
 * 0.12 는 양쪽에서 여유가 있고, 오탐해도 보정 한 번 더 도는 비용뿐이다.
 */
const UNCHANGED_DELTA = 48;
const UNCHANGED_MAX_FRAC = 0.12;
export function unchangedBox(
  origRaw: Uint8Array,
  outRaw: Uint8Array,
  W: number,
  H: number,
  box: [number, number, number, number],
): boolean {
  const p = toPixelBox(box, W, H);
  // toPixelBox 는 실수 좌표를 준다 — 그대로 인덱스로 쓰면 전부 NaN 비교가 된다
  const x0 = Math.max(0, Math.round(p.x0));
  const y0 = Math.max(0, Math.round(p.y0));
  const x1 = Math.min(W, Math.round(p.x1));
  const y1 = Math.min(H, Math.round(p.y1));
  if (x1 - x0 < 4 || y1 - y0 < 4) return false;
  let changed = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * W + x) * 4;
      const d = Math.max(
        Math.abs(outRaw[i] - origRaw[i]),
        Math.abs(outRaw[i + 1] - origRaw[i + 1]),
        Math.abs(outRaw[i + 2] - origRaw[i + 2]),
      );
      if (d > UNCHANGED_DELTA) changed++;
      n++;
    }
  }
  return changed / n < UNCHANGED_MAX_FRAC;
}

/**
 * 다시 손봐야 하는 문구를 고른다 — 원문이 남았거나, 번역문이 잘렸거나,
 * 지워진 채 비어 있거나.
 *
 * 글자 검사는 "완성본에 찍힌 글자"에서 나오므로 모델 호출은 한 번이고,
 * 빈 자리 검사는 픽셀 비교라 공짜다.
 */
/**
 * 최종 판독 교차 읽기 — 전체 1회 + 띠(상·중·하) (live11 실측 대응).
 *
 * 전체 한 장만 읽으면 작은 글자(표 셀·측면 라벨)를 통째로 빠뜨린다. live11 #04·#06 은
 * 렌더가 정확했는데도 판독이 셀을 못 읽어 확정 문구가 "미검출"로 9~10건 뜨고
 * 숫자까지 소실로 잡혔다 — 렌더 결함이 아니라 **검사 눈이 어두운** 것이었다.
 * 띠로 자르면 글자가 상대적으로 커져 살아난다. 텍스트 3회 추가(장당 ₩3 미만).
 * 합치기는 좌표 기준 — 같은 줄을 두 번 담아도 검사에 해가 없다(존재 확인용).
 */
async function transcribeTextCross(
  data: Buffer,
  mime: string,
): Promise<{ box: [number, number, number, number]; text: string }[]> {
  const full = await transcribeText(data, mime);
  const meta = await sharp(data).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) return full;
  const out = [...full];
  for (const [top, hFrac] of OCR_BANDS) {
    const cropTop = Math.round(top * H);
    const cropH = Math.min(H - cropTop, Math.round(hFrac * H));
    if (cropH < 8) continue;
    try {
      const crop = await sharp(data).extract({ left: 0, top: cropTop, width: W, height: cropH }).png().toBuffer();
      const got = await transcribeText(crop, "image/png");
      out.push(...got.map((l) => ({ ...l, box: remapBandBox(l.box, cropTop / H, cropH / H) })));
    } catch (e) {
      // 한도·인증 오류는 띠를 더 돌려도 같다 — 즉시 중단해 요청을 낭비하지 않는다
      if (isFatalApiError(e instanceof Error ? e.message : String(e))) throw e;
    }
  }
  return out;
}

async function flaggedBoxes(
  out: Buffer,
  mime: string,
  targets: OcrBox[],
  /** 번역문이 다 찍혔는지도 볼지. 글자를 아직 안 그린 "지우기 결과"에는 끈다 */
  checkCoverage = true,
  /** 원본 이미지 — 주면 "지워진 채 빈 자리" 픽셀 검사가 켜진다 */
  origData?: Buffer,
  /** 이미 판독한 줄 — 자동 흐름이 판독을 한 번만 하고 재사용할 수 있게 */
  linesIn?: { box: [number, number, number, number]; text: string }[],
): Promise<OcrBox[]> {
  let lines: { box: [number, number, number, number]; text: string }[];
  if (linesIn) lines = linesIn;
  else try {
    lines = await transcribeText(out, mime);
  } catch {
    // 일시 오류일 수 있으니 한 번은 다시
    try {
      lines = await transcribeText(out, mime);
    } catch (e) {
      // 검수를 못 하면 "통과"가 아니라 "전부 보정"이다 — 예전에는 무검수
      // 통과였고, 짤림·원문 잔류가 그대로 노출됐다(운영 신고). 전 문구를
      // 걸린 것으로 돌려주면 보정 경로(모델 지우기 + 직접 그리기)가 받고,
      // 그마저 실패하면 오버레이가 바닥을 지킨다 — 미검수 이미지가 나가는
      // 길이 없어진다.
      console.warn(`[imageTranslate] 검수 판독 실패 — 전 문구 보정 강등: ${e instanceof Error ? e.message : e}`);
      return targets.slice();
    }
  }

  // 빈 자리 픽셀 검사 준비 — 글자를 못 읽은 박스에서만 쓴다
  let origRaw: Uint8Array | null = null;
  let outRaw: Uint8Array | null = null;
  let W = 0;
  let H = 0;
  if (checkCoverage && origData) {
    try {
      const om = await sharp(origData).metadata();
      const rm = await sharp(out).metadata();
      if (om.width && om.width === rm.width && om.height === rm.height) {
        W = om.width;
        H = om.height ?? 0;
        origRaw = new Uint8Array(await sharp(origData).ensureAlpha().raw().toBuffer());
        outRaw = new Uint8Array(await sharp(out).ensureAlpha().raw().toBuffer());
      }
    } catch {
      /* 픽셀 검사는 보강 장치 — 준비 실패 시 글자 검사만 한다 */
    }
  }

  return targets.filter((b) => {
    const hits = lines.filter((l) => flaggedHits(l.box, b));
    // 원문 잔류 — 단, 박스 근처에 "원래부터 있던 다른 외국어"(반투명 워터마크가
    // 대표)가 물리면 오판한다: 모델은 지시대로 워터마크를 남겼는데 검수가
    // "안 지웠다"고 매번 퇴짜를 놔 전부 로컬 폴백으로 강등됐다(실측 — 그
    // 로컬 지우개 뭉개짐이 "지웠더니 변형" 신고의 실체). 읽힌 줄이 이 박스의
    // 원문과 실제로 겹치는 글자일 때만 잔류로 본다.
    if (hits.some((l) => isForeignSource(l.text) && textCoverage(l.text, b.zh) >= 0.5)) return true;
    if (b.mode === "erase") return false; // 지움 박스는 잔류만 본다 — 비어 있는 게 정답
    if (!checkCoverage) return false;
    if (hits.length === 0) {
      // 못 읽은 자리 — OCR 한계일 수도, 지워진 채 빈 것일 수도, 원문이 그대로
      // 남은 것일 수도(판독 부분 누락 — 실측: 售后无忧 가 중국어인 채 무검수
      // 통과). 픽셀로 가른다: 평탄해졌으면 빈 자리, 원본과 같으면 잔류다.
      if (!origRaw || !outRaw) return false;
      return blankedBox(origRaw, outRaw, W, H, b.box) || unchangedBox(origRaw, outRaw, W, H, b.box);
    }
    const seen = hits.map((l) => l.text).join(" ");
    return (
      textCoverage(b.ko, seen) < COVERAGE_MIN ||
      truncatedTail(b.ko, seen) ||
      brokenWordTail(b.ko, seen) ||
      choppedGlyphTail(b.ko, seen)
    );
  });
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
/**
 * 모델에게 지우기만 시키고 글자는 우리가 그린다.
 *
 * 로컬 지우개(renderStill)는 배경을 주변 픽셀에서 추측하는데, 사진·그라데이션
 * 위에서는 흰 얼룩을 남긴다(운영 스크린샷 신고 — 제목 주변 흰 뭉개짐).
 * 모델 지우기는 배경을 다시 그리므로 자국이 없다. 지시(위치·크기)를 정확히
 * 지켜야 하거나 모델 결과를 못 믿을 때 쓰는 공용 경로다.
 */
async function eraseThenDraw(
  data: Buffer,
  mime: string,
  /** 원본에서 지워야 하는 것들 */
  removals: OcrBox[],
  /** 지운 그림 위에 그릴 것들 */
  drawBoxes: OcrBox[],
): Promise<{
  data: Buffer;
  mime: string;
  unresolved: OcrBox[];
  /** 실제로 얹은 패치 사각형(밖 변화 검증용) — 글자를 그리는 수동 경로에서는 참고용 */
  patchRects: PxBox[];
  /** 글자 그리기 전(지우기 패치까지) 합성본 PNG — 자동 wm 지우기 경로의 밖 변화 검증용 */
  compositePng: Buffer;
}> {
  const om = await sharp(data).metadata();
  const W = om.width ?? 0;
  const H = om.height ?? 0;
  const origRaw = W && H ? new Uint8Array(await sharp(data).ensureAlpha().raw().toBuffer()) : null;

  // 패치 품질은 박스마다 따로 본다 — 같은 호출 안에서도 어떤 박스는 깨끗하고
  // 어떤 박스는 잔상이 남는다(실측). 시도별 결과를 모아 박스마다 가장 좋은
  // 패치를 골라 합성하고, 끝내 잔상이 남는 박스만 로컬로 마무리한다.
  const rects = removals.map((b) => gifPatchRect(b, W, H));
  type Attempt = { cleaned: Buffer; scores: number[] };
  const attempts: Attempt[] = [];
  let reason = "";
  for (let attempt = 1; attempt <= REGEN_ATTEMPTS; attempt++) {
    try {
      const cleaned = await eraseViaModel(data, mime, removals);
      if (!origRaw) {
        if (await leftoverInBoxes(cleaned, "image/png", removals, false)) {
          reason = "원문이 남음";
          continue;
        }
        const patched = await compositeTextPatches(data, cleaned, removals, W, H);
        const patchedPng = patched.canvas.toBuffer("image/png");
        return {
          ...(await drawTextOnly(patchedPng, mime, drawBoxes)),
          unresolved: [],
          patchRects: patched.rects,
          compositePng: patchedPng,
        };
      }
      const cleanRaw = new Uint8Array(await sharp(cleaned).ensureAlpha().raw().toBuffer());
      // 박스별 점수 — 하나라도 걸리면 시도 전체를 버리던 방식은 멀쩡한 박스
      // 패치까지 같이 버려 전부 로컬 폴백(뭉개짐)으로 내려갔다(실측).
      //   Infinity = 이 박스 패치는 못 쓴다 (안 지워짐 / 장식 지어냄 / 경계 어긋남)
      //   유한값   = 내부 잔상 비율 (GHOST_MAX 이하면 합격)
      const leftoverSet = new Set(await flaggedBoxes(cleaned, "image/png", removals, false));
      const scores = removals.map((b, i) => {
        if (leftoverSet.has(b)) return Infinity; // 안 지워짐 — 얹어도 원문 그대로
        if (inventedInBox(origRaw, cleanRaw, W, toPixelBox(b.box, W, H))) return Infinity;
        const gap = seamGap(origRaw, cleanRaw, W, H, rects[i]);
        if (gap > SEAM_MAX) return Infinity; // 경계 불합격 — 얹으면 네모가 보인다
        // 경계 조각 침범 — 원문 획이 패치 밖에 걸쳐 있으면 반만 지워진 채 잘린다
        if (edgeCrossing(origRaw, cleanRaw, W, H, rects[i]) > EDGE_CROSS_MAX) return Infinity;
        return ghostResidue(cleanRaw, W, H, rects[i], rects.filter((_, j) => j !== i));
      });
      attempts.push({ cleaned, scores });
      console.warn(
        `[imageTranslate] 지우기 패치 점수(시도 ${attempt}): [${scores.map((s) => (s === Infinity ? "경계탈락" : s.toFixed(1))).join(", ")}]`,
      );
      if (scores.every((s) => s <= GHOST_MAX)) break; // 전 박스 합격 — 더 돌릴 이유 없다
      reason = `지운 자리 잔상 ${scores.filter((s) => s > GHOST_MAX).length}/${removals.length}건`;
    } catch (e) {
      reason = e instanceof Error ? e.message : String(e);
    }
  }

  if (attempts.length === 0) {
    // 로컬 지우개로 내려보내지 않는다 — 사진·그라데이션 위에 뿌연 띠·네모를
    // 남긴다(실측 m3, 2026-08-22 신고 #6). 원문 유지가 바닥이고, 호출한 쪽이
    // unresolved 로 받아 관문 재시도·운영자 확인으로 넘긴다.
    console.warn(`[imageTranslate] 모델 지우기 실패(${REGEN_ATTEMPTS}회) — 원본 유지(덧그리기 금지): ${reason}`);
    return {
      data,
      mime,
      unresolved: drawBoxes.filter((b) => !b.wm),
      patchRects: [],
      compositePng: await sharp(data).png().toBuffer(),
    };
  }

  // 박스마다 가장 잔상이 적은 시도를 고른다
  const pickAttempt = removals.map((_, i) => {
    let best = 0;
    for (let k = 1; k < attempts.length; k++) {
      if (attempts[k].scores[i] < attempts[best].scores[i]) best = k;
    }
    return best;
  });
  const localSet = new Set<OcrBox>(); // 로컬 지우개로 마무리할 박스
  const keepOriginal = new Set<OcrBox>(); // 지우기를 포기하고 원본을 지킬 박스 (워터마크)
  removals.forEach((b, i) => {
    const s = attempts[pickAttempt[i]].scores[i];
    if (s <= GHOST_MAX) return;
    // 워터마크는 깨끗이 지워질 때만 지운다 — 실패하면 원본 유지가 바닥이다
    // (로컬 지우개는 사진 위에 뿌연 띠를 남긴다, 실측 m3)
    if (b.wm) {
      keepOriginal.add(b);
      return;
    }
    // 불합격 박스의 갈림길 — 로컬 지우개는 민 배경에서는 깨끗하지만, 사진·
    // 그라데이션 위에서는 평면 사각형 폴백까지 내려가 더 흉하다(실측: 사진
    // 한가운데 워터마크 자리에 분홍 네모). 민 배경(solid_bg)만 로컬로 보내고,
    // 사진 배경은 잔상이 남더라도 모델 패치 중 최선을 쓴다 — 단 경계 탈락
    // (Infinity)은 얹는 순간 네모가 보이므로 배경과 무관하게 얹지 않는다.
    if (b.solid_bg || s === Infinity) localSet.add(b);
  });
  if (keepOriginal.size > 0) {
    console.warn(`[imageTranslate] 워터마크 ${keepOriginal.size}건 지우기 불합격 — 원본 유지`);
  }

  // 합격 박스를 시도별로 나눠 합성한다 (여러 시도의 좋은 패치를 섞는다)
  let patchedBuf = data;
  const appliedRects: PxBox[] = [];
  for (let k = 0; k < attempts.length; k++) {
    const boxesK = removals.filter(
      (b, i) => pickAttempt[i] === k && !localSet.has(b) && !keepOriginal.has(b),
    );
    if (boxesK.length === 0) continue;
    // avoid=다른 박스 전부: 이 시도의 패치 여백이 다른 시도의 패치·원본 유지
    // 박스(워터마크)·로컬 마무리 박스를 덮으면 서로 다른 렌더가 띠로 섞인다
    const others = removals.filter((b) => !boxesK.includes(b));
    const merged = await compositeTextPatches(patchedBuf, attempts[k].cleaned, boxesK, W, H, others);
    appliedRects.push(...merged.rects);
    patchedBuf = await merged.canvas.toBuffer("image/png");
  }

  const first = await drawTextOnly(patchedBuf, mime, drawBoxes.filter((b) => !localSet.has(b)));
  if (localSet.size === 0) return { ...first, unresolved: [], patchRects: appliedRects, compositePng: patchedBuf };

  // 불합격 박스는 로컬 지우개로 덧그리지 않는다 — 그 자리엔 원문이 그대로
  // 남고(패치를 안 얹었으므로), 호출한 쪽이 unresolved 로 받아 관문 재시도·
  // 운영자 확인으로 넘긴다. 네모 자국보다 원문이 낫다(2026-08-22 정책).
  console.warn(
    `[imageTranslate] 지우기 패치 불합격 ${localSet.size}/${removals.length}건 — 원문 유지(덧그리기 금지) (${reason})`,
  );
  return {
    ...first,
    unresolved: drawBoxes.filter((b) => localSet.has(b)),
    patchRects: appliedRects,
    compositePng: appliedRects.length > 0 ? patchedBuf : await sharp(data).png().toBuffer(),
  };
}

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
  opts: { regenerate?: boolean; hint?: string } = {},
): Promise<{ data: Buffer; mime: string; keptOriginal?: string[] }> {
  // 수동 경로(어드민 문구 수정 재렌더)도 예산 스코프 안에서 돈다 — 지금은 어느
  // 갈래든 호출 1회지만, 그건 REGEN_ATTEMPTS=1 이라는 우연한 상수에 기대는 것이라
  // 루프가 하나만 늘어도 상한이 뚫린다. "장당 이미지 HTTP 1회"를 구조로 못 박는다.
  const budget = { left: MAX_IMAGE_CALLS_PER_ASSET, used: 0 };
  return imageBudget.run(budget, () => renderTranslatedImageInner(data, mime, boxes, opts));
}

async function renderTranslatedImageInner(
  data: Buffer,
  mime: string,
  boxes: OcrBox[],
  opts: { regenerate?: boolean; hint?: string },
): Promise<{ data: Buffer; mime: string; keptOriginal?: string[] }> {
  ensureFonts();
  // GIF 는 워터마크 지우기를 하지 않는다 — 프레임마다 로컬 지우개를 돌리면
  // 사진 배경에 얼룩이 프레임 단위로 어른거린다. 정지 이미지부터 확실히.
  // 이 경로(문구 수정·수동 재렌더)는 운영자가 버튼으로 승인한 실행이다 — 띠별 호출 허용.
  if (mime === "image/gif") return renderGif(data, boxes.filter((b) => !b.wm), { adminApproved: true });
  // 다른 문구와 겹치는 워터마크는 지움 대상에서 제외 (이웃 글자 훼손 방지)
  boxes = dropRiskyWm(boxes);
  if (opts.regenerate === false) return renderStill(data, mime, boxes);

  const removals = eraseTargets(boxes);
  if (removals.length === 0) return renderStill(data, mime, boxes); // 지울 것도 그릴 것도 없다

  // 어드민이 위치·크기·굵기를 손댔거나 "지움"을 표시했으면 문구 교체를 모델에
  // 맡길 수 없다. 대신 지우기만 시키고, 그 위에 지시대로 우리가 그린다 —
  // 지우기는 모델이 자국 없이 잘하고, 지시는 우리가 그려야 정확히 지켜진다.
  if (mustOverlay(boxes)) {
    const r = await eraseThenDraw(data, mime, removals, boxes);
    const wanted = boxes.filter((b) => (b.mode ?? "translate") === "translate" && b.ko.trim());
    if (wanted.length > 0 && r.unresolved.length >= wanted.length) {
      throw new Error("모델 지우기 실패 — 원본 유지 (덧그리기 금지)");
    }
    return { data: r.data, mime: r.mime };
  }

  // 이미지 호출 1회 — 검수에서 걸린 문구를 부분 보정(추가 호출)하던 사다리와
  // 안전 필터 거부 시 띠 재생성 폴백을 없앴다(설계 2026-08-24 v2.1). 실패·불합격은
  // 호출한 쪽이 후보·사유로 받아 검수로 보내고, 추가 렌더는 운영자 승인뿐이다.
  // pending(경계 불합격 박스)은 원문이 그대로 남는다 — 부분 성공도 VERIFIED 금지.
  const out = await regenerateStill(data, mime, boxes, [], opts.hint);
  return { data: out.data, mime: out.mime };
}

/* ── 안전필터 거부 시 국소 편집 폴백 (2026-08-30 실측 기반) ─────────────────
 *
 * 전체 이미지를 보내면 거부되는 장도, 글자 띠만 잘라 보내면 통과한다 —
 * 거부의 원인은 글자가 아니라 프레임에 담긴 신체·사용 장면이기 때문이다.
 * 실측(라이러 대표, SAFETY_BLOCKED): 상단 제목 띠 국소 재생성은 원본 장식체를
 * 그대로 모사(오탈자 0)했고, 지우기+로컬 글자는 서체가 밋밋해 열세였다.
 * 그래서 사다리는 ① 띠 재생성 → ② 띠 지우기+로컬 글자 → ③ 순수 로컬 덮기.
 *
 * 원칙:
 *  - "우회"가 아니라 최소 범위 편집이다: 글자 영역+패딩만 모델에 보낸다.
 *    잘라 보낸 띠까지 거부되면 그 띠는 재호출 없이 다음 단계로 내려간다.
 *  - 결과는 어떤 경우에도 후보(NEEDS_REVIEW)까지만 — 띠 밖은 sharp 합성이라
 *    구조적으로 원본 그대로지만, 띠 안 이음새는 사람 눈이 최종 관문이다.
 *  - 이 함수는 어드민 승인 재렌더(force)에서만 불린다. 자동 흐름의
 *    "이미지 HTTP 최대 1회" 원칙은 그대로다.
 */

export interface BandRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 띠별 모델 호출 상한 — 전체 1회와 합쳐 장당 6회(운영 상한)를 못 넘게 */
const MAX_FALLBACK_CALLS = 5;
/** 박스 주변 패딩(‰) — 딱 맞게 자르면 배경 문맥이 없어 복원이 깨진다 */
const BAND_PAD_PERMIL = 60;
/**
 * 띠 하나의 면적 상한(이미지 대비). 연쇄 병합으로 띠가 이미지의 절반 가까이
 * 커지면 "글자 영역만 보낸다"는 최소 범위 편집이 무너져 민감 영역까지 함께
 * 전송된다 — 그런 띠는 모델로 보내지 않고 미해결로 남긴다.
 */
const MAX_BAND_AREA_RATIO = 0.4;

/**
 * 국소 폴백을 발동해도 되는 거부인가 — 구조화된 안전 코드 화이트리스트.
 *
 * "이미지를 반환하지 않음"(미반환)은 제외한다: 실측(2026-08-31)상 미반환은
 * 재시도 1회에 뒤집히는 일시 증상이라, 띠 호출(최대 5회)을 태우는 폴백보다
 * 재시도 안내가 싸고 정확하다. 429·타임아웃은 호출부에서 transientReason 이
 * 먼저 가로채므로 여기 오지 않는다.
 */
const SAFETY_FALLBACK_REASONS = new Set(["PROHIBITED_CONTENT", "SAFETY", "IMAGE_SAFETY"]);

export function shouldAttemptSafetyFallback(msg: string, mime: string, enabled: boolean): boolean {
  if (!enabled) return false;
  if (mime === "image/gif") return false; // 프레임 문제 — 정지 패치 트랙에서 다룬다
  const m = msg.match(/모델 거부\(([A-Z_]+)\)/);
  return m !== null && SAFETY_FALLBACK_REASONS.has(m[1]);
}

/**
 * 번역 대상 박스들을 "패딩 포함 띠"로 묶는다. 패딩 후 겹치는 박스를 한 띠로
 * 합치는 이유: 같은 배경을 두 번 따로 편집하면 이음새가 두 배로 생긴다.
 */
export function clusterBands(
  boxes: OcrBox[],
  imgW: number,
  imgH: number,
  padPermil = BAND_PAD_PERMIL,
  /**
   * 픽셀 여백 — 주면 permil 대신 이걸 쓴다(가로·세로 같은 픽셀).
   *
   * permil 은 가로·세로에서 서로 다른 픽셀이 되고(750×534 에서 60‰ = 45px/32px),
   * 단계도 성겨서 "정지를 유지할 수 있는 여백이 4~6px" 인 문구를 통째로 놓쳤다 —
   * 실측(2026-09-01): 「360°贴合」(6px)·「强悍震感看得见」(4px)이 세 단계 모두
   * 탈락해 "움직이는 화면 위"로 보고됐지만, 글자 자리는 완전 정지였다.
   * GIF 띠 선택만 이 인자를 쓴다(정지 이미지 경로는 기존 permil 그대로).
   */
  padPx?: number,
): BandRect[] {
  type R = { L: number; T: number; R: number; B: number };
  const px = (v: number, size: number, sign: 1 | -1) =>
    padPx === undefined ? ((v + sign * padPermil) / 1000) * size : (v / 1000) * size + sign * padPx;
  let rects: R[] = boxes.map((b) => {
    const [y1, x1, y2, x2] = b.box;
    return {
      L: Math.max(0, Math.round(px(x1, imgW, -1))),
      T: Math.max(0, Math.round(px(y1, imgH, -1))),
      R: Math.min(imgW, Math.round(px(x2, imgW, 1))),
      B: Math.min(imgH, Math.round(px(y2, imgH, 1))),
    };
  });
  let changed = true;
  while (changed) {
    changed = false;
    const out: R[] = [];
    for (const r of rects) {
      const hit = out.find((o) => !(r.R <= o.L || o.R <= r.L || r.B <= o.T || o.B <= r.T));
      if (hit) {
        hit.L = Math.min(hit.L, r.L);
        hit.T = Math.min(hit.T, r.T);
        hit.R = Math.max(hit.R, r.R);
        hit.B = Math.max(hit.B, r.B);
        changed = true;
      } else {
        out.push({ ...r });
      }
    }
    rects = out;
  }
  return rects
    .filter((r) => r.R > r.L && r.B > r.T)
    .map((r) => ({ left: r.L, top: r.T, width: r.R - r.L, height: r.B - r.T }));
}

/** 원본 정규화 좌표(0~1000)의 박스를 띠 내부 정규화 좌표로 옮긴다 */
export function remapBoxToBand(b: OcrBox, band: BandRect, imgW: number, imgH: number): OcrBox {
  const [y1, x1, y2, x2] = b.box;
  const px = (v: number, size: number) => (v / 1000) * size;
  return {
    ...b,
    box: [
      Math.round(((px(y1, imgH) - band.top) / band.height) * 1000),
      Math.round(((px(x1, imgW) - band.left) / band.width) * 1000),
      Math.round(((px(y2, imgH) - band.top) / band.height) * 1000),
      Math.round(((px(x2, imgW) - band.left) / band.width) * 1000),
    ],
  };
}

/**
 * 띠 패치 판독문에서 "교체·삭제됐어야 할 원문"이 그대로 남았는지 찾는다.
 *
 * 실사례(2026-08-30 합환토·액상): 띠 재생성이 장식 제목 둘째 줄을 브랜드
 * 로고로 착각해 보존했는데, 검사 없이 채택해 한자 잔존 후보가 검수함까지
 * 올라갔다. keep(보존 지정) 원문은 남는 게 정상이라 잔존으로 치지 않는다.
 */
export function findLeftoverZh(observedTexts: string[], targets: OcrBox[]): string[] {
  const norm = (s: string) => s.replace(/\s+/g, "");
  const observed = norm(observedTexts.join(" "));
  return targets
    .filter((b) => (b.mode ?? "translate") !== "keep" && b.zh.trim())
    .filter((b) => observed.includes(norm(b.zh)))
    .map((b) => b.zh);
}

/**
 * 겹쳐 인쇄된 문구 묶기 — 서로 겹치는 박스를 한 그룹으로 만든다.
 *
 * 실사례(2026-08-31 액상): 원본이 큰 제목과 부제를 같은 자리에 겹쳐 인쇄한
 * 디자인이었는데, 모델이 그린 글자 위에 로컬 렌더가 나머지 하나를 또 그려서
 * 두 층이 섞였다. 겹치는 박스는 "한 덩어리"로 취급해 서로 다른 방식으로
 * 그리지 않는다 — 층 섞임은 어떤 폰트·좌표 보정으로도 못 고친다.
 */
export function groupOverlappingBoxes(boxes: OcrBox[]): OcrBox[][] {
  const hit = (a: OcrBox, b: OcrBox) => {
    const [ay1, ax1, ay2, ax2] = a.box;
    const [by1, bx1, by2, bx2] = b.box;
    return ax1 < bx2 && bx1 < ax2 && ay1 < by2 && by1 < ay2;
  };
  const groups: OcrBox[][] = [];
  for (const b of boxes) {
    const touching = groups.filter((g) => g.some((m) => hit(m, b)));
    if (touching.length === 0) {
      groups.push([b]);
      continue;
    }
    // 여러 그룹을 잇는 박스는 그 그룹들을 하나로 합친다 (연쇄 A-B, B-C)
    const merged = [b, ...touching.flat()];
    for (const g of touching) groups.splice(groups.indexOf(g), 1);
    groups.push(merged);
  }
  return groups;
}

/**
 * 이 박스에 로컬 덮기를 써도 되는가 — **사진·그라데이션 배경에는 금지**.
 *
 * 로컬 지우개는 원문 획을 지운 자리를 우리가 메워야 해서 사진 위에서는 뿌연
 * 사각형이 남는다(이 파일의 eraseThenDraw 주석에 기록된 한계, 운영 신고
 * 2026-08-31 "뒤에 흰색 일그러짐"). 못 고칠 바엔 원문을 남기고 사람에게
 * 넘기는 게 이 몰의 무결 원칙이다. 판정이 없으면 단색 취급(기존 규약과 동일).
 */
export function canLocalOverlay(b: OcrBox): boolean {
  return b.solid_bg !== false;
}

/**
 * 띠 패치 가장자리의 알파를 낮춰 원본과 부드럽게 잇는다.
 *
 * 이미지 경계에 닿은 면은 페더하지 않는다 — 그쪽엔 이어붙일 이음선이 없고,
 * 페더하면 원본 가장자리가 도로 비쳐 오히려 띠가 보인다.
 */
export function applyEdgeFeather(
  rgba: Buffer,
  w: number,
  h: number,
  feather: number,
  edges: { left: boolean; top: boolean; right: boolean; bottom: boolean },
): Buffer {
  if (feather <= 0) return rgba;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.min(
        edges.left ? x + 1 : Infinity,
        edges.top ? y + 1 : Infinity,
        edges.right ? w - x : Infinity,
        edges.bottom ? h - y : Infinity,
      );
      if (d >= feather) continue;
      const i = (y * w + x) * 4;
      rgba[i + 3] = Math.round(rgba[i + 3] * (d / feather));
    }
  }
  return rgba;
}

/** 박스 중심이 띠 안에 있는가 — 띠에 걸친 박스를 어느 띠가 그릴지 정한다 */
function boxInBand(b: OcrBox, band: BandRect, imgW: number, imgH: number): boolean {
  const [y1, x1, y2, x2] = b.box;
  const cy = (((y1 + y2) / 2) / 1000) * imgH;
  const cx = (((x1 + x2) / 2) / 1000) * imgW;
  return cy >= band.top && cy < band.top + band.height && cx >= band.left && cx < band.left + band.width;
}

export async function renderSafetyFallback(
  data: Buffer,
  mime: string,
  boxes: OcrBox[],
): Promise<{ data: Buffer; mime: string; note: string }> {
  ensureFonts();
  const meta = await sharp(data).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  if (!W || !H) throw new Error("이미지 크기를 읽을 수 없음");
  const targets = boxes.filter(
    (b) => ((b.mode ?? "translate") === "translate" && b.ko.trim()) || b.mode === "erase",
  );
  if (targets.length === 0) throw new Error("국소 편집 대상 문구 없음");
  const allBands = clusterBands(targets, W, H);
  if (allBands.length === 0) throw new Error("띠를 만들 수 없음");
  // 면적 상한 — 연쇄 병합으로 커진 거대 띠는 "글자 영역만 보낸다"는 전제를
  // 깨므로 모델로 보내지 않는다. 그 안의 문구는 미해결로 정직하게 남긴다.
  const bands = allBands.filter((b) => (b.width * b.height) / (W * H) <= MAX_BAND_AREA_RATIO);
  const oversizedZh = allBands
    .filter((b) => (b.width * b.height) / (W * H) > MAX_BAND_AREA_RATIO)
    .flatMap((band) => targets.filter((t) => boxInBand(t, band, W, H)).map((t) => t.zh));
  if (bands.length === 0) throw new Error("글자 영역이 이미지 대부분을 덮어 국소 편집이 불가능함");

  // 폴백 전용 예산 스코프 — 바깥(자동 1회) 예산과 분리해 상한을 따로 못 박는다
  const budget = { left: MAX_FALLBACK_CALLS, used: 0 };
  const methods = { regen: 0, retry: 0, erase: 0, local: 0 };
  /** 끝내 남은 원문 — 검수 카드에 실어 검수자가 바로 그 자리를 보게 한다 */
  const unresolvedZh: string[] = [...oversizedZh];
  /** 잔존 검사(OCR)가 실패한 띠 수 — 침묵 채택 금지, 검수 사유로 알린다 */
  let leftoverCheckFailed = 0;
  try {
    const patches: { input: Buffer; left: number; top: number }[] = [];
    await imageBudget.run(budget, async () => {
      for (const band of bands) {
        const crop = await sharp(data).extract(band).jpeg({ quality: 95 }).toBuffer();
        const mapped = targets
          .filter((b) => boxInBand(b, band, W, H))
          .map((b) => remapBoxToBand(b, band, W, H));
        if (mapped.length === 0) continue;
        let patch: Buffer | null = null;
        let leftover: string[] | null = null;
        // ① 띠 재생성 — 모델이 배경+글자를 함께. 실측상 장식체 모사가 가장 좋다
        if (budget.left > 0) {
          try {
            patch = await callImageEdit(crop, "image/jpeg", regenPrompt(mapped), band.width, band.height);
            methods.regen++;
            leftover = await bandLeftoverZh(patch, mapped);
          } catch {
            /* 띠도 거부·실패 — 재호출 없이 아래 단계로 */
          }
        }
        // ①-재시도: 장식 제목을 로고로 착각해 보존하는 습관(실사례: 转着戳·咬住舔)을
        // "로고가 아니다" 지시로 깬다. 재시도가 더 나빠지면 원래 패치를 지킨다.
        if (patch && (leftover?.length ?? 0) > 0 && budget.left > 0) {
          try {
            const hint = `이 조각 안의 다음 문구는 브랜드 로고가 아니라 제품 홍보 문구다 — 반드시 지정된 한국어로 교체하라: ${mapped
              .filter((b) => leftover!.includes(b.zh))
              .map((b) => `${b.zh}→${b.ko || "(지움)"}`)
              .join(", ")}`;
            const retried = await callImageEdit(crop, "image/jpeg", regenPrompt(mapped, hint), band.width, band.height);
            methods.retry++;
            const retriedLeftover = await bandLeftoverZh(retried, mapped);
            if ((retriedLeftover?.length ?? Infinity) < leftover!.length) {
              patch = retried;
              leftover = retriedLeftover;
            }
          } catch {
            /* 재시도 실패 — 원래 패치 유지, 아래 강등 판단으로 */
          }
        }
        // ② 그래도 남으면 지우기+로컬로 강등 — 교체가 구조적으로 보장된다
        //    (재생성이 아예 실패한 띠도 여기로 온다)
        if ((!patch || (leftover?.length ?? 0) > 0) && budget.left > 0) {
          try {
            const r = await eraseThenDraw(crop, "image/jpeg", eraseTargets(mapped), mapped);
            patch = await sharp(r.data).png().toBuffer();
            leftover = r.unresolved.map((b) => b.zh);
            methods.erase++;
          } catch {
            /* 아래 로컬 단계로 */
          }
        }
        // ③ 최후 — 순수 로컬 덮기 (호출 0회).
        //    사진·그라데이션 배경 박스는 제외한다: 로컬 지우개가 그 위에서
        //    뿌연 사각형을 남기기 때문(운영 신고 "흰색 일그러짐"). 그런 문구는
        //    원문을 남기고 미해결로 알린다 — 더럽힐 바엔 원본 유지.
        if (!patch) {
          const drawable = mapped.filter(canLocalOverlay);
          const skipped = mapped.filter((b) => !canLocalOverlay(b));
          if (drawable.length === 0) throw new Error("사진 배경 문구만 남아 로컬 덮기 불가");
          const r = await renderStill(crop, "image/jpeg", drawable);
          patch = await sharp(r.data).png().toBuffer();
          leftover = skipped.map((b) => b.zh);
          methods.local++;
        } else if ((leftover?.length ?? 0) > 0) {
          // 재시도·지우기까지 전부 막혔는데 잔존이 남은 패치 — 실사례(2026-08-30
          // 액상): 이 강등이 없으면 한자 잔존 패치가 그대로 채택된다. 잔존 자리만
          // 로컬로 덮어 ①이 성공시킨 나머지 문구의 품질은 지킨다.
          //
          // 단 두 경우는 덮지 않는다:
          //  - 모델이 이미 그린 문구와 겹치는 자리 → 두 층이 섞인다(실사례:
          //    「밀착 핥기」 위에 「쾌감의 맥박」이 겹쳐 인쇄됨)
          //  - 사진·그라데이션 배경 → 흰 뭉개짐
          const groups = groupOverlappingBoxes(mapped);
          const leftSet = new Set(leftover!);
          const drawable = mapped.filter((b) => {
            if (!leftSet.has(b.zh)) return false;
            if (!canLocalOverlay(b)) return false;
            const g = groups.find((grp) => grp.includes(b));
            return !g || g.every((m) => leftSet.has(m.zh));
          });
          if (drawable.length > 0) {
            const r = await renderStill(patch, "image/png", drawable);
            patch = await sharp(r.data).png().toBuffer();
            const drawn = new Set(drawable.map((b) => b.zh));
            leftover = leftover!.filter((zh) => !drawn.has(zh));
            methods.local++;
          }
        }
        if (leftover && leftover.length > 0) unresolvedZh.push(...leftover);
        if (patch && leftover === null) leftoverCheckFailed++;
        // 경계 페더 — 각지게 붙이면 이음선이 보인다. 이미지 끝에 닿은 면은
        // 이어붙일 상대가 없으므로 페더하지 않는다(페더하면 원본이 도로 비친다).
        const raw = await sharp(patch)
          .resize(band.width, band.height, { fit: "fill" })
          .ensureAlpha()
          .raw()
          .toBuffer();
        const feather = Math.min(8, Math.floor(Math.min(band.width, band.height) / 4));
        const feathered = applyEdgeFeather(raw, band.width, band.height, feather, {
          left: band.left > 0,
          top: band.top > 0,
          right: band.left + band.width < W,
          bottom: band.top + band.height < H,
        });
        patches.push({
          input: await sharp(feathered, {
            raw: { width: band.width, height: band.height, channels: 4 },
          })
            .png()
            .toBuffer(),
          left: band.left,
          top: band.top,
        });
      }
    });
    if (patches.length === 0) throw new Error("띠 패치를 하나도 만들지 못함");
    const outPng = await sharp(data).composite(patches).png().toBuffer();
    const out =
      mime === "image/png"
        ? { data: outPng, mime: "image/png" }
        : { data: await sharp(outPng).jpeg({ quality: 92 }).toBuffer(), mime: "image/jpeg" };
    // 내부 카운터는 로그에만 — 관리자 화면 사유에는 무엇을 확인하면 되는지만 싣는다
    console.log(
      `[국소 폴백] 띠 ${bands.length}곳 — 재생성 ${methods.regen}·재시도 ${methods.retry}·지우기 ${methods.erase}·로컬 ${methods.local}`,
    );
    const leftoverNote =
      unresolvedZh.length > 0 ? ` · 아직 남았을 수 있는 글자: ${unresolvedZh.join(", ").slice(0, 120)}` : "";
    const checkNote =
      leftoverCheckFailed > 0 ? ` · ${leftoverCheckFailed}곳은 남은 글자 확인이 안 됐습니다 — 원문이 남았는지 함께 봐주세요` : "";
    const seamNote = methods.local > 0 ? " · 일부는 글자만 덮는 방식이라 덧댄 자국이 보일 수 있습니다" : "";
    return {
      ...out,
      note: `글자 영역 ${bands.length}곳을 자동으로 고쳤습니다${leftoverNote}${checkNote}${seamNote} — 덧댄 자국·이음새가 없는지 확인해주세요`,
    };
  } finally {
    console.log(
      `[비용] 국소 폴백 이미지 HTTP ${budget.used}회 ≈ $${(budget.used * IMAGE_CALL_COST_USD).toFixed(3)} (1K 출력 단가 기준 추정)`,
    );
  }
}

/**
 * 최종 관문 판정 — 완성본을 다시 읽은 결과(found)에서 "남아 있으면 안 되는
 * 외국어"만 센다.
 *
 * 면책 대상:
 *   - **지움을 포기한** 워터마크(gaveUpWm) 자리와 겹치는 줄 — 이웃 글자와 겹쳐
 *     안 지우기로 한 것들이라 남아 있는 게 정상이다
 *   - 외국어가 아닌 줄 (한글·영문·숫자)
 *
 * 예전에는 "판독이 워터마크로 본 줄"을 무조건 면책했는데, 그게 지우라고 **시킨**
 * 워터마크의 지우기 실패까지 통째로 덮었다. dropRiskyWm 이 포기한 워터마크를
 * 배열에서 아예 빼기 때문에 남아 있는 wm 박스는 전부 지우기 대상이고, 그게
 * 완성본에 읽히면 실패다 — 반만 지워진 워터마크(잔획)가 VERIFIED 로 나가던
 * 유일한 경로였다 (2026-08-27 감사). 그래서 호출부가 "포기한 것"만 넘긴다.
 */
export function gateLeftover(found: OcrBox[], gaveUpWm: OcrBox[]): number {
  return found.filter((f) => {
    if (!isForeignSource(f.zh)) return false;
    if (gaveUpWm.some((w) => flaggedHits(f.box, w))) return false;
    return true;
  }).length;
}

/** 문구가 이 수를 넘으면 밀집 그리드(판매자 홍보 모음) — 재시도해도 안 되는 판 */
export const DENSE_GRID_MIN = 30;

/* ── 자동 번역 — 이미지 API HTTP 요청 최대 1회 + 검증 (설계 2026-08-24 v2.1) ──
 *
 * "자동 이미지 호출 최대 1회"의 정의: 캐시 미스이고 렌더 전 검수(교차 OCR·
 * 번역·의미 검수)를 통과한 원본당 HTTP 요청 1회. 렌더 전 실패와 캐시 적중은
 * 0회다. 실패는 상태 코드와 무관하게 자동 재요청하지 않는다 — 후보·사유를
 * 보존해 검수(NEEDS_REVIEW)나 재시도 대기(RETRYABLE)로 보내고, 추가 1회는
 * 운영자 승인으로만 실행한다. 캐시 조회·저장은 호출부(translateAssets)가 한다.
 */

export type TranslateOutcome =
  /** 모든 검사를 실제 통과 — 이 결과만 손님용 url 로 저장할 수 있다 */
  | { status: "VERIFIED"; data: Buffer; mime: string; boxes: OcrBox[] }
  /** 전체·분할 OCR 둘 다 외국어 0건 (이미지 호출 0회) */
  | { status: "NO_FOREIGN_TEXT" }
  /** 검사는 됐는데 합격 불가 — data 가 있으면 후보로 보존한다 (자동 노출 금지) */
  | { status: "NEEDS_REVIEW"; data: Buffer | null; mime: string | null; boxes: OcrBox[]; reasons: ReviewReason[] }
  /** 일시 오류(타임아웃·429·5xx) — 운영자 재시도 승인 대기 */
  | { status: "RETRYABLE"; reasons: ReviewReason[] }
  /** 검수 호출 자체가 실패 — 통과로 치지 않는다 (정책 9) */
  | { status: "VERIFICATION_FAILED"; data: Buffer | null; mime: string | null; boxes: OcrBox[]; reasons: ReviewReason[] }
  /** 렌더 전 단계의 복구 불가 실패 — 원본 유지 */
  | { status: "FAILED"; reason: string };

/** API 오류를 일시(RETRYABLE) 사유로 분류 — 아니면 null */
function transientReason(msg: string): ReviewReason | null {
  if (msg.includes("시간 초과")) return { code: "TIMEOUT", detail: msg };
  if (msg.includes("API 오류 429")) return { code: "RATE_LIMITED", detail: msg };
  if (/API 오류 40[13]/.test(msg)) return { code: "AUTH_ERROR", detail: msg };
  if (/API 오류 5\d\d/.test(msg)) return { code: "SERVER_ERROR", detail: msg };
  return null;
}

/** 원문↔확정 번역문 의미 검수 — 텍스트 호출 1회. 형식 오류는 throw (검수 실패) */
async function verifyMeaning(pairs: { zh: string; ko: string }[]): Promise<{ ok: boolean; issues: string[]; hard: string[] }[]> {
  if (pairs.length === 0) return [];
  const parts = await callGemini(MODEL, [{ text: buildMeaningPrompt(pairs) }], {
    maxOutputTokens: 4000,
    responseMimeType: "application/json",
    thinkingConfig: { thinkingLevel: "minimal" },
  });
  const v = parseMeaningVerdicts(jsonArrayOf(parts), pairs.length);
  if (!v) throw new Error("의미 검수 응답 형식 오류");
  return v;
}

/** 원문↔최종 이미지 판독문 의미 검수 (정책 4) — 텍스트 호출 1회 */
async function verifyRenderedMeaning(
  pairs: { zh: string; observed: string }[],
): Promise<{ ok: boolean; issues: string[]; hard: string[] }[]> {
  if (pairs.length === 0) return [];
  const parts = await callGemini(MODEL, [{ text: buildRenderedMeaningPrompt(pairs) }], {
    maxOutputTokens: 4000,
    responseMimeType: "application/json",
    thinkingConfig: { thinkingLevel: "minimal" },
  });
  const v = parseMeaningVerdicts(jsonArrayOf(parts), pairs.length);
  if (!v) throw new Error("완성본 의미 검수 응답 형식 오류");
  return v;
}

/**
 * 픽셀 비교용 RGBA raw — 원본과 합성본을 **같은 디코더(canvas)** 로 푼다.
 * sharp 와 canvas 의 JPEG 디코딩이 미세하게 달라 교차 비교하면 오탐이 난다.
 */
async function canvasRawOf(buf: Buffer): Promise<{ raw: Uint8ClampedArray; w: number; h: number }> {
  const img = await loadImage(buf);
  const c = createCanvas(img.width, img.height);
  const cx = c.getContext("2d");
  cx.drawImage(img, 0, 0);
  return { raw: cx.getImageData(0, 0, img.width, img.height).data, w: img.width, h: img.height };
}

/**
 * 제품 무결성 심사 — 원본·완성본 두 장을 주고 **제품 사진**이 상품 정보 수준에서
 * 같은지 본다 (전체 채택 경로의 핵심 관문, 2026-08-24 운영 결정).
 * 글자·판 배치 차이는 무시, 제품 개수·형태·색상·구성 변화만 실격.
 * 형식 오류는 throw — 확인 못 했으면 통과가 아니다 (fail-closed).
 */
async function verifyProductIntegrity(
  orig: { data: Buffer; mime: string },
  out: { data: Buffer; mime: string },
): Promise<{ ok: boolean; issues: string[]; hard: string[] }> {
  const parts = await callGemini(
    MODEL,
    [
      { inline_data: { mime_type: orig.mime, data: orig.data.toString("base64") } },
      { inline_data: { mime_type: out.mime, data: out.data.toString("base64") } },
      { text: buildProductIntegrityPrompt() },
    ],
    { maxOutputTokens: 2000, responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "minimal" } },
  );
  // 배열 파서를 쓰면 안 된다 — 단일 객체의 issues/hard 대괄호를 배열로 오인해
  // 렌더 전량이 VERIFICATION_FAILED 로 떨어졌다 (live11 실측, fail-closed 라 안전은 유지)
  const v = parseSingleVerdict(textOf(parts));
  if (!v) throw new Error("제품 무결성 심사 응답 형식 오류");
  return v;
}

/** 검수용 정지 이미지 — GIF 는 첫 프레임 PNG 로 (판독·픽셀 비교 공용) */
async function stillOf(data: Buffer, mime: string): Promise<{ data: Buffer; mime: string }> {
  if (mime !== "image/gif") return { data, mime };
  return { data: await sharp(data, { page: 0, pages: 1 }).png().toBuffer(), mime: "image/png" };
}

/**
 * 검증 재개 옵션 — **이미 만들어 둔 중간 산출물을 재사용해 뒷단계만 다시 돌린다.**
 *
 * 왜 필요한가: 검증 코드를 고친 뒤 재판정하려면 원래는 OCR·번역·의미검수·이미지
 * 생성을 통째로 다시 해야 했다(장당 이미지 1회 + 텍스트 17회). 이미 저장해 둔
 * 판독·번역·모델 출력이 있는데 유료 이미지 호출을 또 쓰는 건 낭비다.
 *
 * **검사는 하나도 건너뛰지 않는다** — 건너뛰는 것은 "결과를 만드는 단계"뿐이고
 * ⑤ 완성본 검수는 전부 그대로 돈다. 그래서 이 경로로 들어와도 VERIFIED 기준은
 * 동일하다(회귀 테스트로 못 박음). 운영 자동 흐름은 이 옵션을 넘기지 않는다 —
 * 검증 재실행 도구 전용이다.
 */
export interface ResumeInput {
  /** 저장해 둔 판독·번역 결과 — 주면 ①교차OCR ②번역 ③의미검수를 건너뛴다 */
  boxes?: OcrBox[];
  /** 저장해 둔 모델 출력(원본 크기) — 주면 ④이미지 호출을 건너뛴다 (전체 채택으로 취급) */
  rendered?: { data: Buffer; mime: string };
}

/**
 * 운영 자동 흐름의 유일한 진입점 — **재개 옵션이 없다.**
 * 어드민 액션·라우트가 부르는 것은 이 함수뿐이라, 외부에서 넘어온 데이터로
 * 검사 단계를 건너뛰게 만들 방법이 없다 (임의 resume 주입 차단).
 */
export async function translateImageAuto(
  data: Buffer,
  mime: string,
  /**
   * safetyFallback: 안전필터 거부 시 글자 띠 국소 편집 폴백을 허용한다.
   * **어드민 승인 재렌더(force)에서만** 켠다 — 띠별 추가 호출(상한 5회)이 들어
   * 자동 흐름의 "이미지 HTTP 최대 1회" 원칙과 함께 둘 수 없다.
   */
  opts: { safetyFallback?: boolean } = {},
): Promise<TranslateOutcome> {
  return runTranslatePipeline(data, mime, undefined, opts.safetyFallback === true);
}

/**
 * 재개 실행 — **translateReverify.ts 전용**. 여기서 직접 부르지 말 것.
 * 해시 검증(원본·후보·pipelineVersion·trace)은 translateReverify 가 하고,
 * 이 함수는 검증을 통과한 입력만 받는다. 이름에 `__` 를 둔 이유는 자동완성에서
 * 운영 코드가 실수로 고르지 않게 하기 위해서다.
 */
export async function __resumeVerifiedPipeline(
  data: Buffer,
  mime: string,
  resume: ResumeInput,
): Promise<TranslateOutcome> {
  return runTranslatePipeline(data, mime, resume);
}

async function runTranslatePipeline(
  data: Buffer,
  mime: string,
  resume?: ResumeInput,
  safetyFallback = false,
): Promise<TranslateOutcome> {
  const budget = { left: MAX_IMAGE_CALLS_PER_ASSET, used: 0 };
  try {
    return await imageBudget.run(budget, () => translateImageAutoInner(data, mime, resume, safetyFallback));
  } finally {
    console.log(`[비용] 이미지 HTTP ${budget.used}회 ≈ $${(budget.used * IMAGE_CALL_COST_USD).toFixed(3)} (1K 출력 단가 기준 추정)`);
  }
}

async function translateImageAutoInner(
  data: Buffer,
  mime: string,
  resume?: ResumeInput,
  safetyFallback = false,
): Promise<TranslateOutcome> {
  ensureFonts();

  // ① 교차 OCR — 전체 판독 + 띠 판독을 항상 둘 다 돌려 합친다. 한쪽만 잡은
  //    문구는 unconfirmed 로 남겨 검수 사유에 싣는다 (단일 판독 맹신 금지).
  let merged: OcrBox[];
  let unconfirmedZh: string[];
  if (resume?.boxes) {
    // 저장된 판독·번역을 그대로 쓴다 — 검사 단계는 아래에서 전부 정상 수행된다
    merged = resume.boxes;
    unconfirmedZh = [];
  } else {
  try {
    const { sendData, sendMime } = await ocrSource(data, mime);
    const full = await extractForeign(data, mime);
    const bands = await extractByBands(sendData, sendMime);
    // 띠가 전부 거부됐으면 두 번째 눈이 없다 — 전체 판독을 한 번 더 해 이중 확인
    const second = bands.ok === 0 ? await extractOnce(sendData, sendMime) : bands.boxes;
    if (full.length === 0 && second.length === 0) return { status: "NO_FOREIGN_TEXT" };
    const m = mergeOcrPasses(full, second);
    // 합친 뒤 한 번 더 중복·조각을 걷어낸다 — mergeOcrPasses 는 전체↔띠를 1:1 로만
    // 짝지어서, 겹친 띠 3개가 같은 문구를 조금씩 다르게 돌려주면 짝을 못 찾은
    // 나머지가 그대로 남는다 (live10 #04·#06 실측)
    merged = dedupeOcrBoxes(m.merged);
    unconfirmedZh = [...new Set(m.unconfirmed.map((b) => b.zh))];
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const t = transientReason(msg);
    return t ? { status: "RETRYABLE", reasons: [t] } : { status: "FAILED", reason: `OCR 실패: ${msg}` };
  }
  }

  // ② 문구 번역 (오탐 필터·길이 예산·한자·축약 보정 포함)
  let boxes: OcrBox[];
  /** 외국어인데 번역이 비었거나 에코로 돌아온 원문 — 자동 통과 금지 신호 */
  let untranslated: string[] = [];
  /** 이웃 글자와 겹쳐 지움을 포기한 워터마크 — 최종 관문에서 이것만 면책한다 */
  let gaveUpWm: OcrBox[] = [];
  if (resume?.boxes) {
    boxes = resume.boxes;
  } else {
    try {
      const t = await translateExtracted(data, mime, merged);
      boxes = t.boxes;
      untranslated = t.untranslated;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const t = transientReason(msg);
      return t ? { status: "RETRYABLE", reasons: [t] } : { status: "FAILED", reason: `번역 실패: ${msg}` };
    }
  }

  // 번역 못 한 외국어가 하나라도 있으면 **렌더 전에** 멈춘다.
  //  - 전량 실패: 예전엔 NO_FOREIGN_TEXT(노출 허용)로 새어 원본이 검증 완료로 나갔다
  //  - 부분 실패: 남은 원문이 그대로 실려 최종 관문(LEFTOVER)에 걸릴 게 뻔하다.
  //    거기까지 가면 이미지 호출 $0.067 을 쓰고 같은 NEEDS_REVIEW 에 도달한다 —
  //    싼 단계에서 막아 비싼 단계를 살린다(규칙 1).
  if (untranslated.length > 0) {
    return {
      status: "NEEDS_REVIEW",
      data: null,
      mime: null,
      boxes,
      reasons: [{ code: "UNTRANSLATED", detail: untranslated.join(" · ").slice(0, 300) }],
    };
  }
  if (eraseTargets(boxes).length === 0) return { status: "NO_FOREIGN_TEXT" };

  // ③ 의미 검수 — 렌더 전(텍스트 호출)에 잡으면 이미지 호출 자체가 안 나간다.
  //    실패 문구는 검수 지적을 되먹인 교정 재번역(배치 1회)만 하고, 교정이
  //    무변화이거나 또 실패하면 렌더하지 않고 검수로 보낸다. 재시도 사다리 없음.
  const { width: W = 0, height: H = 0 } = await sharp((await stillOf(data, mime)).data).metadata();
  // 재개 경로는 저장된 확정 번역문을 쓰므로 렌더 전 의미검수를 다시 하지 않는다 —
  // 원문↔최종 판독문 의미 대조(⑤ MEANING_MISMATCH)는 그대로 돌아 실제 결과물을 심사한다
  if (!resume?.boxes) {
  try {
    const pairs = () => boxes.filter((b) => (b.mode ?? "translate") === "translate" && b.ko.trim());
    const p1 = pairs();
    const verdicts1 = await verifyMeaning(p1.map((b) => ({ zh: b.zh, ko: b.ko })));
    // 실패 문구별로 원문·첫 번역·검수 지적·글자 예산을 같은 인덱스로 보존 —
    // 지적을 교정 재번역에 되먹이고, 실패 시 운영자 사유에도 그대로 남긴다.
    const failed1 = p1
      .map((b, i) => ({ b, v: verdicts1[i] }))
      // hard 지적이 있는 것만 막는다 — soft(뜻은 맞는 축약·의역)는 렌더로 보내고
      // 완성본 의미검수가 실제 결과물로 다시 판정한다 (관문 제거가 아니라 시점 이동)
      .filter((x) => blocksRender(x.v))
      .map(({ b, v }) => ({
        b,
        item: {
          zh: b.zh,
          firstKo: b.ko,
          issues: v?.issues ?? [],
          budget: charBudget(b.box, W, H, [...b.zh].length),
        } satisfies CorrectionItem,
      }));
    if (failed1.length > 0) {
      // 교정 재번역 — 실패 문구 전체를 배치 1회. 문구별 반복 호출 금지.
      const corrected = await retranslateWithIssues(failed1.map((f) => f.item));
      // 교정이 무변화·빈 답·한자·숫자 누락이면 즉시 종료 — 두 번째 검수 호출도
      // 하지 않는다(그 문구는 어차피 못 고쳤고, 한 문구만 막혀도 렌더 금지).
      const rejects = failed1.map((f, i) => correctionRejected(f.item.zh, f.item.firstKo, corrected[i]));
      if (rejects.some((r) => r !== null)) {
        return {
          status: "NEEDS_REVIEW",
          data: null,
          mime: null,
          boxes,
          reasons: failed1.map((f, i) => ({
            code: "MEANING_UNCERTAIN" as const,
            detail: meaningFailureDetail({
              zh: f.item.zh,
              firstKo: f.item.firstKo,
              correctedKo: corrected[i],
              firstIssues: f.item.issues,
              secondIssues: [rejects[i] ?? "미심사 — 다른 문구의 교정 불가로 중단"],
            }),
          })),
        };
      }
      // 교정 반영 후 의미 검수 정확히 1회 더 — 또 실패하면 이미지 호출 없이 검수로.
      // 확정된 교정문(b.ko)은 이후 이미지 프롬프트·최종 OCR 엄격 일치의 기준문구다.
      failed1.forEach((f, i) => {
        f.b.ko = corrected[i];
      });
      // 2차는 **교정된 문구만** 다시 본다. 전체를 재심사하면 1차에서 통과한 문구가
      // 심사의 비결정성으로 뒤집힌다 — live10 #07 실측: 8건 중 7건이 "1차 통과 →
      // 2차 실격"이었다. 각 문구는 여전히 같은 기준으로 최소 1회 검수된다.
      const p2 = failed1.map((f) => f.b);
      const verdicts2 = await verifyMeaning(p2.map((b) => ({ zh: b.zh, ko: b.ko })));
      const failed2 = p2.map((b, i) => ({ b, v: verdicts2[i] })).filter((x) => blocksRender(x.v));
      if (failed2.length > 0) {
        const hist = new Map(failed1.map((f, i) => [f.b, { ...f.item, correctedKo: corrected[i] }]));
        return {
          status: "NEEDS_REVIEW",
          data: null,
          mime: null,
          boxes,
          reasons: failed2.map(({ b, v }) => {
            const h = hist.get(b);
            return {
              code: "MEANING_UNCERTAIN" as const,
              detail: meaningFailureDetail({
                zh: b.zh,
                firstKo: h?.firstKo ?? b.ko,
                correctedKo: b.ko,
                firstIssues: h?.issues ?? [],
                secondIssues: v?.issues ?? [],
              }),
            };
          }),
        };
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const t = transientReason(msg);
    if (t) return { status: "RETRYABLE", reasons: [t] };
    return { status: "VERIFICATION_FAILED", data: null, mime: null, boxes, reasons: [{ code: "VERIFY_FAILED", detail: `의미 검수 실패: ${msg}` }] };
  }
  }

  // ③-1 렌더 전 매핑 검사 (live10 #04) — 이미지 호출 전에 공짜로 막는다.
  //  · 서로 다른 원문이 같은 번역문으로 붙으면 셀 복제·매핑 사고의 전조다
  //  · 원문의 숫자·단위·모델코드가 번역문에서 빠졌으면 렌더까지 갈 이유가 없다
  {
    const targets = boxes.filter((b) => (b.mode ?? "translate") === "translate" && b.ko.trim());
    const m = preRenderMappingIssues(targets.map((b) => ({ zh: b.zh, ko: b.ko, box: b.box })));
    const reasons: ReviewReason[] = [];
    if (m.duplicates.length > 0) {
      reasons.push({ code: "DUPLICATE_TRANSLATION", detail: m.duplicates.join(" · ").slice(0, 300) });
    }
    if (m.numberLoss.length > 0) {
      reasons.push({ code: "NUMBER_CHANGED", detail: `번역 단계에서 소실: ${m.numberLoss.join(" · ")}`.slice(0, 300) });
    }
    if (reasons.length > 0) return { status: "NEEDS_REVIEW", data: null, mime: null, boxes, reasons };
  }

  // ③-2 원본 인벤토리 (H1·H3) — 렌더 **전에** 원본을 한 번 읽어
  //   ① 보존 목록(라틴·브랜드·숫자·모델코드)을 만들고
  //   ② 픽셀로 "글자처럼 보이는 영역"을 따로 찾아 둔다.
  // 판독 호출은 원래 검수 단계에서 하던 것을 앞으로 당긴 것뿐이라 추가 비용이
  // 없다. 보존 목록이 렌더 전에 있어야 패치 사각형이 장식을 삼키는 걸 막는다.
  let origLines: { box: [number, number, number, number]; text: string }[];
  let preserved: PreservedItem[];
  let origRegions: TextLikeRegion[];
  let origRawForCheck: { raw: Uint8ClampedArray; w: number; h: number };
  try {
    const origStill = await stillOf(data, mime);
    origLines = await transcribeText(origStill.data, origStill.mime);
    const translateBoxes = boxes
      .filter((b) => (b.mode ?? "translate") === "translate" && b.ko.trim())
      .map((b) => b.box);
    preserved = buildPreserveList(origLines, translateBoxes);
    const o = await canvasRawOf(origStill.data);
    origRawForCheck = o;
    origRegions = detectTextLikeRegions(o.raw, o.w, o.h);
  } catch (e) {
    // 검사를 못 했으면 통과가 아니다 (fail-closed)
    const msg = e instanceof Error ? e.message : String(e);
    const t = transientReason(msg);
    if (t) return { status: "RETRYABLE", reasons: [t] };
    return {
      status: "VERIFICATION_FAILED",
      data: null,
      mime: null,
      boxes,
      reasons: [{ code: "VERIFY_FAILED", detail: `원본 인벤토리 실패: ${msg}` }],
    };
  }

  // ④ 렌더 — 이미지 API HTTP 요청 정확히 1회. 어떤 실패도 자동 재요청 없음.
  let rendered: { data: Buffer; mime: string };
  let pendingZh: string[] = [];
  // "허용 패치 밖은 원본 그대로" 검증 재료 — 실제로 얹은 rect 와 인코딩 전 합성본
  let patchRects: PxBox[] | null = null;
  let compositePng: Buffer | null = null;
  let expandedPatches: { zh: string; rect: PxBox; scale: [number, number] }[] = [];
  let phraseTrace: PhraseTrace[] = [];
  /** 전체 채택 경로 — 좌표 기반 검사 대신 내용 기반 검사를 쓴다 */
  let fullAdopt = false;
  /** GIF 에서 원문을 그대로 둔 문구 — 왜 안 바뀌었는지 운영자에게 알린다 */
  let gifKeptOriginal: string[] = [];
  try {
    if (resume?.rendered) {
      // 저장된 모델 출력을 그대로 후보로 쓴다 — 이미지 API 호출 0회.
      // 전체 채택 경로와 같은 취급이라 ⑤ 검수는 내용 기반으로 전부 수행된다.
      rendered = resume.rendered;
      fullAdopt = true;
    } else if (mime === "image/gif") {
      // safetyFallback=true 는 운영자 승인 재렌더(force)에서만 온다 — 그때만 띠별 호출
      const g = await renderGif(data, boxes.filter((b) => !b.wm), { adminApproved: safetyFallback });
      rendered = { data: g.data, mime: g.mime };
      gifKeptOriginal = g.keptOriginal ?? [];
    } else {
      // dropRiskyWm 이 빼는 것 = 이웃 글자와 겹쳐 **지움을 포기한** 워터마크.
      // 최종 관문은 이것만 면책한다 — 지우라고 시킨 워터마크가 남으면 실패다.
      const beforeDrop = boxes;
      boxes = dropRiskyWm(boxes);
      gaveUpWm = beforeDrop.filter((b) => b.wm && !boxes.includes(b));
      if (mustOverlay(boxes)) {
        // 자동 흐름에서 여기 오는 경우는 "지울 워터마크만 있는 장"뿐이다
        const r = await eraseThenDraw(data, mime, eraseTargets(boxes), boxes);
        pendingZh = r.unresolved.map((b) => b.zh);
        rendered = { data: r.data, mime: r.mime };
        patchRects = r.patchRects;
        compositePng = r.compositePng;
      } else {
        // 전체 채택 (2026-08-24 아키텍처 전환, 운영 결정): 모델 전체 출력을 후보로
        // 쓴다. 원본 좌표 패치는 한국어 길이 차이로 판이 다시 흐르는(reflow) 모델
        // 동작과 충돌해 live10 에서 자동 통과 0% 였다 — 번역 자체는 정확했는데
        // 좌표 검사가 전량 어긋났다. 픽셀 동일성 대신 "상품 정보 보존"을 검증한다:
        // 잔류·확정문구 일치·숫자·장식 보존은 글 내용으로, 제품 모습은 두-이미지
        // 무결성 심사로. 패치 합성은 수동 재렌더·워터마크·GIF 경로에 남아 있다.
        const meta2 = await sharp(data).metadata();
        const png = await callImageEdit(data, mime, regenPrompt(boxes), meta2.width ?? 0, meta2.height ?? 0);
        rendered =
          mime === "image/png"
            ? { data: png, mime: "image/png" }
            : { data: await sharp(png).jpeg({ quality: 95 }).toBuffer(), mime: "image/jpeg" };
        fullAdopt = true;
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const t = transientReason(msg);
    if (t) return { status: "RETRYABLE", reasons: [t] };
    if (msg.includes("모델 거부") || msg.includes("반환하지 않음")) {
      // 어드민 승인 재렌더에서만 + 구조화된 안전 코드 화이트리스트에 한해:
      // 글자 띠 국소 편집 폴백. 미반환(NO_IMAGE)·GIF 는 제외한다.
      // 성공해도 VERIFIED 는 없다 — 후보로만 떠서 이음새를 사람이 본다.
      if (shouldAttemptSafetyFallback(msg, mime, safetyFallback)) {
        try {
          const fb = await renderSafetyFallback(data, mime, boxes);
          return {
            status: "NEEDS_REVIEW",
            data: fb.data,
            mime: fb.mime,
            boxes,
            reasons: [{ code: "SAFETY_FALLBACK", detail: `${msg} → ${fb.note}` }],
          };
        } catch (fe) {
          const fmsg = fe instanceof Error ? fe.message : String(fe);
          return {
            status: "NEEDS_REVIEW",
            data: null,
            mime: null,
            boxes,
            reasons: [{ code: "SAFETY_BLOCKED", detail: `${msg} (국소 편집 폴백도 실패: ${fmsg.slice(0, 120)})` }],
          };
        }
      }
      return { status: "NEEDS_REVIEW", data: null, mime: null, boxes, reasons: [{ code: "SAFETY_BLOCKED", detail: msg }] };
    }
    if (msg.includes("비율 불일치")) {
      return { status: "NEEDS_REVIEW", data: null, mime: null, boxes, reasons: [{ code: "RATIO_MISMATCH", detail: msg }] };
    }
    return { status: "FAILED", reason: `렌더 실패: ${msg}` };
  }

  // ⑤ 완성본 검수 — 사유가 하나라도 있으면 부분 성공이라도 VERIFIED 금지.
  const reasons: ReviewReason[] = [];
  if (unconfirmedZh.length > 0) reasons.push({ code: "OCR_DISAGREEMENT", detail: unconfirmedZh.join(", ").slice(0, 300) });
  if (pendingZh.length > 0) reasons.push({ code: "PATCH_REJECTED", detail: pendingZh.join(", ").slice(0, 300) });
  if (boxes.length >= DENSE_GRID_MIN) {
    // 밀집 그리드는 판독·관문이 수렴하지 않는 판이다(실측 #14) — 자동 합격 불가
    reasons.push({ code: "DENSE_GRID", detail: `문구 ${boxes.length}개` });
  }
  try {
    const outStill = await stillOf(rendered.data, rendered.mime);
    const origStill = await stillOf(data, mime);
    const verifyTargets = boxes.filter(
      (b) => ((b.mode ?? "translate") === "translate" && b.ko.trim()) || b.mode === "erase",
    );
    const outLines = fullAdopt
      ? await transcribeTextCross(outStill.data, outStill.mime)
      : await transcribeText(outStill.data, outStill.mime);
    // origLines 는 렌더 전(③-2)에 이미 읽었다 — 같은 호출을 두 번 하지 않는다

    if (!fullAdopt) {
      // 좌표 기반 잘림·잔류 검사 — 패치 경로(워터마크 지우기)에서만 좌표가 유효하다
      const flagged = await flaggedBoxes(outStill.data, outStill.mime, verifyTargets, true, origStill.data, outLines);
      if (flagged.length > 0) {
        reasons.push({ code: "FLAGGED", detail: flagged.map((b) => b.zh).join(", ").slice(0, 300) });
      }
    }
    // 숫자·단위·모델명 보존 + 추가 문구(환각) + 확정 문구 일치(정책 5).
    // 전체 채택 경로는 판이 다시 흐르므로(reflow) **좌표가 아니라 글 내용**으로
    // 판독 줄을 찾는다 — 기준(엄격 일치·허용 오차)은 그대로다.
    const numberMissing: string[] = [];
    const extraText: string[] = [];
    const altered: string[] = [];
    const renderedPairs: { zh: string; observed: string }[] = [];
    const outAllText = outLines.map((l) => l.text).join(" ");
    for (const b of verifyTargets) {
      if ((b.mode ?? "translate") !== "translate") continue;
      // 전체 채택: 엄격 일치(개행 문구는 줄 단위 분해) → 없으면 "기대 문구를 담은 줄"
      // (덧붙임 진단용 — EXTRA_TEXT 사유에 실제 덧붙은 글자가 찍히게) → 없으면 미검출
      const segMatch = fullAdopt ? matchExpectedSegments(b.ko, b.zh, outLines) : null;
      const seen = fullAdopt
        ? (segMatch!.ok
            ? segMatch!.seen
            : outLines.find((l) => forCompareText(l.text).includes(forCompareText(b.ko)) && forCompareText(b.ko).length > 0)?.text ?? "")
        : outLines.filter((l) => flaggedHits(l.box, b)).map((l) => l.text).join(" ");
      // 숫자·단위: reflow 로 옆 줄로 밀릴 수 있어 전체 판독문 기준 — 빠졌으면 실격
      const r = numbersPreserved(b.zh, fullAdopt ? outAllText : seen);
      if (!r.ok) numberMissing.push(`${b.zh}: ${r.missing.join("/")}`);
      if (seen) {
        const x = extraTextInBox(b.ko, b.zh, seen);
        if (!x.ok) extraText.push(`${b.ko} +${x.extra}`);
      }
      // 확정 번역문의 엄격 일치 — 전체 채택에서 "맞는 줄이 없다" = 문구가 누락·변형된 것
      const strictOk = fullAdopt ? segMatch!.ok : Boolean(seen && renderedTextMatches(b.ko, seen));
      if (!strictOk) {
        if (fullAdopt && seen && extraTextInBox(b.ko, b.zh, seen).ok) {
          // 이웃 장식과 한 줄로 읽힌 경우 — 기대 문구는 온전하다
        } else {
          altered.push(`${b.ko.replace(/\n/g, " ")} ↔ ${(seen || "(미검출)").replace(/\n/g, " ")}`.slice(0, 80));
        }
      }
      if (seen) renderedPairs.push({ zh: b.zh, observed: seen });
    }
    if (numberMissing.length > 0) reasons.push({ code: "NUMBER_CHANGED", detail: numberMissing.join(" · ").slice(0, 300) });
    if (extraText.length > 0) reasons.push({ code: "EXTRA_TEXT", detail: extraText.join(" · ").slice(0, 300) });
    if (altered.length > 0) reasons.push({ code: "TEXT_ALTERED", detail: altered.join(" · ").slice(0, 300) });
    // 원문 ↔ 최종 판독문 의미 대조 (정책 4) — 문자열 일치가 아니라 의미 단위.
    // 렌더를 거치며 생긴 누락·추가·과장·성적 강화가 있으면 MEANING_MISMATCH.
    const rm = await verifyRenderedMeaning(renderedPairs);
    const mismatched = renderedPairs.filter((_, i) => !rm[i]?.ok);
    if (mismatched.length > 0) {
      reasons.push({
        code: "MEANING_MISMATCH",
        detail: mismatched.map((p, i) => `${p.zh}↔${p.observed}${rm[renderedPairs.indexOf(p)]?.issues?.[0] ? ` (${rm[renderedPairs.indexOf(p)].issues[0]})` : ""}`).join(" · ").slice(0, 300),
      });
    }
    // 없던 문구 생성 — 전체 채택은 좌표가 무의미하므로 "확정 문구·원본 판독 어디에도
    // 없는 줄"로 잡는다 (환각 도장·보증 문구). 패치 경로는 기존 좌표 판정 유지.
    const invented = fullAdopt
      ? unexpectedOutputLines(
          outLines,
          verifyTargets.filter((b) => (b.mode ?? "translate") === "translate").map((b) => ({ ko: b.ko, zh: b.zh })),
          origLines,
        )
      : newTextLines(outLines, boxes.map((b) => b.box), origLines);
    if (invented.length > 0) reasons.push({ code: "NEW_TEXT", detail: invented.map((l) => l.text).join(", ").slice(0, 300) });
    // 최종 관문 — 완성본을 **전체 + 띠(상·중·하)** 로 교차 판독한다.
    // 전체 1회만 읽던 시절, 최초 판독이 놓친 문구를 관문도 같이 놓쳐(같은 모델이라
    // 실명이 상관된다) 중국어가 그대로 보이는 이미지가 VERIFIED 로 나갔다 (H1).
    const gateFound = await extractForeignCross(rendered.data, rendered.mime);
    const leftover = gateLeftover(gateFound, gaveUpWm);
    if (leftover > 0) reasons.push({ code: "LEFTOVER", detail: `외국어 ${leftover}건 잔존` });

    // 제품 무결성 — 픽셀 동일성 관문을 대신하는 의미 관문.
    // 제품 개수·형태·색상·구성이 달라 보이면 실격, 판 재배치·글자 차이는 허용.
    //
    // GIF 도 포함한다(2026-09-02). 예전엔 fullAdopt(정지 이미지 전체 채택)에서만
    // 돌아서, GIF 는 띠에 제품이 걸쳐 있어도 모델이 그것을 바꿨는지 아무도 확인하지
    // 않았다 — 국소 편집이라 위험이 작을 뿐 0 은 아니다. 텍스트 모델 1회(사실상
    // 공짜)로 막을 수 있는 구멍을 열어둘 이유가 없다.
    if (fullAdopt || mime === "image/gif") {
      const pi = await verifyProductIntegrity(
        { data: origStill.data, mime: origStill.mime },
        { data: outStill.data, mime: outStill.mime },
      );
      if (!pi.ok || pi.hard.length > 0) {
        reasons.push({ code: "PRODUCT_CHANGED", detail: (pi.hard[0] ?? pi.issues[0] ?? "제품 모습 상이").slice(0, 300) });
      }
    }

    // H1 — 원본의 모든 문자 영역이 설명돼야 한다.
    // 설명 = 번역 대상 · 보존 목록 · 유지(워터마크/keep) 중 하나가 덮는 것.
    // 픽셀 탐지는 OCR 과 독립이라 "OCR 이 통째로 못 본 문구"를 여기서 잡는다.
    {
      const explained: [number, number, number, number][] = [
        ...boxes.map((b) => b.box),
        ...preserved.map((p) => p.box),
        ...outLines.filter((l) => !isForeignSource(l.text)).map((l) => l.box),
      ];
      const unexplained = unexplainedTextRegions(origRegions, explained);
      if (unexplained.length > 0) {
        reasons.push({
          code: "UNEXPLAINED_TEXT",
          detail: unexplained
            .slice(0, 6)
            .map((r) => `[${r.box.join(",")}] h${r.heightPx}px 대비${r.contrast}`)
            .join(" · ")
            .slice(0, 300),
        });
      }
      // 확신이 낮은 영역(작은 글자·저대비·하단)은 "설명됐다"는 말도 약하다 —
      // 번역 대상으로 잡혀 최종 판독까지 확인된 게 아니면 사람 눈으로 본다.
      const verifiedBoxes = boxes
        .filter((b) => (b.mode ?? "translate") === "translate" && b.ko.trim())
        .map((b) => b.box);
      const shaky = unexplainedTextRegions(
        origRegions.filter(isLowConfidenceRegion),
        verifiedBoxes,
      );
      if (shaky.length > 0) {
        reasons.push({
          code: "LOW_CONFIDENCE_TEXT",
          detail: shaky
            .slice(0, 6)
            .map((r) => `[${r.box.join(",")}] h${r.heightPx}px 확신${r.confidence}`)
            .join(" · ")
            .slice(0, 300),
        });
      }
    }

    // H3 — 보존 목록(라틴·브랜드·숫자·모델코드)이 내용·자리 그대로인가
    if (preserved.length > 0) {
      const intact = preservedTextIntact(preserved, outLines);
      if (!intact.ok) {
        reasons.push({ code: "DECOR_ALTERED", detail: `장식·모델명 소실/변형: ${intact.missing.join(", ")}`.slice(0, 300) });
      }
    }

    // 허용 패치 밖 픽셀 보존 — 실제로 얹은 rect 밖이 원본과 1px 이라도 다르면 실패.
    // 원본과 합성본을 **같은 디코더(canvas)** 로 RGBA raw 로 풀어 비교한다 —
    // sharp 와 canvas 의 JPEG 디코딩이 미세하게 달라 교차 비교하면 오탐이 난다.
    // 합성본은 인코딩 전 PNG(무손실)라 위반이 없으면 정확히 0px 이다.
    if (patchRects && compositePng) {
      const o = await canvasRawOf(data);
      const r = await canvasRawOf(compositePng);
      if (o.w === r.w && o.h === r.h) {
        const diff = outsidePatchDiff(o.raw, r.raw, o.w, o.h, patchRects, 0);
        if (diff > 0) reasons.push({ code: "OUTSIDE_CHANGED", detail: `허용 패치 밖 ${diff}px 변화` });
        // H3 — 보존 영역은 픽셀 한 점도 바뀌면 안 된다. 패치 사각형에서 이미
        // 빼 두지만(rectHitsPreserved), 그 방어가 뚫렸는지 결과로 다시 확인한다.
        const pDiff = preservedPixelDiff(o.raw, r.raw, o.w, o.h, preserved, 0);
        if (pDiff > 0) {
          reasons.push({ code: "DECOR_ALTERED", detail: `보존 영역 ${pDiff}px 변화 (영문·숫자 장식)` });
        }
      } else {
        reasons.push({ code: "OUTSIDE_CHANGED", detail: `크기 불일치 ${o.w}x${o.h} → ${r.w}x${r.h}` });
      }
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const t = transientReason(msg);
    if (t) return { status: "RETRYABLE", reasons: [...reasons, t] };
    return {
      status: "VERIFICATION_FAILED",
      data: rendered.data,
      mime: rendered.mime,
      boxes,
      reasons: [...reasons, { code: "VERIFY_FAILED", detail: msg }],
    };
  }

  // GIF 는 재부호화(팔레트 양자화) 때문에 "패치 밖 원본 보존"을 프레임 단위로
  // 픽셀 증명할 수 없다 — 증명 못 하면 자동 VERIFIED 금지, 육안 확인으로 보낸다 (v2.1 보강)
  if (mime === "image/gif") {
    reasons.push({ code: "GIF_UNVERIFIED", detail: "GIF 재부호화 — 패치 밖 보존을 픽셀로 증명 불가, 육안 확인 필요" });
    // 원문을 그대로 둔 문구는 잔류 검사에도 걸린다 — 그쪽 사유("글자가 깨졌을 수
    // 있습니다")만 보면 운영자가 실패로 오해한다. 의도된 보존임을 따로 밝힌다.
    if (gifKeptOriginal.length > 0) {
      reasons.push({
        code: "GIF_KEPT_ORIGINAL",
        detail: gifKeptOriginal.map((z) => z.slice(0, 14)).join(", ").slice(0, 300),
      });
    }
  }

  // 문구별 추적 — 번역 대상인데 상태가 없는 문구가 있으면 조용한 누락이다 (요구 4).
  // GIF·오버레이 경로는 추적을 만들지 않으므로(문구를 우리가 그린다) 건너뛴다.
  if (phraseTrace.length > 0) {
    const targets = boxes.filter((b) => (b.mode ?? "translate") === "translate" && b.ko.trim());
    const traced = new Set(phraseTrace.map((t) => t.id));
    const missing = targets.filter((b) => !traced.has(phraseId(b)));
    if (missing.length > 0) {
      reasons.push({ code: "UNTRACKED_PHRASE", detail: missing.map((b) => b.zh.slice(0, 14)).join(", ").slice(0, 300) });
    }
    // 패치가 절반 넘게 거부되고 그 사유가 국소 이음매(경계 대변동)라면, 경계가
    // 더러운 게 아니라 **모델이 판을 다시 흘린** 것이다 (live10 #03·#06 실측:
    // 번역 자체는 정확한데 한국어 길이가 달라 본문·제품 위치가 밀렸다).
    // 운영자에게 다른 조치를 안내해야 하므로 사유를 분리한다.
    const rejected = phraseTrace.filter((t) => t.status === "patch_rejected");
    if (targets.length >= 4 && rejected.length > targets.length * 0.5) {
      reasons.push({
        code: "LAYOUT_SHIFTED",
        detail: `패치 ${rejected.length}/${targets.length} 거부 — 모델이 판을 다시 배치했을 가능성. 예: ${rejected[0]?.zh.slice(0, 12)} ${rejected[0]?.detail ?? ""}`.slice(0, 300),
      });
    }
  }

  // 확장 후보 패치는 검증이 다 통과해도 자동 VERIFIED 금지 (2026-08-24 1차 출시 안전정책).
  // 확장 링 검증에는 실측 미탐이 있다 — 링 안 장식이 진해지는 변화(잉크 증가·길쭉)와
  // 6px 윤곽 밀림(작은 조각 2개)은 잉크 방향·국소 이음매·strong·p75 어느 것에도 안
  // 걸리고, 중국어는 제거됐으니 LEFTOVER 도 못 막는다. 링 픽셀은 모델 것으로 갈리는
  // 영역이므로 확장 채택 장은 전부 후보 보존 + 육안 검수로 보낸다. 기본 rect 는
  // 링이 없어(밖은 outsidePatchDiff 0px 증명) 기존 정책 그대로다.
  if (expandedPatches.length > 0) {
    reasons.push({
      code: "EXPANDED_PATCH_REVIEW",
      detail: expandedPatches
        .map((e) => `${e.zh} rect=[${e.rect.x0},${e.rect.y0},${e.rect.x1},${e.rect.y1}] x${e.scale[0]}/y${e.scale[1]}`)
        .join(" · ")
        .slice(0, 300),
    });
  }

  if (reasons.length > 0) return { status: "NEEDS_REVIEW", data: rendered.data, mime: rendered.mime, boxes, reasons };
  return { status: "VERIFIED", data: rendered.data, mime: rendered.mime, boxes };
}
