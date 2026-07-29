import type { Prisma } from "@prisma/client";
import { ORDER_STATUS } from "@/lib/orderStatus";

/**
 * 어드민 주문 목록/CSV 가 공유하는 검색 조건.
 * 목록에서 보고 있는 것과 내려받는 것이 항상 같아야 하므로 한 곳에서 만든다.
 */
export interface OrderFilter {
  status: string; // "ALL" 또는 주문 상태 코드
  q: string;
  from: string; // YYYY-MM-DD (비어 있으면 무시)
  to: string;
}

export function parseOrderFilter(sp: {
  status?: string;
  q?: string;
  from?: string;
  to?: string;
}): OrderFilter {
  const status = sp.status && ORDER_STATUS[sp.status] ? sp.status : "ALL";
  return {
    status,
    q: (sp.q ?? "").trim().slice(0, 80),
    from: isDate(sp.from) ? sp.from! : "",
    to: isDate(sp.to) ? sp.to! : "",
  };
}

// 형식 + 실존 날짜 검증 (2026-13-99 같은 값이 Invalid Date 로 DB까지 가지 않게)
const isDate = (s?: string): s is string =>
  !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(`${s}T00:00:00`).getTime());

export function orderWhere(f: OrderFilter): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {};
  if (f.status !== "ALL") where.status = f.status;

  if (f.q) {
    where.OR = [
      // 주문번호는 화면에 대문자 8자리로 보여주므로 소문자로 되돌려 비교
      { id: { contains: f.q.toLowerCase() } },
      { recipient: { contains: f.q } },
      { trackingNo: { contains: f.q.replace(/[\s-]/g, "").toUpperCase() } },
      { user: { companyName: { contains: f.q } } },
      { user: { email: { contains: f.q } } },
    ];
  }

  if (f.from || f.to) {
    where.createdAt = {};
    if (f.from) where.createdAt.gte = new Date(`${f.from}T00:00:00+09:00`);
    // to 는 그날을 포함해야 하므로 다음 날 0시 미만으로 잡는다
    if (f.to) {
      const end = new Date(`${f.to}T00:00:00+09:00`);
      end.setDate(end.getDate() + 1);
      where.createdAt.lt = end;
    }
  }

  return where;
}

/** 필터를 쿼리스트링으로 되돌린다 (탭 이동·CSV 링크에서 검색 조건 유지) */
export function filterQuery(f: OrderFilter, overrides: Partial<OrderFilter> = {}): string {
  const merged = { ...f, ...overrides };
  const p = new URLSearchParams();
  if (merged.status !== "ALL") p.set("status", merged.status);
  if (merged.q) p.set("q", merged.q);
  if (merged.from) p.set("from", merged.from);
  if (merged.to) p.set("to", merged.to);
  const s = p.toString();
  return s ? `?${s}` : "";
}
