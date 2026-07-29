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

  // 매출 집계에서 제외할 상태 — 취소·실패·미결제는 돈이 아니다
  const DEAD = ["CANCELED", "PAYMENT_FAILED", "PENDING_PAYMENT"];
  const sales = { status: { notIn: DEAD } };

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1);

  const [orderCount, revenue, monthRevenue, memberCount, productCount, pendingMembers, openInquiries, recentOrders, recentSales] =
    await Promise.all([
      db.order.count(),
      db.order.aggregate({ _sum: { total: true }, where: sales }),
      db.order.aggregate({ _sum: { total: true }, where: { ...sales, createdAt: { gte: monthStart } } }),
      db.user.count({ where: { role: "MEMBER" } }),
      db.product.count({ where: { status: "ACTIVE" } }),
      db.user.count({ where: { role: "MEMBER", status: "PENDING" } }),
      db.inquiry.count({ where: { status: "OPEN" } }),
      db.order.findMany({
        orderBy: { createdAt: "desc" },
        take: 6,
        include: { items: true, user: true },
      }),
      db.order.findMany({
        where: { ...sales, createdAt: { gte: sixMonthsAgo } },
        select: { createdAt: true, total: true },
      }),
    ]);

  const total = revenue._sum.total ?? 0;
  const thisMonth = monthRevenue._sum.total ?? 0;

  // 최근 6개월 월별 매출 (주문이 없는 달도 0원으로 표시)
  const months: { label: string; sum: number; count: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ label: `${d.getFullYear()}. ${d.getMonth() + 1}.`, sum: 0, count: 0 });
  }
  for (const o of recentSales) {
    const idx = 5 - ((now.getFullYear() - o.createdAt.getFullYear()) * 12 + now.getMonth() - o.createdAt.getMonth());
    if (idx >= 0 && idx < 6) {
      months[idx].sum += o.total;
      months[idx].count += 1;
    }
  }

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
          label="This month"
          value={thisMonth.toLocaleString("ko-KR")}
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

      {/* 월별 매출 — 취소·실패·미결제 제외 */}
      <div className="rise rise-2 mt-8">
        <Panel title={`월별 매출 (누적 ${won(total)})`} flush>
          <TableWrap minWidth={520}>
            <thead>
              <tr className="border-b border-hairline-soft">
                <Th>월</Th>
                <Th align="right">주문</Th>
                <Th align="right">매출</Th>
              </tr>
            </thead>
            <tbody>
              {months.map((m, i) => (
                <tr key={m.label} className="border-b border-hairline-soft last:border-0">
                  <td className={`px-5 py-3 sm:px-6 ${i === 5 ? "font-bold text-ink-deep" : "text-ink-soft"}`}>
                    {m.label}
                    {i === 5 && <span className="ml-1.5 text-[11px] font-bold text-brand-500">이번 달</span>}
                  </td>
                  <td className="px-5 py-3 text-right text-ink-soft sm:px-6">{m.count}건</td>
                  <td className={`px-5 py-3 text-right sm:px-6 ${i === 5 ? "font-bold text-ink-deep" : "font-semibold text-ink-soft"}`}>
                    {won(m.sum)}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Panel>
      </div>

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
