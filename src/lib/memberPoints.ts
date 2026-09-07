import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { pointsFor, accrualBase } from "@/lib/points";
import { allocateFifo, expiresAtFor, dueLots, expiringSoon, type Lot } from "@/lib/pointLots";
import { gradeFor, promotedGrade } from "@/lib/grades";
import { PAID_STATUSES } from "@/lib/purchaseStats";
import { getPointPolicy } from "@/lib/settings";
import type { TxClient } from "@/lib/stockOps";

/**
 * 회원 등급·포인트 (운영자 요청서 2·3번 + 사용·만료·자동 승급, 2026-09-05).
 *
 * 불변식: `User.pointBalance == Σ ledger.amount == Σ lot.remaining`.
 * 원장(PointLedger)이 근거고 잔액은 캐시다 — 셋은 항상 같은 트랜잭션에서 움직인다.
 * 양수 행 하나가 묶음(lot)이고, 빼는 쪽(사용·차감·회수·만료)은 먼저 만료되는 묶음부터
 * 소진한다(pointLots.ts). 잔액은 음수가 되지 않는다.
 */

export const GRADE_CODES = ["BASIC", "SILVER", "GOLD"] as const;

export interface GradeRow {
  code: string;
  name: string;
  pointRateBp: number;
  threshold: number;
  /** 등급 기본 할인율(만분율) — lib/discount.ts */
  discountBp: number;
  sortOrder: number;
}

export const getGrades = cache(
  (): Promise<GradeRow[]> => db.memberGrade.findMany({ orderBy: { sortOrder: "asc" } }),
);

export const gradeName = (grades: GradeRow[], code: string): string =>
  grades.find((g) => g.code === code)?.name ?? code;

export class InsufficientPointsError extends Error {
  constructor(public readonly balance: number, public readonly requested: number) {
    super(`포인트가 부족합니다. (보유 ${balance.toLocaleString("ko-KR")}P, 요청 ${requested.toLocaleString("ko-KR")}P)`);
    this.name = "InsufficientPointsError";
  }
}

type Db = TxClient | typeof db;

/** 쓸 수 있는 묶음 — remaining>0 인 양수 행 */
async function openLots(tx: Db, userId: string): Promise<(Lot & { userId: string })[]> {
  const rows = await tx.pointLedger.findMany({ where: { userId, remaining: { gt: 0 } } });
  return rows.map((r) => ({ id: r.id, userId: r.userId, remaining: r.remaining, expiresAt: r.expiresAt, createdAt: r.createdAt }));
}

/** 양수 묶음 하나를 만든다 — 잔액도 같이 오른다. 만료일은 정책(개월)대로 */
export async function grantPoints(
  tx: Db,
  input: { userId: string; amount: number; kind: string; reason: string; createdBy: string; orderId?: string; now?: Date },
): Promise<void> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) return;
  const now = input.now ?? new Date();
  const { expiryMonths } = await getPointPolicy();
  await tx.pointLedger.create({
    data: {
      userId: input.userId,
      amount: input.amount,
      kind: input.kind,
      reason: input.reason,
      orderId: input.orderId,
      createdBy: input.createdBy,
      remaining: input.amount,
      expiresAt: expiresAtFor(now, expiryMonths),
      createdAt: now,
    },
  });
  await tx.user.update({ where: { id: input.userId }, data: { pointBalance: { increment: input.amount } } });
}

/**
 * 묶음에서 뺀다(사용·차감·회수). strict 면 부족할 때 예외를 던져 트랜잭션을 되돌리고,
 * 아니면 가용 잔액까지만 빼고 부족분(shortfall)을 돌려준다 — 회수용.
 */
