"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireApprovedUser } from "@/lib/auth";
import { resolveUnitPrice, shippingFor, type Tier } from "@/lib/pricing";

export type OrderState = { error?: string };

export async function placeOrder(_prev: OrderState, formData: FormData): Promise<OrderState> {
  const user = await requireApprovedUser();

  const recipient = String(formData.get("recipient") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const address = String(formData.get("address") ?? "").trim();
  const memo = String(formData.get("memo") ?? "").trim() || null;

  if (!recipient || !phone || !address) {
    return { error: "수령인, 연락처, 주소를 모두 입력해주세요." };
  }

  const items = await db.cartItem.findMany({
    where: { userId: user.id },
    include: { product: { include: { priceTiers: true } } },
  });
  if (items.length === 0) return { error: "장바구니가 비어 있습니다." };

  const orderItems = items.map((it) => {
    const unitPrice = resolveUnitPrice(it.product.priceTiers as Tier[], it.quantity);
    return {
      productId: it.productId,
      name: it.product.name,
      brand: it.product.brand,
      unitPrice,
      quantity: it.quantity,
      lineTotal: unitPrice * it.quantity,
    };
  });

  const subtotal = orderItems.reduce((sum, i) => sum + i.lineTotal, 0);
  const shippingFee = shippingFor(subtotal);

  const order = await db.order.create({
    data: {
      userId: user.id,
      recipient,
      phone,
      address,
      memo,
      subtotal,
      shippingFee,
      total: subtotal + shippingFee,
      items: { create: orderItems },
    },
  });

  await db.cartItem.deleteMany({ where: { userId: user.id } });
  revalidatePath("/", "layout");
  redirect(`/checkout/complete?order=${order.id}`);
}
