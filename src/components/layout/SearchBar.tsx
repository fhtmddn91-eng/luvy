"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { categoryHref } from "@/lib/nav";

export function SearchBar({
  categories,
}: {
  categories: { slug: string; name: string }[];
}) {
  const router = useRouter();
  return (
    <div className="w-full">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const q = new FormData(e.currentTarget).get("q")?.toString().trim() ?? "";
          if (q) router.push(`/search?q=${encodeURIComponent(q)}`);
        }}
        className="mx-auto flex h-12 w-full max-w-[560px] items-center gap-2 rounded-pill border-2 border-brand-400 bg-white pl-5 pr-1.5 transition-colors focus-within:border-brand-500"
      >
        <input
          name="q"
          type="text"
          placeholder="어떤 상품을 찾고 계신가요?"
          aria-label="상품 검색"
          className="h-full flex-1 bg-transparent text-[14px] text-ink placeholder:text-muted focus:outline-none"
        />
        <button
          type="submit"
          aria-label="검색"
          className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500 text-white transition-colors hover:bg-brand-600"
        >
          <Icon name="search" className="h-4.5 w-4.5 h-[18px] w-[18px]" strokeWidth={2.2} />
        </button>
      </form>

      {/*
       * 카테고리 바로가기.
       * 예전에는 좁은 화면에서 가로 스크롤이었는데, 스크롤바를 숨겨둬서(no-scrollbar)
       * 화면 밖 카테고리가 있다는 신호가 전혀 없었다. 390px에서 8개 중 3개가 잘렸다.
       * → 모바일에서는 줄바꿈으로 전부 보여주고, 넓은 화면에서만 한 줄로 유지한다.
       */}
      <nav
        aria-label="상품 카테고리"
        className="mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1.5 sm:flex-nowrap sm:gap-x-5"
      >
        {categories.map((cat) => (
          <Link
            key={cat.slug}
            href={categoryHref(cat.slug)}
            className="shrink-0 whitespace-nowrap text-[13px] font-semibold text-ink-soft transition-colors hover:text-brand-500"
          >
            {cat.name}
          </Link>
        ))}
      </nav>
    </div>
  );
}
