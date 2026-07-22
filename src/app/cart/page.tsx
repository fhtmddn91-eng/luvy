import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { CartItemRow, type CartRowData } from "@/components/cart/CartItemRow";
import { CartSummary } from "@/components/cart/CartSummary";
import { getMoq, resolveUnitPrice, shippingFor, type Tier } from "@/lib/pricing";

export default async function CartPage() {
  const user = await requireUser();
  const items = await db.cartItem.findMany({
    where: { userId: user.id },
    include: { product: { include: { priceTiers: true } } },
    orderBy: { id: "desc" },
  });

  const rows: CartRowData[] = items.map((it) => ({
    id: it.id,
    productId: it.productId,
    name: it.product.name,
    brand: it.product.brand,
    quantity: it.quantity,
    moq: getMoq(it.product.priceTiers as Tier[]),
    tiers: it.product.priceTiers as Tier[],
  }));

  const subtotal = rows.reduce((sum, r) => sum + resolveUnitPrice(r.tiers, r.quantity) * r.quantity, 0);
  const shippingFee = shippingFor(subtotal);

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-10">
      <h1 className="mb-6 text-[26px] font-extrabold text-ink">장바구니</h1>
      {rows.length === 0 ? (
        <div className="flex min-h-[240px] flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-line">
          <p className="text-[15px] text-muted">장바구니가 비어 있습니다.</p>
          <Link href="/category/women" className="rounded-pill bg-brand-500 px-6 py-2.5 text-[14px] font-bold text-white hover:bg-brand-600">
            쇼핑하러 가기
          </Link>
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
          <div>
            {rows.map((r) => (
              <CartItemRow key={r.id} item={r} />
            ))}
          </div>
          <CartSummary subtotal={subtotal} shippingFee={shippingFee} />
        </div>
      )}
    </div>
  );
}
