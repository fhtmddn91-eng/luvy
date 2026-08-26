# 이미지 번역 검증 관문 · 상태 체계 구현 계획 (승인용 설계)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **이 문서는 승인 전 설계본이다.** 승인 후 각 Task 를 단계별 코드(테스트 → 구현 → 커밋)로 펼친다.

**Goal:** 기계가 "깨끗하다"고 실제로 확인한 이미지만 VERIFIED 로 저장·노출하고, 확인하지 못했거나 불확실한 결과는 전부 검수 대기로 격리한다. 손님에게 불확실한 이미지가 나갈 확률을 0에 가깝게.

**Architecture:** 파이프라인 반환값을 `{ data }` 에서 **상태가 달린 결과(outcome)** 로 바꾸고, 저장·노출 코드는 상태만 보고 움직인다. 새 검사(교차 OCR·의미 검수·숫자 보존·새 글자·폰트 수치)는 전부 **이미지 호출 앞(텍스트 호출)** 또는 **픽셀 계산(무료)** 에 둔다 — 비싼 호출을 줄이면서 관문은 늘린다. 상품 판매 전환은 "요청"으로 기록하고, 전 장이 VERIFIED/NO_FOREIGN_TEXT 가 된 시점에 ACTIVE 로 자동 승격한다.

**Tech Stack:** Next.js 15 · Prisma/Postgres(Railway) · sharp · @napi-rs/canvas · vitest · Gemini (`gemini-3.6-flash` 텍스트, `gemini-3.1-flash-image` 이미지)

## Global Constraints

- 이미지 모델 호출 단가 ≈ $0.04 (₩55). 장당 상한 6회는 **HTTP 요청 단위**로 센다 (지금은 논리 호출 단위 — 타임아웃 재시도가 상한 밖으로 샜다).
- 새 검사는 텍스트 호출(≈₩1~3) 또는 픽셀 계산만 추가한다. 이미지 호출 수는 늘리지 않는다.
- 로컬 덧그리기(네모 칠하기) 폴백은 계속 금지. 불합격 = 원본 유지 + 상태 기록.
- 배포 경로는 `git push origin main` → Railway 하나뿐.
- 판정 임계값은 **실측 분포로 정한다.** 지킬 수 없는 규칙은 넣지 않는다 (CLAUDE.md 규칙 4).
- 운영 DB 스크립트는 이어하기 가능하게.
- API 비용이 드는 검증(실이미지 렌더)은 금액을 먼저 적고 승인받은 뒤 돌린다.

---

## 1. 상태 체계

### 1-1. 이미지(ProductAsset) 상태 `translateStatus`

| 상태 | 뜻 | `url` | `candidateUrl` | 손님 노출 |
|---|---|---|---|---|
| `null` | 기록 없음 — 국내 도매처·수동 등록, 또는 2026-08-23 이전 번역본(legacy) | 원본 또는 legacy 번역본 | – | 허용 (아래 1-3) |
| `TRANSLATING` | 번역 진행 중 | 원본 | – | **차단** |
| `VERIFIED` | 모든 검사를 실제 통과 | 번역본 | – | 허용 |
| `NO_FOREIGN_TEXT` | 전체 OCR + 분할 OCR **둘 다** 외국어 0건 | 원본 | – | 허용 |
| `NEEDS_REVIEW` | 일부 잔류 · 의미 불확실 · 밀집 이미지 · OCR 불일치 · 폰트 이질 · 검사 생략 | **원본 유지** | 번역 후보 | **차단** |
| `VERIFICATION_FAILED` | 검사를 **하지 못함** (관문 OCR·검수 판독 호출 실패) | **원본 유지** | 번역 후보 | **차단** |
| `FAILED` | 모델/API/렌더 실패 | 원본 | – | **차단** |

