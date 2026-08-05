import Link from "next/link";
import { getNavLinks } from "@/lib/navLinks";
import { getCategoryTree } from "@/lib/categories";
import { CategoryMenu } from "./CategoryMenu";

export async function Gnb() {
  const [gnbLinks, tree] = await Promise.all([getNavLinks(), getCategoryTree()]);

  return (
    /*
     * 모바일 메뉴 줄. 줄바꿈 방식은 폰 폭마다 접히는 위치가 달라져
     * 기기마다 다르게 "깨져" 보였다 (실기기 제보). → 한 줄 스크롤 + 오른쪽
     * "더 있음" 페이드로 통일한다. 데스크톱(md+)은 기존 그대로.
     */
    <div className="relative">
      <nav className="no-scrollbar mx-auto flex max-w-[1280px] items-center gap-2 overflow-x-auto px-4 pb-2.5 pt-1.5 sm:px-6 md:justify-start md:overflow-visible">
        {/* 예전에는 클릭해도 아무 일 없는 장식 버튼이었다 — 드롭다운으로 교체 */}
        <CategoryMenu
          tree={tree.map((t) => ({
            slug: t.slug,
            name: t.name,
            children: t.children.map((c) => ({ slug: c.slug, name: c.name })),
          }))}
        />

        <div className="flex items-center gap-1">
          {gnbLinks.map((link, i) => (
            <Link
              key={`${link.href}-${i}`}
              href={link.href}
              className="flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-[14px] font-bold text-ink transition-colors hover:bg-brand-50 hover:text-brand-500 sm:px-3.5 sm:text-[15px]"
            >
              {link.label}
              {link.badge && (
                <span className="rounded-pill bg-brand-500 px-1.5 py-0.5 text-[9px] font-extrabold leading-none text-white">
                  {link.badge}
                </span>
              )}
            </Link>
          ))}
        </div>
      </nav>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-y-0 right-0 w-10 bg-gradient-to-l from-white to-transparent md:hidden"
      />
    </div>
  );
}
