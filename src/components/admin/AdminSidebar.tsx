"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const nav = [
  { href: "/admin", label: "대시보드", exact: true },
  { href: "/admin/products", label: "상품 관리" },
  { href: "/admin/orders", label: "주문 관리" },
  { href: "/admin/members", label: "회원 관리" },
  { href: "/admin/inquiries", label: "문의 관리" },
  { href: "/admin/banners", label: "배너 관리" },
  { href: "/admin/notices", label: "공지 관리" },
];

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <nav className="no-scrollbar flex gap-1 overflow-x-auto p-3 md:flex-col md:overflow-visible md:p-4">
      {nav.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`shrink-0 whitespace-nowrap rounded-lg px-3.5 py-2 text-[14px] font-semibold transition-colors md:px-4 md:py-2.5 ${
              active
                ? "bg-brand-500 text-white"
                : "text-ink-soft hover:bg-brand-50 hover:text-brand-600"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
