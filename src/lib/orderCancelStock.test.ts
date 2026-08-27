/**
 * 취소 → 재고 복원 회귀 테스트.
 *
 * 실사례(2026-08-27 발견): 주문 품목을 읽을 때 `optionId` 를 빼고 select 해서,
 * 옵션에서 뺀 재고가 옵션으로 돌아오지 않았다. 상품·옵션이 둘 다 재고를 추적하면
 * 뺀 적 없는 상품 재고가 늘어나 **팔 물건이 없는데 재고가 있다고 표시**됐다.
 *
 * 그래서 이 테스트는 stockOps 순수 함수가 아니라 **실제 취소 경로**(cancelOrderCore)를
 * 통과시킨다 — select 가 다시 좁아지면 여기서 깨져야 한다.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

interface Row {
  id: string;
  trackStock: boolean;
  stock: number;
  name: string;
}
interface ItemRow {
  orderId: string;
  productId: string;
  name: string;
  quantity: number;
  optionId: string;
}

const state = {
  products: [] as Row[],
  options: [] as Row[],
  items: [] as ItemRow[],
  orders: [] as { id: string; status: string }[],
  payment: null as { orderId: string; paymentId: string; status: string } | null,
};

/** where 의 id/trackStock/stock.gte/status.notIn 만 해석하는 최소 구현 */
function stockTable(rows: () => Row[]) {
  return {
    findUnique: async ({ where }: { where: { id: string } }) =>
      rows().find((x) => x.id === where.id) ?? null,
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const r = rows().find((x) => x.id === where.id);
      if (!r) return { count: 0 };
      if (where.trackStock === true && !r.trackStock) return { count: 0 };
      const gte = (where.stock as { gte?: number } | undefined)?.gte;
      if (gte !== undefined && r.stock < gte) return { count: 0 };
      const s = data.stock as { decrement?: number; increment?: number };
      if (s.decrement) r.stock -= s.decrement;
      if (s.increment) r.stock += s.increment;
      return { count: 1 };
    },
  };
}

const fakeDb = {
  product: stockTable(() => state.products),
  productOption: stockTable(() => state.options),
  order: {
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, string> }) => {
      const o = state.orders.find((x) => x.id === where.id);
      if (!o) return { count: 0 };
      const notIn = (where.status as { notIn?: string[] } | undefined)?.notIn;
      if (notIn?.includes(o.status)) return { count: 0 };
      o.status = data.status;
      return { count: 1 };
    },
  },
  orderItem: {
    /**
     * select 를 **실제로 존중한다** — 이게 이 테스트의 핵심이다.
     * 운영 코드가 optionId 를 안 고르면 여기서도 안 돌려주므로 버그가 재현된다.
     */
    findMany: async ({ where, select }: { where: { orderId: string }; select: Record<string, boolean> }) =>
      state.items
        .filter((i) => i.orderId === where.orderId)
        .map((i) => Object.fromEntries(Object.keys(select).map((k) => [k, i[k as keyof ItemRow]]))),
  },
  payment: {
    findUnique: async () => state.payment,
    update: async () => state.payment,
  },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeDb),
};

vi.mock("@/lib/db", () => ({ db: fakeDb }));
vi.mock("@/lib/portone", () => ({ cancelPortOnePayment: vi.fn() }));

const { cancelOrderCore } = await import("./orderCancel");

const META = { by: "ADMIN", reason: "테스트" };

beforeEach(() => {
  state.orders = [{ id: "ord1", status: "RECEIVED" }];
  state.payment = null;
  state.items = [];
  state.products = [];
  state.options = [];
});

describe("cancelOrderCore — 옵션 재고 복원", () => {
  it("옵션에서 뺀 재고는 옵션으로 돌아온다", async () => {
    state.products = [{ id: "p1", trackStock: false, stock: 0, name: "진동기" }];
    state.options = [{ id: "o1", trackStock: true, stock: 7, name: "핑크" }]; // 10 중 3 차감된 상태
    state.items = [{ orderId: "ord1", productId: "p1", name: "진동기", quantity: 3, optionId: "o1" }];

    await cancelOrderCore("ord1", META);

    expect(state.options[0].stock).toBe(10);
    expect(state.products[0].stock).toBe(0); // 엉뚱한 곳으로 가지 않는다
  });

  it("상품·옵션이 모두 재고 추적이어도 상품 재고가 부풀지 않는다", async () => {
    // 실사례의 최악 케이스 — 판 적 없는 재고가 상품 쪽에 생겼다
    state.products = [{ id: "p1", trackStock: true, stock: 5, name: "진동기" }];
    state.options = [{ id: "o1", trackStock: true, stock: 7, name: "핑크" }];
    state.items = [{ orderId: "ord1", productId: "p1", name: "진동기", quantity: 3, optionId: "o1" }];

    await cancelOrderCore("ord1", META);

    expect(state.options[0].stock).toBe(10); // 뺀 곳으로 정확히
    expect(state.products[0].stock).toBe(5); // 안 뺀 곳은 그대로
  });

  it("옵션 없는 상품은 상품 재고로 돌아온다", async () => {
    state.products = [{ id: "p1", trackStock: true, stock: 6, name: "젤" }];
    state.items = [{ orderId: "ord1", productId: "p1", name: "젤", quantity: 4, optionId: "" }];

    await cancelOrderCore("ord1", META);

    expect(state.products[0].stock).toBe(10);
  });

  it("재고 미추적 상품은 건드리지 않는다", async () => {
    state.products = [{ id: "p1", trackStock: false, stock: 0, name: "카탈로그" }];
    state.items = [{ orderId: "ord1", productId: "p1", name: "카탈로그", quantity: 2, optionId: "" }];

    await cancelOrderCore("ord1", META);

    expect(state.products[0].stock).toBe(0);
  });

  it("이미 취소된 주문을 다시 취소해도 재고가 두 번 늘지 않는다", async () => {
    state.orders = [{ id: "ord1", status: "CANCELED" }];
    state.options = [{ id: "o1", trackStock: true, stock: 7, name: "핑크" }];
    state.products = [{ id: "p1", trackStock: false, stock: 0, name: "진동기" }];
    state.items = [{ orderId: "ord1", productId: "p1", name: "진동기", quantity: 3, optionId: "o1" }];

    await cancelOrderCore("ord1", META);

    expect(state.options[0].stock).toBe(7); // 조건부 claim 이 막는다
  });

  it("여러 품목이 각자 뺀 곳으로 돌아간다", async () => {
    state.products = [
      { id: "p1", trackStock: false, stock: 0, name: "진동기" },
      { id: "p2", trackStock: true, stock: 1, name: "젤" },
    ];
    state.options = [{ id: "o1", trackStock: true, stock: 7, name: "핑크" }];
    state.items = [
      { orderId: "ord1", productId: "p1", name: "진동기", quantity: 3, optionId: "o1" },
      { orderId: "ord1", productId: "p2", name: "젤", quantity: 2, optionId: "" },
    ];

    await cancelOrderCore("ord1", META);

    expect(state.options[0].stock).toBe(10);
    expect(state.products[1].stock).toBe(3);
    expect(state.products[0].stock).toBe(0);
  });
});
