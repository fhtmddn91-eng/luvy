"use client";

import { useEffect, useRef } from "react";

/**
 * 북마클릿 링크.
 * React는 javascript: href 를 보안상 차단하므로, 마운트 후 DOM에 직접 설정한다.
 * (북마크바로 드래그해야 하므로 반드시 실제 href 가 있는 a 태그여야 한다)
 */
export function BookmarkletLink({ href, label }: { href: string; label: string }) {
  const ref = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    ref.current?.setAttribute("href", href);
  }, [href]);

  return (
    <a
      ref={ref}
      draggable
      onClick={(e) => e.preventDefault()}
      className="inline-block cursor-grab border border-ink-deep bg-ink-deep px-5 py-3 text-[12px] font-bold uppercase tracking-[0.12em] text-white active:cursor-grabbing"
    >
      {label}
    </a>
  );
}
