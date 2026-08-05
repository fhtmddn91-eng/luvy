import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { won } from "@/lib/format";
import { orderStatusLabel, orderStatusTone, isMemberCancelable } from "@/lib/orderStatus";
import { courierName, hasShipment, trackingUrl } from "@/lib/shipping";
import { AccountShell } from "@/components/account/AccountShell";
import { CancelOrderForm } from "@/components/account/CancelOrderForm";
import { Panel, StatusPill } from "@/components/ui/Panel";
import { getBankAccount } from "@/lib/bankAccountInfo";
import { formatBankAccount } from "@/lib/bankAccount";
import { paymentMethodLabel } from "@/lib/paymentMethods";

const dateTimeFmt = (d: Date) =>
  new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const order = await db.order.findUnique({ where: { id }, include: { items: true } });
  if (!order || order.userId !== user.id) notFound();

  const shipment = { courier: order.courier, trackingNo: order.trackingNo };
  const shipped = hasShipment(shipment);
  const trackUrl = trackingUrl(shipment);
  const cancelable = isMemberCancelable(order);
  // 무통장입금 + 아직 입금 확인 전(접수 상태)일 때만 계좌를 다시 보여준다
  const bankAccount =
    order.paymentMethod === "BANK_TRANSFER" && order.status === "RECEIVED"
      ? formatBankAccount(await getBankAccount())
      : "";

  return (
    <AccountShell
      current="/orders"
      eyebrow="Order detail"
      title="주문 상세"
      description={dateTimeFmt(order.createdAt)}
      action={
        <Link
          href="/orders"
          className="text-[13px] text-muted transition-colors hover:text-ink-deep"
        >
          ← 주문 내역
        </Link>
      }
    >
      <div className="space-y-4">
        {/* 주문 요약 */}
        <div className="rise rise-1 flex flex-wrap items-center justify-between gap-3 border border-hairline bg-white px-5 py-4 sm:px-6">
          <div>
            <p className="eyebrow">Order no.</p>
            <p className="mt-1 font-display text-[20px] tracking-[0.06em] text-ink-deep">
              {order.id.slice(0, 8).toUpperCase()}
            </p>
          </div>
          <StatusPill tone={orderStatusTone(order.status)}>
            {orderStatusLabel(order.status)}
          </StatusPill>
        </div>

        {order.status === "CANCELED" && (
          <div className="rise rise-2 border border-hairline bg-white px-5 py-4 sm:px-6">
            <p className="text-[13px] font-bold text-ink-deep">취소된 주문입니다</p>
            <p className="mt-1.5 text-[13px] text-ink-soft">
              {order.cancelReason || "사유 없음"}
              {order.canceledBy === "ADMIN" && " (판매자 취소)"}
            </p>
            {order.canceledAt && (
              <p className="mt-1 text-[12px] text-muted">{dateTimeFmt(order.canceledAt)}</p>
            )}
          </div>
        )}

        {/* 발송된 주문만 노출 — 송장이 없으면 조회할 것도 없다 */}
        {shipped && (
          <div className="rise rise-2">
            <Panel title="배송 조회">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <dl className="space-y-2.5 text-[13.5px]">
                  <div className="flex gap-4">
                    <dt className="w-[76px] shrink-0 text-muted">택배사</dt>
                    <dd className="font-medium text-ink-deep">{courierName(order.courier)}</dd>
                  </div>
                  <div className="flex gap-4">
                    <dt className="w-[76px] shrink-0 text-muted">운송장번호</dt>
                    <dd className="font-display tracking-[0.06em] text-ink-deep">
                      {order.trackingNo}
                    </dd>
                  </div>
                  {order.shippedAt && (
                    <div className="flex gap-4">
                      <dt className="w-[76px] shrink-0 text-muted">발송일</dt>
                      <dd className="font-medium text-ink-deep">{dateTimeFmt(order.shippedAt)}</dd>
                    </div>
                  )}
                </dl>
                {trackUrl && (
                  <a
                    href={trackUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex h-11 items-center justify-center bg-ink-deep px-6 text-[12px] font-bold uppercase tracking-[0.12em] text-white transition-opacity hover:opacity-80"
                  >
                    배송 조회 ↗
                  </a>
                )}
              </div>
            </Panel>
          </div>
        )}

        <div className="rise rise-3">
          <Panel title="주문 상품" flush>
            <ul className="divide-y divide-hairline-soft">
              {order.items.map((i) => (
                <li key={i.id} className="flex items-start justify-between gap-4 px-5 py-4 sm:px-6">
                  <div className="min-w-0">
                    <p className="text-[12px] font-semibold text-brand-500">{i.brand}</p>
                    <p className="mt-0.5 text-[14px] font-medium text-ink-deep">{i.name}</p>
                    <p className="mt-1 text-[12px] text-muted">
                      {won(i.unitPrice)} × {i.quantity}개
                    </p>
                  </div>
                  <p className="shrink-0 whitespace-nowrap text-[15px] font-bold text-ink-deep">
                    {won(i.lineTotal)}
                  </p>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        <div className="rise rise-4">
          <Panel title="배송지">
            <dl className="space-y-2.5 text-[13.5px]">
              {[
                ["수령인", order.recipient],
                ["연락처", order.phone],
                ["주소", order.address],
                ...(order.memo ? [["배송 메모", order.memo]] : []),
              ].map(([k, v]) => (
                <div key={k} className="flex gap-4">
                  <dt className="w-[76px] shrink-0 text-muted">{k}</dt>
                  <dd className="min-w-0 font-medium text-ink-deep">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>
        </div>

        <div className="rise rise-4">
          <Panel title="결제 금액">
            <dl className="space-y-2.5 text-[13.5px]">
              <div className="flex justify-between text-ink-soft">
                <dt>상품 합계</dt>
                <dd>{won(order.subtotal)}</dd>
              </div>
              <div className="flex justify-between text-ink-soft">
                <dt>배송비</dt>
                <dd>{order.shippingFee === 0 ? "무료" : won(order.shippingFee)}</dd>
              </div>
              {order.paymentMethod && (
                <div className="flex justify-between text-ink-soft">
                  <dt>결제 수단</dt>
                  <dd>{paymentMethodLabel(order.paymentMethod)}</dd>
                </div>
              )}
              <div className="flex items-baseline justify-between border-t border-hairline pt-3">
                <dt className="font-bold text-ink-deep">총 결제 금액</dt>
                <dd className="font-display text-[24px] leading-none tracking-[-0.01em] text-ink-deep">
                  {order.total.toLocaleString("ko-KR")}
                  <span className="ml-0.5 font-sans text-[14px] font-bold">원</span>
                </dd>
              </div>
            </dl>
            {/* 입금 전이면 계좌를 다시 찾아볼 수 있어야 한다 — 발송 이후엔 노이즈라 감춘다 */}
            {bankAccount && (
              <div className="mt-3 rounded-xl bg-brand-50 px-4 py-3">
                <p className="text-[11.5px] font-bold text-brand-600">입금 계좌</p>
                <p className="mt-0.5 text-[14px] font-extrabold text-ink-deep">{bankAccount}</p>
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-soft">
                  입금이 확인되면 발송이 시작됩니다.
                </p>
              </div>
            )}
          </Panel>
        </div>

        {cancelable && (
          <div className="rise rise-4">
            <Panel title="주문 취소">
              <CancelOrderForm orderId={order.id} />
            </Panel>
          </div>
        )}
      </div>
    </AccountShell>
  );
}
