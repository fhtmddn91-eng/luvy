/**
 * 포인트 원장 서비스 — 가짜 DB 로 불변식을 못 박는다:
 *   User.pointBalance == Σ ledger.amount == Σ lot.remaining
 * 돈이 걸린 자리라(2026-09-05 "고객 불만은 운영자가 물어낸다") 경계 사례를 전부 돌린다.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

interface LedgerRow {
  id: string;
  userId: string;
  amount: number;
  kind: string;
  reason: string;
  orderId?: string | null;
  createdBy: string;
  remaining: number;
  expiresAt: Date | null;
  createdAt: Date;
}

const state = {
  ledger: [] as LedgerRow[],
  users: new Map<string, { pointBalance: number; gradeCode: string; gradeLocked: boolean; subtotal?: number }>(),
  orders: new Map<string, { userId: string; subtotal: number; pointsUsed: number; total: number }>(),
  policy: { minUse: 1000, unit: 100, expiryMonths: 12 },
  seq: 0,
};

const matchWhere = (row: LedgerRow, where: Record<string, unknown>): boolean => {
  if (where.orderId_kind) {
    const ok = where.orderId_kind as { orderId: string; kind: string };
    return row.orderId === ok.orderId && row.kind === ok.kind;
  }
  if (where.userId !== undefined && row.userId !== where.userId) return false;
  if (where.kind !== undefined && row.kind !== where.kind) return false;
  const rem = where.remaining as { gt?: number } | undefined;
  if (rem?.gt !== undefined && !(row.remaining > rem.gt)) return false;
  const exp = where.expiresAt as { lte?: Date; not?: null } | undefined;
  if (exp?.lte !== undefined && !(row.expiresAt !== null && row.expiresAt <= exp.lte)) return false;
  if (exp && "not" in exp && exp.not === null && row.expiresAt === null) return false;
  return true;
};

const fakeDb = {
  pointLedger: {
    findUnique: async ({ where }: { where: Record<string, unknown> }) => state.ledger.find((r) => matchWhere(r, where)) ?? null,
    findMany: async ({ where }: { where: Record<string, unknown> }) => state.ledger.filter((r) => matchWhere(r, where)),
    create: async ({ data }: { data: Omit<LedgerRow, "id" | "createdAt"> & { createdAt?: Date } }) => {
      const row: LedgerRow = { id: `l${++state.seq}`, createdAt: data.createdAt ?? new Date(2026, 8, 5), ...data } as LedgerRow;
      state.ledger.push(row);
      return row;
    },
    update: async ({ where, data }: { where: { id: string }; data: { remaining: { decrement: number } | number } }) => {
      const row = state.ledger.find((r) => r.id === where.id)!;
      row.remaining = typeof data.remaining === "number" ? data.remaining : row.remaining - data.remaining.decrement;
      return row;
    },
    /** 조건부 갱신 — 운영 DB 처럼 where 가 안 맞으면 count 0 */
    updateMany: async ({ where, data }: { where: { id: string; remaining?: number | { gte: number } }; data: { remaining: { decrement: number } | number } }) => {
      const row = state.ledger.find((r) => r.id === where.id);
      if (!row) return { count: 0 };
      if (typeof where.remaining === "number" && row.remaining !== where.remaining) return { count: 0 };
      if (typeof where.remaining === "object" && row.remaining < where.remaining.gte) return { count: 0 };
      row.remaining = typeof data.remaining === "number" ? data.remaining : row.remaining - data.remaining.decrement;
      return { count: 1 };
    },
  },
  user: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const u = state.users.get(where.id);
      return u ? { id: where.id, ...u, grade: { pointRateBp: 100, name: "우수" } } : null;
    },
    update: async ({ where, data }: { where: { id: string }; data: { pointBalance?: { increment?: number; decrement?: number }; gradeCode?: string } }) => {
      const u = state.users.get(where.id)!;
      if (data.pointBalance) u.pointBalance += (data.pointBalance.increment ?? 0) - (data.pointBalance.decrement ?? 0);
      if (data.gradeCode) u.gradeCode = data.gradeCode;
      return { id: where.id, ...u };
    },
    updateMany: async ({ where, data }: { where: { id: string; pointBalance?: { gte: number } }; data: { pointBalance: { decrement: number } } }) => {
      const u = state.users.get(where.id);
      if (!u) return { count: 0 };
      if (where.pointBalance && u.pointBalance < where.pointBalance.gte) return { count: 0 };
      u.pointBalance -= data.pointBalance.decrement;
      return { count: 1 };
    },
  },
  order: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const o = state.orders.get(where.id);
      if (!o) return null;
      const u = state.users.get(o.userId)!;
      return { ...o, user: { grade: { pointRateBp: 100, name: "우수" } , gradeLocked: u.gradeLocked, gradeCode: u.gradeCode } };
    },
    aggregate: async () => ({ _sum: { total: 0 } }),
  },
  memberGrade: { findMany: async () => [] },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(fakeDb),
};