"검사 통과(VERIFIED)"와 "검사하지 못함(VERIFICATION_FAILED)"은 다른 상태다. NEEDS_REVIEW 는 "검사는 됐는데 합격을 못 줌"이다.

`reviewReasons` (JSON 배열, NEEDS_REVIEW/VERIFICATION_FAILED 때만):

| 코드 | 뜻 | 어디서 |
|---|---|---|
| `LEFTOVER` | 최종 관문에서 외국어 N건 잔존 | 관문 |
| `DENSE_GRID_UNCHECKED` | 문구 30개 이상이라 관문 생략 | 관문 |
| `OCR_DISAGREEMENT` | 전체 OCR 과 분할 OCR 이 합의하지 못한 문구 있음 | 교차 OCR |
| `MEANING_UNCERTAIN` | 의미 검수 2회 실패 | 의미 검수 |
| `NUMBER_CHANGED` | 숫자·단위·모델명이 완성본에서 달라짐 | 완성본 검사 |
| `NEW_TEXT` | 원문에도 번역문에도 없는 글자가 생김 | 완성본 검사 |
| `FONT_MISMATCH` | 부분 보정 글자가 원문 글자와 수치상 이질 | 폰트 검사 |
| `GATE_OCR_FAILED` | 관문 OCR 호출 실패 | VERIFICATION_FAILED |
| `TRANSCRIBE_FAILED` | 검수 판독 호출 실패 | VERIFICATION_FAILED |
| `FAST_MODE` | 빠른 모드(무검수)로 만든 결과 | 빠른 모드 |

각 코드에 사람이 읽을 상세(`"外国语 2건: 售后无忧, 包邮"`)를 붙여 저장한다.

### 1-2. 상품(Product) 판매 전환 게이트

`Product.status` 는 그대로 `ACTIVE | HIDDEN`. 새 필드 `publishRequestedAt`.

```
운영자 "판매중" 클릭
  ├─ 번역 대상 소스(1688) 아님 → 지금처럼 즉시 ACTIVE
  └─ 번역 대상
       ├─ 전 장이 VERIFIED / NO_FOREIGN_TEXT / null(legacy) → 즉시 ACTIVE
       └─ 아니면 → status=HIDDEN 유지, publishRequestedAt=now, 번역 시작
            └─ 번역 끝 → 전 장 통과면 ACTIVE + publishRequestedAt=null
                        아니면 HIDDEN 유지, 어드민 목록에 사유 배지
운영자가 검수 대기 장을 "후보 승인"/"원본 유지"로 처리 → 전 장 통과 시
  publishRequestedAt 이 남아 있으면 자동 ACTIVE
```

손님 쪽 화면은 이미 전부 `status: "ACTIVE"` 로 거르므로(10곳 확인) 손댈 곳이 없다.

### 1-3. 기존 데이터(legacy) 처리 — **승인 필요 ①**

현재 번역본(`originalUrl != null`)은 새 관문을 거치지 않았다. 선택지:

- **(권장) `translateStatus=null` 그대로 두고 노출 허용.** 지금 판매중인 상품을 한꺼번에 숨기지 않는다. 어드민에서 "재검수" 버튼으로 장당 ₩55~330 에 새 관문을 통과시킬 수 있게 한다. 목록에 "구 파이프라인 N장" 수를 보여준다.
- 전부 NEEDS_REVIEW 로 내려 재번역 — 카탈로그 전체(₩12,000+) 재렌더. 규칙 2(전체 재렌더 금지)에 걸린다.

---

## 2. DB 변경

