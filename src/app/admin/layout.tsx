import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/auth";
import { AdminSidebar } from "@/components/admin/AdminSidebar";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdmin();

  return (
    <div className="min-h-screen bg-cream">
      <header className="flex h-14 items-center justify-between border-b border-line bg-white px-4 sm:px-6">
        <Link href="/admin" className="flex items-center gap-2">
          <span className="text-[18px] font-extrabold tracking-[0.12em] text-ink">LUVY</span>
          <span className="rounded-pill bg-brand-500 px-2 py-0.5 text-[11px] font-bold text-white">
            ADMIN
          </span>
        </Link>
        <div className="flex items-center gap-3 whitespace-nowrap text-[13px] sm:gap-4">
          <span className="hidden text-muted sm:inline">{admin.companyName}</span>
          <Link href="/" className="text-ink-soft hover:text-brand-600">
            사이트 보기
          </Link>
          <form action={logoutAction}>
            <button type="submit" className="text-ink-soft hover:text-brand-600">
              로그아웃
            </button>
          </form>
        </div>
      </header>

      <div className="mx-auto flex max-w-[1400px] flex-col md:flex-row">
        <aside className="w-full shrink-0 border-b border-line bg-white md:w-56 md:border-b-0 md:border-r">
          <AdminSidebar />
        </aside>
        <main className="min-w-0 flex-1 p-4 sm:p-6 md:p-8">{children}</main>
      </div>
    </div>
  );
}
