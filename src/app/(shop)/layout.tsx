import Link from "next/link";
import { getSession } from "@/lib/auth";
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
   * 폐쇄몰: 비로그인 상태로 접근할 수 있는 (shop) 경로는 약관·개인정보처리방침뿐이다.
   * 이때 검색창·카테고리·GNB가 들어간 정식 헤더를 렌더하면 카탈로그 구조가 노출되므로
   * 로고와 로그인 버튼만 있는 최소 헤더로 대체한다.
   */
  if (!user) {
    return (
      <div className="flex min-h-screen flex-col bg-cream">
        <header className="border-b border-line bg-white">
          <div className="mx-auto flex h-16 max-w-[880px] items-center justify-between px-4 sm:px-6">
            <Logo href={null} />
            <Link
              href="/login"
              className="rounded-pill bg-brand-500 px-5 py-2 text-[13px] font-bold text-white hover:bg-brand-600"
            >
              로그인
            </Link>
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
