import "server-only";
import crypto from "node:crypto";
import { db } from "@/lib/db";
import { IMAGE_MODEL } from "@/lib/imageTranslate";

/**
 * (원본 바이트 SHA-256, 파이프라인 버전) → 번역 결과 캐시 (설계 2026-08-24 v2.1 정책 7·8).
 *
 * 같은 그림은 두 번 렌더하지 않는다 — 상품·URL·파일명이 달라도 바이트가 같으면
 * OCR·번역·렌더·검증 결과를 재사용한다. 이미 판정이 난 그림(NEEDS_REVIEW·FAILED 포함)에
 * 자동으로 API 를 다시 쓰는 일도 막는다 — 재실행은 운영자 승인뿐이다.
 */

/**
 * 파이프라인 버전 — 모델 ID·프롬프트·패치 알고리즘·검증 정책이 하나라도 바뀌면
 * 여기 숫자를 올린다. 키가 달라져 구버전 결과가 새 파이프라인에 자동 재사용되지 않는다.
 * (구버전 VERIFIED 행은 보존된다 — 재사용 여부는 운영자가 장별로 결정)
 */
const PROMPT_V = 5; // regenPrompt 에 그림자·외곽선·장식 유지 추가 (2026-08-24)
// v5: 링 분리 성분 판정을 글자 크기 정규화(0.18·h²) + 길쭉함 + 잉크 방향으로 교체
// v6: 국소 이음매 게이트(seamLocalOk — p99·연속 run) 추가. 평균 seamGap 만으로
//     채택된 구버전 결과(live3 A 패치처럼 경계가 끊긴 것)는 자동 재사용되지 않는다 (2026-08-24)
// v7: clipRectAgainst 가 사각형을 자른 뒤 feather 를 다시 잡는다. 그 전에는 잘려서
//     두께가 2×feather 보다 얇아진 패치의 알파가 255 에 도달하지 못해 **패치 전체가
//     반투명**으로 얹혔다 — 원문·워터마크가 비쳐 보이는 결과가 VERIFIED 로 나갔을 수
//     있어 구버전 결과를 자동 재사용하지 않는다 (2026-08-28)
const PATCH_V = 7;
// v2: + 확정문구 엄격 일치·완성본 의미 대조·의미검수 기준 강화
// v3: 확장 rect 패치는 자동 VERIFIED 금지(EXPANDED_PATCH_REVIEW) — 구버전에서 확장
//     채택으로 VERIFIED 된 결과는 링 미탐 위험이 있어 자동 재사용하지 않는다 (2026-08-24)
// v4: H1(원본 문자 영역 전수 설명 + 관문 교차 판독) · H3(라틴·모델코드 보존 목록,
//     편집 금지 rect, 픽셀·내용·자리 대조) 추가 — 이 검사들을 안 거친 구버전
//     VERIFIED 는 잔류·장식 훼손이 섞여 있을 수 있어 자동 재사용하지 않는다 (2026-08-24)
// v5: live10 대응 — 판독 중복·조각 제거, 의미검수 hard/soft 분리(2차는 교정문만),
//     렌더 전 셀 복제·숫자 소실 차단, 문구별 추적(UNTRACKED_PHRASE)·LAYOUT_SHIFTED (2026-08-24)
// v6: 전체 채택 검증 버그픽스 — 단일 객체 verdict 파싱(제품 무결성)·개행 문구 매칭
//     (live11 실측: 렌더 5장 전부 VERIFICATION_FAILED·'미검출' 대량) (2026-08-24)
// v7: live11 대응 — 최종 판독 교차 읽기(작은 글자 누락 오차단), 판독 중복 2자 병합,
//     동의 번역 허용(좌표 충돌·숫자 불일치만 차단), 429 quota 상세 포착 (2026-08-24)
// v8: 재개 경로를 해시 게이트(원본·후보·버전·문구 trace)로 잠그고 운영 진입점에서 분리 (2026-08-24)
// v9: (1) 에코·빈 번역을 "외국어 없음"으로 합치던 fail-open 차단(UNTRANSLATED) —
//     구버전에서 NO_FOREIGN_TEXT 로 통과한 그림 중 실제로는 번역이 실패해 중국어
//     원본이 그대로 나간 것이 섞여 있을 수 있다. 이게 이번 버전업의 주된 이유다.
//     (2) 지우라고 시킨 워터마크가 남으면 잔류로 센다 — 반만 지워진 워터마크가
//     VERIFIED 로 나가던 경로. 두 검사 모두 구버전 판정에는 적용된 적이 없다 (2026-08-28)
const VERIFY_V = 9;
// 렌더 전략 축 — v2: 자동 정지이미지가 패치 합성 → **전체 채택**으로 전환 (2026-08-24
// 운영 결정: 픽셀 동일성 대신 상품 정보 보존을 검증). 패치 시절 결과는 자동 재사용 금지.
// 3: 안전필터 거부 시 글자 띠 국소 편집 폴백 추가 (2026-08-30, 승인 재렌더 전용)
const RENDER_V = 3;
export const PIPELINE_VERSION = `${IMAGE_MODEL}|render:${RENDER_V}|prompt:${PROMPT_V}|patch:${PATCH_V}|verify:${VERIFY_V}`;