export async function consumePoints(
  tx: Db,
  input: { userId: string; amount: number; kind: string; reason: string; createdBy: string; orderId?: string; strict?: boolean },
): Promise<{ consumed: number; shortfall: number }> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) return { consumed: 0, shortfall: 0 };
  const lots = await openLots(tx, input.userId);
  const { takes, shortfall } = allocateFifo(lots, input.amount);
  if (input.strict && shortfall > 0) {
    throw new InsufficientPointsError(lots.reduce((s, l) => s + l.remaining, 0), input.amount);
  }
  // 조건부 차감: 두 창에서 동시에 주문하면 위의 읽기가 낡을 수 있다(READ COMMITTED).
  // remaining >= take 일 때만 빼고, 안 되면 strict 는 예외(전체 롤백), 아니면 그 묶음을 건너뛴다.
  // 이 조건이 없으면 1,000P 묶음에서 800P 씩 두 번 빠져 −600 이 된다.
  let consumed = 0;
  let missed = shortfall;
  for (const t of takes) {
    const done = await tx.pointLedger.updateMany({
      where: { id: t.id, remaining: { gte: t.take } },
      data: { remaining: { decrement: t.take } },
    });
    if (done.count === 1) consumed += t.take;
    else if (input.strict) throw new InsufficientPointsError(lots.reduce((s, l) => s + l.remaining, 0) - consumed, input.amount);
    else missed += t.take;
  }
  if (consumed <= 0) return { consumed: 0, shortfall: missed };
  await tx.pointLedger.create({
    data: {
      userId: input.userId,
      amount: -consumed,
      kind: input.kind,
      reason: missed > 0 ? `${input.reason} (잔액 부족으로 ${missed.toLocaleString("ko-KR")}P 는 회수하지 못함)` : input.reason,
      orderId: input.orderId,
      createdBy: input.createdBy,
      remaining: 0,
      expiresAt: null,
    },
  });
  const bal = await tx.user.updateMany({
    where: { id: input.userId, pointBalance: { gte: consumed } },
    data: { pointBalance: { decrement: consumed } },
  });
  if (bal.count !== 1) {
    // 여기 오면 잔액과 묶음 합이 이미 어긋나 있다 — 더 망가뜨리지 말고 트랜잭션을 되돌린다
    throw new Error(`[points] 잔액 불변식 위반 user=${input.userId} consumed=${consumed}`);
  }
  return { consumed, shortfall: missed };
}

/** 만료 정리 — 지난 묶음마다 EXPIRE 행을 남기고 remaining 을 0 으로. 돌려주는 값은 소멸 합계 */
export async function expirePoints(tx: Db, userId: string, now = new Date()): Promise<number> {
  const due = dueLots(await openLots(tx, userId), now);
  let total = 0;
  for (const lot of due) {
    // 읽은 값 그대로일 때만 0 으로 — 그 사이 사용이 들어갔으면 이번엔 건너뛴다(다음 정리 때 잡힌다)
    const done = await tx.pointLedger.updateMany({ where: { id: lot.id, remaining: lot.remaining }, data: { remaining: 0 } });
    if (done.count !== 1) continue;
    await tx.pointLedger.create({
      data: {
        userId,
        amount: -lot.remaining,
        kind: "EXPIRE",
        reason: `${fmtDate(lot.createdAt)} 적립분 만료`,
        createdBy: "SYSTEM",
        remaining: 0,
        expiresAt: null,
        createdAt: now,
      },
    });
    total += lot.remaining;
  }
  if (total > 0) {
    const bal = await tx.user.updateMany({ where: { id: userId, pointBalance: { gte: total } }, data: { pointBalance: { decrement: total } } });
    if (bal.count !== 1) throw new Error(`[points] 만료 중 잔액 불변식 위반 user=${userId} total=${total}`);
  }
  return total;
}

/** 전체 회원 만료 정리 — 크론이 없어 어드민 목록·대시보드가 열릴 때 돌린다 */
export async function expireAllDuePoints(now = new Date()): Promise<number> {
  const due = await db.pointLedger.findMany({
    where: { remaining: { gt: 0 }, expiresAt: { not: null, lte: now } },
    select: { userId: true },
    distinct: ["userId"],
  });
  let total = 0;
  for (const { userId } of due) {
    total += await db.$transaction((tx) => expirePoints(tx, userId, now));
  }
  return total;
}

/** 잔액 요약 — 만료 정리 뒤의 잔액과 30일 내 소멸 예정 */
export async function pointSummary(userId: string, now = new Date()): Promise<{ balance: number; expiringSoon: number }> {
  await db.$transaction((tx) => expirePoints(tx, userId, now));
  const [user, lots] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { pointBalance: true } }),
    openLots(db, userId),
  ]);
  return { balance: user?.pointBalance ?? 0, expiringSoon: expiringSoon(lots, now, 30) };
}

/**
 * 주문 사용 — 주문 트랜잭션 안에서. 먼저 만료 정리를 하고 strict 로 뺀다:
 * 두 창에서 동시에 주문해도 잔액을 넘는 쪽은 예외로 전체가 롤백된다.
 */
export async function usePointsForOrder(tx: Db, input: { userId: string; orderId: string; amount: number; now?: Date }): Promise<void> {
  if (input.amount <= 0) return;
  await expirePoints(tx, input.userId, input.now);
  await consumePoints(tx, {
    userId: input.userId,
    amount: input.amount,
    kind: "USE",
    reason: "주문 결제에 사용",
    createdBy: input.userId,
    orderId: input.orderId,
    strict: true,
  });
}

/** 취소·결제실패 환급 — 새 묶음으로(만료는 환급일 + 정책). 주문당 한 번 */
export async function refundPointsForOrder(tx: Db, orderId: string, now = new Date()): Promise<number> {
  const used = await tx.pointLedger.findUnique({ where: { orderId_kind: { orderId, kind: "USE" } } });
  if (!used) return 0;
  const already = await tx.pointLedger.findUnique({ where: { orderId_kind: { orderId, kind: "REFUND" } } });
  if (already) return 0;
  const amount = -used.amount;
  await grantPoints(tx, { userId: used.userId, amount, kind: "REFUND", reason: "주문 취소로 사용 포인트 환급", createdBy: "SYSTEM", orderId, now });
  return amount;
}

