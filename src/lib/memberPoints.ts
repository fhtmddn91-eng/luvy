import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";
import { pointsFor } from "@/lib/points";
import type { TxClient } from "@/lib/stockOps";

/**
 * 회원 등급·포인트 (운영자 요청서 2·3번, 2026-09-05).
 *
 * 원장(PointLedger)이 근거고 User.pointBalance 는 캐시다 — 둘은 항상 같은
 * 트랜잭션에서 움직인다. 잔액만 갱신하고 원장을 빠뜨리면 나중에 "왜 이 액수인지"를
 * 설명할 수 없고, 원장만 쓰고 잔액을 안 고치면 목록 숫자가 거짓이 된다.
 */

export const GRADE_CODES = ["BASIC", "SILVER", "GOLD"] as const;

export interface GradeRow {
  code: string;
  name: string;
  pointRateBp: number;
  sortOrder: number;
}

/** 등급 목록 (정렬순). 같은 요청 안에서 여러 화면이 불러도 쿼리는 한 번 */
export const getGrades = cache(
  (): Promise<GradeRow[]> => db.memberGrade.findMany({ orderBy: { sortOrder: "asc" } }),
);

export const gradeName = (grades: GradeRow[], code: string): string =>
  grades.find((g) => g.code === code)?.name ?? code;

/** 원장 한 줄 + 잔액 갱신을 한 트랜잭션 안에서. 호출자가 tx 를 넘긴다 */
async function writeLedger(
  tx: TxClient,
  row: { userId: string; amount: number; kind: string; reason: string; orderId?: string; createdBy: string },
): Promise<void> {
  await tx.pointLedger.create({ data: row });
  await tx.user.update({ where: { id: row.userId }, data: { pointBalance: { increment: row.amount } } });
}

/**
 * 배송완료 적립. 기준액은 상품금액(subtotal, 배송비 제외) × 그 시점 등급의 적립률.
 * 같은 주문에 두 번 쌓이지 않는다 — (orderId, kind) unique 가 두 번째를 거부하므로
 * 여기서 먼저 찾아보고 있으면 조용히 끝낸다. 0원이면 기록하지 않는다.
 * 실패해도 주문 상태 변경은 이미 끝난 뒤다 — 호출자가 예외를 삼키고 로그만 남긴다.
 */
export async function accruePointsForOrder(orderId: string): Promise<number> {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: { userId: true, subtotal: true, user: { select: { grade: { select: { pointRateBp: true, name: true } } } } },
  });
  if (!order) return 0;
  const amount = pointsFor(order.subtotal, order.user.grade.pointRateBp);
  if (amount <= 0) return 0;

  const already = await db.pointLedger.findUnique({ where: { orderId_kind: { orderId, kind: "ACCRUE" } } });
  if (already) return 0;

  await db.$transaction((tx) =>
    writeLedger(tx, {
      userId: order.userId,
      amount,
      kind: "ACCRUE",
      reason: `주문 배송완료 적립 (${order.user.grade.name} 등급)`,
      orderId,
      createdBy: "SYSTEM",
    }),
  );
  return amount;
}

/**
 * 취소 회수 — 취소 트랜잭션 안에서 부른다. 적립 기록이 없으면 아무것도 안 한다.
 * 잔액이 이미 다른 데 쓰여 부족해도 회수는 한다(음수 허용) — 받을 근거가 사라진 포인트다.
 */
export async function reversePointsForOrder(tx: TxClient, orderId: string): Promise<number> {
  const accrued = await tx.pointLedger.findUnique({ where: { orderId_kind: { orderId, kind: "ACCRUE" } } });
  if (!accrued) return 0;
  const reversed = await tx.pointLedger.findUnique({ where: { orderId_kind: { orderId, kind: "REVERSE" } } });
  if (reversed) return 0;
  await writeLedger(tx, {
    userId: accrued.userId,
    amount: -accrued.amount,
    kind: "REVERSE",
    reason: "주문 취소로 적립 회수",
    orderId,
    createdBy: "SYSTEM",
  });
  return accrued.amount;
}

/** 관리자 수동 지급(+)/차감(−). 잔액이 음수가 되는 차감은 거부한다 */
export async function adjustPoints(input: {
  userId: string;
  amount: number;
  reason: string;
  adminId: string;
}): Promise<{ error?: string; balance?: number }> {
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id: input.userId }, select: { pointBalance: true } });
    if (!user) return { error: "회원을 찾을 수 없습니다." };
    if (user.pointBalance + input.amount < 0) {
      return { error: `잔액(${user.pointBalance.toLocaleString("ko-KR")}P)보다 많이 차감할 수 없습니다.` };
    }
    await writeLedger(tx, {
      userId: input.userId,
      amount: input.amount,
      kind: "ADJUST",
      reason: input.reason,
      createdBy: input.adminId,
    });
    return { balance: user.pointBalance + input.amount };
  });
}
