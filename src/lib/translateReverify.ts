import "server-only";
import crypto from "node:crypto";
import { __resumeVerifiedPipeline, phraseId, type OcrBox, type TranslateOutcome } from "@/lib/imageTranslate";
import { PIPELINE_VERSION, sha256Of } from "@/lib/translateCache";

/**
 * 저장 후보 재검증 — **검증 코드를 고친 뒤 이미 만들어 둔 산출물로 다시 판정**하는
 * 도구 전용 경로다. 유료 이미지 호출을 다시 쓰지 않는 것이 목적.
 *
 * 왜 별도 모듈인가: 재개 입력은 "검사 단계를 건너뛰게 하는 힘"을 갖는다. 그 힘이
 * 운영 진입점(translateImageAuto)에 옵션으로 붙어 있으면, 어드민 액션이나 라우트에
 * 외부 값이 흘러 들어오는 순간 검사를 건너뛴 결과가 VERIFIED 로 나갈 수 있다.
 * 그래서 ① 운영 진입점에서 옵션 자체를 없애고 ② 재개는 이 모듈에서만 열되
 * ③ **바이트·버전·문구가 저장 당시와 같다는 걸 해시로 증명**해야 실행되게 한다.
 *
 * 여기서 통과시켜도 완성본 검수(⑤)는 하나도 생략되지 않는다 — 건너뛰는 것은
 * "결과를 만드는 단계"(판독·번역·의미검수·이미지 생성)뿐이다.
 */

/** 재개 표 — 저장 시점의 신원. 하나라도 어긋나면 실행하지 않는다 */
export interface ReverifyTicket {
  /** 원본 바이트 SHA-256 */
  originalSha256: string;
  /** 저장된 모델 출력(후보) 바이트 SHA-256 — 후보 없이 렌더부터 재개하면 null */
  candidateSha256: string | null;
  /** 저장 당시 파이프라인 버전 */
  pipelineVersion: string;
  /** 문구 목록(원문·번역·좌표)의 정본 해시 */
  boxesHash: string;
}

export interface ReverifyInput {
  ticket: ReverifyTicket;
  original: Buffer;
  originalMime: string;
  boxes: OcrBox[];
  /** 저장된 모델 출력. 없으면 이미지 1회를 써서 렌더부터 재개한다 */
  candidate?: { data: Buffer; mime: string };
}

/**
 * 문구 목록의 정본 해시 — 좌표·원문·번역이 하나라도 바뀌면 값이 달라진다.
 * 순서에 흔들리지 않도록 안정 ID 로 정렬한다(배열이 재정렬돼도 같은 해시).
 */
export function boxesTraceHash(boxes: OcrBox[]): string {
  const rows = boxes
    .map((b) => ({ id: phraseId(b), zh: b.zh, ko: b.ko, mode: b.mode ?? "translate" }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return crypto.createHash("sha256").update(JSON.stringify(rows)).digest("hex");
}

/** 재개 표를 만든다 — 산출물을 저장하는 쪽이 부른다 */
export function makeReverifyTicket(input: {
  original: Buffer;
  candidate?: Buffer | null;
  boxes: OcrBox[];
}): ReverifyTicket {
  return {
    originalSha256: sha256Of(input.original),
    candidateSha256: input.candidate ? sha256Of(input.candidate) : null,
    pipelineVersion: PIPELINE_VERSION,
    boxesHash: boxesTraceHash(input.boxes),
  };
}

/** 표와 실제 입력이 일치하는지 — 어긋난 이유를 돌려준다(없으면 null) */
export function ticketMismatch(input: ReverifyInput): string | null {
  const { ticket } = input;
  if (!ticket || typeof ticket !== "object") return "재개 표 없음";
  if (ticket.pipelineVersion !== PIPELINE_VERSION) {
    return `파이프라인 버전 불일치 (저장 ${ticket.pipelineVersion} ≠ 현재 ${PIPELINE_VERSION})`;
  }
  if (sha256Of(input.original) !== ticket.originalSha256) return "원본 바이트 불일치";
  const candSha = input.candidate ? sha256Of(input.candidate.data) : null;
  if (candSha !== ticket.candidateSha256) return "후보 바이트 불일치";
  if (!Array.isArray(input.boxes) || input.boxes.length === 0) return "문구 목록 없음";
  if (input.boxes.some((b) => !b || typeof b.zh !== "string" || typeof b.ko !== "string" || !Array.isArray(b.box))) {
    return "문구 목록 형식 오류";
  }
  if (boxesTraceHash(input.boxes) !== ticket.boxesHash) return "문구·좌표 해시 불일치(변조 또는 누락)";
  return null;
}

/**
 * 저장 후보 재검증 실행. 표가 어긋나면 **아무 호출도 하지 않고** 차단한다.
 * 실패는 VERIFICATION_FAILED — "확인 못 했으면 통과가 아니다"를 여기서도 지킨다.
 */
export async function reverifySavedCandidate(input: ReverifyInput): Promise<TranslateOutcome> {
  const bad = ticketMismatch(input);
  if (bad) {
    return {
      status: "VERIFICATION_FAILED",
      data: null,
      mime: null,
      boxes: Array.isArray(input.boxes) ? input.boxes : [],
      reasons: [{ code: "VERIFY_FAILED", detail: `재검증 거부: ${bad}` }],
    };
  }
  return __resumeVerifiedPipeline(input.original, input.originalMime, {
    boxes: input.boxes,
    rendered: input.candidate,
  });
}
