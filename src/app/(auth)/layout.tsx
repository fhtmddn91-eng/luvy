/**
 * 인증 페이지 전용 레이아웃.
 *
 * 폐쇄몰이므로 비회원에게는 카탈로그 구조(검색창·카테고리·GNB)를 일절 노출하지 않는다.
 * 상점 레이아웃을 상속하지 않도록 (shop) 그룹 바깥에 둔 이유가 이것이다.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-cream">
      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:py-16">
        {children}
      </main>
      <footer className="px-4 pb-8 text-center text-[12px] text-muted">
        <p>(주)러비 · 사업자등록번호 000-00-00000 · 고객센터 1600-0000</p>
        <p className="mt-1.5">
          <a href="/terms" className="hover:text-brand-500">
            이용약관
          </a>
          <span className="mx-2 text-line">|</span>
          <a href="/privacy" className="hover:text-brand-500">
            개인정보처리방침
          </a>
        </p>
        <p className="mt-2">본 사이트는 만 19세 이상 사업자 회원만 이용할 수 있습니다.</p>
      </footer>
    </div>
  );
}
