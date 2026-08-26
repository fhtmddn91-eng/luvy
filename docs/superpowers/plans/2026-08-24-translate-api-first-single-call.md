# 이미지 번역 — 고품질 API 렌더 유지 · 자동 1회 · 검증 관문 · 해시 캐시 (승인용 설계 v2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.
>
> **승인 전 설계본.** 기능 코드·DB·마이그레이션은 아직 수정하지 않았다.
> 이전 문서 [2026-08-23-translate-verification-gates.md](2026-08-23-translate-verification-gates.md) 는 **덮어쓰지 않고 보존**했다. 바뀐 섹션은 맨 끝 "v1 대비 변경" 에 명시.

**Goal:** 원본 폰트·색·굵기·장식·그림자·배치가 유지되는 **고품질 이미지 API 렌더를 기본 렌더러로 유지**하되, 자동 호출을 원본당 1회로 묶고, 검증을 통과한 패치 합성 결과만 VERIFIED 로 내보낸다. 실패는 재시도 없이 후보 보존 + NEEDS_REVIEW. 같은 원본 바이트(SHA-256)는 두 번 다시 호출하지 않는다.

**결정 근거 (2026-08-23~24 실측):** LaMa·MI-GAN·로컬 인페인팅·Canvas/Pretendard 덧그리기는 자동 고객 노출 경로에서 **제외** — 사각형 마스크(자동통과 이미지 3/20 이하·환각 43~46%)와 획 마스크(12 < 로컬 16, 유령 획) 모두 기존 로컬조차 못 넘었고, 로컬 덧그리기는 서체·질감 보존이라는 품질 목표 자체를 만족하지 못한다(스크래치 `inpaint/REPORT.md`, `REPORT-glyph.md`).

## Global Constraints

- 이미지 API(`IMAGE_MODEL`, gemini-3.1-flash-image) 비용: 현재 `callImageEdit` 는 출력 해상도를 지정하지 않으므로 **기본 1K 기준 공식 단가 $0.067/출력 이미지 + 입력 토큰 비용**을 적용한다(0.5K $0.045 를 확정 비용처럼 쓰지 않는다). 입력 토큰분은 미측정 — 호출당 **≈$0.07 (추정)**. 원화 표기는 전부 **추정**이며 환율 1,400원/USD(2026-08-24 가정) 기준 **≈₩95~100/호출**. 텍스트 API ≈ ₩1~3/호출(추정).
- **자동 이미지 호출의 정의: "캐시 미스이고 렌더 전 검수(교차 OCR·번역·의미 검수)를 통과한 원본당, 자동 이미지 HTTP 요청 최대 1회".** 렌더 전 단계에서 실패한 원본과 캐시 적중은 **0회**다. 상태 코드와 무관하게(타임아웃·429·5xx 포함) 자동 HTTP 요청은 1회를 넘지 않는다.
- 실패·불합격 시 자동 재시도 금지 — 후보·사유를 보존하고 RETRYABLE(일시 오류) 또는 NEEDS_REVIEW(품질)로 보낸다.
- 운영자가 원본·후보·사유를 보고 명시 승인할 때만 **추가 1회**.
- 이미 VERIFIED 인 결과에는 이미지·OCR·번역·검수 API 재호출 금지.
- 로컬 실험 관문(겹침·인접글자·줄수·최소크기)은 **후보 검수 참고 주석**으로만 쓴다. 로컬 렌더 결과를 고객용으로 저장하지 않는다.
- 배포는 `git push origin main` 한 경로. 마이그레이션은 컬럼·테이블 추가만(파괴 없음).

---

## 1. 현재 이미지 API 호출 경로 전수 목록 (정책 11 — 코드 실측)

`callImageEdit` → `callGemini(IMAGE_MODEL)` 한 곳으로 모이며, 장당 논리 상한 6회(`MAX_IMAGE_CALLS_PER_ASSET`, [imageTranslate.ts:13](../../src/lib/imageTranslate.ts), 차감 [:207-213]).

