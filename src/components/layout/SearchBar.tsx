"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { recommendedKeywords } from "@/lib/mock/nav";

export function SearchBar() {
  const router = useRouter();
  return (
    <div className="w-full max-w-[560px]">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          const q = new FormData(e.currentTarget).get("q")?.toString().trim() ?? "";
          if (q) router.push(`/search?q=${encodeURIComponent(q)}`);
        }}
        className="flex h-12 w-full items-center gap-2 rounded-pill border-2 border-brand-400 bg-white pl-5 pr-1.5 transition-colors focus-within:border-brand-500"
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
      <div className="mt-1.5 hidden items-center gap-1 pl-5 text-[12px] lg:flex">
        <span className="font-semibold text-brand-500">추천 검색</span>
        {recommendedKeywords.map((k, i) => (
          <span key={k} className="flex items-center">
            {i > 0 && <span className="mx-1.5 h-2.5 w-px bg-line" aria-hidden />}
            <Link
              href={`/search?q=${encodeURIComponent(k)}`}
              className="text-muted transition-colors hover:text-brand-500"
            >
              {k}
            </Link>
          </span>
        ))}
      </div>
    </div>
  );
}