```prisma
model ProductAsset {
  // ... 기존 필드
  /**
   * 번역 검증 상태. null = 기록 없음(국내·수동·2026-08-23 이전 번역본).
   * VERIFIED 만 url 이 번역본이다. NEEDS_REVIEW/VERIFICATION_FAILED 는 url 을
   * 원본에 두고 후보를 candidateUrl 에 보관한다 — 불확실한 이미지는 나가지 않는다.
   */
  translateStatus String?
  /** NEEDS_REVIEW / VERIFICATION_FAILED 사유 — JSON [{code, detail}] */
  reviewReasons   String?
  /** 검수 대기 번역 후보 (/uploads/..). 승인하면 url 로 승격, 거부하면 파일 삭제 */
  candidateUrl    String?
  /** 후보에 딸린 OCR·번역문 JSON — 승인 시 ocrData 로 승격 */
  candidateOcr    String?
  /** 사람이 승인/거부한 시각 — 자동 판정과 구분 */
  reviewedAt      DateTime?

  @@index([productId])
  @@index([translateStatus])
}

model Product {
  // ... 기존 필드
  /** 판매 전환 요청 시각. 번역 검증이 끝나지 않아 HIDDEN 으로 붙잡아 둔 상태 */
  publishRequestedAt DateTime?
}
```

마이그레이션 `20260823xxxxxx_asset_translate_status` — 컬럼 추가만, 기존 행은 null. 되돌리기: 컬럼 drop.

---

## 3. 파이프라인 변경 (`src/lib/imageTranslate.ts` + 새 파일 3개)

### 3-1. 반환형

```ts
export type ReviewReason = { code: ReviewCode; detail: string };
export type TranslateOutcome =
  | { status: "VERIFIED"; data: Buffer; mime: string; boxes: OcrBox[] }
  | { status: "NO_FOREIGN_TEXT" }
  | { status: "NEEDS_REVIEW"; data: Buffer; mime: string; boxes: OcrBox[]; reasons: ReviewReason[] }
  | { status: "VERIFICATION_FAILED"; data: Buffer; mime: string; boxes: OcrBox[]; reasons: ReviewReason[] }
  | { status: "FAILED"; reason: string };

export async function translateImage(data: Buffer, mime: string): Promise<TranslateOutcome>;
```

`unresolved` 숫자 하나로 뭉뚱그리던 것을 없앤다. 호출부는 `status` 만 본다.

### 3-2. 흐름 (정밀 모드 = 유일한 기본)

```
① 교차 OCR        전체 1회 + 띠 3회 (텍스트, ≈₩4)        → 합의/불합의 박스
② 문구 번역       예산 적용 (텍스트, ≈₩0.1)
③ 의미 검수       원문↔번역문 독립 호출 (텍스트, ≈₩0.2)  → 실패 항목 1회 재번역 → 재검수
④ 렌더            이미지 1회 + 패치 합성 (₩55)
   ├ 경계·잔상·침범 픽셀 검사 (무료)
   └ 박스 밖 픽셀 = 원본과 바이트 동일 검증 (무료, 구조상 보장 + 단언)
⑤ 완성본 검수     판독 1회 (텍스트) → 잔류·잘림·자모·숫자보존·새글자
   └ 걸린 문구만 부분 보정 (이미지 1~N회) → 폰트 수치 검사 (무료)
⑥ 최종 관문       완성본 전체 OCR (텍스트) → 외국어 0건?
⑦ 판정            VERIFIED / NEEDS_REVIEW(사유) / VERIFICATION_FAILED / FAILED
```

재시도 정책: ⑥ 에서 잔존이면 지금처럼 처음부터 1회 더(GATE_TRIES=2). 2회째도 잔존 → **NEEDS_REVIEW(LEFTOVER)**, 후보 보존. 밀집 그리드(≥30) → 관문 생략 대신 **관문을 돌리되 결과와 무관하게 NEEDS_REVIEW(DENSE_GRID_UNCHECKED)** — "검사 생략"이 아니라 "검사했지만 자동 합격 불가"로 둔다(관문 비용은 텍스트라 ₩2).

### 3-3. 각 정책 항목 → 구현