| # | 경로 (파일·함수) | 조건 | 호출 수 |
|---|---|---|---|
| A | `regenerateStill` [:2485] ← `renderTranslatedImage` [:3279] | 정지 이미지 기본 재생성 | 1 |
| B | `eraseViaModel` [:2583] ← `eraseThenDraw` 루프 [:3126] | 검수 걸린 문구 부분 보정 / 수동 조정(`mustOverlay`) | ≤ `REGEN_ATTEMPTS`=2 |
| C | `regenerateByBands` [:2404] | 안전 필터 거부 시 띠별 재생성 | 띠 수(≤3) × 시도 2 = ≤6 |
| D | `tryBuildGifPatch` [:1971] | GIF 첫 프레임 재생성 | ≤ `REGEN_ATTEMPTS`=2 |
| E | `translateImageFast` [:3507] | `TRANSLATE_MODE=fast` 일 때만 | 1 |
| 외곽 | `translateImageVerifiedInner` [:3552] `GATE_TRIES`=2 | 관문 잔존 시 **①OCR부터 전체 재실행** (A~C 반복) | ×2 |
| HTTP | `callGemini` 재시도 [:218], 이미지 호출 `attempts:2` [:2269] | 429·5xx·**타임아웃** | 논리 1회당 HTTP ≤2 |

최악 조합(코드 구조상 가능): 1차 A(1)+B(2) → 관문 잔존 → 2차 A(1)+B(2) = **논리 6회(상한 도달), HTTP ≤12회**. 타임아웃 재시도는 서버가 생성을 마쳤을 수 있어 **과금되고 버려질 가능성이 있는 누수**다(과금 여부 미확인 — 아래 2절).

## 2. 비용 — 기본 1회 + 승인 1회로 바꾸면 (정책 12)

> **전부 추정이다.** 현재 로그에서 실제 이미지 HTTP 요청 횟수와 실제 청구 토큰을 아직 측정하지 않았다. 단가는 gemini-3.1-flash-image 공식 가격(출력 1K 기준 $0.067/이미지) + 입력 토큰(미측정), 환율 1,400원/USD(2026-08-24 가정).

| | 현재 코드 | 변경 후 |
|---|---|---|
| 자동 이미지 호출(논리) | 전형 1~3회(운영 로그 관찰 범위, 추정 평균 ~2회) · 상한 6회(코드 상수) | 캐시 미스 + 렌더 전 검수 통과 시 **HTTP 최대 1회** (렌더 전 실패·캐시 적중 = 0회) |
| HTTP 요청 | 논리×2 까지 (상태 코드별 재시도) | **상태 코드와 무관하게 1회** — 타임아웃·429·5xx 는 RETRYABLE 로 보존, 승인 시에만 +1회 |
| 장당 비용(추정) | 전형 ₩190~280 · 상한 ₩560~670 + 텍스트 ₩5~10 | **₩95~100 + 텍스트 ₩8~12 ≈ ₩105~110** · 승인 시 +₩95~100 |
| 절감률(추정) | – | 상한 대비 약 -80% · 전형 대비 약 -40~-60% · 캐시 적중/렌더 전 차단 시 -100% |

**과금 보장 범위 구분:** 공식 문서가 보장하는 것은 단가표(출력 이미지·토큰 단가)뿐이다. 오류 응답(429/5xx)·타임아웃된 요청이 청구되는지는 **공식 문서로 확인하지 못했다(미확인)**. 그래서 절감 설계를 "실패는 과금 안 된다"에 걸지 않고, **성공·실패 무관 HTTP 1회 제한**에 건다. 구현 후 `[비용]` 로그에 HTTP 요청 수·응답 상태·usage 토큰을 남겨 실측으로 치환한다.

텍스트 호출이 ₩3~5(추정) 늘어나는 이유: 의미 검수·숫자 보존·새 문구 검사(9절)가 렌더 앞뒤에 붙는다 — ₩95~100(추정) 재렌더를 텍스트 호출 몇 원(추정, 실제 청구 토큰 미측정)으로 예방하는 투자.

