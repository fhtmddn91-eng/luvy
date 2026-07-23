"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { getSession, requireUser, requireApprovedUser } from "@/lib/auth";
import { getMoq, type Tier } from "@/lib/pricing";

const MAX_QTY = 100_000; // 상한 (정수 오버플로/오입력 방지)

function clampQty(quantity: number, moq: number): number {
  return Math.min(MAX_QTY, Math.max(moq, Math.floor(quantity) || moq));
}

export async function addToCart(productId: string, quantity: number): Promise<void> {
  const user = await requireApprovedUser();
  const product = await db.product.findUnique({ where: { id: productId }, include: { priceTiers: true } });
  if (!product) return;

  const moq = getMoq(product.priceTiers as Tier[]);
  const qty = clampQty(quantity, moq);

  await db.cartItem.upsert({
    where: { userId_productId: { userId: user.id, productId } },
    create: { userId: user.id, productId, quantity: qty },
    update: { quantity: { increment: qty } },
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
  const qty = clampQty(quantity, moq);

  await db.cartItem.update({ where: { id: itemId }, data: { quantity: qty } });
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