| 정책 | 구현 | 파일 | 비용 |
|---|---|---|---|
| 1. unresolved>0 저장 금지 | `TranslateOutcome` + 호출부가 NEEDS_REVIEW 면 `candidateUrl` 에 저장, `url` 원본 유지 | imageTranslate.ts, translateAssets.ts, admin-assets.ts | 0 |
| 2. 밀집 → 자동 성공 금지 | 위 3-2 | imageTranslate.ts | 0 |
| 3. 관문 OCR 실패 → VERIFICATION_FAILED | `gateLeftover` 앞 catch 제거, 실패를 상태로 | imageTranslate.ts | 0 |
| 4. 교차 OCR | `ocrImage` 가 전체+띠를 **항상** 돌리고 `mergeOcrPasses(full, bands)` 로 합침. 같은 문구 판정: 박스 IoU ≥ 0.5 **또는** 원문 글자 일치율(LCS) ≥ 0.6. 한쪽에만 있는 문구는 번역·렌더는 하되 `confirmed:false` → 최종 NEEDS_REVIEW(OCR_DISAGREEMENT). NO_FOREIGN_TEXT 는 **둘 다 0건**일 때만. | 새 `src/lib/ocrMerge.ts` (순수) | +₩3 |
| 5. 의미 검수 | `verifyMeaning(pairs)` 한 호출에 전 문구 → 항목별 `{ok, issues[]}` (의미·숫자단위모델명·과장/효능·없는정보·자연스러움 5항목). 실패 항목은 issues 를 넣어 1회 재번역 → 재검수 → 실패면 NEEDS_REVIEW(MEANING_UNCERTAIN). **이미지 호출 전**에 돈다. | 새 `src/lib/translateVerify.ts` | +₩0.4 |
| 6. 완성본 검사 확장 | 기존 잔류·잘림·자모 + `numbersPreserved(zh, observed)`(숫자·단위·모델코드 토큰이 판독문에 전부 있어야) + `newTextLines(transcribed, boxes, origTranscribed)`(어느 박스와도 안 겹치고 원본 판독에도 없던 줄) → NEEDS_REVIEW. 판독 호출 실패 → VERIFICATION_FAILED(TRANSCRIBE_FAILED), "전부 보정"으로 돌리지 않음. 원본 판독 1회 추가. | translateVerify.ts, imageTranslate.ts | +₩2 |
| 7. 박스 밖 픽셀 변화 폐기 | 패치 합성이 구조상 박스 밖을 원본으로 둔다. 여기에 `outsidePatchDiff(orig, out, rects) === 0` 단언을 파이프라인 끝에 넣어 어떤 경로든(띠·보정·GIF) 어기면 FAILED. 빠른 모드의 `changedFrac>0.6 → 통째 사용` 분기는 삭제. | imageTranslate.ts | 0 |
| 8. 부분 보정 폰트 수치 비교 | `glyphMetrics(raw, W, H, box, fg)` → {inkHeight, strokeWidth(가로 런 길이 중앙값), meanColor, centerOffset, linePitch}. 원본 박스 vs 보정 박스 비교. 임계값은 **운영 번역본 109쌍으로 분포를 재서** 정한다(초안: 높이비 0.75~1.25, 획두께비 0.6~1.6, 색거리 <60, 중심 어긋남 <폭 15%). 벗어나면 NEEDS_REVIEW(FONT_MISMATCH). | 새 `src/lib/glyphMetrics.ts` (순수) | 0 |
| 9. ACTIVE 게이트 | `productPublishGate(assets)` 순수 함수 → `{ ready, blocking: {translating, needsReview, failed, legacy} }`. `setProductStatus`/`updateProduct` 의 ACTIVE 분기가 이걸 보고 HIDDEN+`publishRequestedAt` 로 보류. `translateProductImages` 끝과 어드민 승인/거부 액션 끝에서 `promoteIfReady(productId)`. | 새 `src/lib/productPublishGate.ts`, admin-products.ts, translateAssets.ts, admin-assets.ts | 0 |
| 10. 상태 구분 | 1-1 표 | schema, 전 호출부 | 0 |
| 11. 회귀 세트 | 4절 | `eval/` | 별도 승인 |
| (비용) HTTP 단위 상한 | `callGemini` 의 차감을 재시도 루프 **안**으로 | imageTranslate.ts | 절감 |
| (비용) 빠른 모드 | 남기되 결과는 항상 NEEDS_REVIEW(FAST_MODE) — VERIFIED 로 못 나감 | imageTranslate.ts | – |

