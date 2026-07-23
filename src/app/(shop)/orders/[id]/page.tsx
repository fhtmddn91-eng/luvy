import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { won } from "@/lib/format";
import { orderStatusLabel, orderStatusTone } from "@/lib/orderStatus";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const order = await db.order.findUnique({ where: { id }, include: { items: true } });
  if (!order || order.userId !== user.id) notFound();

  return (
    <div className="mx-auto max-w-[720px] px-6 py-10">
      <div className="flex items-center gap-3">
        <h1 className="text-[24px] font-extrabold text-ink">주문 상세</h1>
        <span className={`rounded-pill px-2.5 py-1 text-[12px] font-bold ${orderStatusTone(order.status)}`}>
          {orderStatusLabel(order.status)}
        </span>
      </div>
      <p className="mt-1 text-[13px] text-muted">주문번호 {order.id.slice(0, 8).toUpperCase()}</p>

      <section className="mt-8 rounded-2xl border border-line bg-white p-6 shadow-[var(--shadow-soft)]">
        <h2 className="mb-4 text-[15px] font-bold text-ink">주문 상품</h2>
        <ul className="space-y-3 text-[14px]">
          {order.items.map((i) => (
            <li key={i.id} className="flex justify-between gap-3">
              <span className="min-w-0">
                <span className="text-[12px] font-semibold text-brand-500">{i.brand}</span>
                <span className="block truncate text-ink-soft">{i.name} × {i.quantity} ({won(i.unitPrice)})</span>
              </span>
              <span className="shrink-0 font-semibold text-ink">{won(i.lineTotal)}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-4 rounded-2xl border border-line bg-white p-6 shadow-[var(--shadow-soft)]">
        <h2 className="mb-4 text-[15px] font-bold text-ink">배송지</h2>
        <dl className="space-y-1.5 text-[14px] text-ink-soft">
          <div className="flex gap-3"><dt className="w-16 shrink-0 text-muted">수령인</dt><dd>{order.recipient}</dd></div>
          <div className="flex gap-3"><dt className="w-16 shrink-0 text-muted">연락처</dt><dd>{order.phone}</dd></div>
          <div className="flex gap-3"><dt className="w-16 shrink-0 text-muted">주소</dt><dd>{order.address}</dd></div>
          {order.memo && <div className="flex gap-3"><dt className="w-16 shrink-0 text-muted">메모</dt><dd>{order.memo}</dd></div>}
        </dl>
      </section>

      <section className="mt-4 rounded-2xl border border-line bg-white p-6 shadow-[var(--shadow-soft)]">
        <dl className="space-y-2 text-[14px]">
          <div className="flex justify-between text-ink-soft"><dt>상품 합계</dt><dd>{won(order.subtotal)}</dd></div>
          <div className="flex justify-between text-ink-soft"><dt>배송비</dt><dd>{order.shippingFee === 0 ? "무료" : won(order.shippingFee)}</dd></div>
          <div className="flex justify-between border-t border-line pt-2">
            <dt className="font-bold text-ink">합계</dt>
            <dd className="text-[18px] font-extrabold text-brand-600">{won(order.total)}</dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
