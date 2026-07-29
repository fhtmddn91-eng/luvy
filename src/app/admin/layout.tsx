import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/auth";
import { AdminSidebar } from "@/components/admin/AdminSidebar";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdmin();

  // 처리 대기 건수 배지 — 페이지를 옮길 때마다 새로 계산된다
  const [pendingMembers, newOrders, openInquiries] = await Promise.all([
    db.user.count({ where: { status: "PENDING" } }),
    db.order.count({ where: { status: "RECEIVED" } }),
    db.inquiry.count({ where: { status: "OPEN" } }),
  ]);
  const badges = {
    "/admin/members": pendingMembers,
    "/admin/orders": newOrders,
    "/admin/inquiries": openInquiries,
  };

  return (
    <div className="flex min-h-screen flex-col bg-white">
      <header className="sticky top-0 z-30 border-b border-ink-deep bg-white">
        <div className="flex h-14 items-center justify-between gap-4 px-5 sm:px-7">
          <Link href="/admin" className="flex items-baseline gap-2.5">
            <span className="text-[17px] font-extrabold tracking-[0.2em] text-ink-deep">LUVY</span>
            <span className="text-[9px] font-bold uppercase tracking-[0.24em] text-muted">
              Console
            </span>
          </Link>

          <div className="flex items-center gap-4 text-[11px] font-bold uppercase tracking-[0.12em]">
            <span className="hidden max-w-[160px] truncate normal-case tracking-normal text-muted lg:inline">
              {admin.companyName}
            </span>
            <Link
              href="/"
              className="whitespace-nowrap text-ink-soft transition-colors hover:text-ink-deep"
            >
              Store
            </Link>
            <form action={logoutAction}>
              <button
                type="submit"
                className="whitespace-nowrap text-ink-soft transition-colors hover:text-ink-deep"
              >
                Logout
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col md:flex-row">
        <aside className="shrink-0 border-b border-hairline md:w-[196px] md:border-b-0 md:border-r">
          <div className="md:sticky md:top-14">
            <AdminSidebar badges={badges} />
          </div>
        </aside>
        <main className="min-w-0 flex-1 bg-canvas px-5 py-8 sm:px-7 sm:py-10 lg:px-10">
          {children}
        </main>
      </div>
    </div>
  );
}
