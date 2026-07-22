import Link from "next/link";
import { Logo } from "./Logo";

const footerColumns = [
  {
    title: "쇼핑",
    links: [
      { label: "신상품", href: "/new" },
      { label: "베스트", href: "/best" },
      { label: "기획전", href: "/events" },
      { label: "브랜드관", href: "/brands" },
    ],
  },
  {
    title: "파트너",
    links: [
      { label: "B2B 안내", href: "/partner" },
      { label: "입점 문의", href: "/partner/apply" },
      { label: "대량구매 상담", href: "/partner/bulk" },
      { label: "제휴 제안", href: "/partner/alliance" },
    ],
  },
  {
    title: "고객지원",
    links: [
      { label: "공지사항", href: "/support/notice" },
      { label: "자주 묻는 질문", href: "/support/faq" },
      { label: "1:1 문의", href: "/support/inquiry" },
      { label: "주문/배송 조회", href: "/orders" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-line bg-cream">
      <div className="mx-auto max-w-[1280px] px-6 py-14">
        <div className="flex flex-col gap-12 lg:flex-row lg:justify-between">
          <div className="max-w-xs">
            <Logo />
            <p className="mt-4 text-[13px] leading-relaxed text-muted">
              신뢰할 수 있는 성인 라이프스타일 B2B 플랫폼.
              <br />
              검증된 제품과 파트너십으로 당신의 비즈니스 성공을 함께합니다.
            </p>
            <div className="mt-6 inline-flex items-center gap-2 rounded-pill bg-white px-4 py-2 text-[13px] font-semibold text-brand-600 shadow-[var(--shadow-soft)]">
              고객센터 1600-0000
            </div>
          </div>

          <div className="grid grid-cols-2 gap-10 sm:grid-cols-3">
            {footerColumns.map((col) => (
              <div key={col.title}>
                <h4 className="text-[14px] font-bold text-ink">{col.title}</h4>
                <ul className="mt-4 space-y-2.5">
                  {col.links.map((link) => (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        className="text-[13px] text-ink-soft transition-colors hover:text-brand-500"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-3 border-t border-line pt-6 text-[12px] text-muted md:flex-row md:items-center md:justify-between">
          <p>
            (주)러비 · 대표 000 · 사업자등록번호 000-00-00000 · 통신판매업
            0000-서울-0000
          </p>
          <div className="flex items-center gap-4">
            <Link href="/terms" className="hover:text-brand-500">
              이용약관
            </Link>
            <Link href="/privacy" className="font-semibold hover:text-brand-500">
              개인정보처리방침
            </Link>
          </div>
        </div>

        <p className="mt-6 text-[12px] text-muted/80">
          본 사이트는 성인용품을 취급하며, 만 19세 이상 사업자 회원만 이용
          가능합니다.
        </p>
      </div>
    </footer>
  );
}
