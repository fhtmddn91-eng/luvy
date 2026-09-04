/**
 * 번역 검증 — 순수 함수 모음 (설계 2026-08-24 v2.1 정책 9).
 *
 * 전부 픽셀·문자열 계산이다. API 호출은 여기 없다 — 호출부(imageTranslate)가
 * 판독 결과를 넘겨 주면 판정만 한다. 순수로 떼어낸 이유: 이 판정들이 "틀린
 * 이미지가 나가느냐"를 가르는 마지막 선이라 단위 테스트로 못 박아야 한다.
 */

/** [ymin, xmin, ymax, xmax] — 0~1000 정규화 좌표 */
export type NormBox = [number, number, number, number];

/**
 * 보존돼야 하는 토큰 — 숫자(+붙은 라틴 단위)와 모델 코드.
 * "不低于53MIN" → ["53MIN"], "SHD-S549" → ["SHD-S549"], "3.7V" → ["3.7V"].
 * 비교는 공백·쉼표 제거 + 대문자로 정규화해서 한다.
 */
export function extractNumberTokens(s: string): string[] {
  const out: string[] = [];
  // 모델 코드: 영문 2+ 로 시작하고 숫자를 포함한 형태 (SHD-S549 처럼 하이픈 뒤 영문+숫자도)
  const MODEL_CODE = /[A-Za-z]{2,}[A-Za-z0-9-]*\d[A-Za-z0-9-]*/g;
  for (const m of s.matchAll(MODEL_CODE)) out.push(m[0]);
  // 숫자 + 선택적 단위 (모델 코드에 이미 삼킨 숫자는 제외하기 위해 위치로 거른다)
  const taken = new Set<number>();
  for (const m of s.matchAll(MODEL_CODE)) {
    for (let i = m.index!; i < m.index! + m[0].length; i++) taken.add(i);
  }
  for (const m of s.matchAll(/\d+(?:[.,]\d+)?\s*(?:[A-Za-z%°]{0,4})/g)) {
    if (taken.has(m.index!)) continue;
    out.push(m[0]);
  }
  return out.map((t) => t.replace(/[\s,]/g, "").toUpperCase()).filter(Boolean);
}

const normText = (s: string) => s.replace(/[\s,]/g, "").toUpperCase();

/**
 * 원문의 숫자·단위·모델명이 판독문에 전부 남아 있는가.
 * 하나라도 빠지면 이미지 모델이 숫자를 바꾸거나 뺀 것 — VERIFIED 불가 사유.
 */
export function numbersPreserved(zh: string, observed: string): { ok: boolean; missing: string[] } {
  const hay = normText(observed);
  const missing = extractNumberTokens(zh).filter((t) => !hay.includes(t));
  return { ok: missing.length === 0, missing };
}

const inter = (a: NormBox, b: NormBox): number => {
  const y = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const x = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  return x * y;
};
const area = (a: NormBox): number => Math.max(0, a[2] - a[0]) * Math.max(0, a[3] - a[1]);

/**
 * 완성본 판독에서 "원문에도 번역문에도 없던 새 글자"를 찾는다.
 *
 * 모델이 지운 자리에 도장·문구를 지어내는 사고(실측: 源头工厂 → 빨간 도장) 검출.
 * 아는 박스와 30% 이상 겹치는 줄은 번역문이 찍힌 것이니 제외하고,
 * 원본 판독에 이미 있던 줄(로고·영문 장식)도 제외한다.
 */
export function newTextLines(
  lines: { box: NormBox; text: string }[],
  knownBoxes: NormBox[],
  origLines: { text: string }[],
): { box: NormBox; text: string }[] {
  const origNorm = origLines.map((l) => normText(l.text)).filter(Boolean);
  return lines.filter((l) => {
    const t = normText(l.text);
    if (!t) return false;
    const la = area(l.box);
    if (la > 0 && knownBoxes.some((b) => inter(l.box, b) >= la * 0.3)) return false;
    if (origNorm.some((o) => o.includes(t) || t.includes(o))) return false;
    return true;
  });
}

/**
 * 허용 패치 영역 밖 픽셀이 원본과 같은가 — "글자 밖은 원본 그대로" 단언.
 * 같은 디코더로 얻은 raw 끼리 비교해야 한다(인코딩 전 캔버스 단계). tol=0 이 기본.
 */
export function outsidePatchDiff(
  orig: Uint8Array | Uint8ClampedArray,
  out: Uint8Array | Uint8ClampedArray,
  W: number,
  H: number,
  rects: { x0: number; y0: number; x1: number; y1: number }[],
  tol = 0,
): number {
  const px = rects.map((r) => ({
    x0: Math.max(0, Math.floor(r.x0)),
    y0: Math.max(0, Math.floor(r.y0)),
    x1: Math.min(W, Math.ceil(r.x1)),
    y1: Math.min(H, Math.ceil(r.y1)),
  }));
  let diff = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (px.some((r) => x >= r.x0 && x < r.x1 && y >= r.y0 && y < r.y1)) continue;
      const i = (y * W + x) * 4;
      if (
        Math.abs(out[i] - orig[i]) > tol ||
        Math.abs(out[i + 1] - orig[i + 1]) > tol ||
        Math.abs(out[i + 2] - orig[i + 2]) > tol
      ) {
        diff++;
      }
    }
  }
  return diff;
}

