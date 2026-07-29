import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { won } from "@/lib/format";
import { orderStatusLabel, orderStatusTone } from "@/lib/orderStatus";
import { parseOrderFilter, orderWhere, filterQuery } from "@/lib/orderQuery";
import { courierName, hasShipment } from "@/lib/shipping";
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
  searchParams: Promise<{ status?: string; q?: string; from?: string; to?: string }>;
}) {
  await requireAdmin();
  const filter = parseOrderFilter(await searchParams);
  const active = filter.status;

  const orders = await db.order.findMany({
    where: orderWhere(filter),
    include: { items: true, user: true },
    orderBy: { createdAt: "desc" },
  });

  const sum = orders.reduce((acc, o) => acc + o.total, 0);
  const filtered = filter.q !== "" || filter.from !== "" || filter.to !== "";

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="주문 관리"
        description={`${orders.length}건 · 합계 ${won(sum)}`}
        action={
          orders.length > 0 ? (
            <a
              href={`/api/admin/orders.csv${filterQuery(filter)}`}
              className="border border-hairline bg-white px-4 py-2.5 text-[12px] font-bold uppercase tracking-[0.12em] text-ink-soft transition-colors hover:border-ink-deep hover:text-ink-deep"
            >
              엑셀 다운로드 (CSV)
            </a>
          ) : undefined
        }
      />

      <div className="rise rise-1">
        <FilterTabs
          items={filters.map((f) => ({
            // 탭을 옮겨도 검색어·기간은 유지된다
            href: `/admin/orders${filterQuery(filter, { status: f })}`,
            label: f === "ALL" ? "전체" : orderStatusLabel(f),
            active: active === f,
          }))}
        />
      </div>

      {/* 검색 + 기간 */}
      <form action="/admin/orders" className="rise rise-1 mb-4 mt-3 flex flex-wrap items-center gap-2">
        {active !== "ALL" && <input type="hidden" name="status" value={active} />}
        <input
          name="q"
          defaultValue={filter.q}
          placeholder="주문번호 · 회원사 · 수령인 · 송장번호"
          className="h-10 w-full max-w-[280px] border border-hairline bg-white px-3.5 text-[13px] text-ink-deep placeholder:text-muted focus:border-ink-deep focus:outline-none"
        />
        <div className="flex items-center gap-1.5 text-[13px] text-muted">
          <input
            type="date"
            name="from"
            defaultValue={filter.from}
            aria-label="시작일"
            className="h-10 border border-hairline bg-white px-2.5 text-[13px] text-ink-deep focus:border-ink-deep focus:outline-none"
          />
          ~
          <input
            type="date"
            name="to"
            defaultValue={filter.to}
            aria-label="종료일"
            className="h-10 border border-hairline bg-white px-2.5 text-[13px] text-ink-deep focus:border-ink-deep focus:outline-none"
          />
        </div>
        <button
          type="submit"
          className="h-10 bg-ink-deep px-5 text-[12px] font-bold uppercase tracking-[0.12em] text-white transition-opacity hover:opacity-80"
        >
          검색
        </button>
        {filtered && (
          <Link
            href={`/admin/orders${active === "ALL" ? "" : `?status=${active}`}`}
            className="text-[13px] text-muted underline underline-offset-4 hover:text-ink-deep"
          >
            초기화
          </Link>
        )}
      </form>

      <div className="rise rise-2">
        <Panel flush>
          {orders.length === 0 ? (
            <EmptyState>해당 조건의 주문이 없습니다.</EmptyState>
          ) : (
            <TableWrap minWidth={900}>
              <thead>
                <tr className="border-b border-hairline-soft">
                  <Th>주문번호</Th>
                  <Th>회원</Th>
                  <Th>상품</Th>
                  <Th align="right">금액</Th>
                  <Th>송장</Th>
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
                        className="font-display text-[14px] tracking-[0.04em] text-ink-deep hover:text-ink-deep"
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
                    <td className="whitespace-nowrap px-5 py-3.5 text-[12px] sm:px-6">
                      {hasShipment(o) ? (
                        <span className="text-ink-soft">
                          {courierName(o.courier)}
                          <span className="ml-1.5 font-display tracking-[0.04em] text-ink-deep">
                            {o.trackingNo}
                          </span>
                        </span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
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
