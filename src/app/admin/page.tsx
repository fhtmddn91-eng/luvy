import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { won } from "@/lib/format";
import { orderStatusLabel, orderStatusTone } from "@/lib/orderStatus";
import {
  PageHeader,
  Panel,
  StatTile,
  StatusPill,
  TableWrap,
  Th,
  EmptyState,
} from "@/components/ui/Panel";

const dateFmt = (d: Date) =>
  new Intl.DateTimeFormat("ko-KR", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);

export default async function AdminDashboardPage() {
  await requireAdmin();

  const [orderCount, revenue, memberCount, productCount, pendingMembers, openInquiries, recentOrders] =
    await Promise.all([
      db.order.count(),
      db.order.aggregate({ _sum: { total: true } }),
      db.user.count({ where: { role: "MEMBER" } }),
      db.product.count({ where: { status: "ACTIVE" } }),
      db.user.count({ where: { role: "MEMBER", status: "PENDING" } }),
      db.inquiry.count({ where: { status: "OPEN" } }),
      db.order.findMany({
        orderBy: { createdAt: "desc" },
        take: 6,
        include: { items: true, user: true },
      }),
    ]);

  const total = revenue._sum.total ?? 0;

  return (
    <div>
      <PageHeader
        eyebrow="Overview"
        title="대시보드"
        description="LUVY 운영 현황 요약"
      />

      <div className="rise rise-1 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile label="Total orders" value={orderCount} suffix="건" href="/admin/orders" />
        <StatTile
          label="Revenue"
          value={total.toLocaleString("ko-KR")}
          suffix="원"
          href="/admin/orders"
        />
        <StatTile label="Members" value={memberCount} suffix="명" href="/admin/members" />
        <StatTile label="Live products" value={productCount} suffix="개" href="/admin/products" />
      </div>

      {/* 처리 대기 항목이 있을 때만 노출 — 평소엔 화면을 비워 둔다 */}
      {(pendingMembers > 0 || openInquiries > 0) && (
        <div className="rise rise-2 mt-4 flex flex-wrap gap-3">
          {pendingMembers > 0 && (
            <Link
              href="/admin/members?status=PENDING"
              className="group flex items-center gap-3 border border-hairline bg-white px-5 py-4 transition-colors hover:border-ink-deep"
            >
              <span className="font-display text-[26px] leading-none text-brand-500">
                {pendingMembers}
              </span>
              <span className="text-[13px] font-semibold text-ink-deep group-hover:text-ink-deep">
                승인 대기 회원
              </span>
            </Link>
          )}
          {openInquiries > 0 && (
            <Link
              href="/admin/inquiries?status=OPEN"
              className="group flex items-center gap-3 border border-hairline bg-white px-5 py-4 transition-colors hover:border-ink-deep"
            >
              <span className="font-display text-[26px] leading-none text-brand-500">
                {openInquiries}
              </span>
              <span className="text-[13px] font-semibold text-ink-deep group-hover:text-ink-deep">
                답변 대기 문의
              </span>
            </Link>
          )}
        </div>
      )}

      <div className="rise rise-3 mt-8">
        <Panel
          title="최근 주문"
          flush
          action={
            <Link
              href="/admin/orders"
              className="text-[12px] font-semibold text-ink-soft transition-colors hover:text-ink-deep"
            >
              전체 보기 →
            </Link>
          }
        >
          {recentOrders.length === 0 ? (
            <EmptyState>아직 주문이 없습니다.</EmptyState>
          ) : (
            <TableWrap minWidth={640}>
              <thead>
                <tr className="border-b border-hairline-soft">
                  <Th>주문번호</Th>
                  <Th>회원</Th>
                  <Th>상품</Th>
                  <Th align="center">상태</Th>
                  <Th align="right">금액</Th>
                  <Th align="right">일시</Th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.map((o) => {
                  return (
                    <tr
                      key={o.id}
                      className="border-b border-hairline-soft last:border-0 transition-colors hover:bg-canvas"
                    >
                      <td className="px-5 py-3.5 sm:px-6">
                        <Link
                          href={`/admin/orders/${o.id}`}
                          className="font-display text-[14px] tracking-[0.04em] text-ink-deep hover:text-ink-deep"
                        >
                          {o.id.slice(0, 8).toUpperCase()}
                        </Link>
                      </td>
                      <td className="px-5 py-3.5 text-ink-soft sm:px-6">{o.user.companyName}</td>
                      <td className="max-w-[240px] truncate px-5 py-3.5 text-ink-soft sm:px-6">
                        {o.items[0]?.name}
                        {o.items.length > 1 ? ` 외 ${o.items.length - 1}건` : ""}
                      </td>
                      <td className="px-5 py-3.5 text-center sm:px-6">
                        <StatusPill tone={orderStatusTone(o.status)}>
                          {orderStatusLabel(o.status)}
                        </StatusPill>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-right font-semibold text-ink-deep sm:px-6">
                        {won(o.total)}
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-right text-[13px] text-muted sm:px-6">
                        {dateFmt(o.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </Panel>
      </div>
    </div>
  );
}