/** 비교용 정규화 — 공백·문장부호·장식부호는 OCR 이 흘리기 쉬워 뺀다 */
export const forCompareText = (s: string): string => forCompare(s);
const forCompare = (s: string): string =>
  s.replace(/[\s.,·:;!?()[\]{}'"“”‘’\-–—/+~～⁓∼…⋯*※&|]/g, "");

/**
 * 번역 박스 안의 추가 문구(환각) 검출 — 양방향 비교 (v2.1 보강 2026-08-24).
 *
 * 기존 검사(textCoverage)는 "기대 문구가 다 찍혔나"만 봐서, 모델이 기대 문구
 * **옆에 없던 말을 덧붙인** 경우("강렬한 진동 정품 보증")를 통과시켰다.
 * 관측문에서 기대 문구(순서 유지 부분수열)와 원문에 이미 있던 숫자·단위·
 * 라틴 장식을 걷어낸 뒤, 의미 있는 한글·한자·라틴 글자가 2자 이상 남으면
 * 지어낸 문구다. 공백·문장부호·띄어쓰기 차이는 정규화로 허용한다.
 */
export function extraTextInBox(
  expectedKo: string,
  zh: string,
  observed: string,
): { ok: boolean; extra: string } {
  const exp = forCompare(expectedKo);
  let rest = forCompare(observed);

  // 기대 문구를 순서 유지 부분수열로 제거 — OCR 이 중간 글자를 흘려도
  // 남는 것은 "기대 밖" 글자만이어야 한다
  let ei = 0;
  let leftover = "";
  for (const ch of rest) {
    if (ei < exp.length && ch === exp[ei]) ei++;
    else leftover += ch;
  }
  rest = leftover;

  // 원문에 이미 있던 토큰(숫자·단위·모델코드·라틴 장식)은 남아 있어도 정상
  const allowed = [
    ...extractNumberTokens(zh),
    ...[...zh.matchAll(/[A-Za-z]{2,}/g)].map((m) => m[0].toUpperCase()),
  ];
  let restUpper = rest.toUpperCase();
  for (const tok of allowed) {
    while (tok && restUpper.includes(tok)) {
      const at = restUpper.indexOf(tok);
      rest = rest.slice(0, at) + rest.slice(at + tok.length);
      restUpper = rest.toUpperCase();
    }
  }

  // 의미 있는 글자(한글·한자·라틴)만 센다 — 낱자 하나는 OCR 티끌로 본다
  const meaningful = rest.match(/[가-힣㐀-䶿一-鿿A-Za-z]/g) ?? [];
  if (meaningful.length >= 2) return { ok: false, extra: meaningful.join("") };
  return { ok: true, extra: "" };
}

/**
 * 의미 검수 요청문 — 원문↔번역문 쌍을 심사시킨다 (정책 9, 2026-08-24 v2.1 보강).
 *
 * 보강 배경(live1 실측): "奏响快乐和弦(즐거움의 화음을 연주하다)" → "쾌락의 하모니"
 * 처럼 원문에 없는 성적 뉘앙스로 강화된 번역과, "柔软咬合" → "부드러운 흡입"처럼
 * 수식·행위가 깎여 나간 번역이 통과했다. 핵심 행위·대상·수식어의 누락/추가와
 * 성적 표현 강화를 명시적 실격 기준으로 박는다.
 */
export function buildMeaningPrompt(pairs: { zh: string; ko: string }[]): string {
  const list = pairs.map((p, i) => `${i + 1}. "${p.zh}" → "${p.ko}"`).join("\n");
  return `중국 상품 상세페이지 문구의 원문과 한국어 번역 쌍입니다. 각 쌍을 심사하세요.

각 쌍을 두 종류로 나눠 판정하세요.

**hard (심각 — 그대로 내보내면 안 되는 것)**
1. 원문에 없는 행위·대상·효능·보증이 **추가**됨
2. 원문보다 과장되거나 **성적 표현이 강화**됨
   (예: 원문이 "즐거움·쾌감" 수준인데 "쾌락"처럼 더 노골적인 단어로 바꾸면 hard)
3. 핵심 낱말의 **오역** (뜻이 다른 말로 바뀜)
4. 숫자·단위·모델명이 바뀌거나 빠짐
5. 원문이 깨졌거나 뜻을 확정할 수 없어 번역이 추측인 경우
6. 한자·중국어가 번역문에 남음

**soft (다듬을 여지 — 뜻은 맞는 것)**
7. 부가 수식어·반복 표현이 생략됨 (뜻이 유지되는 축약·의역)
8. 어색하지만 뜻은 통하는 표현

판정 규칙: hard 가 하나라도 있으면 ok:false. soft 만 있으면 **ok:true** 로 두고
issues 에 남기세요 — 뜻이 맞는데 다듬을 여지가 있다는 이유로 막지 않습니다.
확실하지 않으면 hard 로 분류하세요.

입력과 같은 개수·순서로 JSON 배열만 출력:
[{"ok":true,"issues":[],"hard":[]},
 {"ok":false,"issues":["숫자 누락: 53MIN"],"hard":["숫자 누락: 53MIN"]},
 {"ok":true,"issues":["수식어 '부드러운' 생략"],"hard":[]}]

입력 (${pairs.length}개):
${list}`;
}

/** 교정 재번역에 넘길 실패 문구 정보 — 원문·첫 번역·검수 지적·글자 예산을 같은 인덱스로 */
export interface CorrectionItem {
  zh: string;
  firstKo: string;
  issues: string[];
  budget: number;
}

/**
 * 교정 재번역 요청문 (2026-08-24 live2 실측 보강).
 *
 * 배경: 재번역이 검수 지적을 전달받지 못해 첫 번역과 글자 하나 안 다른 답을
 * 되풀이했다(live2: 5문구 × 2회 동일). 문구마다 원문·기존 번역·구체적 지적을
 * 넣어 "무엇을 왜 고쳐야 하는지"를 알려 준다. 실패 문구 전체를 배치 1회로 —
 * 문구별 반복 호출 금지.
 */
export function buildCorrectiveRetranslatePrompt(items: CorrectionItem[]): string {
  const list = items
    .map(
      (it, i) =>
        `${i + 1}. 원문 "${it.zh}" / 기존 번역 "${it.firstKo}" / 최대 ${it.budget}자\n   지적: ${it.issues.join(" · ") || "(사유 미상 — 기준 전체를 다시 점검)"}`,
    )
    .join("\n");
  return `중국 상품 상세페이지 문구의 기존 번역이 의미 검수에서 실격됐습니다. 지적을 반영한 교정 번역을 만드세요.

규칙:
- 지적된 누락·오역·과장·성적 표현 강화를 **모두** 바로잡으세요
- 원문의 핵심 행위·대상·방향·수식어를 보존하세요 (上下→위아래, 顶撞→찌르기 처럼 방향·행위를 살립니다)
- 원문에 없는 효능·행위·표현을 추가하지 마세요
- 숫자·단위·모델명은 원문 그대로 유지하세요
- 한국 성인용품 쇼핑몰 상세페이지에서 쓰는 자연스러운 문구로
- 항목마다 적힌 "최대 N자"(공백 포함)를 지키세요 — 원문 자리에 그대로 들어갑니다
- 한자·중국어 문자를 절대 남기지 마세요
- 기존 번역과 똑같은 답을 다시 내지 마세요 — 지적이 반영돼야 합니다
- 입력과 같은 개수, 같은 순서의 JSON 문자열 배열만 출력

입력 (${items.length}개):
${list}`;
}

const HANZI = /[㐀-䶿一-鿿]/;

/**
 * 교정 번역 사용 불가 판정 — 걸리면 추가 재시도 없이 즉시 MEANING_UNCERTAIN.
 * 무변화(정규화 기준)·빈 답·한자 잔류에 더해, 원문의 숫자·단위·모델명이 빠진
 * 교정도 공짜 검사로 거른다(규칙 1 — 싼 단계에서 막는다).
 */
export function correctionRejected(zh: string, firstKo: string, corrected: string): string | null {
  if (!corrected.trim()) return "빈 교정 응답";
  if (HANZI.test(corrected)) return "교정에 한자 잔류";
  if (forCompare(corrected) === forCompare(firstKo)) return "재번역 무변화 — 첫 번역과 동일";
  const nums = numbersPreserved(zh, corrected);
  if (!nums.ok) return `교정에서 숫자·단위 누락: ${nums.missing.join(", ")}`;
  return null;
}

/**
 * MEANING_UNCERTAIN 사유 문자열 — 운영자가 원문·1차 번역·교정·양쪽 지적을
 * 한 줄에서 볼 수 있게. 전체 프롬프트·개인정보는 넣지 않는다.
 */
export function meaningFailureDetail(f: {
  zh: string;
  firstKo: string;
  correctedKo: string;
  firstIssues: string[];
  secondIssues: string[];
}): string {
  const fmt = (xs: string[]) => (xs.length ? xs.join("; ") : "-");
  return `${f.zh} | 1차 "${f.firstKo}" (${fmt(f.firstIssues)}) | 교정 "${f.correctedKo}" (${fmt(f.secondIssues)})`.slice(0, 400);
}

/**
 * 완성본 의미 검수 요청문 — 중국어 원문 ↔ **최종 이미지에서 읽어온** 한국어를
 * 직접 대조한다 (정책 4). 문자열 일치가 아니라 의미 단위 심사다 — 렌더 과정에서
 * 모델이 문구를 바꿔치기했거나 검수가 놓친 의미 변형을 마지막에 한 번 더 잡는다.
 */
export function buildRenderedMeaningPrompt(pairs: { zh: string; observed: string }[]): string {
  const list = pairs.map((p, i) => `${i + 1}. 원문 "${p.zh}" → 최종 이미지 판독 "${p.observed}"`).join("\n");
  return `중국 상품 상세페이지의 원문과, 번역 완성 이미지에서 실제로 읽어온 한국어입니다. 각 쌍의 의미가 일치하는지 심사하세요.

기준 (하나라도 어긋나면 ok:false):
1. 핵심 행위·대상·수식어의 누락이 없는가
2. 원문에 없는 내용의 추가가 없는가
3. 과장이나 **성적 표현 강화**가 없는가 (원문과 같은 수위여야 함)
4. 숫자·단위·모델명이 그대로인가
5. 판독문이 온전한 한국어 문구인가 (중국어가 남았거나 글자가 깨졌으면 실격)

OCR 특성상 띄어쓰기·문장부호 차이는 무시하세요. 확실하지 않으면 ok:false.
입력과 같은 개수·순서로 JSON 배열만 출력: [{"ok":true,"issues":[]}]

입력 (${pairs.length}개):
${list}`;
}

/**
 * 확정 번역문 ↔ 최종 이미지 판독문 양방향 엄격 비교 (정책 5).
 *
 * 의미가 비슷해도 모델이 문구를 임의로 바꾸면 안 된다 — 문구는 우리가 확정해서
 * 넘긴 것이고, 이미지에는 그 문구가 그대로 찍혀야 한다. 허용 오차는 공백·
 * 문장부호·OCR 띄어쓰기 차이뿐(forCompare 정규화). 그 외 한 글자라도 다르면
 * 불일치 — 잘림("자ᄀ")·바꿔치기("밀착" 탈락)·덧붙임이 전부 여기 걸린다.
 */
export function renderedTextMatches(expectedKo: string, observed: string): boolean {
  return forCompare(expectedKo) === forCompare(observed);
}

/**
 * 의미 검수 응답 해석 — 형식이 어긋나면 null (호출부가 VERIFICATION_FAILED 처리).
 *
 * hard 는 "그대로 내보내면 안 되는" 지적만 담는다. 모델이 ok:false 를 주면서 hard 를
 * 비워 두는 경우가 있어(구버전 응답 포함) **ok:false 는 그 자체로 hard 취급**한다 —
 * 관문을 느슨하게 만드는 방향의 해석은 하지 않는다 (fail-closed).
 */
export function parseMeaningVerdicts(
  raw: unknown,
  n: number,
): { ok: boolean; issues: string[]; hard: string[] }[] | null {
  if (!Array.isArray(raw) || raw.length !== n) return null;
  const out: { ok: boolean; issues: string[]; hard: string[] }[] = [];
  for (const v of raw) {
    if (typeof v !== "object" || v === null || typeof (v as { ok?: unknown }).ok !== "boolean") return null;
    const strs = (k: string): string[] =>
      Array.isArray((v as Record<string, unknown>)[k])
        ? ((v as Record<string, unknown>)[k] as unknown[]).map((s) => String(s)).slice(0, 10)
        : [];
    const ok = (v as { ok: boolean }).ok;
    const issues = strs("issues");
    let hard = strs("hard");
    if (!ok && hard.length === 0) hard = issues.length > 0 ? issues : ["심각 지적(사유 미기재)"];
    out.push({ ok, issues, hard });
  }
  return out;
}

/**
 * 렌더 전 차단 여부 — hard 지적이 하나라도 있으면 막는다.
 * soft(뜻은 맞는 축약·의역)만 있으면 통과시키되, 완성본 의미검수
 * (verifyRenderedMeaning → MEANING_MISMATCH)가 실제 렌더 결과로 다시 판정한다.
 * 즉 관문을 없앤 게 아니라 **판정 시점을 실제 결과물 쪽으로 옮긴** 것이다.
 */
export function blocksRender(v: { ok: boolean; hard: string[] } | undefined): boolean {
  if (!v) return true; // 판정이 없으면 통과가 아니다
  return !v.ok || v.hard.length > 0;
}

/**
 * 렌더 전 매핑 검사 (live10 #04 대응) — 이미지 호출 전에 공짜로 막는다.
 *  ① 서로 다른 원문이 같은 번역문으로 붙으면 셀 복제·매핑 사고의 전조다
 *  ② 원문의 숫자·단위·모델코드가 번역문에서 빠지면 렌더까지 갈 이유가 없다
 */
export function preRenderMappingIssues(
  boxes: { zh: string; ko: string; box?: NormBox }[],
): { duplicates: string[]; numberLoss: string[] } {
  const byKo = new Map<string, { zh: string; box?: NormBox }[]>();
  for (const b of boxes) {
    const k = forCompare(b.ko);
    if (!k) continue;
    const list = byKo.get(k) ?? [];
    list.push({ zh: b.zh, box: b.box });
    byKo.set(k, list);
  }
  const duplicates: string[] = [];
  for (const [ko, items] of byKo) {
    // 같은 원문이 두 번 들어온 것(판독 중복)은 여기서 볼 일이 아니다 — dedupeOcrBoxes 몫
    const uniq: { zh: string; box?: NormBox }[] = [];
    for (const it of items) {
      if (!uniq.some((u) => zhCompare(u.zh) === zhCompare(it.zh))) uniq.push(it);
    }
    if (uniq.length < 2) continue;

    // 서로 다른 원문이 같은 번역 — **그 자체는 정상일 수 있다**(동의어: 酒红色/酒红 → 버건디).
    // live11 #01 에서 정상 번역을 막았다. 진짜 사고인 경우에만 막는다:
    //  ① 좌표 충돌 — 두 박스가 겹치면 같은 글자를 두 번 읽은 것이거나 패치가 서로를 덮는다
    //  ② 숫자 불일치 — 원문의 숫자·단위가 다른데 번역이 같으면 값이 뭉개진 것 (셀 복제 사고)
    //  ③ 좌표를 모르면 판단 불가 → 보수적으로 차단 (fail-closed)
    const reasons: string[] = [];
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const a = uniq[i];
        const b = uniq[j];
        if (!a.box || !b.box) {
          reasons.push("좌표 미상");
          continue;
        }
        if (inter(a.box, b.box) > 0) reasons.push("좌표 충돌");
        const na = extractNumberTokens(a.zh).join("|");
        const nb = extractNumberTokens(b.zh).join("|");
        if (na !== nb) reasons.push("숫자 불일치");
      }
    }
    if (reasons.length === 0) continue;
    const why = [...new Set(reasons)].join("·");
    duplicates.push(`${why}: ${uniq.map((u) => u.zh.slice(0, 14)).join(" / ")} → "${ko.slice(0, 20)}"`);
  }
  const numberLoss = boxes
    .map((b) => {
      const r = numbersPreserved(b.zh, b.ko);
      return r.ok ? null : `${b.zh.slice(0, 16)}: ${r.missing.join("/")}`;
    })
    .filter((s2): s2 is string => s2 !== null);
  return { duplicates, numberLoss };
}