의미 검수 프롬프트(③) 핵심 — 항목별 JSON `{ "ok": bool, "issues": ["숫자 누락: 53MIN", ...] }`:
```
원문(중국어)과 한국어 번역문 쌍입니다. 각 쌍을 아래 5가지로 심사하세요.
1 의미 보존  2 숫자·단위·모델명 그대로  3 과장·의학적 효능 추가 없음
4 원문에 없는 정보 없음  5 한국 상품 상세페이지 문구로 자연스러움
하나라도 어긋나면 ok:false 와 구체적 issues. 확실하지 않으면 ok:false.
```

### 3-4. 호출부

**`translateAssets.ts` (자동)**
```
TRANSLATING 기록 → translateImage → 상태별:
  VERIFIED        url=번역본, originalUrl=원본, ocrData, status
  NO_FOREIGN_TEXT status 만
  NEEDS_REVIEW / VERIFICATION_FAILED
                  candidateUrl=후보 저장, candidateOcr, reviewReasons, url 그대로
  FAILED          status, reviewReasons=[{code:"FAILED", detail}]
끝나면 promoteIfReady(productId)
```
형제 자산 재사용(같은 원본 파일)은 **형제가 VERIFIED 일 때만** 잇는다.

**`admin-assets.ts` (수동)**
- `translateProductAsset`: 위와 같은 저장 규칙. 반환 메시지에 상태·사유.
- 새 액션 `approveAssetCandidate(assetId)`: candidateUrl → url, candidateOcr → ocrData, status=VERIFIED, reviewedAt, 감사로그 `ASSET_REVIEW_APPROVE`. 끝에 promoteIfReady.
- 새 액션 `rejectAssetCandidate(assetId)`: 후보 파일 삭제, status=FAILED(사유 "운영자 거부"), reviewedAt. 끝에 promoteIfReady.
- `updateAssetTranslation`(문구 수정 재렌더): 결과도 같은 관문을 탄다 — 수정본이 NEEDS_REVIEW 면 후보로.
- `revertAssetTranslation`: status=null 로 되돌림(legacy 취급) — 운영자가 의도적으로 원본을 택한 것.

### 3-5. 어드민 화면

- `ProductAssetsManager.tsx`: 카드 배지 `한글`(VERIFIED) / `검수 N건`(노랑, 사유 툴팁) / `검사 실패` / `실패` / `번역 중`. 검수 대기 카드는 원본·후보를 나란히 보여주고 **후보 승인 / 원본 유지** 버튼. 문구 수정은 후보에도 가능.
- `admin/products/page.tsx`: 상태 열에 `판매 보류 · 검수 2장`처럼 게이트 사유. 상단 "검수 필요 N개" 필터 링크.

---

## 4. 회귀 테스트 세트 (정책 11) — **승인 필요 ②(비용)**

이전 세션의 `scratchpad/all`(109쌍)은 스크래치가 비워져 **없다.** 운영 DB(`DATABASE_PUBLIC_URL`)에서 `originalUrl != null` 자산을 뽑아 원본·번역본·ocrData 를 내려받는 스크립트로 다시 만든다.

- 위치: `eval/` (이미지는 `.gitignore`, `eval/labels.json` 만 커밋). 성인용품 이미지라 저장소에 넣지 않는다.
- 정답 확정: 자동 OCR 을 초안으로 넣고 **운영자가 확정**(정답 박스·원문·번역문). 제가 초안을 만들고 확정은 사용자 몫.
- 지표 러너 `eval/run.ts` (vitest 로 구동):

