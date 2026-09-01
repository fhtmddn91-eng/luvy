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
const PROMPT_V = 6; // v6: GIF 글자 띠 전용 프롬프트 분리 (2026-09-01) — 띠 crop 에도
// 전체 이미지용 프롬프트를 쓰느라, 관문이 떨어뜨리는 세 가지(가장자리 배경색·
// 겹침 금지·띠 안에 넣기)를 모델에게 한마디도 지시하지 않고 있었다.
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
// 4: GIF 도 띠 국소 편집으로 전환 (2026-08-31) — 옛 좌표 패치는 재조판과 충돌해
//    글자가 전부 정지인 GIF 마저 실패시켰다(H007 실측)
// 5: GIF 띠 채택에 육안 심사(겹침·뭉갬·잘림) 관문 + 불합격 재시도 추가 (2026-09-01)
//    — 판독만 보던 구버전은 두 겹으로 찍힌 제목을 통과시켰다(마리아 GIF 실측).
//    그 판정으로 만든 결과는 자동 재사용하지 않는다.
// 6: 겹치는 정지 띠를 합치거나 글자 사이에서 잘라 나눈다 + 페더를 여백 안쪽·
//    비이음매로 제한 (2026-09-01). 겹친 띠에 패치를 두 번 얹어 글자가 두 겹으로
//    찍히고, 반투명 가장자리로 중국어 원문이 비쳐 나오던 결과는 재사용 금지.
// 7: 띠가 담은 글자를 전부 덮게 보장 (조각 합집합 + 커버 검증). 구버전은 띠
//    조각 하나만 쓰면서 글자 절반이 패치 밖에 남아 원문이 드러났다(M18 실측:
//    여백 L-105·B-90). 그 판정으로 만든 결과는 재사용하지 않는다.
// 8: 띠 채택에 이음매 관문(페더 전 픽셀 검사) + 글자 여유 2px + 이웃 문구 오탐
//    수정 (2026-09-01). 구버전은 배경이 어긋난 패치를 그대로 얹었고, 반대로
//    이웃 문구가 읽히면 멀쩡한 결과를 거부했다 — 두 판정 모두 재사용 금지.
// 9: 띠를 이웃 글자 코어를 피해 자른다 (2026-09-01). 여백에 걸친 이웃 원문을
//    모델이 손대 헛글자를 만들어 띠 전체가 버려졌다(M18 실측: 「360°贴合」이
//    "360새름"으로 깨져 「쿠션 설계」가 원문으로 남았다).
// 10: 여백 사다리를 픽셀 단위로 세분화(45/32/24/18/14/11/8) + 가까운 띠 합치기.
//     permil 3단계(45/26/13px)는 성겨서 8~13px 로만 정지인 문구를 놓쳤다.
//     하한 8px 은 폰트 오버슈트 실측(1~5px)에서 나온 값 — 더 좁히면 판독 박스를
//     넘어선 획이 패치 밖에 남는다(M18 여백 4px 실측: "자세 체감" 뒤 원문 잔존).
// 11: 여백 하한을 문구마다 계산한다 — 판독 박스가 자른 획(오버슈트)을 국소
//     배경 + 연결 성분으로 실제 측정(glyphExtent). 고정 하한 8px 은 오버슈트가
//     작은 문구까지 싸잡아 버렸고, 3px 은 큰 문구에서 획을 남겼다.
// 12: 작은 글자는 띠를 확대해 보낸다(목표 44px) + 납작한 띠는 세로 확장 +
//     재시도는 배율을 바꿔 조건을 달리한다. 실측: 1회에 성공한 띠 9개는 전부
//     글자 41~94px, 실패한 띠는 22px 였다.
// 13: 정지 판정을 "움직인 픽셀 0개"에서 **절대 크기·덩어리** 기준으로 (2026-09-01).
//     0개 규칙은 과잉 반작용이었다 — M18 의 두 문구는 99.8~100% 정지인데 잡티
//     9픽셀 때문에 통째로 버려졌다. 얼렸을 때 손실은 11px(0.11%)로 보이지 않는다.
// 14: 프레임을 하나씩 읽어 움직임 마스크만 누적한다(메모리가 프레임 수와 무관).
//     전 프레임을 배열로 들던 구조 때문에 프레임 60장 상한이 있었고, 표본 47장
//     중 5장(10.6%)이 그 상한으로 통째로 배제됐다. 상한 60 → 200.
const RENDER_V = 14;
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
