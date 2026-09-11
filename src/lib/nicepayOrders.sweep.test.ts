/**
 * 버려진 결제대기 주문 정리 — 실제 정리 함수를 통과시킨다.
 * 순수 판정(pendingRules)이 맞아도 DB 질의·취소 호출이 어긋나면 소용없다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface Row {
  id: string;
  status: string;
  paymentMethod: string;
  createdAt: Date;
  payment: { status: string } | null;
}

const state = { orders: [] as Row[], where: null as Record<string, unknown> | null };
const cancelled: string[] = [];
const audits: Record<string, unknown>[] = [];

vi.mock("@/lib/db", () => ({
  db: {
    order: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        state.where = where;
        const lt = (where.createdAt as { lt: Date }).lt;
        return state.orders.filter(
          (o) => o.status === where.status && o.paymentMethod === where.paymentMethod && o.createdAt < lt,
        );
      },
    },
  },
}));
vi.mock("@/lib/orderCancel", () => ({
  cancelOrderCore: async (id: string, _m: unknown, opts: { skipPgRefund?: boolean }) => {
    if (!opts?.skipPgRefund) throw new Error("정리는 skipPgRefund 로만 불러야 한다");
    if (id === "boom") throw new Error("돈이 나간 결제(PAID)는 환불 없이 취소할 수 없습니다");
    cancelled.push(id);
  },
}));
vi.mock("@/lib/nicepay", () => ({ cancelPayment: async () => ({ ok: true }) }));
vi.mock("@/lib/audit", () => ({ audit: async (a: Record<string, unknown>) => { audits.push(a); }, shortId: (s: string) => s }));

const { sweepAbandonedPendingOrders } = await import("./nicepayOrders");

const NOW = new Date("2026-09-11T12:00:00Z");
const min = (m: number) => new Date(NOW.getTime() - m * 60_000);
const row = (id: string, ageMin: number, pay: string | null, over: Partial<Row> = {}): Row => ({
  id, status: "PENDING_PAYMENT", paymentMethod: "NICEPAY", createdAt: min(ageMin),
  payment: pay === null ? null : { status: pay }, ...over,
});

beforeEach(() => {
  state.orders = [];
  cancelled.length = 0;
  audits.length = 0;
});

describe("sweepAbandonedPendingOrders", () => {
  it("30분 넘은 READY 주문을 취소하고 감사로그 한 줄을 남긴다", async () => {
    state.orders = [row("old", 45, "READY"), row("fresh", 5, "READY")];
    const n = await sweepAbandonedPendingOrders(NOW);
    expect(n).toBe(1);
    expect(cancelled).toEqual(["old"]);
    expect(audits).toHaveLength(1);
    expect(audits[0].action).toBe("PAYMENT_PENDING_SWEPT");
    expect(String(audits[0].summary)).toContain("1건");
  });

  it("DB 질의 자체가 결제대기·카드·30분 전으로 좁혀져 있다", async () => {
    await sweepAbandonedPendingOrders(NOW);
    expect(state.where?.status).toBe("PENDING_PAYMENT");
    expect(state.where?.paymentMethod).toBe("NICEPAY");
    expect((state.where?.createdAt as { lt: Date }).lt.toISOString()).toBe("2026-09-11T11:30:00.000Z");
  });

  /** 판정 규칙이 DB 질의 뒤에 한 번 더 걸린다 — 돈이 나갔을 수 있는 건 절대 안 넘긴다 */
  it("UNCERTAIN·PAID·CANCEL_FAILED 결제는 오래돼도 취소 경로에 넘기지 않는다", async () => {
    state.orders = [row("u", 999, "UNCERTAIN"), row("p", 999, "PAID"), row("cf", 999, "CANCEL_FAILED"), row("ok", 999, "READY")];
    const n = await sweepAbandonedPendingOrders(NOW);
    expect(cancelled).toEqual(["ok"]);
    expect(n).toBe(1);
  });

  it("한 건이 실패해도(그 사이 PAID 가 됨) 나머지는 계속 정리한다", async () => {
    state.orders = [row("a", 60, "READY"), row("boom", 60, "READY"), row("c", 60, "READY")];
    const n = await sweepAbandonedPendingOrders(NOW);
    expect(cancelled).toEqual(["a", "c"]);
    expect(n).toBe(2);
  });

  it("정리할 게 없으면 감사로그도 남기지 않는다", async () => {
    state.orders = [row("fresh", 1, "READY")];
    expect(await sweepAbandonedPendingOrders(NOW)).toBe(0);
    expect(audits).toHaveLength(0);
  });
});