vi.mock("server-only", () => ({}));
vi.mock("react", () => ({ cache: (f: unknown) => f }));
vi.mock("@/lib/db", () => ({ db: fakeDb }));
vi.mock("@/lib/settings", () => ({ getPointPolicy: async () => state.policy }));

const svc = await import("./memberPoints");

const balance = (u: string) => state.users.get(u)!.pointBalance;
const sumAmount = (u: string) => state.ledger.filter((r) => r.userId === u).reduce((s, r) => s + r.amount, 0);
const sumRemaining = (u: string) => state.ledger.filter((r) => r.userId === u).reduce((s, r) => s + r.remaining, 0);
const invariant = (u: string) => {
  expect(sumAmount(u)).toBe(balance(u));
  expect(sumRemaining(u)).toBe(balance(u));
};
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

beforeEach(() => {
  state.ledger = [];
  state.users = new Map([["u1", { pointBalance: 0, gradeCode: "BASIC", gradeLocked: false }]]);
  state.orders = new Map();
  state.policy = { minUse: 1000, unit: 100, expiryMonths: 12 };
  state.seq = 0;
});

describe("grantPoints — 양수 묶음", () => {
  it("적립하면 잔액·원장·remaining 이 같이 오르고 만료일은 정책대로", async () => {
    await svc.grantPoints(fakeDb as never, { userId: "u1", amount: 500, kind: "ACCRUE", reason: "t", createdBy: "SYSTEM", now: d(2026, 9, 5) });
    expect(balance("u1")).toBe(500);
    expect(state.ledger[0]).toMatchObject({ remaining: 500, expiresAt: d(2027, 9, 5) });
    invariant("u1");
  });
  it("정책 0 이면 만료 없음", async () => {
    state.policy.expiryMonths = 0;
    await svc.grantPoints(fakeDb as never, { userId: "u1", amount: 500, kind: "ADJUST", reason: "t", createdBy: "a", now: d(2026, 9, 5) });
    expect(state.ledger[0].expiresAt).toBeNull();
  });
});

