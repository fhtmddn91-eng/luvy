/**
 * reserveStock — DB 없이 항상 도는 회귀 테스트.
 *
 * stockOps.test.ts 는 로컬 Postgres 가 있을 때만 돌아서(runIf) 기본 CI 에선
 * 전부 건너뛴다. 초과판매 방지·부족 시 전체 롤백은 소프트오픈의 핵심 보장이라
 * 여기서 가짜 트랜잭션(스냅샷 → 예외 시 원복)으로 같은 계약을 못 박는다.
 * 동시성(조건부 updateMany 경합)만은 진짜 DB가 필요해 stockOps.test.ts 에 남긴다.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { reserveStock, InsufficientStockError, type TxClient } from "./stockOps";

interface Row {
  id: string;
  trackStock: boolean;
  stock: number;
  name: string;
}

const state = {
  products: [] as Row[],
  options: [] as Row[],
};

/** where 의 id/trackStock/stock.gte 만 해석하는 최소 구현 */
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

const fakeTx = {
  product: stockTable(() => state.products),
  productOption: stockTable(() => state.options),
} as unknown as TxClient;

/** Prisma $transaction 의 계약을 흉내: 예외가 나면 그 안의 변경을 전부 되돌린다 */
async function inTransaction(fn: (tx: TxClient) => Promise<void>): Promise<void> {
  const snapshot = structuredClone({ products: state.products, options: state.options });
  try {
    await fn(fakeTx);
  } catch (e) {
    state.products = snapshot.products;
    state.options = snapshot.options;
    throw e;
  }
}

beforeEach(() => {
  state.products = [];
  state.options = [];
});

describe("reserveStock — 부족 시 전체 롤백", () => {
  it("재고가 부족하면 InsufficientStockError 를 던지고 아무것도 차감되지 않는다", async () => {
    state.products = [{ id: "p1", trackStock: true, stock: 3, name: "젤" }];

    await expect(
      inTransaction((tx) => reserveStock(tx, [{ productId: "p1", name: "젤", quantity: 5 }])),
    ).rejects.toThrow(InsufficientStockError);

    expect(state.products[0].stock).toBe(3);
  });

  it("여러 품목 중 하나만 부족해도 먼저 차감된 품목까지 원복된다", async () => {
    state.products = [
      { id: "p1", trackStock: true, stock: 100, name: "충분" },
      { id: "p2", trackStock: true, stock: 1, name: "부족" },
    ];

    await expect(
      inTransaction((tx) =>
        reserveStock(tx, [
          { productId: "p1", name: "충분", quantity: 10 },
          { productId: "p2", name: "부족", quantity: 5 },
        ]),
      ),
    ).rejects.toThrow(InsufficientStockError);

    // 먼저 성공한 p1 의 차감도 트랜잭션 롤백으로 돌아와야 한다
    expect(state.products[0].stock).toBe(100);
    expect(state.products[1].stock).toBe(1);
  });

  it("옵션 재고가 부족하면 옵션 이름을 붙여 알려주고 롤백한다", async () => {
    state.products = [{ id: "p1", trackStock: false, stock: 0, name: "진동기" }];
    state.options = [{ id: "o1", trackStock: true, stock: 2, name: "핑크" }];

    const run = inTransaction((tx) =>
      reserveStock(tx, [{ productId: "p1", name: "진동기", quantity: 3, optionId: "o1" }]),
    );

    await expect(run).rejects.toThrow(/핑크/);
    expect(state.options[0].stock).toBe(2);
  });
});

describe("reserveStock — 차감 위치", () => {
  it("옵션이 재고를 추적하면 옵션에서만 뺀다 (상품·옵션 동시 추적 이중 차감 금지)", async () => {
    state.products = [{ id: "p1", trackStock: true, stock: 5, name: "진동기" }];
    state.options = [{ id: "o1", trackStock: true, stock: 10, name: "핑크" }];

    await inTransaction((tx) =>
      reserveStock(tx, [{ productId: "p1", name: "진동기", quantity: 3, optionId: "o1" }]),
    );

    expect(state.options[0].stock).toBe(7);
    expect(state.products[0].stock).toBe(5); // 상품 쪽은 건드리지 않는다
  });

  it("옵션이 재고를 추적하지 않으면 상품에서 뺀다", async () => {
    state.products = [{ id: "p1", trackStock: true, stock: 5, name: "진동기" }];
    state.options = [{ id: "o1", trackStock: false, stock: 0, name: "핑크" }];

    await inTransaction((tx) =>
      reserveStock(tx, [{ productId: "p1", name: "진동기", quantity: 2, optionId: "o1" }]),
    );

    expect(state.products[0].stock).toBe(3);
    expect(state.options[0].stock).toBe(0);
  });

  it("재고 미추적 상품은 수량 제한 없이 통과한다", async () => {
    state.products = [{ id: "p1", trackStock: false, stock: 0, name: "카탈로그" }];

    await inTransaction((tx) =>
      reserveStock(tx, [{ productId: "p1", name: "카탈로그", quantity: 9999 }]),
    );

    expect(state.products[0].stock).toBe(0);
  });
});