/** 원문 비교용 정규화 (공백·문장부호 제거) — 판독 중복 판정과 같은 기준 */
const zhCompare = (s: string): string => s.replace(/[\s,.:;()（）·、，。：；]/g, "");

/**
 * 교차 OCR 합의 — 전체 판독과 띠 판독에서 같은 문구를 짝짓는다.
 * 같은 문구 = 박스 IoU ≥ 0.5 이거나 원문 정규화 일치율이 높은 것.
 * 한쪽에만 있는 문구는 unconfirmed — 렌더는 하되 검수 사유로 남긴다 (정책 9 보강).
 */
export function mergeOcrPasses<T extends { box: NormBox; zh: string }>(
  full: T[],
  bands: T[],
): { merged: T[]; unconfirmed: T[] } {
  const iou = (a: NormBox, b: NormBox) => {
    const i = inter(a, b);
    const u = area(a) + area(b) - i;
    return u > 0 ? i / u : 0;
  };
  const sameText = (a: string, b: string) => {
    const na = normText(a);
    const nb = normText(b);
    if (!na || !nb) return false;
    return na.includes(nb) || nb.includes(na);
  };
  const matchedBand = new Set<T>();
  const unconfirmed: T[] = [];
  for (const f of full) {
    const m = bands.find((b) => !matchedBand.has(b) && (iou(f.box, b.box) >= 0.5 || sameText(f.zh, b.zh)));
    if (m) matchedBand.add(m);
    else unconfirmed.push(f);
  }
  const extra = bands.filter((b) => !matchedBand.has(b));
  unconfirmed.push(...extra);
  return { merged: [...full, ...extra], unconfirmed };
}

