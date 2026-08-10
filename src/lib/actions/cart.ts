"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession, requireUser, requireApprovedUser } from "@/lib/auth";
import { getMoq, hasPrice, type Tier } from "@/lib/pricing";
import { clampToStock, isSoldOut } from "@/lib/stock";
import { isOptionSoldOut, optionMaxQty, sellableOptions } from "@/lib/options";

const MAX_QTY = 100_000; // 상한 (정수 오버플로/오입력 방지)

export async function addToCart(
  productId: string,
  quantity: number,
  optionId = "",
): Promise<void> {
  const user = await requireApprovedUser();
  const product = await db.product.findUnique({
    where: { id: productId },
    include: { priceTiers: true, options: true },
  });
  if (!product) return;
  if (isSoldOut(product)) return; // 품절 상품은 담기지 않는다
  // 단가가 아직 0인 수집 상품 — 담기면 그대로 0원 주문이 된다
  if (!hasPrice(product.priceTiers as Tier[])) return;

  // 옵션이 있는 상품은 반드시 옵션을 골라야 한다 (없이 담으면 뭘 보낼지 알 수 없다)
  const live = sellableOptions(product.options);
  const option = optionId ? live.find((o) => o.id === optionId) : undefined;
  if (live.length > 0 && !option) return;
  if (live.length === 0 && optionId) return;
  if (option && isOptionSoldOut(option, product)) return;

  const moq = getMoq(product.priceTiers as Tier[]);
  const key = { userId: user.id, productId, optionId: option?.id ?? "" };

  // 이미 담긴 수량까지 합해 재고를 넘지 않도록 한다
  const existing = await db.cartItem.findUnique({
    where: { userId_productId_optionId: key },
  });
  const desired = (existing?.quantity ?? 0) + (Math.floor(quantity) || moq);
  const qty = Math.min(
    clampToStock(desired, moq, product, MAX_QTY),
    optionMaxQty(option, product, MAX_QTY),
  );
  if (qty <= 0) return;

  await db.cartItem.upsert({
    where: { userId_productId_optionId: key },
    create: { ...key, quantity: qty },
    update: { quantity: qty },
  });

  revalidatePath("/cart");
  revalidatePath("/", "layout"); // 헤더 뱃지
}

/** 옵션별 수량을 한 번에 담는다 — 색상별로 몇 개씩 주문하는 게 도매의 기본 */
export async function addOptionsToCart(
  productId: string,
  picks: { optionId: string; quantity: number }[],
): Promise<void> {
  for (const p of picks) {
    if (p.quantity > 0) await addToCart(productId, p.quantity, p.optionId);
  }
}

export async function updateCartQty(itemId: string, quantity: number): Promise<void> {
  const user = await requireUser();
  const item = await db.cartItem.findUnique({
    where: { id: itemId },
    include: { product: { include: { priceTiers: true, options: true } } },
  });
  if (!item || item.userId !== user.id) return;

  const option = item.optionId
    ? item.product.options.find((o) => o.id === item.optionId)
    : undefined;
  const moq = getMoq(item.product.priceTiers as Tier[]);
  const qty = Math.min(
    clampToStock(quantity, moq, item.product, MAX_QTY),
    optionMaxQty(option, item.product, MAX_QTY),
  );

  if (qty <= 0) {
    // 재고가 사라진 상품은 장바구니에서 제거해 결제 단계에서 막히지 않게 한다
    await db.cartItem.delete({ where: { id: itemId } });
  } else {
    await db.cartItem.update({ where: { id: itemId }, data: { quantity: qty } });
  }
  revalidatePath("/cart");
  revalidatePath("/", "layout");
}

export async function removeCartItem(itemId: string): Promise<void> {
  const user = await requireUser();
  const item = await db.cartItem.findUnique({ where: { id: itemId } });
  if (!item || item.userId !== user.id) return;

  await db.cartItem.delete({ where: { id: itemId } });
  revalidatePath("/cart");
  revalidatePath("/", "layout");
}

export async function getCartCount(): Promise<number> {
  const user = await getSession();
  if (!user) return 0;
  const items = await db.cartItem.findMany({ where: { userId: user.id }, select: { quantity: true } });
  return items.reduce((sum, i) => sum + i.quantity, 0);
}
