"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { categoryHref } from "@/lib/nav";

export interface CategoryMenuItem {
  slug: string;
  name: string;
  children: { slug: string; name: string }[];
}

/**
 * 헤더 좌측 "전체 카테고리".
 *
 * 데스크톱은 대분류·소분류를 한 번에 펼치는 메가메뉴다. 예전의 "대분류 세로
 * 목록 + 호버 플라이아웃"은 홈 화면 왼쪽에 상시 노출되는 카테고리 기둥과
 * 모양이 똑같아, 클릭하면 기둥 위에 같은 목록이 겹쳐 "카테고리 위에
 * 카테고리"로 보였다(클라이언트 제보). 대분류마다 컬럼을 나눠 가로로
 * 펼치므로 그보다 더 예전 방식(세로 2단 그리드)처럼 화면 아래로 넘치지
 * 않고, 카테고리가 늘어날 때를 대비해 내부 스크롤을 안전망으로 둔다.
 *
 * 모바일은 같은 구조를 아코디언 시트로 편다 — 예전에는 md 미만에서
 * 버튼 자체가 숨겨져 카테고리로 갈 방법이 없었다.
 */
export function CategoryMenu({ tree }: { tree: CategoryMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // 모바일 시트는 포털로 body 에 나가 있어 rootRef 안에 없다 —
  // 따로 잡아두지 않으면 시트를 누르는 순간 "바깥 클릭"으로 닫혀 링크가 안 눌린다
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => setMounted(true), []);

  // 바깥 클릭·ESC 로 닫기
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (sheetRef.current?.contains(t)) return;
      if (rootRef.current && !rootRef.current.contains(t)) setOpen(false);
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
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className="flex shrink-0 items-center gap-2 whitespace-nowrap rounded-lg border border-line bg-white px-3 py-2 text-[14px] font-bold text-ink transition-colors hover:border-brand-300 hover:text-brand-600 sm:px-3.5"
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
        <>
          {/* 데스크톱: 전 카테고리 펼침 메가메뉴 */}
          <div
            role="menu"
            className="absolute left-0 top-[calc(100%+6px)] z-50 hidden md:block"
          >
            <CategoryMegaMenu tree={tree} onNavigate={() => setOpen(false)} />
          </div>

          {/* 모바일: 전체 화면 시트.
              헤더에 backdrop-blur 가 걸려 있어 그 안의 fixed 는 헤더 기준으로
              잡힌다 → 본문(body)으로 포털을 내보내야 화면 전체를 덮는다. */}
          {mounted &&
            createPortal(
              <div ref={sheetRef} className="fixed inset-0 z-[60] md:hidden">
                <button
                  type="button"
                  aria-label="닫기"
                  onClick={() => setOpen(false)}
                  className="absolute inset-0 bg-ink/35"
                />
                <div className="absolute inset-x-0 bottom-0 top-[12%] overflow-y-auto rounded-t-2xl border-t border-line bg-white">
                  <div className="sticky top-0 flex items-center justify-between border-b border-line bg-white px-4 py-3.5">
                    <p className="text-[15px] font-extrabold text-ink">전체 카테고리</p>
                    <button
                      type="button"
                      onClick={() => setOpen(false)}
                      aria-label="닫기"
                      className="flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-cream hover:text-ink"
                    >
                      <Icon name="close" className="h-5 w-5" strokeWidth={2.2} />
                    </button>
                  </div>
                  <CategoryAccordion tree={tree} onNavigate={() => setOpen(false)} />
                </div>
              </div>,
              document.body,
            )}
        </>
      )}
    </div>
  );
}

/**
 * 데스크톱 메가메뉴 — 대분류가 컬럼 제목, 아래로 소분류를 1열 나열.
 * 소분류를 2열로 접으면 어드민에서 넣은 순서(1,2,3…)가 지그재그(1 2 / 3 4)로
 * 보인다는 제보가 있었다 — 여기와 아래 플라이아웃·아코디언 모두 1열이 규칙이다.
 */