| 지표 | 계산 | 비용 |
|---|---|---|
| 외국어 문구 검출 재현율 | 정답 박스 중 교차 OCR 이 잡은 비율 | 텍스트만 ≈₩4/장 |
| 잔류 중국어 비율 | 완성본 관문 OCR 외국어 건수 / 정답 건수 | 렌더 필요 |
| 환각 문구 발생률 | `newTextLines` 건수 > 0 인 장 비율 | 렌더 필요 |
| 숫자·단위 보존율 | `numbersPreserved` 통과 문구 비율 | 렌더 필요 |
| 박스 밖 픽셀 변경률 | `outsidePatchDiff` / 박스 밖 면적 | 렌더 필요 |
| 사람 검수 통과율 | `labels.json` 의 `humanPass` 열 (운영자 기입) | 0 |

- 렌더가 필요한 지표는 장당 ₩55~330. **20장 표본 = 최대 ₩6,600** — 돌리기 전에 별도 승인. OCR 전용 지표(재현율)는 109장 ≈ ₩450.
- 목표: 잔류 0% · 환각 0% · 숫자변조 0% · 박스 밖 주요 객체 변경 0%. 목표에 못 미치는 장이 VERIFIED 로 나오면 그 장이 곧 회귀 테스트 실패다.

---

## 5. 수정 파일 목록

| 파일 | 변경 |
|---|---|
| `prisma/schema.prisma`, `prisma/migrations/20260823*_asset_translate_status/` | 2절 |
| `src/lib/imageTranslate.ts` | 반환형, 교차 OCR 호출, 의미 검수 연결, 관문 실패 상태화, 밀집 처리, HTTP 단위 상한, 박스 밖 단언, 폰트 검사 연결, 빠른 모드 NEEDS_REVIEW |
| `src/lib/ocrMerge.ts` (신규, 순수) | `mergeOcrPasses`, `sameText`, `iou` |
| `src/lib/translateVerify.ts` (신규) | `verifyMeaning`(호출), `numbersPreserved`, `extractNumberTokens`, `newTextLines`, `outsidePatchDiff` (순수) |
| `src/lib/glyphMetrics.ts` (신규, 순수) | `glyphMetrics`, `fontMismatch` |
| `src/lib/productPublishGate.ts` (신규, 순수) | `productPublishGate`, 상태 상수·타입 |
| `src/lib/import/translateAssets.ts` | 상태 저장 규칙, 후보 저장, `promoteIfReady` |
| `src/lib/actions/admin-assets.ts` | 상태 저장, `approveAssetCandidate`, `rejectAssetCandidate`, 수정·복원 경로 |
| `src/lib/actions/admin-products.ts` | ACTIVE 게이트, `publishRequestedAt` |
| `src/components/admin/ProductAssetsManager.tsx` | 배지·후보 비교·승인/거부 |
| `src/app/admin/products/page.tsx` | 보류 사유·필터 |
| `src/lib/*.test.ts` | 6절 |
| `eval/` | 4절 |
| `CLAUDE.md` | 상태 체계·관문 설명 갱신 |

---

## 6. 테스트 계획 (API 비용 0원)

