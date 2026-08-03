import Link from "next/link";
import { getNavLinks } from "@/lib/navLinks";
import { getCategoryTree } from "@/lib/categories";
import { CategoryMenu } from "./CategoryMenu";

export async function Gnb() {
  const [gnbLinks, tree] = await Promise.all([getNavLinks(), getCategoryTree()]);

  return (
    // 카테고리 줄과 같은 이유로 모바일에서는 줄바꿈 — 가로 스크롤이면 끝 메뉴가 잘린 채 숨는다
    <nav className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-center gap-2 px-4 pb-2.5 pt-1.5 sm:px-6 md:flex-nowrap md:justify-start">
      {/* 예전에는 클릭해도 아무 일 없는 장식 버튼이었다 — 드롭다운으로 교체 */}
      <CategoryMenu
        tree={tree.map((t) => ({
          slug: t.slug,
          name: t.name,
          children: t.children.map((c) => ({ slug: c.slug, name: c.name })),
        }))}
      />

      <div className="flex flex-wrap items-center justify-center gap-1">
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
  );
}