## 3. 렌더 파이프라인 (정책 1·3·4·5)

```
(sha256, pipelineVersion) → 캐시 조회 ─ 적중(VERIFIED, 파일 무결) → 파일 연결, API 0회 [끝]
  ↓ 미스
① 교차 OCR (전체+띠, 텍스트)            ── 둘 다 0건 → NO_FOREIGN_TEXT (이미지 호출 0회)
② 문구 번역 + charBudget + 의미 검수 (텍스트) ── 검수 실패 문구는 1회 재번역, 또 실패 → 렌더하지 않고 NEEDS_REVIEW (이미지 호출 0회)
③ 이미지 API HTTP 1회 — regenerateStill (프롬프트: 원본 서체 분위기·크기·색·굵기·정렬·그림자·장식 유지)
   · 타임아웃·429·5xx·안전필터·비율 불일치 → 재요청 없이 RETRYABLE/NEEDS_REVIEW + 사유 보존
④ 패치 합성 — 검증된 중국어 변경 영역만 원본에 얹음 (compositeTextPatches)
   · seamGap ≤48 · edgeCrossing ≤45 통과 패치만. 불합격 패치 = 그 문구 원문 유지
   · 제품·인물·로고·숫자·영문 장식·배경 = 패치 밖 → 원본 바이트 그대로 (outsidePatchDiff===0 단언)
⑤ 완성본 검수 (텍스트) — 9절 전 항목
⑥ 판정 — 전부 통과 → VERIFIED
   · **패치가 한 개라도 경계 불합격(pending)이거나, 원문이 한 군데라도 남으면
     그 이미지는 부분 성공이라도 VERIFIED 금지 → 후보 보존 + NEEDS_REVIEW(사유·문구 목록)**
   [자동 재시도 없음]
```

- 프롬프트(`regenPrompt`)는 유지하되 한 줄 보강: "각 문구는 원문과 같은 서체 느낌·크기·굵기·색·정렬·**그림자·외곽선·장식 효과**로". 확정 번역문 주입 방식 유지(정책 3).
- 안전 필터 거부·타임아웃·비율 불일치 → 그 자리에서 NEEDS_REVIEW(사유 코드) — 띠 재생성(C) 자동 실행 금지.
- GIF: 첫 프레임 1회 재생성 → 정지 패치 합성 → 합성본 검수 → 불합격 문구가 하나라도 있으면 NEEDS_REVIEW. 시도 1회.
- `TRANSLATE_MODE=fast`(E) 는 삭제 — "검수 없는 결과" 자체가 정책 위반이다.

## 4. 자동 재시도 비활성화 목록 (정책 5 — 파일·함수별)

| 코드 | 지금 | 바꿈 |
|---|---|---|
| `GATE_TRIES` [:3364] | 2 (전체 파이프라인 ×2) | **1** — 잔존 → NEEDS_REVIEW(LEFTOVER) |
| `eraseThenDraw` 자동 진입 [:3304] | 검수 걸린 문구 부분 보정(이미지 +1~2회) | **자동 진입 제거** — 걸린 문구는 사유에 기록, 후보 보존. (수동 문구 수정 경로에서만, 승인 1회로) |
| `regenerateByBands` 자동 진입 [:3328] | 안전 필터 거부 시 | **제거** — NEEDS_REVIEW(SAFETY_BLOCKED) |
| `REGEN_ATTEMPTS` (B·D) | 2 | **1** |
| `callImageEdit` `attempts:2` [:2269] | 타임아웃·429·5xx 재시도 | **이미지 API 는 상태 코드와 무관하게 자동 HTTP 요청 1회** — 타임아웃·429·5xx 전부 재요청 없이 사유 보존 후 RETRYABLE (텍스트 API 의 재시도는 유지) |
| `MAX_IMAGE_CALLS_PER_ASSET` [:13] | 6 (논리) | **1 (HTTP 단위)** — 벨트. 차감을 HTTP 요청 직전으로 |

