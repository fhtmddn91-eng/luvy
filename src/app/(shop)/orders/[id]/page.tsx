import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { won } from "@/lib/format";
import { orderStatusLabel, orderStatusTone } from "@/lib/orderStatus";
import { AccountShell } from "@/components/account/AccountShell";
import { Panel, StatusPill } from "@/components/ui/Panel";

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

        <div className="rise rise-2">
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

        <div className="rise rise-3">
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
              <div className="flex items-baseline justify-between border-t border-hairline pt-3">
                <dt className="font-bold text-ink-deep">총 결제 금액</dt>
                <dd className="font-display text-[24px] leading-none tracking-[-0.01em] text-ink-deep">
                  {order.total.toLocaleString("ko-KR")}
                  <span className="ml-0.5 font-sans text-[14px] font-bold">원</span>
                </dd>
              </div>
            </dl>
          </Panel>
        </div>
      </div>
    </AccountShell>
  );
}
