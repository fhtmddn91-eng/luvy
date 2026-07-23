import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { won } from "@/lib/format";
import { StatCard } from "@/components/admin/StatCard";

const dateFmt = (d: Date) =>
  new Intl.DateTimeFormat("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);

export default async function AdminDashboardPage() {
  await requireAdmin();
  const [orderCount, revenue, memberCount, productCount, recentOrders] = await Promise.all([
    db.order.count(),
    db.order.aggregate({ _sum: { total: true } }),
    db.user.count({ where: { role: "MEMBER" } }),
    db.product.count({ where: { status: "ACTIVE" } }),
    db.order.findMany({ orderBy: { createdAt: "desc" }, take: 5, include: { items: true, user: true } }),
  ]);

  return (
    <div>
      <h1 className="text-[22px] font-extrabold text-ink">대시보드</h1>
      <p className="mt-1 text-[13px] text-muted">LUVY 운영 현황 요약</p>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="총 주문" value={`${orderCount}건`} />
        <StatCard label="총 매출" value={won(revenue._sum.total ?? 0)} />
        <StatCard label="사업자 회원" value={`${memberCount}명`} />
        <StatCard label="판매중 상품" value={`${productCount}개`} />
      </div>

      <div className="mt-8 rounded-2xl border border-line bg-white p-6 shadow-[var(--shadow-soft)]">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-ink">최근 주문</h2>
          <Link href="/admin/orders" className="text-[13px] font-semibold text-brand-600 hover:underline">
            전체 보기
          </Link>
        </div>
        {recentOrders.length === 0 ? (
          <p className="py-8 text-center text-[14px] text-muted">주문이 없습니다.</p>
        ) : (
          <table className="w-full text-[14px]">
            <thead>
              <tr className="border-b border-line text-left text-[12px] text-muted">
                <th className="py-2 font-medium">주문번호</th>
                <th className="py-2 font-medium">회원</th>
                <th className="py-2 font-medium">상품</th>
                <th className="py-2 text-right font-medium">금액</th>
                <th className="py-2 text-right font-medium">일시</th>
              </tr>
            </thead>
            <tbody>
              {recentOrders.map((o) => (
                <tr key={o.id} className="border-b border-line/60">
                  <td className="py-2.5">
                    <Link href={`/admin/orders/${o.id}`} className="font-semibold text-brand-600 hover:underline">
                      {o.id.slice(0, 8).toUpperCase()}
                    </Link>
                  </td>
                  <td className="py-2.5 text-ink-soft">{o.user.companyName}</td>
                  <td className="py-2.5 text-ink-soft">
                    {o.items[0]?.name}{o.items.length > 1 ? ` 외 ${o.items.length - 1}건` : ""}
                  </td>
                  <td className="py-2.5 text-right font-semibold text-ink">{won(o.total)}</td>
                  <td className="py-2.5 text-right text-muted">{dateFmt(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