describe("consumePoints — 먼저 만료되는 묶음부터", () => {
  beforeEach(async () => {
    await svc.grantPoints(fakeDb as never, { userId: "u1", amount: 300, kind: "ACCRUE", reason: "a", createdBy: "SYSTEM", now: d(2026, 1, 1) });
    await svc.grantPoints(fakeDb as never, { userId: "u1", amount: 500, kind: "ACCRUE", reason: "b", createdBy: "SYSTEM", now: d(2026, 3, 1) });
  });
  it("700 을 쓰면 1월분 300 전부 + 3월분 400 (3월분 100 남음)", async () => {
    const r = await svc.consumePoints(fakeDb as never, { userId: "u1", amount: 700, kind: "USE", reason: "주문", createdBy: "u1", orderId: "o1" });
    expect(r).toEqual({ consumed: 700, shortfall: 0 });
    expect(state.ledger[0].remaining).toBe(0);
    expect(state.ledger[1].remaining).toBe(100);
    expect(state.ledger[2]).toMatchObject({ kind: "USE", amount: -700, remaining: 0, orderId: "o1" });
    expect(balance("u1")).toBe(100);
    invariant("u1");
  });
  it("잔액보다 많이 쓰려 하면 strict 모드는 예외, 아무것도 안 바뀐다", async () => {
    await expect(
      svc.consumePoints(fakeDb as never, { userId: "u1", amount: 900, kind: "USE", reason: "주문", createdBy: "u1", strict: true }),
    ).rejects.toBeInstanceOf(svc.InsufficientPointsError);
    expect(balance("u1")).toBe(800);
    expect(state.ledger).toHaveLength(2);
    invariant("u1");
  });
  it("느슨한 모드(회수)는 가용 잔액까지만 빼고 부족분을 알린다 — 잔액이 음수가 되지 않는다", async () => {
    const r = await svc.consumePoints(fakeDb as never, { userId: "u1", amount: 900, kind: "REVERSE", reason: "회수", createdBy: "SYSTEM" });
    expect(r).toEqual({ consumed: 800, shortfall: 100 });
    expect(balance("u1")).toBe(0);
    invariant("u1");
  });
  it("0 을 쓰면 아무 기록도 남기지 않는다", async () => {
    const r = await svc.consumePoints(fakeDb as never, { userId: "u1", amount: 0, kind: "USE", reason: "", createdBy: "u1" });
    expect(r).toEqual({ consumed: 0, shortfall: 0 });
    expect(state.ledger).toHaveLength(2);
  });
});

describe("consumePoints — 동시 주문 경합", () => {
  it("낡은 읽기로 두 번 빼려 해도 묶음이 음수가 되지 않는다 — 두 번째는 예외로 롤백", async () => {
    await svc.grantPoints(fakeDb as never, { userId: "u1", amount: 1000, kind: "ACCRUE", reason: "a", createdBy: "SYSTEM", now: d(2026, 1, 1) });
    // 두 주문이 같은 잔액(1000)을 읽은 상황을 흉내 낸다: findMany 가 낡은 사본을 돌려준다
    const stale = state.ledger.map((r) => ({ ...r }));
    const realFindMany = fakeDb.pointLedger.findMany;
    fakeDb.pointLedger.findMany = async () => stale.map((r) => ({ ...r }));
    try {
      await svc.consumePoints(fakeDb as never, { userId: "u1", amount: 800, kind: "USE", reason: "1", createdBy: "u1", strict: true });
      await expect(
        svc.consumePoints(fakeDb as never, { userId: "u1", amount: 800, kind: "USE", reason: "2", createdBy: "u1", strict: true }),
      ).rejects.toBeInstanceOf(svc.InsufficientPointsError);
    } finally {
      fakeDb.pointLedger.findMany = realFindMany;
    }
    expect(state.ledger[0].remaining).toBe(200);
    expect(balance("u1")).toBe(200);
    invariant("u1");
  });
});

