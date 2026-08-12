"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const groups: { heading: string; items: { href: string; label: string; exact?: boolean }[] }[] = [
  {
    heading: "Overview",
    items: [{ href: "/admin", label: "대시보드", exact: true }],
  },
  {
    heading: "Catalog",
    items: [
      { href: "/admin/products", label: "상품 관리" },
      { href: "/admin/categories", label: "카테고리" },
      { href: "/admin/nav", label: "상단 메뉴" },
      { href: "/admin/home", label: "메인 상품 탭" },
      // 1688 은 상위 경로라 exact — 없으면 /admin/import/domestic 에서도 활성으로 보인다
      { href: "/admin/import", label: "1688 수집", exact: true },
      { href: "/admin/import/domestic", label: "국내 사이트" },
      { href: "/admin/banners", label: "배너 관리" },
      { href: "/admin/notices", label: "공지 관리" },
      { href: "/admin/faqs", label: "FAQ 관리" },
    ],
  },
  {
    heading: "Operations",
    items: [
      { href: "/admin/orders", label: "주문 관리" },
      { href: "/admin/members", label: "회원 관리" },
      { href: "/admin/inquiries", label: "문의 관리" },
    ],
  },
  {
    heading: "System",
    items: [
      { href: "/admin/audit", label: "감사 로그" },
      { href: "/admin/settings", label: "설정" },
    ],
  },
];

export function AdminSidebar({
  badges = {},
}: {
  /** href → 처리 대기 건수. 0이거나 없으면 배지를 그리지 않는다 */
  badges?: Record<string, number>;
}) {
  const pathname = usePathname();
  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  return (
    <nav
      aria-label="관리 메뉴"
      className="no-scrollbar flex gap-1 overflow-x-auto px-3 py-3 md:block md:space-y-7 md:overflow-visible md:px-4 md:py-6"
    >
      {groups.map((group) => (
        <div key={group.heading} className="contents md:block">
          {/* 그룹 라벨은 데스크톱에서만 — 모바일은 한 줄 스크롤 탭 */}
          <p className="eyebrow mb-2.5 hidden px-3 md:block">{group.heading}</p>
          {group.items.map((item) => {
            const active = isActive(item.href, item.exact);
            const badge = badges[item.href] ?? 0;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`relative flex shrink-0 items-center gap-2 whitespace-nowrap px-3.5 py-2 text-[13px] transition-colors md:px-3 md:py-2 ${
                  active
                    ? "bg-ink-deep font-bold text-white md:bg-transparent md:text-ink-deep"
                    : "font-medium text-muted hover:text-ink-deep"
                }`}
              >
                {/* 데스크톱 활성 표시 — 좌측 각진 바 */}
                {active && (
                  <span
                    aria-hidden
                    className="absolute left-0 top-1/2 hidden h-3.5 w-[2px] -translate-y-1/2 bg-ink-deep md:block"
                  />
                )}
                {item.label}
                {badge > 0 && (
                  <span
                    aria-label={`처리 대기 ${badge}건`}
                    className="inline-flex h-[18px] min-w-[18px] items-center justify-center bg-brand-600 px-1 text-[10px] font-extrabold leading-none text-white"
                  >
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
