import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { won } from "@/lib/format";

const dateFmt = (d: Date) =>
  new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

export default async function OrdersPage() {
  const user = await requireUser();
  const orders = await db.order.findMany({
    where: { userId: user.id },
    include: { items: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="mx-auto max-w-[880px] px-6 py-10">
      <h1 className="mb-6 text-[26px] font-extrabold text-ink">주문 내역</h1>
      {orders.length === 0 ? (
        <div className="flex min-h-[200px] items-center justify-center rounded-2xl border border-dashed border-line text-[14px] text-muted">
          주문 내역이 없습니다.
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map((o) => {
            const first = o.items[0];
            const rest = o.items.length - 1;
            return (
              <Link
                key={o.id}
                href={`/orders/${o.id}`}
                className="block rounded-2xl border border-line bg-white p-5 transition-shadow hover:shadow-[var(--shadow-soft)]"
              >
                <div className="flex items-center justify-between text-[12px] text-muted">
                  <span>{dateFmt(o.createdAt)} · 주문 {o.id.slice(0, 8).toUpperCase()}</span>
                  <span className="rounded-pill bg-brand-50 px-2.5 py-1 font-bold text-brand-600">접수됨</span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <p className="text-[15px] font-medium text-ink">
                    {first?.name}{rest > 0 ? ` 외 ${rest}건` : ""}
                  </p>
                  <p className="text-[16px] font-extrabold text-ink">{won(o.total)}</p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
