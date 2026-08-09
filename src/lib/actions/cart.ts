"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession, requireUser, requireApprovedUser } from "@/lib/auth";
import { getMoq, hasPrice, type Tier } from "@/lib/pricing";
import { clampToStock, isSoldOut } from "@/lib/stock";

const MAX_QTY = 100_000; // 상한 (정수 오버플로/오입력 방지)

export async function addToCart(productId: string, quantity: number): Promise<void> {
  const user = await requireApprovedUser();
  const product = await db.product.findUnique({ where: { id: productId }, include: { priceTiers: true } });
  if (!product) return;
  if (isSoldOut(product)) return; // 품절 상품은 담기지 않는다
  // 단가가 아직 0인 수집 상품 — 담기면 그대로 0원 주문이 된다
  if (!hasPrice(product.priceTiers as Tier[])) return;

  const moq = getMoq(product.priceTiers as Tier[]);

  // 이미 담긴 수량까지 합해 재고를 넘지 않도록 한다
  const existing = await db.cartItem.findUnique({
    where: { userId_productId: { userId: user.id, productId } },
  });
  const desired = (existing?.quantity ?? 0) + (Math.floor(quantity) || moq);
  const qty = clampToStock(desired, moq, product, MAX_QTY);
  if (qty <= 0) return;

  await db.cartItem.upsert({
    where: { userId_productId: { userId: user.id, productId } },
    create: { userId: user.id, productId, quantity: qty },
    update: { quantity: qty },
  });

  revalidatePath("/cart");
  revalidatePath("/", "layout"); // 헤더 뱃지
}

export async function updateCartQty(itemId: string, quantity: number): Promise<void> {
  const user = await requireUser();
  const item = await db.cartItem.findUnique({
    where: { id: itemId },
    include: { product: { include: { priceTiers: true } } },
  });
  if (!item || item.userId !== user.id) return;

  const moq = getMoq(item.product.priceTiers as Tier[]);
  const qty = clampToStock(quantity, moq, item.product, MAX_QTY);

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