## 5. 해시 캐시 (정책 7·8)

**측정(운영 DB 메타데이터, 2026-08-24, API 0회):** 자산 569개 / 번역본 443개 / 원본 443개 전부 상이 — `originalUrl` 기준 형제 재사용 적중 **0건**. StoredFile 1,107개(431 MB) 중 미러링 271개, (bytes+mime) 동일 쌍 **8건(≈3%)** = 해시 중복의 상한 추정치(같은 크기·다른 바이트일 수 있어 **추정**). 즉 현 데이터에서 캐시 절감은 작지만, 해시 키는 ① URL 이 달라도 같은 바이트를 잡고(재수집·다른 도매처 동일 이미지) ② "VERIFIED 재호출 금지"(정책 8)를 자산이 아니라 **바이트** 단위로 보장한다.

```prisma
/** (원본 바이트, 파이프라인 버전) → 번역 결과 캐시. 같은 그림·같은 파이프라인은 두 번 렌더하지 않는다 (정책 7·8) */
model TranslationCache {
  sha256          String                 // 원본 바이트 SHA-256 (hex)
  /**
   * 파이프라인 버전 문자열 — 모델 ID · 프롬프트 버전 · 패치 알고리즘 버전 · 검증 정책 버전을
   * 전부 반영한다. 예: "gemini-3.1-flash-image|prompt:4|patch:2|verify:3" (상수 한 곳에서 조립).
   * 어느 하나라도 바뀌면 키가 달라져 구버전 결과가 새 파이프라인에 자동 재사용되지 않는다.
   */
  pipelineVersion String
  status          String                 // VERIFIED | NO_FOREIGN_TEXT | NEEDS_REVIEW | RETRYABLE | FAILED
  ocrData         String?                // 교차 OCR + 확정 번역 JSON
  resultFile      String?                // 번역본 파일 — StoredFile 관계 (아래)
  storedFile      StoredFile? @relation(fields: [resultFile], references: [name], onDelete: SetNull)
  verifyData      String?                // 검수 결과 JSON (사유 포함)
  /** 끊어진 캐시 표시 — 파일 소실·손상·운영자 거부 등으로 재사용 불가가 된 시각·사유 */
  staleAt         DateTime?
  staleReason     String?
  createdAt       DateTime @default(now())

  @@id([sha256, pipelineVersion])
}
```

`StoredFile` 은 `name String @id` 이므로 반대편 관계 필드를 추가한다(관계 유효성):

```prisma
model StoredFile {
  // ... 기존 필드 그대로
  translationCaches TranslationCache[]
}
```

- 조회: `translateImage` 진입 시 `(sha256(원본), 현재 pipelineVersion)` 정확 일치 → `VERIFIED`/`NO_FOREIGN_TEXT` 적중이면 **이미지·OCR·번역·검수 API 전부 0회**, 파일만 연결.
- **적중 시 무결성 확인**: `resultFile` 은 StoredFile FK(onDelete: SetNull)라 참조 무결은 DB 가 지키고, 연결 전에 실제 로드 + `bytes` 일치를 확인한다. 파일이 없거나(resultFile null 포함) 손상이면 **적중 처리하지 않고** 그 행에 `staleAt`/`staleReason` 을 기록한 뒤 미스로 진행한다.
- **구버전 VERIFIED 는 보존하되 새 파이프라인 버전에 자동 재사용하지 않는다** — 어드민에서 "구버전 캐시 N건" 으로 보이고, 재사용 여부는 운영자가 장별로 결정한다.
- `NEEDS_REVIEW`/`FAILED` 적중이면 자동 재실행하지 않고 같은 사유로 NEEDS_REVIEW (운영자 승인 재렌더만 캐시를 갱신).
- 기존 `StoredFile.sourceUrl` 미러 캐시·형제 재사용(`translateAssets.ts`)은 유지 — 해시 캐시가 그 위의 상위 키.
- `ProductAsset.originalSha256 String?` 추가 — 자산↔캐시 연결·중복 측정용 인덱스.

