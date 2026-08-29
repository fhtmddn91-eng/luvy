/**
 * 목록 페이지네이션 계산 (어드민 상품 목록 등).
 *
 * 실사례(2026-08-31 피드백): 수집 상품이 늘어 목록이 한 페이지에 전부 떠서,
 * 상품을 하나 등록하고 돌아올 때마다 하염없이 스크롤해야 했다.
 *
 * 입력은 주소창에서 온다 — 사람이 고칠 수 있는 값이므로 전부 방어한다:
 * 범위 밖 페이지는 끝으로 붙이고, 허용 밖 페이지 크기는 기본값으로 되돌린다
 * (안 그러면 ?per=10000 으로 전체를 당겨 페이지네이션이 무의미해진다).
 */

/** 운영자가 고를 수 있는 페이지 크기 — 첫 값이 기본값 */
export const PER_PAGE_CHOICES = [20, 50] as const;

export interface PageCalc {
  /** 1 이상, pages 이하로 보정된 현재 페이지 */
  page: number;
  /** 전체 페이지 수 (최소 1 — 빈 목록도 1페이지 화면은 있다) */
  pages: number;
  skip: number;
  take: number;
}

export function paginate(totalCount: number, rawPage: number, rawPer: number): PageCalc {
  const take = (PER_PAGE_CHOICES as readonly number[]).includes(rawPer)
    ? rawPer
    : PER_PAGE_CHOICES[0];
  const pages = Math.max(1, Math.ceil(totalCount / take));
  const wanted = Number.isFinite(rawPage) ? Math.floor(rawPage) : 1;
  const page = Math.min(pages, Math.max(1, wanted));
  return { page, pages, skip: (page - 1) * take, take };
}

/**
 * 하단에 표시할 페이지 번호 목록 — 현재 페이지 앞뒤 2개 + 양끝.
 * 사이가 벌어진 곳은 화면에서 "…" 으로 그린다 (연속하지 않는 이웃 번호 사이).
 */
export function pageWindow(pages: number, current: number): number[] {
  const keep = new Set<number>([1, pages]);
  for (let p = current - 2; p <= current + 2; p++) {
    if (p >= 1 && p <= pages) keep.add(p);
  }
  return [...keep].sort((a, b) => a - b);
}
