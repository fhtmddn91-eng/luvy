/**
 * 회원별 구매금액 집계 (운영자 요청서 1번, 2026-09-05) — 순수 함수.
 *
 * "구매금액"은 **결제가 확인된 주문**만 센다. 무통장 접수됨은 돈이 아직 안 들어온
 * 상태라 빠진다(대시보드 매출은 접수됨을 포함해 더 크다 — 의도된 차이).
 * 주는 월요일 시작(한국 관행). 빈 기간도 0 으로 채운다 — 표가 끊기면 "이 달에
 * 주문이 없었다"와 "집계가 빠졌다"를 구분할 수 없다.
 */

export const PAID_STATUSES = ["PAID", "PREPARING", "SHIPPED", "DELIVERED"] as const;

export type Period = "all" | "month" | "week" | "today";
export type BucketView = "month" | "week" | "day";

export interface PurchaseRow {
  label: string;
  count: number;
  total: number;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** 그 주 월요일 0시 — 일요일(getDay 0)은 6일 전이 월요일 */
function startOfWeek(d: Date): Date {
  const day = startOfDay(d);
  const back = (day.getDay() + 6) % 7;
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - back);
}

/** 목록 기간 탭의 시작 시각. 전체·모르는 값은 null(조건 없음) */
export function periodStart(period: string, now: Date): Date | null {
  switch (period as Period) {
    case "today":
      return startOfDay(now);
    case "week":
      return startOfWeek(now);
    case "month":
      return new Date(now.getFullYear(), now.getMonth(), 1);
    default:
      return null;
  }
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** 상세 화면의 월·주·일 표 — 최신 칸이 먼저. 월 12 · 주 12 · 일 30 */
export function bucketOrders(
  orders: { createdAt: Date; total: number }[],
  view: BucketView,
  now: Date,
): PurchaseRow[] {
  const starts: { start: Date; end: Date; label: string }[] = [];
  if (view === "month") {
    for (let i = 0; i < 12; i++) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      starts.push({ start, end, label: `${start.getFullYear()}.${pad2(start.getMonth() + 1)}` });
    }
  } else if (view === "week") {
    const thisWeek = startOfWeek(now);
    for (let i = 0; i < 12; i++) {
      const start = new Date(thisWeek.getFullYear(), thisWeek.getMonth(), thisWeek.getDate() - 7 * i);
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
      starts.push({ start, end, label: `${pad2(start.getMonth() + 1)}.${pad2(start.getDate())} 주` });
    }
  } else {
    const today = startOfDay(now);
    for (let i = 0; i < 30; i++) {
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
      starts.push({ start, end, label: `${pad2(start.getMonth() + 1)}.${pad2(start.getDate())}` });
    }
  }
  return starts.map(({ start, end, label }) => {
    let count = 0;
    let total = 0;
    for (const o of orders) {
      if (o.createdAt >= start && o.createdAt < end) {
        count++;
        total += o.total;
      }
    }
    return { label, count, total };
  });
}