/**
 * 배송완료 적립. 기준액 = 상품금액 − 사용 포인트(포인트로 산 부분엔 적립 없음) × 그 시점 등급 적립률.
 * 같은 주문은 한 번만((orderId, kind) unique). 0원이면 기록하지 않는다.
 * 자동 승급 평가(evaluateGradeFor)는 호출자가 이어서 부른다 — 결과를 감사 로그에 남기기 위해.
 */
export async function accruePointsForOrder(orderId: string, now = new Date()): Promise<number> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { userId: true, subtotal: true, pointsUsed: true, user: { select: { grade: { select: { pointRateBp: true, name: true } } } } },
  });
  if (!order) return 0;
  const amount = pointsFor(accrualBase(order.subtotal, order.pointsUsed), order.user.grade.pointRateBp);
  let granted = 0;
  if (amount > 0) {
    const already = await db.pointLedger.findUnique({ where: { orderId_kind: { orderId, kind: "ACCRUE" } } });
    if (!already) {
      await db.$transaction((tx) =>
        grantPoints(tx, {
          userId: order.userId,
          amount,
          kind: "ACCRUE",
          reason: `주문 배송완료 적립 (${order.user.grade.name} 등급)`,
          createdBy: "SYSTEM",
          orderId,
          now,
        }),
      );
      granted = amount;
    }
  }
  return granted;
}

/** 취소 회수 — 취소 트랜잭션 안에서. 가용 잔액까지만(음수 금지), 주문당 한 번 */
export async function reversePointsForOrder(tx: Db, orderId: string): Promise<number> {
  const accrued = await tx.pointLedger.findUnique({ where: { orderId_kind: { orderId, kind: "ACCRUE" } } });
  if (!accrued) return 0;
  const reversed = await tx.pointLedger.findUnique({ where: { orderId_kind: { orderId, kind: "REVERSE" } } });
  if (reversed) return 0;
  const { consumed } = await consumePoints(tx, {
    userId: accrued.userId,
    amount: accrued.amount,
    kind: "REVERSE",
    reason: "주문 취소로 적립 회수",
    createdBy: "SYSTEM",
    orderId,
  });
  return consumed;
}

/** 관리자 수동 지급(+)/차감(−). 차감은 잔액 안에서만 */
export async function adjustPoints(input: { userId: string; amount: number; reason: string; adminId: string }): Promise<{ error?: string; balance?: number }> {
  try {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: input.userId }, select: { pointBalance: true } });
      if (!user) return { error: "회원을 찾을 수 없습니다." };
      await expirePoints(tx, input.userId);
      if (input.amount > 0) {
        await grantPoints(tx, { userId: input.userId, amount: input.amount, kind: "ADJUST", reason: input.reason, createdBy: input.adminId });
      } else {
        await consumePoints(tx, { userId: input.userId, amount: -input.amount, kind: "ADJUST", reason: input.reason, createdBy: input.adminId, strict: true });
      }
      const after = await tx.user.findUnique({ where: { id: input.userId }, select: { pointBalance: true } });
      return { balance: after?.pointBalance ?? 0 };
    });
  } catch (e) {
    if (e instanceof InsufficientPointsError) return { error: `잔액(${e.balance.toLocaleString("ko-KR")}P)보다 많이 차감할 수 없습니다.` };
    throw e;
  }
}

/* ── 자동 승급 ───────────────────────────────────────────────────────────── */

/**
 * 누적 결제확인 구매금액으로 등급을 다시 본다. 올라가기만 한다. 수동 고정이면 건너뛴다.
 * 바뀌었으면 {from, to} 를 돌려준다 — 호출자가 감사 로그를 남긴다.
 */
export async function evaluateGradeFor(userId: string): Promise<{ from: string; to: string } | null> {
  const user = await db.user.findUnique({ where: { id: userId }, select: { gradeCode: true, gradeLocked: true } });
  if (!user || user.gradeLocked) return null;
  const grades = await getGrades();
  const spent = await db.order.aggregate({ where: { userId, status: { in: [...PAID_STATUSES] } }, _sum: { total: true } });
  const target = gradeFor(spent._sum.total ?? 0, grades);
  const next = promotedGrade(user.gradeCode, target, grades);
  if (next === user.gradeCode) return null;
  await db.user.update({ where: { id: userId }, data: { gradeCode: next } });
  return { from: user.gradeCode, to: next };
}

function fmtDate(d: Date): string {
  return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
}
