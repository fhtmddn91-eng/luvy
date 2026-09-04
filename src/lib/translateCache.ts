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
// v7: 띠 프롬프트에 "글자 크기를 원문대로 유지(자간을 좁혀 넣어라)"와
//     "색이 바뀌는 지점은 단어 경계로" 추가 — 실측: 글자가 61%까지 작아지고
//     제목 색이 '인체공/학설계' 처럼 단어 중간에서 갈렸다 (2026-09-01)
// v10: tight 예산 완화(수용량 x1.2→x1.5, 원문 x1.2→x1.4) + "한도는 상한일 뿐,
//      뜻을 깎지 마라" 지시 추가. x1.2 는 반대편 실패를 냈다 — 실측: 「入体进阶」이
//      "실전 자극", 「强震蜜豆 伸缩人体」에서 부위 이름이 통째로 빠졌다 (2026-09-02)
// v9: GIF 는 번역 길이 예산을 조인다(tight) — 띠 폭이 정지 영역에 갇혀 넓힐 수
//     없으므로, 자리에 안 들어갈 문구는 이미지 단계가 아니라 번역 단계에서 짧게
//     만든다. 「多种频率」 예산 9자 → 5자 ("다양한 진동 모드" → "진동 모드")
// v11: 띠 프롬프트에 문구별 글자 높이(px)·"85% 미만이면 버린다"·장체 허용 명시, 재시도
//      힌트에 실측 비율 삽입, GIF 줄이기 요청에 직전 답·초과량 되먹임(2차까지).
//      실측(2026-09-02 띠 22개): "같게 유지"만으로는 절반이 75~83% 로 작아졌다.
// v12: 띠 프롬프트에 띠 안 여백(px)과 "가장자리 3px 이상·닿느니 줄 이동·최대 10% 축소" 규칙,
//      GIF 번역에 "완결된 명사구" 규칙·예시. 실측(exp10): 위 여백 1px 띠에서 글자가
//      가장자리에 닿아 이음매에 두 번 걸렸고, "여운이 남는"·"1스틱 2용도"가 나왔다.
// v13: GIF 번역에 승인 문구 기억(phraseMemory) — 재렌더·같은 상품 그림의 확정 번역을 그대로
//      쓰고 예산을 넘는 것만 줄인다. GIF 요청문에 부위·동작 용어집(蜜豆·伸缩·炮机) 추가,
//      예시를 일반 문구로 교체. 실측(exp11): 재번역이 승인 문구를 버리고 의미 검수에 걸려
//      호출 0회로 검수함행. (2026-09-02)
// v14: GIF 줄이기 — 줄인 답이 예산의 65% 미만이면 "너무 짧다"고 직전 답과 함께 되묻는다,
//      "초과한 만큼만 줄여라" 규칙. 실측(exp12): 15자 예산에 9자로 깎아 更大更刺激 이 사라졌다.
// v15: GIF 처음 보는 문구는 후보 3개를 받아 심사(텍스트 1회)로 고른다 — 실측(exp12): 하나만
//      받으면 8개 중 3개가 어색했다. 승인 문구 사전은 카탈로그 전체(VERIFIED)로 확대.
// v16: GIF 띠 예산의 여백을 띠 두께(글자 ±8px)로 잰다 — 실측 13 「大头爆震」: 글자 행 ±2 로 센 여백
//      140px 로 17자를 줬는데 띠는 313px 라 글자가 양 끝에 닿아 이음매에 두 번 걸렸다. 원문에 숫자가
//      없는데 숫자를 나열한 답("1스틱 2용도")은 받지 않는다(실측 12·13 두 번 다 냈다).
const PROMPT_V = 16; // v8: 띠 프롬프트에 세로쓰기 유지 지시 복원 (2026-09-02) // v6: GIF 글자 띠 전용 프롬프트 분리 (2026-09-01) — 띠 crop 에도
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
// v10: 띠 관문에 글자 크기(픽셀, 원문의 85% 미만이면 재시도 → 그래도 작으면 채택+
//      GIF_SMALL_TEXT)와 문구 누락(판독에 기대 문구가 전혀 없음) 추가, 육안 심사
//      hard 에 '문구가 빠짐' 추가. 구버전은 작아진 띠·빈 띠를 그대로 채택했다 (2026-09-02)
// v11: 확정 문구와 유사도 0.8 이상(어미·한 글자 차이)인 띠는 헛글자가 아니라 soft —
//      정확히 맞추려 1회 재시도하고 못 맞추면 채택(최종 관문 TEXT_ALTERED 가 보고).
//      실측(exp10): "자극적으로"를 버리고 재시도가 이음매에 걸려 중국어가 남았다.
// v12: (1) 글자색 관문(bandGlyphColorShift, soft → GIF_TEXT_COLOR) — 지금까지 어떤 관문도
//      색을 보지 않았다. (2) 패치 밖 보존을 프레임마다 픽셀로 재서 GIF_UNVERIFIED 사유에
//      적는다 — "증명 불가"라던 전제가 틀렸다(재부호화 손실 0, 양자화만 몇 픽셀).
//      (3) GIF 만 의미 교정 2회. (2026-09-02)
// v13: (1) 단색 배경 직접 그리기 폴백(localSolidPatch, GIF_LOCAL_TEXT) — 정지 띠를 만들 수
//      없는 자리(글자 1px 옆까지 움직임)만, 배경 단색·정지·85% 이상 들어감을 픽셀로 확인.
//      (2) 글자색 관문은 획 중심색(가장 진한 30%)으로 비교 — 안티앨리어싱 번짐 오탐 제거. (2026-09-02)
// v14: (1) 굵기 관문(bandGlyphWeightShift, soft → GIF_TEXT_WEIGHT). (2) 색 관문은 좌·우 반씩도
//      본다(두 색 제목의 한쪽만 바뀐 경우). (3) GIF 재렌더는 같은 원본의 저장 좌표를 재사용해
//      판독 0회·띠 고정(knownBoxes). (2026-09-02)
// v15: 관문 재보정(실측 산출물 7회분 대조). 안쪽 배경은 원본·합성본 둘 다 글자 아닌 픽셀로만
//      잰다(글자가 30~45% 인 띠에서 중앙값이 글자로 넘어가 깨끗한 「全面覆盖」가 5회 전부 오탐).
//      굵기는 가로·세로 연속 길이의 짧은 쪽으로 재고 **굵어지는 쪽만** 잡는다(한자→한글은
//      획이 얇아지는 게 서체 차이, 0.35~0.66 전부 오탐). GIF 제품 무결성 심사에 "남은 외국어
//      글자는 제품 변화가 아니다" 추가. (2026-09-02)
// v16: (1) 색 관문이 '색 자체 변화'와 '색 경계 이동'(팔레트 같음)을 가른다. (2) 정지 판정의 흩어진
//      움직임 허용량을 24px 과 면적 1% 중 큰 쪽으로 — 운영 GIF 95장 조사: "움직이는 글자" 47개 중
//      40개가 팔레트 흔들림 0.1~1.6% 로 탈락한 것이었다. 띠 가능 문구 86.0% → 89.5%. (2026-09-02)
const VERIFY_V = 16;
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
// 15: 이음매 관문에 **띠 안쪽 배경** 검사 추가. 경계만 재면 "테두리는 원본에
//     맞추고 안쪽만 밝게" 그린 패치가 통과해 사각 자국이 남는다(실측 M19).
// 16: 번역문이 길면 띠를 가로로 넓힌다 — 폭이 모자라 모델이 글자를 61~84%로
//     줄여 그리던 문제(실측 5개 띠). 정상은 92~97%.
// 17: 앞으로 들어올 GIF 대비 안전장치 — 예산을 띠 수에 맞추고(고정 6 → 띠+3,
//     상한 10), 띠 면적 상한(50%)·개수 상한(12)·픽셀 예산(2.5억)을 두고,
//     GIF 도 제품 무결성 심사를 받는다(예전엔 정지 이미지에서만 돌았다).
// 18: 띠 시도마다 결과를 기록하고, 작아진 띠는 재시도(실측 힌트) 뒤 더 나은 쪽을
//     채택한다. 실측(마리아 0018): 「回弹设计」가 원문으로 남았는데 사유가 비어 있어
//     되짚을 수 없었다 (2026-09-02)
// 19: (1) 띠 확장(growWide/growFlat)이 막히지 않은 쪽으로 계속 넓힌다 — 한쪽 움직임에
//     양쪽이 같이 멈추던 문제. (2) GIF 번역 예산을 박스가 아니라 **정지 여백까지 넓힌
//     띠 폭**으로 잰다(gifBudgetsFor) — 박스 기준은 양쪽으로 틀렸다(6자 "인체 마스터" vs
//     실제 자리 7자·「多种频率」 4자). 교정 재번역도 같은 예산. (3) 원문 유지 사유
//     표기가 14자에서 잘리던 버그 — "사유 없음"의 실체였다. (2026-09-02)
// 20: GIF 인코더 interPaletteMaxError 0 — 기본값(3)은 앞 프레임 팔레트를 재사용해, 띠의
//     재표본화 회색이 팔레트를 채운 뒤 다음 프레임의 고유색이 엉뚱한 항목에 붙었다(실측:
//     프레임 전체 100→78·160→117). 운영 결과물에서도 사진 영역에 흩어진 차이로 보였다.
//     패치 밖 보존을 프레임마다 재서(outsideMaxDiff) 사유에 적는다. (2026-09-02)
// 21: 띠 시도마다 직전 사유를 비운다 — 안 비우면 2차가 전부 통과해도 1차 사유가 남아 soft 후보로
//     잘못 분류됐다(실측 13 「360°贴合」). 결과는 같았지만 기록·분류가 틀렸다. (2026-09-02)
const RENDER_V = 21;
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
