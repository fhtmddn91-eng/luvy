import Link from "next/link";
import { db } from "@/lib/db";
import { won } from "@/lib/format";
import { ORDER_STATUS, orderStatusLabel, orderStatusTone } from "@/lib/orderStatus";

const dateFmt = (d: Date) =>
  new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);

const filters = ["ALL", "RECEIVED", "PREPARING", "SHIPPED", "DELIVERED", "CANCELED"];

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const active = status && ORDER_STATUS[status] ? status : "ALL";

  const orders = await db.order.findMany({
    where: active === "ALL" ? undefined : { status: active },
    include: { items: true, user: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <h1 className="text-[22px] font-extrabold text-ink">주문 관리</h1>
      <p className="mt-1 text-[13px] text-muted">{orders.length}건</p>

      <div className="mt-5 flex flex-wrap gap-2">
        {filters.map((f) => (
          <Link
            key={f}
            href={f === "ALL" ? "/admin/orders" : `/admin/orders?status=${f}`}
            className={`rounded-pill px-4 py-1.5 text-[13px] font-semibold transition-colors ${
              active === f ? "bg-brand-500 text-white" : "bg-white text-ink-soft hover:bg-brand-50"
            }`}
          >
            {f === "ALL" ? "전체" : orderStatusLabel(f)}
          </Link>
        ))}
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-white">
        <table className="w-full text-[14px]">
          <thead>
            <tr className="border-b border-line bg-cream/60 text-left text-[12px] text-muted">
              <th className="px-4 py-3 font-medium">주문번호</th>
              <th className="px-4 py-3 font-medium">회원</th>
              <th className="px-4 py-3 font-medium">상품</th>
              <th className="px-4 py-3 text-right font-medium">금액</th>
              <th className="px-4 py-3 text-center font-medium">상태</th>
              <th className="px-4 py-3 text-right font-medium">일시</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">주문이 없습니다.</td>
              </tr>
            ) : (
              orders.map((o) => (
                <tr key={o.id} className="border-b border-line/60">
                  <td className="px-4 py-3">
                    <Link href={`/admin/orders/${o.id}`} className="font-semibold text-brand-600 hover:underline">
                      {o.id.slice(0, 8).toUpperCase()}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{o.user.companyName}</td>
                  <td className="px-4 py-3 text-ink-soft">
                    {o.items[0]?.name}{o.items.length > 1 ? ` 외 ${o.items.length - 1}건` : ""}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-ink">{won(o.total)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`rounded-pill px-2.5 py-1 text-[12px] font-bold ${orderStatusTone(o.status)}`}>
                      {orderStatusLabel(o.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-muted">{dateFmt(o.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
