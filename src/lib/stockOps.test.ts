import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { reserveStock, restoreStock, InsufficientStockError } from "./stockOps";

/**
 * 초과판매 방지는 재고 관리의 가장 중요한 보장이므로 실제 DB로 검증한다.
 * (조건부 updateMany 없이 읽고→판단→쓰기로 구현하면 이 테스트가 깨진다)
 *
 * 로컬 Postgres 가 없으면 조용히 건너뛴다.
 */
const db = new PrismaClient();
let dbUp = false;

beforeAll(async () => {
  try {
    await db.$queryRaw`SELECT 1`;
    dbUp = true;
  } catch {
    dbUp = false;
  }
});

afterAll(async () => {
  await db.$disconnect();
});

async function makeProduct(stock: number, trackStock = true) {
  return db.product.create({
    data: {
      name: `[테스트] 재고 ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      brand: "TEST",
      categorySlug: "men",
      description: "재고 테스트용",
      basePrice: 1000,
      status: "HIDDEN",
      trackStock,
      stock,
      priceTiers: { create: [{ minQty: 1, unitPrice: 1000 }] },
    },
  });
}

describe.runIf(process.env.DATABASE_URL)("reserveStock — 동시성", () => {
  it("동시에 들어온 주문이 재고를 초과해 팔리지 않는다", async () => {
    if (!dbUp) return;
    const p = await makeProduct(10);
    const lines = [{ productId: p.id, name: p.name, quantity: 4 }];

    // 4개씩 5건 동시 요청 → 최대 2건만 성공해야 한다
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () =>
        db.$transaction(async (tx) => {
          await reserveStock(tx, lines);
        }),
      ),
    );

    const ok = results.filter((r) => r.status === "fulfilled").length;
    const after = await db.product.findUnique({
      where: { id: p.id },
      select: { stock: true },
    });

    // 핵심: 재고가 음수로 가지 않고, 팔린 수량 + 남은 재고 = 최초 재고
    expect(after!.stock).toBeGreaterThanOrEqual(0);
    expect(ok * 4 + after!.stock).toBe(10);
    expect(ok).toBeLessThanOrEqual(2);

    await db.product.delete({ where: { id: p.id } });
  });

  it("재고가 부족하면 InsufficientStockError 를 던지고 아무것도 차감하지 않는다", async () => {
    if (!dbUp) return;
    const p = await makeProduct(3);

    await expect(
      db.$transaction(async (tx) => {
        await reserveStock(tx, [{ productId: p.id, name: p.name, quantity: 5 }]);
      }),
    ).rejects.toThrow(InsufficientStockError);

    const after = await db.product.findUnique({ where: { id: p.id }, select: { stock: true } });
    expect(after!.stock).toBe(3); // 그대로

    await db.product.delete({ where: { id: p.id } });
  });

  it("여러 상품 중 하나만 부족해도 전체가 롤백된다", async () => {
    if (!dbUp) return;
    const enough = await makeProduct(100);
    const short = await makeProduct(1);

    await expect(
      db.$transaction(async (tx) => {
        await reserveStock(tx, [
          { productId: enough.id, name: enough.name, quantity: 10 },
          { productId: short.id, name: short.name, quantity: 5 },
        ]);
      }),
    ).rejects.toThrow(InsufficientStockError);

    // 먼저 차감됐던 상품도 트랜잭션 롤백으로 원복되어야 한다
    const a = await db.product.findUnique({ where: { id: enough.id }, select: { stock: true } });
    const b = await db.product.findUnique({ where: { id: short.id }, select: { stock: true } });
    expect(a!.stock).toBe(100);
    expect(b!.stock).toBe(1);

    await db.product.deleteMany({ where: { id: { in: [enough.id, short.id] } } });
  });

  it("재고 미추적 상품은 수량 제한 없이 통과한다", async () => {
    if (!dbUp) return;
    const p = await makeProduct(0, false);

    await db.$transaction(async (tx) => {
      await reserveStock(tx, [{ productId: p.id, name: p.name, quantity: 9999 }]);
    });

    const after = await db.product.findUnique({ where: { id: p.id }, select: { stock: true } });
    expect(after!.stock).toBe(0); // 차감 대상이 아니므로 변화 없음

    await db.product.delete({ where: { id: p.id } });
  });
});

describe.runIf(process.env.DATABASE_URL)("restoreStock", () => {
  it("취소 시 재고를 되돌린다", async () => {
    if (!dbUp) return;
    const p = await makeProduct(10);
    const lines = [{ productId: p.id, name: p.name, quantity: 4 }];

    await db.$transaction(async (tx) => reserveStock(tx, lines));
    expect((await db.product.findUnique({ where: { id: p.id } }))!.stock).toBe(6);

    await db.$transaction(async (tx) => restoreStock(tx, lines));
    expect((await db.product.findUnique({ where: { id: p.id } }))!.stock).toBe(10);

    await db.product.delete({ where: { id: p.id } });
  });

  it("재고 미추적 상품에는 영향을 주지 않는다", async () => {
    if (!dbUp) return;
    const p = await makeProduct(0, false);
    await db.$transaction(async (tx) =>
      restoreStock(tx, [{ productId: p.id, name: p.name, quantity: 50 }]),
    );
    expect((await db.product.findUnique({ where: { id: p.id } }))!.stock).toBe(0);
    await db.product.delete({ where: { id: p.id } });
  });
});