/* ══════════════════════════════════════════════════════════════════
 * H1 — 원문 잔류 방지: OCR 과 독립된 "글자처럼 보이는 영역" 탐지
 *
 * 왜 필요한가(2026-08-24 진단): 최초 판독과 최종 관문이 같은 OCR 모델이라
 * 실명이 상관된다. 최초에 못 본 문구는 번역 대상에 못 들어가 패치되지 않고,
 * 더 약한 관문(전체 1회)이 같은 문구를 또 못 보면 LEFTOVER 0 으로 통과한다 —
 * 사람 눈에는 중국어가 그대로 보이는데 VERIFIED 가 됐다.
 *
 * 그래서 모델을 쓰지 않는 픽셀 신호를 하나 더 둔다. 이 함수는 글자를 "읽지"
 * 않는다 — 글자처럼 생긴 잉크 덩어리가 어디 있는지만 찾는다. 그 영역이 전부
 * (번역함 / 보존 대상 / 검수로 보냄) 중 하나로 설명돼야 VERIFIED 를 준다.
 * 오탐(사진 무늬를 글자로 봄)은 자동화율만 깎고 안전은 해치지 않는다 — 설계
 * 원칙이 fail-closed 이므로 그 방향의 오차를 택한다.
 * ══════════════════════════════════════════════════════════════════ */

export interface TextLikeRegion {
  box: NormBox;
  /** 원본 픽셀 기준 글줄 높이 — 작은 글자 판정용 */
  heightPx: number;
  /** 배경 대비 잉크 세기 평균 (0~255) */
  contrast: number;
  /** 판독 확신 (0~1) — 작거나 흐리면 낮다. 낮으면 OCR 이 놓쳤을 수 있다 */
  confidence: number;
  /** 이 영역을 이루는 글자꼴 덩어리 수 */
  glyphs: number;
}

/** 잉크로 볼 최소 배경 대비 — 이보다 옅으면 무늬로 본다 */
const INK_MIN_CONTRAST = 26;
/** 확신 계산 기준: 이 높이·대비면 확신 1.0 */
const CONF_FULL_HEIGHT_PX = 15;
const CONF_FULL_CONTRAST = 48;

const luma = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;

