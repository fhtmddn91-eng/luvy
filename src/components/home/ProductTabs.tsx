"use client";

import { useState } from "react";
import { ProductGrid } from "@/components/product/ProductGrid";
import type { ProductCardData } from "@/components/product/ProductCard";

export interface TabData {
  id: string;
  label: string;
  products: ProductCardData[];
}

export function ProductTabs({ tabs }: { tabs: TabData[] }) {
  const [active, setActive] = useState(0);
  if (tabs.length === 0) return null;

  const current = tabs[active] ?? tabs[0];

  return (
    <section className="mx-auto max-w-[1280px] px-6 py-10">
      {/*
       * 탭 줄도 카테고리와 같은 이유로 줄바꿈한다 —
       * 가로 스크롤로 두면 좁은 화면에서 마지막 탭이 잘린 채 숨는다.
       */}
      <div
        role="tablist"
        aria-label="추천 상품"
        className="mb-5 flex flex-wrap items-center gap-2 border-b border-line pb-3"
      >
        {tabs.map((t, i) => {
          const on = i === active;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setActive(i)}
              className={
                on
                  ? "rounded-pill bg-brand-500 px-4 py-2 text-[14px] font-bold text-white"
                  : "rounded-pill px-4 py-2 text-[14px] font-bold text-ink-soft transition-colors hover:bg-brand-50 hover:text-brand-600"
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" aria-label={current.label}>
        <ProductGrid products={current.products} />
      </div>
    </section>
  );
}
