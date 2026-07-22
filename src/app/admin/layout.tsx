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
      <header className="flex h-14 items-center justify-between border-b border-line bg-white px-6">
        <Link href="/admin" className="flex items-center gap-2">
          <span className="text-[18px] font-extrabold tracking-[0.12em] text-ink">LUVY</span>
          <span className="rounded-pill bg-brand-500 px-2 py-0.5 text-[11px] font-bold text-white">
            ADMIN
          </span>
        </Link>
        <div className="flex items-center gap-4 text-[13px]">
          <span className="text-muted">{admin.companyName}</span>
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

      <div className="mx-auto flex max-w-[1400px]">
        <aside className="w-56 shrink-0 border-r border-line bg-white">
          <AdminSidebar />
        </aside>
        <main className="min-w-0 flex-1 p-8">{children}</main>
      </div>
    </div>
  );
}
