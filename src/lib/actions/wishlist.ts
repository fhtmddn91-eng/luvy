"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { requireApprovedUser } from "@/lib/auth";

/**
 * 찜(관심상품) 토글.
 *
 * 담기/빼기를 한 동작으로 묶는다 — 하트 버튼은 상태가 하나뿐이라
 * add/remove 를 나누면 화면과 서버가 어긋났을 때 되돌릴 방법이 없다.
 * 지금 상태와 무관하게 "요청한 결과"를 만들어 그 결과를 돌려준다.
 */
export async function toggleWishlist(productId: string): Promise<boolean> {
  const user = await requireApprovedUser();

  const exists = await db.wishlist.findUnique({
    where: { userId_productId: { userId: user.id, productId } },
    select: { userId: true },
  });

  if (exists) {
    await db.wishlist.delete({
      where: { userId_productId: { userId: user.id, productId } },
    });
  } else {
    // 숨김·삭제된 상품이 찜에 남지 않도록 판매중인 상품만 담는다
    const product = await db.product.findUnique({
      where: { id: productId },
      select: { status: true },
    });
    if (!product || product.status !== "ACTIVE") return false;
    await db.wishlist.create({ data: { userId: user.id, productId } });
  }

  revalidatePath("/account/wishlist");
  return !exists;
}

export async function removeFromWishlist(formData: FormData): Promise<void> {
  const user = await requireApprovedUser();
  const productId = String(formData.get("productId") ?? "");
  if (!productId) return;
  await db.wishlist.deleteMany({ where: { userId: user.id, productId } });
  revalidatePath("/account/wishlist");
}
