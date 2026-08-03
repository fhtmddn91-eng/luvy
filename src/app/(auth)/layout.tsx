import { companyLine, contactLine } from "@/lib/company";
import { getCompany } from "@/lib/companyInfo";

/**
 * 인증 페이지 전용 레이아웃.
 *
 * 폐쇄몰이므로 비회원에게는 카탈로그 구조(검색창·카테고리·GNB)를 일절 노출하지 않는다.
 * 상점 레이아웃을 상속하지 않도록 (shop) 그룹 바깥에 둔 이유가 이것이다.
 */

/**
 * 이 아래 페이지(로그인·회원가입)는 **요청마다** 렌더한다.
 *
 * 로고와 사업자 정보를 관리자가 DB에서 바꿀 수 있게 되면서 두 가지 문제가 생겼다:
 *  1. 빌드 시점에 정적 생성하면 그때 DB를 읽는데, 배포 빌드 컨테이너는 DB에 못 붙는다
 *     (Railway 빌드 실패의 원인이었다).
 *  2. 붙는다 해도 그 값이 HTML에 구워져서, 관리자가 로고를 바꿔도 반영되지 않는다.
 *
 * (shop) 쪽은 레이아웃이 쿠키를 읽어 이미 동적이라 이 설정이 필요 없다.
 */
export const dynamic = "force-dynamic";
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  const company = await getCompany();
  return (
    <div className="flex min-h-screen flex-col bg-cream">
      <main className="flex flex-1 items-center justify-center px-4 py-10 sm:py-16">
        {children}
      </main>
      <footer className="px-4 pb-8 text-center text-[12px] text-muted">
        <p>
          {companyLine(company)} · {contactLine(company)}
        </p>
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
