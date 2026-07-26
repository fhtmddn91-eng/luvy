import Link from "next/link";
import { requireAdmin } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/auth";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { Icon } from "@/components/ui/Icon";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await requireAdmin();

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <header className="sticky top-0 z-30 border-b border-hairline bg-white/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/admin" className="flex items-baseline gap-2.5">
            <span className="text-[19px] font-extrabold tracking-[0.16em] text-ink-deep">LUVY</span>
            <span className="font-display text-[12px] italic tracking-[0.08em] text-brand-500">
              Console
            </span>
          </Link>

          <div className="flex items-center gap-2 text-[13px] sm:gap-4">
            <span className="hidden max-w-[160px] truncate text-muted lg:inline">
              {admin.companyName}
            </span>
            <span aria-hidden className="hidden h-3.5 w-px bg-hairline lg:block" />
            <Link
              href="/"
              className="flex items-center gap-1.5 whitespace-nowrap font-medium text-ink-soft transition-colors hover:text-ink-deep"
            >
              <Icon name="store" className="h-4 w-4" strokeWidth={1.7} />
              <span className="hidden sm:inline">사이트 보기</span>
            </Link>
            <form action={logoutAction}>
              <button
                type="submit"
                className="whitespace-nowrap rounded-pill border border-hairline px-3.5 py-1.5 font-medium text-ink-soft transition-colors hover:border-ink-deep hover:text-ink-deep"
              >
                로그아웃
              </button>
            </form>
          </div>
        </div>
      </header>

      {/* flex-1 이 있어야 사이드바 구분선이 화면 끝까지 이어진다 */}
      <div className="mx-auto flex w-full max-w-[1440px] flex-1 flex-col md:flex-row">
        <aside className="shrink-0 border-b border-hairline bg-white/60 md:w-[212px] md:border-b-0 md:border-r">
          <div className="md:sticky md:top-16">
            <AdminSidebar />
          </div>
        </aside>
        <main className="min-w-0 flex-1 px-4 py-7 sm:px-6 sm:py-9 lg:px-10">{children}</main>
      </div>
    </div>
  );
}