/**
 * 글자처럼 보이는 영역 탐지 (순수·모델 없음).
 *
 * ① 배경을 굵은 블록 평균으로 잡고 ② 배경에서 벗어난 픽셀을 잉크로 표시한 뒤
 * ③ 연결 성분을 글자꼴 조건(크기·채움비)으로 거르고 ④ 같은 줄에 놓인 것들을
 * 묶는다. ⑤ 글자 높이가 들쭉날쭉한 묶음(사진 잡티)은 버린다.
 *
 * 속도를 위해 짧은 변 기준 ~400px 로 줄여서 계산한다 — 글줄 높이 3px 미만은
 * 어차피 사람도 못 읽고 OCR 도 못 읽는다.
 */
export function detectTextLikeRegions(
  raw: Uint8Array | Uint8ClampedArray,
  W: number,
  H: number,
): TextLikeRegion[] {
  if (W <= 0 || H <= 0) return [];
  const step = Math.max(1, Math.round(Math.min(W, H) / 400));
  const w = Math.floor(W / step);
  const h = Math.floor(H / step);
  if (w < 8 || h < 8) return [];

  const gray = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((y * step) * W + x * step) * 4;
      gray[y * w + x] = luma(raw[i], raw[i + 1], raw[i + 2]);
    }
  }

  // 배경: 굵은 블록의 **중앙값**. 평균을 쓰면 글자가 배경 추정을 끌어당겨,
  // 글자가 빽빽한 블록에서 배경이 글자와 여백의 중간값이 되고 — 그러면 글자도
  // 여백도 전부 "배경과 다름"이 되어 대역 전체가 한 덩어리로 뭉친다(실측).
  // 글자는 블록 안에서 소수라 중앙값은 여백을 가리킨다.
  const B = Math.max(8, Math.round(Math.min(w, h) / 12));
  const bw = Math.ceil(w / B);
  const bh = Math.ceil(h / B);
  const bg = new Float32Array(bw * bh);
  const buf: number[] = [];
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      buf.length = 0;
      for (let y = by * B; y < Math.min(h, (by + 1) * B); y++) {
        for (let x = bx * B; x < Math.min(w, (bx + 1) * B); x++) buf.push(gray[y * w + x]);
      }
      if (buf.length === 0) {
        bg[by * bw + bx] = 0;
        continue;
      }
      buf.sort((p, q) => p - q);
      bg[by * bw + bx] = buf[buf.length >> 1];
    }
  }
  const bgAt = (x: number, y: number): number => bg[Math.min(bh - 1, (y / B) | 0) * bw + Math.min(bw - 1, (x / B) | 0)];

  const ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (Math.abs(gray[y * w + x] - bgAt(x, y)) > INK_MIN_CONTRAST) ink[y * w + x] = 1;
    }
  }

  // 연결 성분 → 글자꼴 후보
  type Comp = { x0: number; y0: number; x1: number; y1: number; area: number; sum: number };
  const seen = new Uint8Array(w * h);
  const glyphs: Comp[] = [];
  const maxGlyphH = Math.max(4, Math.floor(h / 6)); // 이보다 크면 글자가 아니라 그림
  for (let sy = 0; sy < h; sy++) {
    for (let sx = 0; sx < w; sx++) {
      const k0 = sy * w + sx;
      if (!ink[k0] || seen[k0]) continue;
      const stack = [k0];
      seen[k0] = 1;
      let x0 = sx;
      let x1 = sx;
      let y0 = sy;
      let y1 = sy;
      let area = 0;
      let sum = 0;
      while (stack.length) {
        const k = stack.pop()!;
        area++;
        const cx = k % w;
        const cy = (k - cx) / w;
        if (cx < x0) x0 = cx;
        if (cx > x1) x1 = cx;
        if (cy < y0) y0 = cy;
        if (cy > y1) y1 = cy;
        sum += Math.abs(gray[k] - bgAt(cx, cy));
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || nx >= w || ny < 0 || ny >= h) continue;
          const nk = ny * w + nx;
          if (ink[nk] && !seen[nk]) {
            seen[nk] = 1;
            stack.push(nk);
          }
        }
      }
      const cw = x1 - x0 + 1;
      const ch = y1 - y0 + 1;
      if (ch < 2 || ch > maxGlyphH) continue;
      if (cw > ch * 12) continue; // 가로줄·테두리
      const fill = area / (cw * ch);
      if (fill < 0.06 || fill > 0.97) continue; // 점·꽉 찬 사각형
      glyphs.push({ x0, y0, x1, y1, area, sum });
    }
  }

  // 같은 줄로 묶기 — 세로로 겹치고 가로 간격이 글자 높이 안쪽이면 한 줄
  glyphs.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const used = new Array(glyphs.length).fill(false);
  const out: TextLikeRegion[] = [];
  for (let i = 0; i < glyphs.length; i++) {
    if (used[i]) continue;
    const line = [glyphs[i]];
    used[i] = true;
    let changed = true;
    while (changed) {
      changed = false;
      const ly0 = Math.min(...line.map((g) => g.y0));
      const ly1 = Math.max(...line.map((g) => g.y1));
      const lx0 = Math.min(...line.map((g) => g.x0));
      const lx1 = Math.max(...line.map((g) => g.x1));
      const lh = ly1 - ly0 + 1;
      for (let j = 0; j < glyphs.length; j++) {
        if (used[j]) continue;
        const g = glyphs[j];
        const ov = Math.min(ly1, g.y1) - Math.max(ly0, g.y0) + 1;
        if (ov < Math.min(lh, g.y1 - g.y0 + 1) * 0.5) continue;
        const gap = g.x0 > lx1 ? g.x0 - lx1 : lx0 - g.x1;
        if (gap > lh * 1.6) continue;
        line.push(g);
        used[j] = true;
        changed = true;
      }
    }
    const hs = line.map((g) => g.y1 - g.y0 + 1);
    const hMax = Math.max(...hs);
    const hMin = Math.min(...hs);
    // 사진 잡티는 크기가 제각각이다 — 글줄은 높이가 고르다
    if (line.length >= 2 && hMax > hMin * 2.6) continue;
    // 낱자가 둘 이상이어야 글줄로 본다.
    // 한 덩어리짜리는 통짜 색띠·도형·아이콘이다 — 배경 추정(블록 중앙값) 때문에
    // 큰 단색 띠는 테두리만 잉크로 남아 속 빈 사각형처럼 보이는데, 이걸 글줄로
    // 세면 색띠가 있는 이미지가 전부 "설명 안 된 문자 영역"으로 막힌다(실측).
    // 글자 한 덩어리를 놓치는 대가는 OCR 이 받쳐 준다 — 이건 두 번째 신호다.
    if (line.length < 2) continue;
    const x0 = Math.min(...line.map((g) => g.x0));
    const x1 = Math.max(...line.map((g) => g.x1));
    const y0 = Math.min(...line.map((g) => g.y0));
    const y1 = Math.max(...line.map((g) => g.y1));

    const area = line.reduce((s, g) => s + g.area, 0);
    const contrast = area ? line.reduce((s, g) => s + g.sum, 0) / area : 0;
    const heightPx = (y1 - y0 + 1) * step;
    const confidence = Math.max(
      0,
      Math.min(1, Math.min(heightPx / CONF_FULL_HEIGHT_PX, contrast / CONF_FULL_CONTRAST)),
    );
    out.push({
      box: [
        Math.round(((y0 * step) / H) * 1000),
        Math.round(((x0 * step) / W) * 1000),
        Math.round((((y1 + 1) * step) / H) * 1000),
        Math.round((((x1 + 1) * step) / W) * 1000),
      ],
      heightPx,
      contrast: Math.round(contrast),
      confidence: Number(confidence.toFixed(2)),
      glyphs: line.length,
    });
  }
  return out;
}

