import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { won } from "@/lib/format";
import { ORDER_STATUS, orderStatusLabel, orderStatusTone } from "@/lib/orderStatus";
import {
  PageHeader,
  Panel,
  StatusPill,
  TableWrap,
  Th,
  EmptyState,
  FilterTabs,
} from "@/components/ui/Panel";

const dateFmt = (d: Date) =>
  new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);

const filters = ["ALL", "RECEIVED", "PREPARING", "SHIPPED", "DELIVERED", "CANCELED"];

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();
  const { status } = await searchParams;
  const active = status && ORDER_STATUS[status] ? status : "ALL";

  const orders = await db.order.findMany({
    where: active === "ALL" ? undefined : { status: active },
    include: { items: true, user: true },
    orderBy: { createdAt: "desc" },
  });

  const sum = orders.reduce((acc, o) => acc + o.total, 0);

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="주문 관리"
        description={`${orders.length}건 · 합계 ${won(sum)}`}
      />

      <div className="rise rise-1">
        <FilterTabs
          items={filters.map((f) => ({
            href: f === "ALL" ? "/admin/orders" : `/admin/orders?status=${f}`,
            label: f === "ALL" ? "전체" : orderStatusLabel(f),
            active: active === f,
          }))}
        />
      </div>

      <div className="rise rise-2">
        <Panel flush>
          {orders.length === 0 ? (
            <EmptyState>해당 조건의 주문이 없습니다.</EmptyState>
          ) : (
            <TableWrap minWidth={720}>
              <thead>
                <tr className="border-b border-hairline-soft">
                  <Th>주문번호</Th>
                  <Th>회원</Th>
                  <Th>상품</Th>
                  <Th align="right">금액</Th>
                  <Th align="center">상태</Th>
                  <Th align="right">일시</Th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => (
                  <tr
                    key={o.id}
                    className="border-b border-hairline-soft last:border-0 transition-colors hover:bg-canvas"
                  >
                    <td className="px-5 py-3.5 sm:px-6">
                      <Link
                        href={`/admin/orders/${o.id}`}
                        className="font-display text-[14px] tracking-[0.04em] text-ink-deep hover:text-brand-600"
                      >
                        {o.id.slice(0, 8).toUpperCase()}
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 text-[13px] text-ink-soft sm:px-6">
                      {o.user.companyName}
                    </td>
                    <td className="max-w-[260px] truncate px-5 py-3.5 text-[13px] text-ink-soft sm:px-6">
                      {o.items[0]?.name}
                      {o.items.length > 1 ? ` 외 ${o.items.length - 1}건` : ""}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-right font-semibold text-ink-deep sm:px-6">
                      {won(o.total)}
                    </td>
                    <td className="px-5 py-3.5 text-center sm:px-6">
                      <StatusPill tone={orderStatusTone(o.status)}>
                        {orderStatusLabel(o.status)}
                      </StatusPill>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-right text-[13px] text-muted sm:px-6">
                      {dateFmt(o.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Panel>
      </div>
    </div>
  );
}