function CategoryMegaMenu({
  tree,
  onNavigate,
}: {
  tree: CategoryMenuItem[];
  onNavigate: () => void;
}) {
  return (
    <div className="max-h-[min(560px,calc(100vh-180px))] w-[min(1080px,calc(100vw-40px))] overflow-y-auto rounded-2xl border border-line bg-white p-6 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap gap-x-10 gap-y-7">
        {tree.map((top) => (
          <section key={top.slug} className="w-[140px]">
            <Link
              href={categoryHref(top.slug)}
              onClick={onNavigate}
              className="mb-2 block break-keep border-b-2 border-line pb-2 text-[14.5px] font-extrabold leading-snug text-ink transition-colors hover:text-brand-600"
            >
              {top.name}
            </Link>
            {top.children.length > 0 && (
              <ul>
                {top.children.map((kid) => (
                  <li key={kid.slug}>
                    <Link
                      href={categoryHref(kid.slug)}
                      onClick={onNavigate}
                      className="block break-keep py-[5px] text-[13.5px] leading-snug text-ink-soft transition-colors hover:text-brand-500"
                    >
                      {kid.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * 홈 화면 왼쪽에 상시 노출되는 카테고리 기둥 — 대분류 세로 목록 + 세부 플라이아웃.
 * (헤더 드롭다운은 위의 메가메뉴를 쓴다)
 */
export function CategoryColumns({
  tree,
  onNavigate,
  className = "",
}: {
  tree: CategoryMenuItem[];
  onNavigate?: () => void;
  className?: string;
}) {
  // null = 아무것도 안 고른 상태. 마우스가 떠나면 세부 패널을 닫는다
  const [active, setActive] = useState<string | null>(null);
  const current = tree.find((t) => t.slug === active);

  return (
    <div
      className={`relative ${className}`}
      onMouseLeave={() => setActive(null)}
    >
      <ul className="h-full w-[190px] overflow-y-auto border-r border-line bg-white/95 py-3 backdrop-blur">
        {tree.map((top) => (
          <li key={top.slug}>
            <Link
              href={categoryHref(top.slug)}
              onClick={onNavigate}
              onMouseEnter={() => setActive(top.slug)}
              onFocus={() => setActive(top.slug)}
              aria-current={active === top.slug ? "true" : undefined}
              className={`flex items-center justify-between gap-2 px-4 py-3 text-[14px] font-bold transition-colors ${
                active === top.slug ? "bg-brand-50 text-brand-600" : "text-ink hover:bg-cream"
              }`}
            >
              <span className="truncate">{top.name}</span>
              {top.children.length > 0 && (
                <Icon name="chevronRight" className="h-4 w-4 shrink-0 opacity-60" strokeWidth={2} />
              )}
            </Link>
          </li>
        ))}
      </ul>

      {current && current.children.length > 0 && (
        <div className="absolute left-full top-0 z-40 max-h-[440px] min-w-[210px] max-w-[320px] overflow-y-auto rounded-2xl border border-line bg-white p-4 shadow-[var(--shadow-card)]">
          <Link
            href={categoryHref(current.slug)}
            onClick={onNavigate}
            className="mb-2.5 block border-b border-line pb-2 text-[13.5px] font-extrabold text-brand-600"
          >
            {current.name} 전체보기
          </Link>
          {/* 소분류는 1열 — 2열로 접으면 어드민 입력 순서가 지그재그로 보이고
              글자도 작아진다는 제보(카테고리 디자인 수정 요청서) */}
          <ul>
            {current.children.map((kid) => (
              <li key={kid.slug}>
                <Link
                  href={categoryHref(kid.slug)}
                  onClick={onNavigate}
                  className="block break-keep py-[5px] text-[14px] leading-snug text-ink-soft transition-colors hover:text-brand-500"
                >
                  {kid.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** 모바일 시트용 아코디언 — 좁은 화면에서는 메가메뉴가 놓일 자리가 없다 */
function CategoryAccordion({
  tree,
  onNavigate,
}: {
  tree: CategoryMenuItem[];
  onNavigate: () => void;
}) {
  const [openSlug, setOpenSlug] = useState<string | null>(tree[0]?.slug ?? null);

  return (
    <ul className="divide-y divide-line">
      {tree.map((top) => {
        const expanded = openSlug === top.slug;
        return (
          <li key={top.slug}>
            <div className="flex items-stretch">
              <Link
                href={categoryHref(top.slug)}
                onClick={onNavigate}
                className="flex-1 px-4 py-3.5 text-[14.5px] font-bold text-ink"
              >
                {top.name}
              </Link>
              {top.children.length > 0 && (
                <button
                  type="button"
                  onClick={() => setOpenSlug(expanded ? null : top.slug)}
                  aria-expanded={expanded}
                  aria-label={`${top.name} 세부 카테고리`}
                  className="flex w-12 items-center justify-center text-muted"
                >
                  <Icon
                    name="chevronDown"
                    className={`h-4.5 w-4.5 transition-transform ${expanded ? "rotate-180" : ""}`}
                    strokeWidth={2}
                  />
                </button>
              )}
            </div>
            {expanded && top.children.length > 0 && (
              <ul className="bg-cream px-4 pb-3.5 pt-1">
                {top.children.map((kid) => (
                  <li key={kid.slug}>
                    <Link
                      href={categoryHref(kid.slug)}
                      onClick={onNavigate}
                      className="block break-keep py-2 text-[14px] leading-snug text-ink-soft"
                    >
                      {kid.name}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );
}
