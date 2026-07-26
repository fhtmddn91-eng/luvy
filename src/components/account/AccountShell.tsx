import Link from "next/link";

const nav = [
  { href: "/account", label: "계정 홈", exact: true },
  { href: "/orders", label: "주문 내역" },
  { href: "/support/inquiry", label: "1:1 문의" },
  { href: "/cart", label: "장바구니" },
];

/**
 * 마이페이지 계열 공용 셸.
 * 좌측 얇은 내비 + 우측 콘텐츠. 좁은 화면에선 내비가 가로 스크롤 탭이 된다.
 */
export function AccountShell({
  eyebrow = "My account",
  title,
  description,
  current,
  action,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  /** 현재 페이지 경로 (활성 표시용) */
  current: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-canvas">
      <div className="mx-auto max-w-[1120px] px-4 py-9 sm:px-6 sm:py-12">
        <header className="rise mb-8 flex flex-wrap items-end justify-between gap-4 border-b border-hairline pb-6">
          <div className="min-w-0">
            <p className="eyebrow font-display">{eyebrow}</p>
            <h1 className="mt-2 text-[26px] font-bold leading-tight tracking-[-0.02em] text-ink-deep sm:text-[30px]">
              {title}
            </h1>
            {description && <p className="mt-2 text-[13px] text-muted">{description}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>

        <div className="grid gap-7 lg:grid-cols-[188px_1fr] lg:gap-10">
          <nav aria-label="마이페이지 메뉴" className="rise rise-1">
            <ul className="no-scrollbar flex gap-1.5 overflow-x-auto lg:block lg:space-y-0.5">
              {nav.map((item) => {
                const active = item.exact ? current === item.href : current.startsWith(item.href);
                return (
                  <li key={item.href} className="shrink-0">
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`relative block whitespace-nowrap rounded-lg px-3.5 py-2 text-[13.5px] transition-colors lg:px-3 lg:py-2.5 ${
                        active
                          ? "bg-ink-deep font-bold text-white lg:bg-transparent lg:text-ink-deep"
                          : "font-medium text-muted hover:text-ink-deep lg:hover:bg-white"
                      }`}
                    >
                      {active && (
                        <span
                          aria-hidden
                          className="absolute left-0 top-1/2 hidden h-4 w-[2px] -translate-y-1/2 rounded-full bg-brand-500 lg:block"
                        />
                      )}
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </div>
  );
}