describe("expirePoints — 만료 정리", () => {
  it("지난 묶음의 remaining 만큼 EXPIRE 를 남기고 잔액을 내린다", async () => {
    await svc.grantPoints(fakeDb as never, { userId: "u1", amount: 300, kind: "ACCRUE", reason: "a", createdBy: "SYSTEM", now: d(2025, 6, 1) }); // 만료 2026-06-01
    await svc.grantPoints(fakeDb as never, { userId: "u1", amount: 500, kind: "ACCRUE", reason: "b", createdBy: "SYSTEM", now: d(2026, 3, 1) });
    await svc.consumePoints(fakeDb as never, { userId: "u1", amount: 100, kind: "USE", reason: "", createdBy: "u1" }); // 6월분에서 100
    const expired = await svc.expirePoints(fakeDb as never, "u1", d(2026, 9, 5));
    expect(expired).toBe(200);
    expect(state.ledger.find((r) => r.kind === "EXPIRE")).toMatchObject({ amount: -200, remaining: 0 });
    expect(balance("u1")).toBe(500);
    invariant("u1");
  });
  it("두 번 돌려도 두 번 빠지지 않는다", async () => {
    await svc.grantPoints(fakeDb as never, { userId: "u1", amount: 300, kind: "ACCRUE", reason: "a", createdBy: "SYSTEM", now: d(2025, 6, 1) });
    await svc.expirePoints(fakeDb as never, "u1", d(2026, 9, 5));
    const again = await svc.expirePoints(fakeDb as never, "u1", d(2026, 9, 5));
    expect(again).toBe(0);
    expect(balance("u1")).toBe(0);
    invariant("u1");
  });
});

describe("주문 사용 → 환급 (취소·결제실패)", () => {
  beforeEach(async () => {
    await svc.grantPoints(fakeDb as never, { userId: "u1", amount: 5000, kind: "ACCRUE", reason: "a", createdBy: "SYSTEM", now: d(2026, 1, 1) });
    state.orders.set("o1", { userId: "u1", subtotal: 20_000, pointsUsed: 3000, total: 20_000 });
  });
  it("환급은 새 묶음으로, 만료는 환급일 + 정책", async () => {
    await svc.usePointsForOrder(fakeDb as never, { userId: "u1", orderId: "o1", amount: 3000 });
    expect(balance("u1")).toBe(2000);
    const refunded = await svc.refundPointsForOrder(fakeDb as never, "o1", d(2026, 9, 5));
    expect(refunded).toBe(3000);
    expect(balance("u1")).toBe(5000);
    expect(state.ledger.find((r) => r.kind === "REFUND")).toMatchObject({ amount: 3000, remaining: 3000, expiresAt: d(2027, 9, 5) });
    invariant("u1");
  });
  it("환급은 주문당 한 번", async () => {
    await svc.usePointsForOrder(fakeDb as never, { userId: "u1", orderId: "o1", amount: 3000 });
    await svc.refundPointsForOrder(fakeDb as never, "o1", d(2026, 9, 5));
    const again = await svc.refundPointsForOrder(fakeDb as never, "o1", d(2026, 9, 6));
    expect(again).toBe(0);
    expect(balance("u1")).toBe(5000);
    invariant("u1");
  });
  it("쓴 적 없는 주문은 환급하지 않는다", async () => {
    expect(await svc.refundPointsForOrder(fakeDb as never, "o1", d(2026, 9, 5))).toBe(0);
    expect(balance("u1")).toBe(5000);
  });
});

describe("배송완료 적립 → 취소 회수", () => {
  it("적립 기준은 상품금액 − 사용 포인트", async () => {
    state.orders.set("o1", { userId: "u1", subtotal: 100_000, pointsUsed: 30_000, total: 73_000 });
    const got = await svc.accruePointsForOrder("o1", d(2026, 9, 5));
    expect(got).toBe(700); // 70,000 × 1%
    expect(balance("u1")).toBe(700);
    invariant("u1");
  });
  it("회수는 가용 잔액까지만 — 이미 써서 모자라면 사유에 남긴다", async () => {
    state.orders.set("o1", { userId: "u1", subtotal: 100_000, pointsUsed: 0, total: 100_000 });
    await svc.accruePointsForOrder("o1", d(2026, 9, 5)); // +1000
    await svc.consumePoints(fakeDb as never, { userId: "u1", amount: 600, kind: "USE", reason: "", createdBy: "u1", strict: true });
    const reversed = await svc.reversePointsForOrder(fakeDb as never, "o1");
    expect(reversed).toBe(400);
    expect(balance("u1")).toBe(0);
    expect(state.ledger.find((r) => r.kind === "REVERSE")?.reason).toContain("600");
    invariant("u1");
  });
});
