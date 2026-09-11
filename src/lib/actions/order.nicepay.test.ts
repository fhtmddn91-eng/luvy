/**
 * 카드 주문 생성 — Payment 행이 주문과 **같은 트랜잭션**에서 만들어지는지.
 *
 * 실사례(2026-09-11 리뷰): 재고 차감·포인트 사용·주문 생성은 트랜잭션 안이었는데
 * `db.payment.create` 는 커밋 **뒤에** 따로 돌았다. 그 사이 실패하면 주문은
 * PENDING_PAYMENT 로 남고 Payment 행이 없다 — 재고·포인트는 잠긴 채, 이전 주문 정리
 * (payment.status 로 거른다)에도 안 걸려 영영 안 풀린다. 이 테스트는 create 가
 * 트랜잭션 클라이언트에서 불리는지, 루트 db 에서 불리는지를 구분해 못 박는다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const calls = { rootPaymentCreate: 0, txPaymentCreate: 0, orderCreate: 0 };

/** 트랜잭션 클라이언트와 루트 db 를 다른 객체로 두어 어디서 불렸는지 구분한다 */
const tx = {
  order: {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      calls.orderCreate += 1;
      return { id: "ord1", ...data };
    },
  },
  payment: {
    create: async () => {
      calls.txPaymentCreate += 1;
      return {};
    },
  },
  cartItem: { deleteMany: async () => ({ count: 0 }) },
};

const db = {
  order: { findMany: async () => [] },
  payment: {
    create: async () => {
      calls.rootPaymentCreate += 1;
      return {};
    },
  },
  $transaction: async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
};

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/auth", () => ({
  requireApprovedUser: async () => ({ id: "u1", email: "u@x.com", companyName: "테스트", role: "MEMBER", status: "APPROVED" }),
  requireUser: async () => ({ id: "u1" }),
}));
vi.mock("@/lib/payments", () => ({
  buildOrderDraft: async () => ({
    ok: true,
    draft: {
      items: [{ productId: "p1", name: "상품", brand: "B", sku: "", optionName: "", optionId: "", unitPrice: 1000, listPrice: 1000, quantity: 1, lineTotal: 1000 }],
      subtotal: 1000, shippingFee: 3500, total: 4500, orderName: "상품", discountBp: 0, discountAmount: 0,
    },
  }),
}));
vi.mock("@/lib/stockOps", () => ({
  reserveStock: async () => undefined,
  linesFromOrderItems: (i: unknown[]) => i,
  InsufficientStockError: class extends Error {},
}));
vi.mock("@/lib/orderCancel", () => ({ cancelOrderCore: async () => undefined, RefundFailedError: class extends Error {} }));
vi.mock("@/lib/audit", () => ({ audit: async () => undefined, shortId: (s: string) => s }));
vi.mock("@/lib/nicepay", () => ({ isNicePayConfigured: () => true, NICEPAY_CLIENT_KEY: "R2_test" }));
vi.mock("@/lib/settings", () => ({ getPointPolicy: async () => ({ minUse: 1000, unit: 100, expiryMonths: 12 }) }));
vi.mock("@/lib/memberPoints", () => ({
  pointSummary: async () => ({ balance: 0, expiringSoon: 0 }),
  usePointsForOrder: async () => undefined,
  InsufficientPointsError: class extends Error {},
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ host: "luvyb2b.com" }) }));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/navigation", () => ({ redirect: () => undefined }));

const { createNicePayOrder } = await import("./order");

function form(): FormData {
  const fd = new FormData();
  fd.set("recipient", "홍길동");
  fd.set("phone", "01012345678");
  fd.set("postcode", "28000");
  fd.set("address", "충북 청주시 대로 1");
  fd.set("addressDetail", "");
  fd.set("paymentMethod", "NICEPAY");
  fd.set("pointsUsed", "0");
  return fd;
}

beforeEach(() => {
  calls.rootPaymentCreate = 0;
  calls.txPaymentCreate = 0;
  calls.orderCreate = 0;
});

describe("createNicePayOrder — Payment 는 주문과 한 트랜잭션이다", () => {
  it("Payment 행을 트랜잭션 클라이언트에서 만든다 (커밋 뒤 따로 만들지 않는다)", async () => {
    const r = await createNicePayOrder(form());
    expect(r.ok).toBe(true);
    expect(calls.orderCreate).toBe(1);
    expect(calls.txPaymentCreate).toBe(1);
    expect(calls.rootPaymentCreate).toBe(0);
  });

  it("결제창 호출값에 우리 채번 주문번호와 금액이 실린다", async () => {
    const r = await createNicePayOrder(form());
    if (!r.ok || r.paid) throw new Error("결제창 경로여야 한다");
    expect(r.window.orderId).toBe("luvy-ord1-1");
    expect(r.window.amount).toBe(4500);
    expect(r.window.clientId).toBe("R2_test");
  });
});