export function sha256Of(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

export type CacheHit =
  | { kind: "verified"; data: Buffer; mime: string; ocrData: string | null; resultFile: string }
  | { kind: "no_foreign" }
  /** 이미 판정이 난 그림 — 자동 재실행 금지, 같은 사유로 표시 (후보 파일이 살아 있으면 같이) */
  | { kind: "blocked"; status: string; verifyData: string | null; ocrData: string | null; candidate: { data: Buffer; mime: string; resultFile: string } | null };

/**
 * 캐시 조회. VERIFIED 는 파일 무결성(존재 + bytes 일치)까지 확인하고, 끊어진
 * 캐시는 staleAt/staleReason 을 기록한 뒤 미스(null)로 돌린다 — 깨진 파일을
 * 손님에게 잇는 길을 만들지 않는다.
 */
export async function lookupTranslationCache(sha256: string): Promise<CacheHit | null> {
  const row = await db.translationCache.findUnique({
    where: { sha256_pipelineVersion: { sha256, pipelineVersion: PIPELINE_VERSION } },
    include: { storedFile: true },
  });
  if (!row || row.staleAt) return null;

  if (row.status === "NO_FOREIGN_TEXT") return { kind: "no_foreign" };

  const loadFile = (): { data: Buffer; mime: string; resultFile: string } | null => {
    const f = row.storedFile;
    if (!f) return null;
    const data = Buffer.from(f.data);
    if (data.byteLength !== f.bytes) return null; // 손상 — bytes 불일치
    return { data, mime: f.mime, resultFile: f.name };
  };

  if (row.status === "VERIFIED") {
    const file = loadFile();
    if (!file) {
      await markCacheStale(sha256, row.storedFile ? "파일 손상(bytes 불일치)" : "파일 소실");
      return null;
    }
    return { kind: "verified", data: file.data, mime: file.mime, ocrData: row.ocrData, resultFile: file.resultFile };
  }

  // NEEDS_REVIEW · RETRYABLE · FAILED — 자동 재실행 금지, 후보가 살아 있으면 같이 전달
  return { kind: "blocked", status: row.status, verifyData: row.verifyData, ocrData: row.ocrData, candidate: loadFile() };
}

export async function markCacheStale(sha256: string, reason: string): Promise<void> {
  await db.translationCache.updateMany({
    where: { sha256, pipelineVersion: PIPELINE_VERSION },
    data: { staleAt: new Date(), staleReason: reason.slice(0, 200) },
  });
}

/** 결과 저장 — 같은 키가 있으면 덮어쓴다(운영자 승인 재렌더가 판정을 갱신하는 경로) */
export async function saveTranslationCache(input: {
  sha256: string;
  status: "VERIFIED" | "NO_FOREIGN_TEXT" | "NEEDS_REVIEW" | "VERIFICATION_FAILED" | "RETRYABLE" | "FAILED";
  ocrData?: string | null;
  resultFile?: string | null;
  verifyData?: string | null;
}): Promise<void> {
  const data = {
    status: input.status,
    ocrData: input.ocrData ?? null,
    resultFile: input.resultFile ?? null,
    verifyData: input.verifyData ?? null,
    staleAt: null,
    staleReason: null,
  };
  await db.translationCache.upsert({
    where: { sha256_pipelineVersion: { sha256: input.sha256, pipelineVersion: PIPELINE_VERSION } },
    create: { sha256: input.sha256, pipelineVersion: PIPELINE_VERSION, ...data },
    update: data,
  });
}