**순수 함수 단위 테스트 (vitest)**
- `ocrMerge.test.ts`: 같은 문구 두 번 → 1개 confirmed; 한쪽에만 → unconfirmed; 좌표 어긋나도 원문 같으면 합의; 둘 다 빈 배열 → NO_FOREIGN_TEXT 조건.
- `translateVerify.test.ts`: `numbersPreserved("不低于53MIN", "53MIN 이상")` 참 / `("53MIN", "35MIN")` 거짓 / 모델코드 `SHD-S549` 누락 거짓 / 단위 `mAh`·`dB`·`%`; `newTextLines` — 박스 안 줄 무시, 원본 판독에 있던 영어 줄 무시, 새 줄 검출; `outsidePatchDiff` — 패치 밖 한 픽셀 변화 검출, 패치 안 변화는 0.
- `glyphMetrics.test.ts`: 합성 이미지(캔버스로 글자 그린 것)로 높이·획·색 추정이 ±10% 안에 드는지; 굵기 2배 → strokeWidth 비 >1.6 → mismatch; 같은 폰트 → pass.
- `productPublishGate.test.ts`: 전부 VERIFIED → ready; legacy null → ready; TRANSLATING 1장 → blocking.translating=1; NEEDS_REVIEW → 차단; 국내 소스 → 항상 ready.
- `imageTranslate.test.ts` 추가: 관문 예외 → VERIFICATION_FAILED; boxes≥30 → NEEDS_REVIEW(DENSE_GRID_UNCHECKED); 2회 잔존 → NEEDS_REVIEW(LEFTOVER)에 후보 포함; HTTP 재시도 2회가 예산 2회 차감(fetch 목); 빠른 모드 → NEEDS_REVIEW(FAST_MODE).

**호출부 통합 테스트 (`translateImage`·DB 목)**
- `translateAssets.test.ts`: 상태별 저장 필드(VERIFIED → url 교체 / NEEDS_REVIEW → url 유지·candidateUrl) ; 형제 재사용은 VERIFIED 만; 끝나면 promoteIfReady 호출.
- `admin-products`: ACTIVE 요청 + NEEDS_REVIEW 1장 → HIDDEN + publishRequestedAt; 승인 후 promote → ACTIVE.

**오버레이·패치 경로 (API 없이)**: 회귀 세트 원본+ocrData 로 `compositeTextPatches`→`outsidePatchDiff===0`, `glyphMetrics` 분포 측정(임계값 확정용).

**실이미지 E2E (승인 후, 비용 발생)**: Gemini 한도 풀린 뒤 1장(≤₩330) → VERIFIED 경로 끝까지 확인. 이어서 4절 표본 20장(≤₩6,600).

---

## 7. 비용 영향 (장당)

| | 지금 | 변경 후 |
|---|---|---|
| 이미지 호출(₩55) | 1~6회 (HTTP 최대 12) | 1~6회 (**HTTP 최대 6**) |
| 텍스트 호출 | 5~8회 ≈ ₩5 | 10~13회 ≈ ₩12 |
| 의미 오류로 인한 재렌더 | ₩55 | ₩0.4 (이미지 호출 전에 잡힘) |
| 검수 대기 후 운영자 수정 | 처음부터 다시 | 후보 보존 → 걸린 문구만 보정 |

---

## 8. 승인 요청 항목

1. **legacy 번역본**: null 유지 + 노출 허용 + "재검수" 버튼 (권장) — 아니면 전부 검수 대기?
2. **회귀 세트 비용**: OCR 전용 109장 ≈ ₩450 은 바로, 렌더 지표 20장 ≤ ₩6,600 은 한도 풀린 뒤 별도 승인.
3. **교차 OCR 불일치 정책**: 불일치 문구가 있으면 그 장 전체를 NEEDS_REVIEW. 불일치율이 실측으로 30% 를 넘으면(지킬 수 없는 규칙) 임계값을 다시 보고드리고 조정.
4. **빠른 모드**: 남기되 VERIFIED 불가(항상 NEEDS_REVIEW). 아예 삭제를 원하시면 삭제.

승인되면 이 문서의 각 Task 를 테스트→구현→커밋 단계로 펼쳐 순서대로 진행한다. 순서: DB/상태형 → 관문 상태화(1·2·3) → 호출부·게이트(9·10) → 교차 OCR(4) → 의미 검수(5) → 완성본 검사 확장(6·7) → 폰트 수치(8) → 어드민 화면 → 회귀 세트(11).