/** 확신이 낮아 "OCR 이 놓쳤을 수 있다"고 봐야 하는 영역인가 (작은 글자·저대비·하단) */
export function isLowConfidenceRegion(r: TextLikeRegion): boolean {
  if (r.confidence < 0.6) return true;
  // 하단 15% 의 작은 글자 — 스펙·주의문구가 몰리는 자리라 판독이 특히 약하다
  if (r.box[0] >= 850 && r.heightPx < 20) return true;
  return false;
}

/**
 * 탐지된 문자 영역 중 "설명되지 않은" 것을 고른다.
 * 설명 = 번역 대상 박스 · 보존 목록 · 유지(워터마크/keep) 박스 중 하나가
 * 그 영역의 절반 이상을 덮는 것. 하나라도 남으면 VERIFIED 를 줄 수 없다.
 */
export function unexplainedTextRegions(regions: TextLikeRegion[], explained: NormBox[]): TextLikeRegion[] {
  return regions.filter((r) => {
    const ra = area(r.box);
    if (ra <= 0) return false;
    return !explained.some((e) => inter(r.box, e) >= ra * 0.5);
  });
}

/* ══════════════════════════════════════════════════════════════════
 * H3 — 영문·브랜드·숫자·모델코드 보존
 *
 * 패치 사각형은 문구 박스보다 크다(패드·확장). 그 안에 들어온 **번역 대상이
 * 아닌 장식 줄**은 모델 픽셀로 통째 갈리는데 이를 보는 검사가 없었다 —
 * numbersPreserved 는 원문(zh) 토큰만, renderedTextMatches 는 문구 박스와
 * 겹치는 줄만, newTextLines 는 "없던 줄 생성"만 본다. 장식 소실·변형은
 * 아무도 안 잡았다(2026-08-24 재현으로 확인).
 * ══════════════════════════════════════════════════════════════════ */

export interface PreservedItem {
  box: NormBox;
  text: string;
}

/**
 * 보존 목록 — 원본 판독 줄 중 번역 대상이 아니면서 라틴·숫자를 담은 것.
 * (브랜드·모델코드·용량 표기가 여기 들어온다)
 */
export function buildPreserveList(
  origLines: { box: NormBox; text: string }[],
  translateBoxes: NormBox[],
): PreservedItem[] {
  return origLines
    .filter((l) => {
      const t = l.text.trim();
      if (!t) return false;
      if (!/[A-Za-z0-9]/.test(t)) return false; // 라틴·숫자가 없으면 보존 대상 아님
      const la = area(l.box);
      if (la <= 0) return false;
      // 번역 대상과 겹치는 줄은 번역 경로가 책임진다 (겹침 안전성은 rectHitsPreserved 가 따로 본다)
      return !translateBoxes.some((b) => inter(l.box, b) >= la * 0.5);
    })
    .map((l) => ({ box: l.box, text: l.text.trim() }));
}

/** 패치 사각형이 보존 영역을 건드리는가 — 건드리면 그 후보는 쓸 수 없다 */
export function rectHitsPreserved(
  rect: { x0: number; y0: number; x1: number; y1: number },
  W: number,
  H: number,
  preserved: PreservedItem[],
): PreservedItem | null {
  const r: NormBox = [
    (rect.y0 / H) * 1000,
    (rect.x0 / W) * 1000,
    (rect.y1 / H) * 1000,
    (rect.x1 / W) * 1000,
  ];
  return preserved.find((p) => inter(r, p.box) > 0) ?? null;
}

/** 보존 영역 안의 픽셀이 원본과 다른 개수 — 0 이어야 한다 */
export function preservedPixelDiff(
  orig: Uint8Array | Uint8ClampedArray,
  out: Uint8Array | Uint8ClampedArray,
  W: number,
  H: number,
  preserved: PreservedItem[],
  tol = 0,
): number {
  let diff = 0;
  for (const p of preserved) {
    const y0 = Math.max(0, Math.floor((p.box[0] / 1000) * H));
    const x0 = Math.max(0, Math.floor((p.box[1] / 1000) * W));
    const y1 = Math.min(H, Math.ceil((p.box[2] / 1000) * H));
    const x1 = Math.min(W, Math.ceil((p.box[3] / 1000) * W));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * W + x) * 4;
        if (
          Math.abs(out[i] - orig[i]) > tol ||
          Math.abs(out[i + 1] - orig[i + 1]) > tol ||
          Math.abs(out[i + 2] - orig[i + 2]) > tol
        ) {
          diff++;
        }
      }
    }
  }
  return diff;
}

/**
 * 보존 목록이 완성본 판독에도 같은 내용·같은 자리로 남아 있는가.
 * 사라짐·글자 변형·자리 이동을 전부 잡는다.
 */
