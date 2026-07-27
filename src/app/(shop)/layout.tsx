import Link from "next/link";
import { getSession } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/auth";
import { Logo } from "@/components/layout/Logo";
import { UtilBar } from "@/components/layout/UtilBar";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";
import { companyLine, contactLine } from "@/lib/company";

export default async function ShopLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSession();

  /**
   * 폐쇄몰: 검색창·카테고리·GNB가 들어간 정식 헤더는 카탈로그 구조 자체를 노출한다.
   * 그래서 승인 회원에게만 보여주고, 그 외에는 로고만 있는 최소 헤더로 대체한다.
   *
   * - 비로그인: 약관·개인정보처리방침만 열람 가능 → 로그인 버튼
   * - 승인 대기·반려: 승인 안내와 고객센터만 이용 가능 → 로그아웃 버튼
   *   (여기서 카테고리를 보여주면 눌러도 전부 안내 페이지로 튕겨 혼란만 준다)
   */
  const approved = user?.status === "APPROVED";
  if (!approved) {
    return (
      <div className="flex min-h-screen flex-col bg-cream">
        <header className="border-b border-line bg-white">
          <div className="mx-auto flex h-16 max-w-[880px] items-center justify-between px-4 sm:px-6">
            <Logo href={null} />
            {user ? (
              <div className="flex items-center gap-4 text-[13px]">
                <Link href="/support" className="font-semibold text-ink-soft hover:text-brand-500">
                  고객센터
                </Link>
                <form action={logoutAction}>
                  <button
                    type="submit"
                    className="rounded-pill border border-line bg-white px-4 py-2 text-[13px] font-bold text-ink-soft hover:border-brand-300 hover:text-brand-600"
                  >
                    로그아웃
                  </button>
                </form>
              </div>
            ) : (
              <Link
                href="/login"
                className="rounded-pill bg-brand-500 px-5 py-2 text-[13px] font-bold text-white hover:bg-brand-600"
              >
                로그인
              </Link>
            )}
          </div>
        </header>
        <main className="flex-1">{children}</main>
        <footer className="px-4 py-8 text-center text-[12px] text-muted">
          <p>
            {companyLine()} · {contactLine()}
          </p>
          <p className="mt-1.5">
            <Link href="/terms" className="hover:text-brand-500">
              이용약관
            </Link>
            <span className="mx-2 text-line">|</span>
            <Link href="/privacy" className="hover:text-brand-500">
              개인정보처리방침
            </Link>
          </p>
        </footer>
      </div>
    );
  }

  return (
    <>
      <UtilBar />
      <Header />
      <main>{children}</main>
      <Footer />
    </>
  );
}
