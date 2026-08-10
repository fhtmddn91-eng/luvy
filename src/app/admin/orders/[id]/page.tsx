import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { won } from "@/lib/format";
import { FULFILLMENT_STATUSES, orderStatusLabel, orderStatusTone } from "@/lib/orderStatus";
import { setOrderStatus, cancelOrderPayment } from "@/lib/actions/admin-orders";
import { courierName, hasShipment, trackingUrl } from "@/lib/shipping";
import { ShippingForm } from "@/components/admin/ShippingForm";
import { paymentMethodLabel } from "@/lib/paymentMethods";

const dateFmt = (d: Date) =>
  new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(d);

const payMethodLabel: Record<string, string> = {
  CARD: "신용카드",
  TRANSFER: "계좌이체",
  EASY_PAY: "간편결제",
};

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const order = await db.order.findUnique({
    where: { id },
    include: { items: true, user: true, payment: true },
  });
  if (!order) notFound();

  const shipment = { courier: order.courier, trackingNo: order.trackingNo };
  const shipped = hasShipment(shipment);
  const trackUrl = trackingUrl(shipment);

  return (
    <div className="max-w-[840px]">
      <Link href="/admin/orders" className="text-[13px] text-muted hover:text-ink-deep">
        ← 주문 목록
      </Link>
      <div className="mt-2 flex items-center gap-3">
        <h1 className="text-[22px] font-extrabold text-ink-deep">
          주문 {order.id.slice(0, 8).toUpperCase()}
        </h1>
        <span className={`px-2.5 py-1 text-[12px] font-bold ${orderStatusTone(order.status)}`}>
          {orderStatusLabel(order.status)}
        </span>
      </div>
      <p className="mt-1 text-[13px] text-muted">{dateFmt(order.createdAt)}</p>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <section className="border border-hairline bg-white p-6">
            <h2 className="mb-4 text-[15px] font-bold text-ink-deep">주문 상품</h2>
            <ul className="space-y-3 text-[14px]">
              {order.items.map((i) => (
                <li key={i.id} className="flex justify-between gap-3">
                  <span className="min-w-0">
                    <span className="text-[12px] font-semibold text-brand-500">{i.brand}</span>
                    {/* 품번 — 창고에서 물건을 집을 때 보는 값이라 상품명 옆에 붙인다 */}
                    {i.sku && (
                      <span className="ml-2 font-display text-[11px] tracking-[0.04em] text-muted">
                        {i.sku}
                      </span>
                    )}
                    <span className="block truncate text-ink-soft">
                      {i.name}{i.optionName ? ` (${i.optionName})` : ""} × {i.quantity} ({won(i.unitPrice)})
                    </span>
                  </span>
                  <span className="shrink-0 font-semibold text-ink-deep">{won(i.lineTotal)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-4 space-y-2 border-t border-hairline pt-4 text-[14px]">
              <div className="flex justify-between text-ink-soft">
                <dt>상품 합계</dt>
                <dd>{won(order.subtotal)}</dd>
              </div>
              <div className="flex justify-between text-ink-soft">
                <dt>배송비</dt>
                <dd>{order.shippingFee === 0 ? "무료" : won(order.shippingFee)}</dd>
              </div>
              <div className="flex justify-between border-t border-hairline pt-2">
                <dt className="font-bold text-ink-deep">합계</dt>
                <dd className="text-[17px] font-extrabold text-brand-600">{won(order.total)}</dd>
              </div>
            </dl>
          </section>

          <section className="border border-hairline bg-white p-6">
            <h2 className="mb-4 text-[15px] font-bold text-ink-deep">배송지 / 회원</h2>
            <dl className="space-y-1.5 text-[14px] text-ink-soft">
              <div className="flex gap-3">
                <dt className="w-16 shrink-0 text-muted">회원</dt>
                <dd>
                  {order.user.companyName} ({order.user.email})
                </dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-16 shrink-0 text-muted">수령인</dt>
                <dd>{order.recipient}</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-16 shrink-0 text-muted">연락처</dt>
                <dd>{order.phone}</dd>
              </div>
              <div className="flex gap-3">
                <dt className="w-16 shrink-0 text-muted">주소</dt>
                <dd>{order.address}</dd>
              </div>
              {order.memo && (
                <div className="flex gap-3">
                  <dt className="w-16 shrink-0 text-muted">메모</dt>
                  <dd>{order.memo}</dd>
                </div>
              )}
            </dl>
          </section>
        </div>

        <div className="h-fit space-y-4">
          <section className="border border-hairline bg-white p-6">
            <h2 className="mb-4 text-[15px] font-bold text-ink-deep">결제</h2>
            {order.payment ? (
              <dl className="space-y-1.5 text-[13px] text-ink-soft">
                <div className="flex justify-between">
                  <dt className="text-muted">상태</dt>
                  <dd className="font-semibold">{orderStatusLabel(order.payment.status)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">수단</dt>
                  <dd>
                    {order.payment.method
                      ? payMethodLabel[order.payment.method] ?? order.payment.method
                      : "-"}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">채널</dt>
                  <dd>{order.payment.channel.toUpperCase()}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">금액</dt>
                  <dd className="font-semibold">{won(order.payment.amount)}</dd>
                </div>
              </dl>
            ) : order.paymentMethod ? (
              // PG 연동 전 주문 — 회원이 주문서에서 고른 수단만 남는다
              <dl className="space-y-1.5 text-[13px] text-ink-soft">
                <div className="flex justify-between">
                  <dt className="text-muted">선택한 수단</dt>
                  <dd className="font-semibold">{paymentMethodLabel(order.paymentMethod)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">금액</dt>
                  <dd className="font-semibold">{won(order.total)}</dd>
                </div>
              </dl>
            ) : (
              <p className="text-[13px] text-muted">결제 정보 없음 (모의 주문)</p>
            )}
          </section>

          {order.status === "CANCELED" && (
            <section className="border border-hairline bg-white p-6">
              <h2 className="mb-3 text-[15px] font-bold text-ink-deep">취소 내역</h2>
              <dl className="space-y-1.5 text-[13px] text-ink-soft">
                <div className="flex justify-between gap-3">
                  <dt className="shrink-0 text-muted">취소자</dt>
                  <dd className="font-semibold">
                    {order.canceledBy === "MEMBER"
                      ? "회원"
                      : order.canceledBy === "ADMIN"
                        ? "관리자"
                        : "—"}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="shrink-0 text-muted">사유</dt>
                  <dd className="text-right">{order.cancelReason || "—"}</dd>
                </div>
                {order.canceledAt && (
                  <div className="flex justify-between gap-3">
                    <dt className="shrink-0 text-muted">일시</dt>
                    <dd>{dateFmt(order.canceledAt)}</dd>
                  </div>
                )}
              </dl>
            </section>
          )}

          <section className="border border-hairline bg-white p-6">
            <h2 className="mb-1 text-[15px] font-bold text-ink-deep">송장 / 배송</h2>
            {shipped ? (
              <div className="mb-4 mt-3 border border-hairline-soft bg-canvas px-3.5 py-3">
                <p className="text-[13px] font-semibold text-ink-deep">
                  {courierName(order.courier)}
                </p>
                <p className="mt-0.5 font-display text-[15px] tracking-[0.04em] text-ink-deep">
                  {order.trackingNo}
                </p>
                {order.shippedAt && (
                  <p className="mt-1 text-[12px] text-muted">발송 {dateFmt(order.shippedAt)}</p>
                )}
                {trackUrl && (
                  <a
                    href={trackUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-2 inline-block text-[12px] font-semibold text-ink-soft underline underline-offset-4 hover:text-ink-deep"
                  >
                    배송 조회 ↗
                  </a>
                )}
              </div>
            ) : (
              <p className="mb-4 mt-2 text-[13px] text-muted">등록된 송장이 없습니다.</p>
            )}
            <ShippingForm
              orderId={order.id}
              courier={order.courier}
              trackingNo={order.trackingNo}
            />
          </section>

          <section className="border border-hairline bg-white p-6">
            <h2 className="mb-4 text-[15px] font-bold text-ink-deep">상태 변경</h2>
            <form action={setOrderStatus.bind(null, order.id)} className="space-y-3">
              <select
                name="status"
                defaultValue={order.status}
                className="h-11 w-full border border-hairline bg-white px-3 text-[14px] focus:border-ink-deep focus:outline-none"
              >
                {FULFILLMENT_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {orderStatusLabel(s)}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="h-11 w-full bg-ink-deep text-[12px] font-bold uppercase tracking-[0.12em] text-white transition-opacity hover:opacity-80"
              >
                변경 저장
              </button>
            </form>
            {order.status !== "CANCELED" && (
              <form
                action={cancelOrderPayment.bind(null, order.id)}
                className="mt-3 border-t border-hairline pt-3"
              >
                <button
                  type="submit"
                  className="h-10 w-full border border-hairline bg-white text-[13px] font-bold text-ink-soft hover:border-ink-deep hover:text-ink-deep"
                >
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