export function preservedTextIntact(
  preserved: PreservedItem[],
  outLines: { box: NormBox; text: string }[],
): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  for (const p of preserved) {
    const want = normText(p.text);
    const pa = area(p.box);
    const found = outLines.some((l) => {
      const t = normText(l.text);
      if (!t) return false;
      if (!(t.includes(want) || want.includes(t))) return false;
      // 같은 자리여야 한다 — 다른 곳에 같은 글자가 있다고 보존된 게 아니다.
      // 전체 채택 렌더는 판이 조금 흐르므로(reflow) 겹침이 없어도 중심이
      // 150‰(화면의 15%) 안이면 같은 자리로 본다 — 엉뚱한 곳으로 이동한 건 여전히 실격
      if (pa <= 0 || inter(p.box, l.box) >= pa * 0.3) return true;
      const dy = Math.abs((p.box[0] + p.box[2]) / 2 - (l.box[0] + l.box[2]) / 2);
      const dx = Math.abs((p.box[1] + p.box[3]) / 2 - (l.box[1] + l.box[3]) / 2);
      return dy <= 150 && dx <= 150;
    });
    if (!found) missing.push(p.text.slice(0, 30));
  }
  return { ok: missing.length === 0, missing };
}

/* ══════════════════════════════════════════════════════════════════
 * 전체 채택 렌더 검증 (2026-08-24 아키텍처 전환)
 *
 * 모델 전체 출력을 후보로 쓰면 한국어 길이 차이로 판이 다시 흘러(reflow)
 * **원본 좌표가 더 이상 유효하지 않다** — live10 실측: 번역은 정확한데
 * 좌표 기반 패치·검사가 전량 어긋났다. 그래서 완성본 검사는 좌표가 아니라
 * **글 내용**으로 한다: 확정 문구가 온전히 찍혔는가, 없던 문구가 생겼는가.
 * 픽셀 동일성 대신 "상품 정보 보존"이 관문이다 (운영 결정).
 * ══════════════════════════════════════════════════════════════════ */

/**
 * 완성본 판독 줄에서 확정 번역문과 맞는 줄을 찾는다 (좌표 무관).
 * 일치 기준은 기존 엄격 일치(renderedTextMatches)와 동일 — 공백·문장부호만 허용.
 * 정확 일치가 없으면, 기대 문구가 통째로 들어 있고 **허용 밖 글자가 없는** 줄
 * (extraTextInBox 통과)을 받는다 — OCR 이 이웃 장식과 한 줄로 읽는 경우.
 */
export function matchExpectedLine(
  expectedKo: string,
  zh: string,
  outLines: { box: NormBox; text: string }[],
): { text: string; box: NormBox } | null {
  for (const l of outLines) {
    if (renderedTextMatches(expectedKo, l.text)) return l;
  }
  const exp = forCompare(expectedKo);
  if (!exp) return null;
  for (const l of outLines) {
    const t = forCompare(l.text);
    if (t.includes(exp) && extraTextInBox(expectedKo, zh, l.text).ok) return l;
  }
  return null;
}

/**
 * 완성본에서 "있어선 안 되는" 줄 — 어떤 확정 문구와도 안 맞고, 원본 판독에도
 * 없던 줄. 모델이 지어낸 문구(도장·보증 문구 환각) 검출의 reflow 대응판.
 * 외국어 줄은 세지 않는다 — 그건 LEFTOVER(관문 교차 판독) 몫이다.
 */
export function unexpectedOutputLines(
  outLines: { box: NormBox; text: string }[],
  expected: { ko: string; zh: string }[],
  origLines: { text: string }[],
): { box: NormBox; text: string }[] {
  const origNorm = origLines.map((l) => normText(l.text)).filter(Boolean);
  return outLines.filter((l) => {
    const t = forCompare(l.text);
    if (!t) return false;
    // 의미 있는 글자 2자 미만은 티끌
    if ((l.text.match(/[가-힣㐀-䶿一-鿿A-Za-z]/g) ?? []).length < 2) return false;
    // 확정 문구와 맞는 줄인가 — 줄이 문구를 담거나, 문구가 줄을 담거나(OCR 이 쪼갠 경우)
    const matchesExpected = expected.some((e) => {
      const ek = forCompare(e.ko);
      if (!ek) return false;
      if (t.includes(ek) || ek.includes(t)) return true;
      return extraTextInBox(e.ko, e.zh, l.text).ok && forCompare(l.text).length > 0 && t.split("").some(() => true) && renderedTextMatches(e.ko, l.text);
    });
    if (matchesExpected) return false;
    // 원본에 이미 있던 줄(로고·장식·스펙)은 새 글자가 아니다
    const n = normText(l.text);
    if (origNorm.some((o) => o.includes(n) || n.includes(o))) return false;
    return true;
  });
}

/**
 * 제품 무결성 심사 요청문 — 원본과 번역 완성본 **두 장**을 주고 제품 사진이
 * 상품 정보 수준에서 같은지 심사시킨다. 글자는 번역돼 다른 게 정상이므로 무시.
 * 판 재배치(문구 위치·줄바꿈 변화)는 허용 — 상품이 달라 보이는 변화만 실격.
 */
export function buildProductIntegrityPrompt(opts: { leftoverTextIsNotChange?: boolean } = {}): string {
  // GIF 는 일부 문구를 원문 그대로 두는 일이 정상이다(움직이는 화면 위 등). 실측(2026-09-02 exp12):
  // 남은 중국어를 "제품 사진 내부의 미번역 텍스트"로 hard 판정해 PRODUCT_CHANGED 가 붙었다 —
  // 남은 글자는 잔류 관문(LEFTOVER)이 따로 잡으니 여기서는 글자를 전부 무시해야 한다.
  const leftover = opts.leftoverTextIsNotChange
    ? "\n번역되지 않고 **남은 외국어 글자**도 글자입니다 — 제품 변화가 아니므로 무시하세요(다른 검사가 잡습니다).\n"
    : "";
  return `같은 상품 상세 이미지의 원본(첫째 장)과 번역본(둘째 장)입니다. 두 장의 **제품 사진**을 비교하세요.

글자는 한국어로 번역되어 다른 것이 정상입니다 — 글자 내용·위치·줄바꿈 차이는 전부 무시하세요.${leftover}

hard (하나라도 있으면 ok:false — 상품이 달라 보이는 변화):
1. 제품의 **개수**가 다름 (사라지거나 늘어남)
2. 제품의 **형태·구조**가 다름 (모양·부품·버튼·구멍 등)
3. 제품·배경의 **색상**이 눈에 띄게 다름
4. 제품 사진·손·모델 등 구성 요소가 사라지거나 새로 생김
5. 배지·아이콘·로고 그림이 다른 그림으로 바뀜

무시할 것 (ok 에 영향 없음):
- 문구의 위치·크기·줄바꿈·글꼴
- 몇 픽셀 수준의 미세한 위치 차이
- 압축 노이즈

확실하지 않으면 ok:false 로 하세요.
JSON 하나만 출력: {"ok":true,"issues":[],"hard":[]} 또는 {"ok":false,"issues":["제품이 2개→1개"],"hard":["제품이 2개→1개"]}`;
}


