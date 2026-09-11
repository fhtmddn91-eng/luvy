import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { won } from "@/lib/format";
import { orderStatusLabel, orderStatusTone, needsDepositConfirm } from "@/lib/orderStatus";
import { cancelOrderPayment } from "@/lib/actions/admin-orders";
import { courierName, hasShipment, trackingUrl } from "@/lib/shipping";
import { ShippingForm } from "@/components/admin/ShippingForm";
import { OrderStatusForm } from "@/components/admin/OrderStatusForm";
import { DepositForm } from "@/components/admin/DepositForm";
import { PaymentDetail } from "@/components/admin/PaymentDetail";
import { ResolveUncertainForm } from "@/components/admin/ResolveUncertainForm";
import { depositGapLabel, elapsedLabel } from "@/lib/deposit";
import { paymentMethodLabel } from "@/lib/paymentMethods";
import { orderDiscountAmount, discountLabel } from "@/lib/discount";
import { fullAddress } from "@/lib/address";

const dateFmt = (d: Date) =>
  new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" }).format(d);

export default async function AdminOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const order = await db.order.findUnique({
    where: { id },
    include: { items: true, user: true, payment: true },
  });
  if (!order) notFound();
  const discountAmount = orderDiscountAmount(order.items);

  const shipment = { courier: order.courier, trackingNo: order.trackingNo };
  const shipped = hasShipment(shipment);
  const trackUrl = trackingUrl(shipment);

  const awaitingDeposit = needsDepositConfirm({
    from: order.status,
    paymentMethod: order.paymentMethod,
    depositConfirmedAt: order.depositConfirmedAt,
  });
  const elapsed = elapsedLabel(order.createdAt, new Date());
  const depositGap = order.depositConfirmedAt
    ? depositGapLabel(order.depositAmount, order.total)
    : "";

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
              {/* 할인은 이미 상품 합계에 반영돼 있다 — 얼마를 깎아 줬는지 대사용으로 보여준다 */}
              {discountAmount > 0 && (
                <div className="flex justify-between font-semibold text-brand-600">
                  <dt>{discountLabel(order.discountBp) || "회원 할인"}</dt>
                  <dd>−{won(discountAmount)}</dd>
                </div>
              )}
              <div className="flex justify-between text-ink-soft">
                <dt>상품 합계</dt>
                <dd>{won(order.subtotal)}</dd>
              </div>
              <div className="flex justify-between text-ink-soft">
                <dt>배송비</dt>
                <dd>{order.shippingFee === 0 ? "무료" : won(order.shippingFee)}</dd>
              </div>
              {order.pointsUsed > 0 && (
                <div className="flex justify-between text-ink-soft">
                  <dt>포인트 사용</dt>
                  <dd>−{won(order.pointsUsed)}</dd>
                </div>
              )}
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
                {/* 우편번호·상세주소가 없는 옛 주문은 fullAddress 가 그 자리를 접는다 */}
                <dd className="min-w-0 break-words">{fullAddress(order)}</dd>
              </div>
              {order.memo && (
                <div className="flex gap-3">
                  <dt className="w-16 shrink-0 text-muted">메모</dt>
                  {/* 손님이 여러 줄로 남긴 요청("부재 시 …", "문 앞에 …")이 한 줄로
                      뭉개지면 뒷줄을 놓치고 발송한다 — 쓴 그대로 보여준다 */}
                  <dd className="min-w-0 whitespace-pre-line break-words">{order.memo}</dd>
                </div>
              )}
            </dl>
          </section>
        </div>

        <div className="h-fit space-y-4">
          <section className="border border-hairline bg-white p-6">
            <h2 className="mb-4 text-[15px] font-bold text-ink-deep">결제</h2>
            {order.payment ? (
              <>
                <PaymentDetail payment={order.payment} />
                {/* 승인 불명은 사람이 결정해야 한다 — 그 결정을 내릴 버튼이 여기 있어야 한다 (#7) */}
                {order.payment.status === "UNCERTAIN" && <ResolveUncertainForm orderId={order.id} />}
              </>
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
                    {/* SYSTEM 은 자동 정리(#5)·결제 실패 처리, PG 는 나이스페이 쪽 취소 — 둘 다 사람이 아니다 */}
                    {order.canceledBy === "MEMBER"
                      ? "회원"
                      : order.canceledBy === "ADMIN"
                        ? "관리자"
                        : order.canceledBy === "SYSTEM"
                          ? "시스템 (자동)"
                          : order.canceledBy === "PG"
                            ? "나이스페이"
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
            {/* 서버(shippingEntryRejection)가 어차피 거부한다 — 폼을 보여 주고 오류를 내느니 이유를 먼저 적는다 */}
            {order.status === "PENDING_PAYMENT" ? (
              <p className="text-[12.5px] leading-relaxed text-muted">
                카드 결제가 완료되지 않은 주문이라 송장을 붙일 수 없습니다.
              </p>
            ) : (
              <ShippingForm
                orderId={order.id}
                courier={order.courier}
                trackingNo={order.trackingNo}
              />
            )}
          </section>

          {awaitingDeposit && (
            <section className="border border-brand-200 bg-brand-50 p-6">
              <h2 className="text-[15px] font-bold text-ink-deep">입금 확인</h2>
              <p className="mb-4 mt-1 text-[12px] leading-relaxed text-ink-soft">
                주문 후 <strong className="font-bold text-brand-600">{elapsed}</strong> 경과 · 미입금 상태로
                재고를 물고 있습니다. 통장에서 확인한 뒤 아래를 채워주세요.
              </p>
              <DepositForm orderId={order.id} total={order.total} />
            </section>
          )}

          {order.depositConfirmedAt && (
            <section className="border border-hairline bg-white p-6">
              <h2 className="mb-3 text-[15px] font-bold text-ink-deep">입금 기록</h2>
              <dl className="space-y-1.5 text-[13px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">입금자명</dt>
                  <dd className="font-semibold text-ink-deep">{order.depositorName}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">입금액</dt>
                  <dd className="font-semibold text-ink-deep">
                    {won(order.depositAmount)}
                    {depositGap && <span className="ml-1 font-bold text-brand-600">({depositGap})</span>}
                  </dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt className="text-muted">확인</dt>
                  <dd className="text-right text-ink-soft">
                    {order.depositConfirmedBy}
                    <br />
                    {dateFmt(order.depositConfirmedAt)}
                  </dd>
                </div>
              </dl>
            </section>
          )}

          <section className="border border-hairline bg-white p-6">
            <h2 className="mb-4 text-[15px] font-bold text-ink-deep">상태 변경</h2>
            {order.status === "PENDING_PAYMENT" ? (
              /* 돈이 안 들어온 주문은 손으로 못 넘긴다(statusChangeRejection). 드롭다운 대신 이유를 보여 준다 */
              <p className="text-[12.5px] leading-relaxed text-muted">
                카드 결제가 아직 완료되지 않았습니다. 결제가 확정되면 자동으로 <b>결제완료</b>가 됩니다.
                손님이 결제창을 닫고 떠났다면 아래 「주문 취소」로 재고를 돌려놓으세요.
              </p>
            ) : (
              <OrderStatusForm orderId={order.id} status={order.status} />
            )}
            {awaitingDeposit && (
              <p className="mt-3 text-[12px] leading-relaxed text-muted">
                무통장 입금이 확인되기 전에는 접수됨을 벗어날 수 없습니다.
              </p>
            )}
            {order.status !== "CANCELED" && (
              <form
                action={cancelOrderPayment.bind(null, order.id)}
                className="mt-3 border-t border-hairline pt-3"
              >
                {order.payment?.status === "CANCEL_FAILED" && (
                  <p className="mb-2 text-[12px] font-semibold leading-relaxed text-brand-600">
                    앞선 환불 시도가 실패했습니다. 다시 누르면 환불을 다시 시도합니다 — 환불이 성공해야만 취소됩니다.
                  </p>
                )}
                <button
                  type="submit"
                  className="h-10 w-full border border-hairline bg-white text-[13px] font-bold text-ink-soft hover:border-ink-deep hover:text-ink-deep"
                >
                  {order.payment?.status === "CANCEL_FAILED"
                    ? "환불 재시도 후 취소"
                    : order.payment?.status === "PAID"
                      ? "결제 취소 (환불)"
                      : "주문 취소"}
                </button>
              </form>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
