"use client";

import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";

export function SearchBar() {
  const router = useRouter();
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const q = new FormData(e.currentTarget).get("q")?.toString().trim() ?? "";
        if (q) router.push(`/search?q=${encodeURIComponent(q)}`);
      }}
      className="group flex h-12 w-full max-w-[380px] items-center gap-2 rounded-pill border border-brand-200 bg-white pl-5 pr-2 transition-colors focus-within:border-brand-400"
    >
      <input
        name="q"
        type="text"
        placeholder="상품명 또는 키워드를 검색하세요"
        aria-label="상품 검색"
        className="h-full flex-1 bg-transparent text-[14px] text-ink placeholder:text-muted focus:outline-none"
      />
      <button
        type="submit"
        aria-label="검색"
        className="flex h-9 w-9 items-center justify-center rounded-full text-brand-500 transition-colors hover:bg-brand-50"
      >
        <Icon name="search" className="h-5 w-5" strokeWidth={2} />
      </button>
    </form>
  );
}
