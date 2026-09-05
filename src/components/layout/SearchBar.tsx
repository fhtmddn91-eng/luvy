"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";

/**
 * 검색창. 예전엔 밑에 대분류 바로가기 줄이 붙어 있었는데 운영자 요청(2026-09-05)으로
 * 뺐다 — 바로 아래 「전체 카테고리」 메가메뉴와 홈 카테고리 기둥이 같은 길을 낸다.
 */
export function SearchBar() {
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
    </div>
  );
}
