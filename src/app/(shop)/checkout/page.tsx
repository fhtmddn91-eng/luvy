import { redirect } from "next/navigation";
import { requireApprovedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { CheckoutForm } from "./CheckoutForm";
import { won } from "@/lib/format";
import { resolveUnitPrice, shippingFor, type Tier } from "@/lib/pricing";

export default async function CheckoutPage() {
  const user = await requireApprovedUser();
  const items = await db.cartItem.findMany({
    where: { userId: user.id },
    include: { product: { include: { priceTiers: true } } },
  });
  if (items.length === 0) redirect("/cart");

  const lines = items.map((it) => {
    const unit = resolveUnitPrice(it.product.priceTiers as Tier[], it.quantity);
    return { id: it.id, name: it.product.name, quantity: it.quantity, lineTotal: unit * it.quantity };
  });
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const shippingFee = shippingFor(subtotal);

  return (
    <div className="mx-auto max-w-[1080px] px-6 py-10">
      <h1 className="mb-6 text-[26px] font-extrabold text-ink">주문/결제</h1>
      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <CheckoutForm />
        <div className="rounded-2xl border border-line bg-white p-6 shadow-[var(--shadow-soft)]">
          <h2 className="text-[16px] font-bold text-ink">주문 상품</h2>
          <ul className="mt-4 space-y-3 text-[14px]">
            {lines.map((l) => (
              <li key={l.id} className="flex justify-between gap-3">
                <span className="min-w-0 truncate text-ink-soft">{l.name} × {l.quantity}</span>
                <span className="shrink-0 font-semibold text-ink">{won(l.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-4 space-y-2 border-t border-line pt-4 text-[14px]">
            <div className="flex justify-between text-ink-soft"><dt>상품 합계</dt><dd>{won(subtotal)}</dd></div>
            <div className="flex justify-between text-ink-soft"><dt>배송비</dt><dd>{shippingFee === 0 ? "무료" : won(shippingFee)}</dd></div>
          </dl>
          <div className="mt-4 flex justify-between border-t border-line pt-4">
            <span className="text-[15px] font-bold text-ink">합계</span>
            <span className="text-[20px] font-extrabold text-brand-600">{won(subtotal + shippingFee)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