## 6. 상태·노출 흐름 (정책 9·10) — v1 의 1·2절 유지, 달라진 점만

`ProductAsset.translateStatus` = **VERIFIED / NO_FOREIGN_TEXT / TRANSLATING / NEEDS_REVIEW / RETRYABLE / VERIFICATION_FAILED / FAILED / null(legacy)**. v1 의 `reviewReasons`, `candidateUrl/candidateOcr/reviewedAt`, `Product.publishRequestedAt`, ACTIVE 게이트(**노출 허용은 VERIFIED · NO_FOREIGN_TEXT · legacy null 뿐 — TRANSLATING·NEEDS_REVIEW·RETRYABLE·VERIFICATION_FAILED·FAILED 는 전부 차단**), legacy(null) 처리 — 그대로. 달라진 점:

- NEEDS_REVIEW 유입이 "재시도 소진 후"가 아니라 **1회 실패 즉시**다. 사유 코드에 `SAFETY_BLOCKED`(안전 필터), `RATIO_MISMATCH`(비율 불일치), `PATCH_REJECTED`(경계 불합격 문구 목록) 추가. 타임아웃·429·5xx 는 품질 문제가 아니라 일시 오류이므로 별도 상태 **`RETRYABLE`**(사유: `TIMEOUT`/`RATE_LIMITED`/`SERVER_ERROR`)로 구분한다 — 노출 차단은 NEEDS_REVIEW 와 동일하고, 어드민에서 "재시도 승인" 한 번으로 이미지 HTTP 1회를 다시 실행한다.
- **부분 성공 금지(정책 6·9)**: 패치가 하나라도 거부(pending)되거나 완성본 어디든 원문이 한 군데라도 남으면, 통과한 문구가 아무리 많아도 그 이미지는 VERIFIED 가 될 수 없다 → 후보 보존 + NEEDS_REVIEW(불합격 문구 목록 첨부).
- VERIFIED 조건(정책 9): 원문 잔류 0 · 새 문구 0 · 숫자/단위/모델명 보존 · 잘림/자모 깨짐 0 · 허용 패치 영역 밖 변화 0px — **하나라도 실패하거나 검수 호출 자체가 실패하면 VERIFIED 금지**(후자는 VERIFICATION_FAILED).
- 밀집 그리드(≥30문구)도 동일: 1회 렌더 + 검수 후 무조건 NEEDS_REVIEW(DENSE_GRID).
- 참고 주석(정책 15): 로컬 실험 관문 — 박스 겹침, 인접 글자(가까운 띠 높고 먼 띠 낮음), OCR zh 줄수↔ko 줄수 불일치, 최소 크기 미달 — 을 후보의 `reviewReasons` 에 **경고로만** 첨부해 운영자 판단을 돕는다. 이 관문으로 로컬 렌더를 저장하는 일은 없다.

## 7. 운영자 승인 재렌더 (정책 6)

- 어드민 자산 카드(NEEDS_REVIEW): 원본 | 후보 | 사유 코드+상세를 나란히. 버튼:
  - **후보 승인** — candidateUrl → url, VERIFIED(reviewedAt), 캐시 갱신
  - **원본 유지** — 후보 파일 삭제, FAILED(운영자 거부)
  - **재렌더 1회 승인** — 이미지 API HTTP 1회만 추가 실행(전체 재추첨 또는 문구 수정 후 재렌더 중 택1, RETRYABLE 은 같은 설정 재시도). 결과는 다시 ⑤ 검수 → VERIFIED 또는 새 후보. 실행 전 "≈₩100 (추정)" 표기.
- 문구 수정 재렌더(`updateAssetTranslation`)·수동 지움도 승인 1회 규칙에 편입 — 결과가 자동 VERIFIED 되지 않고 후보로 떠서 운영자가 확인 후 승인.
- 감사로그: `ASSET_RERENDER_APPROVE`(비용 메타 포함) / `ASSET_REVIEW_APPROVE` / `ASSET_REVIEW_REJECT`.

