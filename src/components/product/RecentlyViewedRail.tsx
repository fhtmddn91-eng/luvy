"use client";

/* eslint-disable @next/next/no-img-element */
import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { RECENT_EVENT, readRecent, type RecentItem } from "./recentlyViewed";

/** 한 번에 보여줄 개수. 더 넣으면 세로로 화면을 다 먹는다. */
const WINDOW = 4;

/**
 * 화면 오른쪽에 붙는 "최근 본 상품" 레일.
 *
 * 본문(최대 1280px)과 겹치면 안 되므로 여백이 확보되는 2xl(1536px) 이상에서만
 * 띄운다 — 1280~1440 에서는 푸터 링크 위에 그대로 얹혀 버린다.
 */
export function RecentlyViewedRail() {
  const [items, setItems] = useState<RecentItem[]>([]);
  const [start, setStart] = useState(0);

  useEffect(() => {
    const sync = () => {
      setItems(readRecent(window.localStorage));
      setStart(0);
    };
    sync();
    window.addEventListener(RECENT_EVENT, sync);
    // 다른 탭에서 본 상품도 반영된다
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(RECENT_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  if (items.length === 0) return null;

  const maxStart = Math.max(0, items.length - WINDOW);
  const visible = items.slice(start, start + WINDOW);

  return (
    <aside
      aria-label="최근 본 상품"
      className="fixed right-5 top-1/2 z-30 hidden w-[92px] -translate-y-1/2 rounded-2xl border border-line bg-white/95 p-2 shadow-[var(--shadow-card)] backdrop-blur 2xl:block"
    >
      <p className="pb-2 text-center text-[11px] font-bold text-ink-soft">최근 본 상품</p>
      <ul className="space-y-2">
        {visible.map((it) => (
          <li key={it.id}>
            <Link href={`/products/${it.id}`} className="group block" title={it.name}>
              <div className="overflow-hidden rounded-lg border border-line bg-cream">
                {it.image ? (
                  <img
                    src={it.image}
                    alt=""
                    loading="lazy"
                    className="aspect-square w-full object-cover transition-opacity group-hover:opacity-85"
                  />
                ) : (
                  <div className="aspect-square w-full bg-brand-50" />
                )}
              </div>
              <span className="mt-1 block truncate text-center text-[10.5px] text-muted group-hover:text-brand-600">
                {it.name}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      {items.length > WINDOW && (
        <div className="mt-2 flex justify-center gap-1 border-t border-line pt-2">
          <button
            type="button"
            onClick={() => setStart((s) => Math.max(0, s - 1))}
            disabled={start === 0}
            aria-label="이전"
            className="flex h-6 w-6 items-center justify-center rounded-full text-muted transition-colors hover:bg-cream hover:text-ink disabled:opacity-30"
          >
            <Icon name="chevronDown" className="h-3.5 w-3.5 rotate-180" strokeWidth={2.2} />
          </button>
          <button
            type="button"
            onClick={() => setStart((s) => Math.min(maxStart, s + 1))}
            disabled={start >= maxStart}
            aria-label="다음"
            className="flex h-6 w-6 items-center justify-center rounded-full text-muted transition-colors hover:bg-cream hover:text-ink disabled:opacity-30"
          >
            <Icon name="chevronDown" className="h-3.5 w-3.5" strokeWidth={2.2} />
          </button>
        </div>
      )}
    </aside>
  );
}
