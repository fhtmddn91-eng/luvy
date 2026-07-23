import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { won } from "@/lib/format";
import { FULFILLMENT_STATUSES, orderStatusLabel, orderStatusTone } from "@/lib/orderStatus";
import { setOrderStatus, cancelOrderPayment } from "@/lib/actions/admin-orders";

const dateFmt = (d: Date) =>
  new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(d);

const payMethodLabel: Record<string, string> = {
  CARD: "신용카드", TRANSFER: "계좌이체", EASY_PAY: "간편결제",
};

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await db.order.findUnique({
    where: { id },
    include: { items: true, user: true, payment: true },
  });
  if (!order) notFound();

  return (
    <div className="max-w-[840px]">
      <Link href="/admin/orders" className="text-[13px] text-muted hover:text-brand-600">← 주문 목록</Link>
      <div className="mt-2 flex items-center gap-3">
        <h1 className="text-[22px] font-extrabold text-ink">주문 {order.id.slice(0, 8).toUpperCase()}</h1>
        <span className={`rounded-pill px-2.5 py-1 text-[12px] font-bold ${orderStatusTone(order.status)}`}>
          {orderStatusLabel(order.status)}
        </span>
      </div>
      <p className="mt-1 text-[13px] text-muted">{dateFmt(order.createdAt)}</p>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <section className="rounded-2xl border border-line bg-white p-6">
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
            <dl className="mt-4 space-y-2 border-t border-line pt-4 text-[14px]">
              <div className="flex justify-between text-ink-soft"><dt>상품 합계</dt><dd>{won(order.subtotal)}</dd></div>
              <div className="flex justify-between text-ink-soft"><dt>배송비</dt><dd>{order.shippingFee === 0 ? "무료" : won(order.shippingFee)}</dd></div>
              <div className="flex justify-between border-t border-line pt-2">
                <dt className="font-bold text-ink">합계</dt>
                <dd className="text-[17px] font-extrabold text-brand-600">{won(order.total)}</dd>
              </div>
            </dl>
          </section>

          <section className="rounded-2xl border border-line bg-white p-6">
            <h2 className="mb-4 text-[15px] font-bold text-ink">배송지 / 회원</h2>
            <dl className="space-y-1.5 text-[14px] text-ink-soft">
              <div className="flex gap-3"><dt className="w-16 shrink-0 text-muted">회원</dt><dd>{order.user.companyName} ({order.user.email})</dd></div>
              <div className="flex gap-3"><dt className="w-16 shrink-0 text-muted">수령인</dt><dd>{order.recipient}</dd></div>
              <div className="flex gap-3"><dt className="w-16 shrink-0 text-muted">연락처</dt><dd>{order.phone}</dd></div>
              <div className="flex gap-3"><dt className="w-16 shrink-0 text-muted">주소</dt><dd>{order.address}</dd></div>
              {order.memo && <div className="flex gap-3"><dt className="w-16 shrink-0 text-muted">메모</dt><dd>{order.memo}</dd></div>}
            </dl>
          </section>
        </div>

        <div className="h-fit space-y-4">
          <section className="rounded-2xl border border-line bg-white p-6">
            <h2 className="mb-4 text-[15px] font-bold text-ink">결제</h2>
            {order.payment ? (
              <dl className="space-y-1.5 text-[13px] text-ink-soft">
                <div className="flex justify-between"><dt className="text-muted">상태</dt><dd className="font-semibold">{orderStatusLabel(order.payment.status)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">수단</dt><dd>{order.payment.method ? payMethodLabel[order.payment.method] ?? order.payment.method : "-"}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">채널</dt><dd>{order.payment.channel.toUpperCase()}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">금액</dt><dd className="font-semibold">{won(order.payment.amount)}</dd></div>
              </dl>
            ) : (
              <p className="text-[13px] text-muted">결제 정보 없음 (모의 주문)</p>
            )}
          </section>

          <section className="rounded-2xl border border-line bg-white p-6">
            <h2 className="mb-4 text-[15px] font-bold text-ink">상태 변경</h2>
            <form action={setOrderStatus.bind(null, order.id)} className="space-y-3">
              <select
                name="status"
                defaultValue={order.status}
                className="h-11 w-full rounded-lg border border-line bg-white px-3 text-[14px] focus:border-brand-400 focus:outline-none"
              >
                {FULFILLMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>{orderStatusLabel(s)}</option>
                ))}
              </select>
              <button type="submit" className="h-11 w-full rounded-pill bg-brand-500 text-[14px] font-bold text-white hover:bg-brand-600">
                변경 저장
              </button>
            </form>
            {order.status !== "CANCELED" && (
              <form action={cancelOrderPayment.bind(null, order.id)} className="mt-3 border-t border-line pt-3">
                <button type="submit" className="h-10 w-full rounded-pill border border-line bg-white text-[13px] font-bold text-ink-soft hover:bg-cream">
                  {order.payment?.status === "PAID" ? "결제 취소 (환불)" : "주문 취소"}
                </button>
              </form>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