## 8. 파일별 계획 (정책 14)

| 파일 | 유지 | 비활성/삭제 | 추가 |
|---|---|---|---|
| `src/lib/imageTranslate.ts` | `regenPrompt`(+그림자·장식 한 줄) · `regenerateStill` · `compositeTextPatches`+`clipRectAgainst` · `flaggedBoxes` 계열 · `gateLeftover` · GIF 정지 패치 · `charBudget` · 교차 OCR 기반(`extractForeign`+`OCR_BANDS`) | `GATE_TRIES` 루프, `eraseThenDraw`·`regenerateByBands` **자동 진입**, `REGEN_ATTEMPTS=2`, fast 모드(`translateImageFast`·`FAST_PROMPT_DEFAULT`·`changedMask`·`compositeByMask`), 타임아웃 재시도 | `TranslateOutcome` 반환형, HTTP 단위 예산=1, `outsidePatchDiff` 단언, 사유 코드 |
| `src/lib/translateVerify.ts` (신규) | – | – | `verifyMeaning`(렌더 전 텍스트 검수), `numbersPreserved`, `newTextLines`, `outsidePatchDiff` (순수 함수) |
| `src/lib/translateCache.ts` (신규) | – | – | `sha256Of`, `lookupCache`, `saveCache` — DB 접근 한 곳 |
| `src/lib/productPublishGate.ts` (신규) | – | – | v1 9절 그대로 (`productPublishGate`, `promoteIfReady`) |
| `src/lib/import/translateAssets.ts` | 형제 재사용·풀 방식 동시 3 | 상태 무시 저장 | 해시 조회 선행, `TranslateOutcome` 별 저장(후보/원본), TRANSLATING 기록, `promoteIfReady` |
| `src/lib/actions/admin-assets.ts` | `swapTranslatedFile`·`revertAssetTranslation` | 무조건 url 교체 | `approveAssetCandidate`/`rejectAssetCandidate`/`approveRerender(mode)`, 수정 재렌더의 후보화 |
| `src/lib/actions/admin-products.ts` | `translateOnPublish` 호출 시점 | ACTIVE 즉시 반영 | `publishRequestedAt` 게이트 (v1 그대로) |
| `prisma/schema.prisma` + 마이그레이션 1개 | – | – | v1 필드(6절) + `TranslationCache`(복합 키 sha256+pipelineVersion, StoredFile FK) + `ProductAsset.originalSha256` (전부 추가만) |
| `src/components/admin/ProductAssetsManager.tsx` | 번역 도구줄·문구 수정 편집기 | – | 상태 배지, 원본/후보 비교, 승인·거부·재렌더(≈₩100 추정 표기) 버튼, 참고 경고 표시 |
| `src/app/admin/products/page.tsx` | – | – | "판매 보류 · 검수 N장" 배지 + 필터 |
| `CLAUDE.md` | – | – | 호출 1회 정책·캐시·상태 체계 갱신 |

## 9. 테스트 계획 (전부 API 0원 — 호출은 목)

- `imageTranslate.test.ts` 확장: **자동 흐름에서 이미지 API HTTP 요청 최대 1회 단언**(fetch 목의 IMAGE_MODEL HTTP 카운트 — 성공·검수실패·안전필터·타임아웃·429·5xx·밀집 각 시나리오에서 ≤1회, 재요청 0회) · 렌더 전 실패·캐시 적중 = 0회 · 실패 시 `RETRYABLE`/`NEEDS_REVIEW`+사유 · `outsidePatchDiff===0` · **패치 1개 거부 또는 원문 1건 잔류 → 이미지 전체 NEEDS_REVIEW** 단언.
- `translateVerify.test.ts`: 숫자·단위·모델코드 보존 참/거짓 표, 새 문구 검출, 의미 검수 응답 파싱.
- `translateCache.test.ts`: 같은 (바이트, pipelineVersion) → 두 번째 호출 API 0회 / 다른 바이트 → 미스 / **pipelineVersion 이 다르면 구버전 VERIFIED 라도 미스** / NEEDS_REVIEW 캐시는 재실행 안 함 / resultFile 이 없거나 bytes 불일치(끊어진 캐시) → 적중 아님 + stale 표시.
- `productPublishGate.test.ts` + `translateAssets` 통합(DB 목): v1 6절 그대로 + 해시 선행 조회.
- 회귀: `scratchpad/eval20` 20장 + 저장된 OCR 로 패치 합성·검수 경로(무료) — `outsidePatchDiff`, 관문 참고 주석 재현.
- 실이미지 검증(승인 후 별도): 1장 **약 ₩105~110 (추정 — 실행 직전 단가·환율 재확인)** → 통과 시 묶음. 실행 전 금액 승인.

