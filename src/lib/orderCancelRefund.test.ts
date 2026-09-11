/**
 * 취소 → PG 환불 관문 회귀 테스트.
 *
 * 실사례(2026-09-11 코드 리뷰, 실경로로 재현): 나이스페이 환불이 한 번 실패하면
 * Payment 가 CANCEL_FAILED 로 남고 운영자가 다시 누르게 되어 있다. 그런데 재시도는
 * `status === "PAID"` 관문을 통과하지 못해 **환불 없이** 주문만 취소하고 재고를
 * 되돌렸다 — 손님 돈은 그대로인데 장부는 취소. 환불 실패를 복구하려고 만든 길이
 * 그 사고를 내고 있었다. 이 파일은 그 관문을 못 박는다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state = {
  order: { id: "ord1", status: "PAID" },
  payment: null as null | { orderId: string; paymentId: string; pgTxId: string | null; channel: string; status: string },
  paymentUpdates: [] as Record<string, unknown>[],
  stock: 0,
};

const fakeDb = {
  product: {
    findUnique: async () => ({ id: "p1", trackStock: true, stock: state.stock, name: "상품" }),
    updateMany: async ({ data }: { data: { stock: { increment?: number } } }) => {
      state.stock += data.stock.increment ?? 0;
      return { count: 1 };
    },
  },
  productOption: { findUnique: async () => null, updateMany: async () => ({ count: 0 }) },
  order: {
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: { status: string } }) => {
      const notIn = (where.status as { notIn?: string[] }).notIn;
      if (notIn?.includes(state.order.status)) return { count: 0 };
      state.order.status = data.status;
      return { count: 1 };
    },
  },
  orderItem: { findMany: async () => [{ productId: "p1", name: "상품", quantity: 3, optionId: "" }] },
  payment: {
    findUnique: async () => state.payment,
    update: async ({ data }: { data: Record<string, unknown> }) => {
      state.paymentUpdates.push(data);
      if (state.payment && typeof data.status === "string") state.payment.status = data.status;
      return state.payment;
    },
  },
  pointLedger: { findUnique: async () => null, findMany: async () => [], create: async () => ({}), updateMany: async () => ({ count: 0 }) },
  user: { update: async () => ({}), updateMany: async () => ({ count: 1 }) },
  setting: { findMany: async () => [] },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeDb),
};

const cancelPayment = vi.fn<() => Promise<{ ok: true } | { ok: false; code: string; message: string }>>();
vi.mock("@/lib/db", () => ({ db: fakeDb }));
vi.mock("@/lib/nicepay", () => ({ cancelPayment }));

const { cancelOrderCore, RefundFailedError } = await import("./orderCancel");

const paid = (status: string) => ({
  orderId: "ord1", paymentId: "luvy-ord1-1", pgTxId: "tid1", channel: "nicepay", status,
});

beforeEach(() => {
  state.order = { id: "ord1", status: "PAID" };
  state.payment = null;
  state.paymentUpdates = [];
  state.stock = 0;
  cancelPayment.mockReset();
  cancelPayment.mockResolvedValue({ ok: true });
});

describe("cancelOrderCore — 환불 관문", () => {
  it("PAID 주문 취소는 환불을 부르고, 성공하면 취소·재고복원까지 간다", async () => {
    state.payment = paid("PAID");
    await cancelOrderCore("ord1", { by: "ADMIN", reason: "테스트" });
    expect(cancelPayment).toHaveBeenCalledTimes(1);
    expect(state.order.status).toBe("CANCELED");
    expect(state.stock).toBe(3);
    expect(state.payment?.status).toBe("CANCELED");
  });

  it("환불이 실패하면 주문·재고는 건드리지 않고 CANCEL_FAILED 로 표시한다", async () => {
    state.payment = paid("PAID");
    cancelPayment.mockResolvedValue({ ok: false, code: "E999", message: "PG 오류" });
    await expect(cancelOrderCore("ord1", { by: "ADMIN", reason: "테스트" })).rejects.toBeInstanceOf(RefundFailedError);
    expect(state.order.status).toBe("PAID");
    expect(state.stock).toBe(0);
    expect(state.payment?.status).toBe("CANCEL_FAILED");
  });

  /** 이게 사고 지점이었다 */
  it("CANCEL_FAILED 재시도는 환불을 **다시** 부른다 — 건너뛰고 취소하면 돈만 뺏는다", async () => {
    state.payment = paid("CANCEL_FAILED");
    await cancelOrderCore("ord1", { by: "ADMIN", reason: "재시도" });
    expect(cancelPayment).toHaveBeenCalledTimes(1);
    expect(state.order.status).toBe("CANCELED");
    expect(state.payment?.status).toBe("CANCELED");
    expect(state.stock).toBe(3);
  });

  it("CANCEL_FAILED 재시도도 실패하면 여전히 취소하지 않는다", async () => {
    state.payment = paid("CANCEL_FAILED");
    cancelPayment.mockResolvedValue({ ok: false, code: "E999", message: "또 실패" });
    await expect(cancelOrderCore("ord1", { by: "ADMIN", reason: "재시도" })).rejects.toBeInstanceOf(RefundFailedError);
    expect(state.order.status).toBe("PAID");
    expect(state.stock).toBe(0);
  });

  /**
   * skipPgRefund 는 "돈이 안 나갔다/PG 가 이미 취소했다"를 호출자가 아는 경우다.
   * 그런데 PAID·CANCEL_FAILED 는 돈이 나가 있다 — 그걸 건너뛰면 같은 사고다.
   * (failNicePayPayment 가 웹훅과 경합해 PAID 인 결제에 skip 으로 들어올 수 있다)
   */
  it("돈이 나간 결제(PAID·CANCEL_FAILED)에는 skipPgRefund 가 있어도 취소하지 않는다", async () => {
    for (const s of ["PAID", "CANCEL_FAILED"]) {
      state.order = { id: "ord1", status: "PAID" };
      state.payment = paid(s);
      state.stock = 0;
      await expect(
        cancelOrderCore("ord1", { by: "SYSTEM", reason: "인증 실패" }, { skipPgRefund: true }),
      ).rejects.toBeInstanceOf(RefundFailedError);
      expect(cancelPayment).not.toHaveBeenCalled();
      expect(state.order.status).toBe("PAID");
      expect(state.stock).toBe(0);
    }
  });

  it("READY(미승인) 결제는 환불 없이 취소한다 — 돈이 안 나갔다", async () => {
    state.order = { id: "ord1", status: "PENDING_PAYMENT" };
    state.payment = paid("READY");
    await cancelOrderCore("ord1", { by: "SYSTEM", reason: "정리" }, { skipPgRefund: true });
    expect(cancelPayment).not.toHaveBeenCalled();
    expect(state.order.status).toBe("CANCELED");
    expect(state.stock).toBe(3);
  });

  it("이미 PG 가 취소한 결제(CANCELED)는 다시 부르지 않는다", async () => {
    state.payment = paid("CANCELED");
    await cancelOrderCore("ord1", { by: "PG", reason: "나이스페이 취소" }, { skipPgRefund: true });
    expect(cancelPayment).not.toHaveBeenCalled();
    expect(state.order.status).toBe("CANCELED");
  });
});
