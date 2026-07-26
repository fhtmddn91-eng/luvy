import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { won } from "@/lib/format";
import { orderStatusLabel, orderStatusTone } from "@/lib/orderStatus";
import { courierName, hasShipment } from "@/lib/shipping";
import { AccountShell } from "@/components/account/AccountShell";
import { Panel, StatusPill, EmptyState } from "@/components/ui/Panel";

const dateFmt = (d: Date) =>
  new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export default async function OrdersPage() {
  const user = await requireUser();
  const orders = await db.order.findMany({
    // 결제 전(대기/실패) 주문은 회원 내역에서 숨김
    where: { userId: user.id, status: { notIn: ["PENDING_PAYMENT", "PAYMENT_FAILED"] } },
    include: { items: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <AccountShell
      current="/orders"
      title="주문 내역"
      description={orders.length > 0 ? `총 ${orders.length}건` : undefined}
    >
      <div className="rise rise-2">
        <Panel flush>
          {orders.length === 0 ? (
            <EmptyState>
              주문 내역이 없습니다.
              <Link href="/new" className="ml-1.5 font-semibold text-ink-deep underline underline-offset-4">
                상품 보러가기
              </Link>
            </EmptyState>
          ) : (
            <ul className="divide-y divide-hairline-soft">
              {orders.map((o) => {
                const first = o.items[0];
                const rest = o.items.length - 1;
                const qty = o.items.reduce((sum, i) => sum + i.quantity, 0);
                return (
                  <li key={o.id}>
                    <Link
                      href={`/orders/${o.id}`}
                      className="block px-5 py-5 transition-colors hover:bg-canvas sm:px-6"
                    >
                      <div className="flex items-center justify-between gap-3 text-[12px] text-muted">
                        <span className="flex items-center gap-2">
                          <span className="font-display tracking-[0.04em] text-ink-soft">
                            {o.id.slice(0, 8).toUpperCase()}
                          </span>
                          <span aria-hidden className="h-2.5 w-px bg-hairline" />
                          {dateFmt(o.createdAt)}
                        </span>
                        <StatusPill tone={orderStatusTone(o.status)}>
                          {orderStatusLabel(o.status)}
                        </StatusPill>
                      </div>
                      <div className="mt-2.5 flex flex-wrap items-end justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[15px] font-medium text-ink-deep">
                            {first?.name}
                            {rest > 0 ? ` 외 ${rest}건` : ""}
                          </p>
                          <p className="mt-0.5 text-[12px] text-muted">
                            총 {qty}개
                            {hasShipment(o) && (
                              <>
                                <span aria-hidden className="mx-1.5">·</span>
                                {courierName(o.courier)} {o.trackingNo}
                              </>
                            )}
                          </p>
                        </div>
                        <p className="whitespace-nowrap text-[17px] font-bold text-ink-deep">
                          {won(o.total)}
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </div>
    </AccountShell>
  );
}