## 10. v1(2026-08-23 문서) 대비 변경 섹션

| v1 섹션 | 처분 |
|---|---|
| 1(상태 체계)·2(DB)·9(ACTIVE 게이트) | **유지** — 6절에서 참조, 사유 코드만 추가 |
| 3-2 흐름(관문 재시도 GATE_TRIES=2, 부분 보정 자동) | **교체** → 3·4절: 자동 1회, 재시도·부분보정·띠 자동 진입 제거 |
| 3-3 표 4(교차 OCR)·5(의미 검수)·6(완성본 검사)·7(박스 밖) | **유지** (3·9절) |
| 3-3 표 8(폰트 수치 비교 glyphMetrics) | **삭제** — Canvas 덧그리기가 자동 경로에서 빠져 대상 없음. 수동 경로는 운영자 육안 승인으로 대체 |
| 빠른 모드 "NEEDS_REVIEW 로 존치" | **교체** → 삭제 (4절) |
| 4(회귀 세트) | **축소 유지** — 9절 무료 회귀 + 승인 후 실이미지 |
| (없던 것) | **신설** — 1(호출 전수 목록)·2(비용)·5(해시 캐시)·7(승인 재렌더) |

## 10-1. v2.1 수정 이력 (2026-08-24, 운영자 지시 6건)

1. 비용: 출력 1K 공식 단가 $0.067 + 입력 토큰(미측정) 기준으로 전면 수정, 원화는 환율 가정(1,400원/USD, 2026-08-24)과 함께 전부 추정 표기. 비용표에 "실제 HTTP 요청 수·청구 토큰 미측정 — 추정" 명시.
2. "429/5xx 과금 없음" 삭제 → 공식 보장 범위(단가표)와 미확인 범위(오류·타임아웃 청구 여부) 구분. 이미지 API 는 상태 코드 무관 자동 HTTP 1회, 타임아웃·429·5xx 는 후보·사유 보존 후 `RETRYABLE`.
3. "정확히 1회" → "캐시 미스이고 렌더 전 검수를 통과한 원본당 자동 이미지 HTTP 요청 최대 1회, 렌더 전 실패·캐시 적중 = 0회"로 재정의.
4. `TranslationCache` 키를 `(sha256, pipelineVersion)` 복합 키로 — 버전 문자열에 모델 ID·프롬프트·패치 알고리즘·검증 정책 버전 반영, 구버전 VERIFIED 는 보존하되 자동 재사용 금지.
5. `resultFile` 을 StoredFile FK 관계로 + 적중 시 실제 로드·bytes 무결성 확인, 끊어진 캐시는 미스 처리 + stale 표시.
6. 부분 성공 금지 명문화 — 패치 1개 거부 또는 원문 1건 잔류면 이미지 전체 VERIFIED 불가 → NEEDS_REVIEW.

## 11. 승인 요청

1. 이 설계로 구현 착수 (순서: DB/캐시 → 호출 1회화·상태 반환 → 저장·게이트 → 어드민 UI → 테스트). legacy 처리는 6절(v1 결정 유지)에 포함되어 있다.
2. 구현 완료 후 실이미지 1장 검증(약 ₩105~110 추정, 실행 직전 재확인)은 별도 승인.
