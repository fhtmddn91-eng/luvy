import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * 재고 차감/복원. 트랜잭션 클라이언트를 받아 주문 생성과 같은 원자 단위로 묶는다.
 *
 * 초과판매 방지의 핵심은 조건부 updateMany 이다.
 *   "재고가 요청 수량 이상인 행만" 감소시키고 영향받은 행 수를 확인하기 때문에,
 *   두 주문이 같은 순간에 마지막 재고를 노려도 한쪽만 성공한다.
 *   (읽고→판단하고→쓰는 방식은 그 사이에 다른 주문이 끼어들어 음수 재고가 된다)
 */

export type TxClient = Prisma.TransactionClient;

export interface StockLine {
  productId: string;
  name: string;
  quantity: number;
  /** 옵션별 재고를 쓰는 상품이면 옵션 id. 없으면 빈 문자열 */
  optionId?: string;
}

export class InsufficientStockError extends Error {
  constructor(public readonly items: string[]) {
    super(
      `재고가 부족합니다: ${items.join(", ")}. 장바구니 수량을 조정한 뒤 다시 시도해주세요.`,
    );
    this.name = "InsufficientStockError";
  }
}

/**
 * 주문 확정 시 재고 차감.
 * 재고를 추적하지 않는(trackStock=false) 상품은 건너뛴다.
 * 하나라도 부족하면 InsufficientStockError 를 던져 트랜잭션 전체를 되돌린다.
 */
export async function reserveStock(tx: TxClient, lines: StockLine[]): Promise<void> {
  const short: string[] = [];

  for (const line of lines) {
    if (line.quantity <= 0) continue;

    // 옵션이 재고를 추적하면 옵션에서 먼저 뺀다 — 상품 재고와 이중으로 빼면 안 된다
    if (line.optionId) {
      const opt = await tx.productOption.findUnique({
        where: { id: line.optionId },
        select: { trackStock: true, stock: true, name: true },
      });
      if (opt?.trackStock) {
        const taken = await tx.productOption.updateMany({
          where: { id: line.optionId, trackStock: true, stock: { gte: line.quantity } },
          data: { stock: { decrement: line.quantity } },
        });
        if (taken.count === 0) {
          short.push(`${line.name} (${opt.name}) (요청 ${line.quantity} / 재고 ${Math.max(0, opt.stock)})`);
        }
        continue;
      }
    }

    const res = await tx.product.updateMany({
      where: {
        id: line.productId,
        trackStock: true,
        stock: { gte: line.quantity },
      },
      data: { stock: { decrement: line.quantity } },
    });

    if (res.count === 0) {
      // 재고 미추적 상품이면 정상(차감 대상 아님), 추적 상품이면 부족
      const p = await tx.product.findUnique({
        where: { id: line.productId },
        select: { trackStock: true, stock: true },
      });
      if (p?.trackStock) {
        short.push(`${line.name} (요청 ${line.quantity} / 재고 ${Math.max(0, p.stock)})`);
      }
    }
  }

  if (short.length > 0) throw new InsufficientStockError(short);
}

/** 주문 취소·결제 실패 시 재고 원복. 추적 상품만 되돌린다. */
export async function restoreStock(tx: TxClient, lines: StockLine[]): Promise<void> {
  for (const line of lines) {
    if (line.quantity <= 0) continue;
    // 뺀 곳으로 되돌린다 — 옵션에서 뺐으면 옵션으로
    if (line.optionId) {
      const back = await tx.productOption.updateMany({
        where: { id: line.optionId, trackStock: true },
        data: { stock: { increment: line.quantity } },
      });
      if (back.count > 0) continue;
    }
    await tx.product.updateMany({
      where: { id: line.productId, trackStock: true },
      data: { stock: { increment: line.quantity } },
    });
  }
}

/** 주문의 품목을 재고 조작용 형태로 변환 */
export function linesFromOrderItems(
  items: { productId: string; name: string; quantity: number; optionId?: string }[],
): StockLine[] {
  return items.map((i) => ({
    productId: i.productId,
    name: i.name,
    quantity: i.quantity,
    optionId: i.optionId ?? "",
  }));
}
