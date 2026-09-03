import "server-only";
import { hasHanzi, type OcrBox } from "./imageTranslate";

/**
 * 승인 문구 기억 — 사람이 승인한 번역을 재렌더·같은 상품 다른 그림의 출발점으로 쓴다.
 *
 * 실측(2026-09-02 마리아 0018): 이 자산은 VERIFIED 문구 "인체공학 설계"를 갖고 있는데
 * 「다시 만들기」가 매번 처음부터 번역해 "인체 마스터"를 만들었고, 다음 실행은
 * 「强震蜜豆」 재번역이 의미 검수에 두 번 걸려 렌더까지 못 갔다(호출 0회). 번역
 * 모델은 실행마다 답이 달라지지만 승인 문구는 이미 사람이 본 것이다.
 * 운영 DB 조사: 같은 상품 안에서 반복되는 문구 14.1%(412/2922), 그중 승인본 60건.
 *
 * 우선순위: 자기 자신의 확정 문구(ocrData) → 같은 상품 VERIFIED 그림의 확정 문구.
 * 후보(candidateOcr)·검수 대기 문구는 승인이 아니므로 쓰지 않는다.
 */
export function phraseMemoryFrom(
  rows: { id: string; productId?: string; translateStatus: string | null; ocrData: string | null; candidateOcr: string | null }[],
  selfId: string,
  opts: { productId?: string } = {},
): Map<string, string> {
  const out = new Map<string, string>();
  const parse = (json: string | null): { zh: string; ko: string }[] => {
    if (!json) return [];
    let boxes: unknown;
    try {
      boxes = JSON.parse(json);
    } catch {
      return [];
    }
    if (!Array.isArray(boxes)) return [];
    const pairs: { zh: string; ko: string }[] = [];
    for (const raw of boxes as Partial<OcrBox>[]) {
      const zh = typeof raw.zh === "string" ? raw.zh.trim() : "";
      const ko = typeof raw.ko === "string" ? raw.ko.trim() : "";
      if (!zh || !ko) continue;
      if ((raw.mode ?? "translate") !== "translate") continue; // keep·erase 는 번역이 아니다
      if (ko === zh || hasHanzi(ko)) continue; // 에코·한자 잔존은 승인 문구가 아니다
      pairs.push({ zh, ko });
    }
    return pairs;
  };
  const addFirst = (json: string | null) => {
    for (const { zh, ko } of parse(json)) if (!out.has(zh)) out.set(zh, ko);
  };
  // ① 자기 확정 문구 ② 같은 상품의 VERIFIED 문구
  const self = rows.find((r) => r.id === selfId);
  addFirst(self?.ocrData ?? null);
  for (const r of rows) {
    if (r.id === selfId || r.translateStatus !== "VERIFIED") continue;
    if (opts.productId !== undefined && r.productId !== opts.productId) continue;
    addFirst(r.ocrData);
  }
  // ③ 카탈로그 전체 — 상품끼리 번역이 갈리면 더 많이 승인된 쪽. 「防水设计」「智能加温」 같은
  //    문구는 공급처가 달라도 같다(운영 DB: 같은 상품 안 반복 14%, 상품 간은 그 이상).
  const votes = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (r.id === selfId || r.translateStatus !== "VERIFIED") continue;
    if (opts.productId !== undefined && r.productId === opts.productId) continue;
    for (const { zh, ko } of parse(r.ocrData)) {
      if (out.has(zh)) continue;
      const v = votes.get(zh) ?? new Map<string, number>();
      v.set(ko, (v.get(ko) ?? 0) + 1);
      votes.set(zh, v);
    }
  }
  for (const [zh, v] of votes) {
    let best = "", n = 0;
    for (const [ko, c] of v) if (c > n) { best = ko; n = c; }
    if (best) out.set(zh, best);
  }
  return out;
}