/**
 * GIF 글자 띠 재생성본 육안 심사 프롬프트 — **그림을 보고** 판정한다.
 *
 * 왜 판독(transcribe)만으로는 부족한가: 실측(2026-09-01 마리아 GIF) 제목 띠가
 * "강력한 신축"을 두 겹으로 겹쳐 찍어 획이 뭉갰는데, 판독 모델은 그걸 정상
 * 문자열로 읽어냈다 — 글자 내용 검사는 전부 통과하고 깨진 그림이 채택됐다.
 * 겹침·뭉갬·덧댄 자국은 **모양의 문제**라 모양을 보는 눈이 있어야 잡힌다.
 *
 * 이 심사는 텍스트 모델(사실상 공짜)로 돈다 — 규칙 1: 싼 단계에서 막아
 * 비싼 이미지 단계의 재작업을 줄인다.
 */
export function buildBandQualityPrompt(expected: string[]): string {
  return `이미지는 상품 상세 이미지에서 **글자 부분만 잘라낸 띠**이며, 방금 한국어로 다시 그린 결과물입니다.
이 그림 자체의 **품질**만 보세요. 번역이 맞는지, 원문이 무엇이었는지는 판단하지 마세요.

여기 있어야 할 문구:
${expected.map((s, i) => `${i + 1}. ${s}`).join("\n")}

hard (하나라도 있으면 ok:false — 손님에게 내보낼 수 없는 상태):
1. 같은 글자가 **두 겹으로 겹쳐** 찍혀 획이 뭉개짐 (그림자·외곽선 효과는 정상)
2. 글자 획이 깨졌거나, 글자가 잘려 일부만 보임
3. 글자 위에 네모·띠·얼룩 같은 **덧댄 자국**이 있음
4. 읽을 수 없는 헛글자·깨진 글자가 섞임
5. 위 목록에 없는 글자가 새로 생김
6. 있어야 할 문구가 빠졌거나(자리가 비어 있음) 일부만 그려짐

무시할 것 (ok 에 영향 없음):
- 글꼴·자간·줄바꿈·글자 크기가 원본과 다른 것
- 배경 그림이 조금 다르게 그려진 것
- 압축 노이즈, 가장자리의 부드러운 경계

애매하면 ok:false 로 하세요 — 깨끗하지 않으면 원본을 유지하는 것이 기본입니다.
JSON 하나만 출력: {"ok":true,"issues":[],"hard":[]} 또는 {"ok":false,"issues":["제목이 겹쳐 찍힘"],"hard":["제목이 겹쳐 찍힘"]}`;
}

/**
 * 단일 verdict JSON 파싱 — 제품 무결성 심사처럼 "JSON 하나"를 받는 응답용.
 *
 * live11 실측 버그: 배열용 파서(jsonArrayOf)의 정규식 \[[\s\S]*\] 이 단일 객체
 * {"ok":false,"issues":[...],"hard":[...]} 에서 **issues 의 [ 부터 hard 의 ] 까지**를
 * 잘라 JSON.parse 예외를 냈고, fail-closed 라 렌더 5장 전부가 VERIFICATION_FAILED
 * 로 떨어졌다 (안전은 지켜졌지만 측정 무효). 형식이 어긋나면 null — 통과 아님.
 */
export function parseSingleVerdict(text: string): { ok: boolean; issues: string[]; hard: string[] } | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const v = parseMeaningVerdicts([JSON.parse(m[0])], 1);
    return v ? v[0] : null;
  } catch {
    return null;
  }
}

/**
 * 여러 줄 확정 문구 매칭 — 기대 문구가 개행을 담으면(예: "야외\n약 90dB")
 * 완성본 판독은 이를 **별개의 줄**로 돌려준다 (live11 #04·#06 실측: 전부 "미검출").
 * 줄 단위로 쪼개 각 조각이 어딘가에 엄격 일치로 존재해야 통과 — 기준은 그대로,
 * 개행 구조만 관대해진다.
 */
export function matchExpectedSegments(
  expectedKo: string,
  zh: string,
  outLines: { box: NormBox; text: string }[],
): { ok: boolean; seen: string } {
  const whole = matchExpectedLine(expectedKo, zh, outLines);
  if (whole) return { ok: true, seen: whole.text };
  const segs = expectedKo.split(/\n+/).map((s2) => s2.trim()).filter((s2) => forCompare(s2).length > 0);
  if (segs.length <= 1) return { ok: false, seen: "" };
  const seen: string[] = [];
  for (const seg of segs) {
    const m = matchExpectedLine(seg, zh, outLines);
    if (!m) return { ok: false, seen: seen.join(" ") };
    seen.push(m.text);
  }
  return { ok: true, seen: seen.join(" ") };
}

/**
 * 번역 후보 3개 중 고르기(GIF 처음 보는 문구) — 텍스트 호출 1회.
 * 실측(2026-09-02 exp12): 한 번에 하나만 받으면 8개 중 3개가 어색했다("1스틱 2기능",
 * "클리진동 체형왕복"). 후보를 받아 심사로 고르면 그런 답이 뽑힐 확률이 준다.
 */
export function buildCandidateJudgePrompt(items: { zh: string; candidates: string[]; budget: number }[]): string {
  const list = items
    .map((it, i) => `${i + 1}. 원문 "${it.zh}" (최대 ${it.budget}자)\n${it.candidates.map((c, j) => `   [${j}] ${c}`).join("\n")}`)
    .join("\n");
  return `중국 상품 상세페이지 문구의 한국어 번역 후보들입니다. 항목마다 **가장 알맞은 후보의 번호**(0부터)를 고르세요.

기준 (위가 우선):
1. 원문의 대상·부위·기능·숫자를 빠짐없이 담은 것
2. 한국 성인용품 도매몰 상세페이지 카피처럼 자연스러운 것 — 뒤가 잘린 꼴("여운이 남는"), 숫자 나열("1스틱 2기능"), 한자어 직역은 탈락
3. "최대 N자"(공백 포함) 안에 드는 것. 전부 넘으면 가장 짧은 것

${list}

입력과 같은 개수, 같은 순서의 번호 배열만 출력: [1, 0, 2]`;
}
