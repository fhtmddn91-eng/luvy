"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { categoryHref } from "@/lib/nav";

export interface CategoryMenuItem {
  slug: string;
  name: string;
  children: { slug: string; name: string }[];
}

/**
 * 헤더 좌측 "전체 카테고리" 드롭다운.
 * 예전에는 눌러도 아무 일도 없는 장식 버튼이었다 — 실서버 피드백으로 발견.
 */
export function CategoryMenu({ tree }: { tree: CategoryMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 바깥 클릭·ESC 로 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (tree.length === 0) return null;

  return (
    <div ref={rootRef} className="relative hidden md:block">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-line bg-white px-3.5 py-2 text-[14px] font-bold text-ink transition-colors hover:border-brand-300 hover:text-brand-600"
      >
        <Icon name="menu" className="h-[18px] w-[18px]" strokeWidth={2} />
        전체 카테고리
        <Icon
          name="chevronDown"
          className={`h-4 w-4 text-muted transition-transform ${open ? "rotate-180" : ""}`}
          strokeWidth={2}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 top-[calc(100%+6px)] z-50 w-[560px] rounded-2xl border border-line bg-white p-5 shadow-[var(--shadow-card)]"
        >
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            {tree.map((top) => (
              <div key={top.slug}>
                <Link
                  href={categoryHref(top.slug)}
                  onClick={() => setOpen(false)}
                  className="block text-[14px] font-bold text-ink transition-colors hover:text-brand-600"
                >
                  {top.name}
                </Link>
                {top.children.length > 0 && (
                  <ul className="mt-1.5 space-y-1">
                    {top.children.map((kid) => (
                      <li key={kid.slug}>
                        <Link
                          href={categoryHref(kid.slug)}
                          onClick={() => setOpen(false)}
                          className="block text-[13px] text-ink-soft transition-colors hover:text-brand-500"
                        >
                          {kid.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
