"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import type { HomeStatRow } from "@/lib/home-stats";

/** 로그인 성공 시 서버가 심어주는 1회용 쿠키 (httpOnly 아님 — 클라이언트가 지워야 함) */
const COOKIE = "luvy_welcome";

/** 쿠키가 있으면 true를 반환하고 즉시 지운다 → 로그인 1회당 정확히 한 번만 뜬다 */
function consumeWelcomeFlag(): boolean {
  const found = document.cookie
    .split("; ")
    .some((c) => c.trim() === `${COOKIE}=1`);
  if (found) document.cookie = `${COOKIE}=; Max-Age=0; path=/`;
  return found;
}

export function WelcomeModal({
  companyName,
  rows,
  pending = false,
}: {
  companyName: string;
  rows: HomeStatRow[];
  /** 가입 승인 대기 회원 — 주문이 불가하므로 안내 문구를 바꾼다 */
  pending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (consumeWelcomeFlag()) setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    closeRef.current?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("keydown", onKey);

    // 팝업 떠 있는 동안 배경 스크롤 잠금
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="welcome-title"
    >
      {/* 배경 딤 — 클릭하면 닫힘 */}
      <button
        type="button"
        aria-label="닫기"
        onClick={close}
        className="welcome-fade absolute inset-0 cursor-default bg-ink/40 backdrop-blur-[2px]"
      />

      <div className="welcome-pop relative w-full max-w-[340px] rounded-3xl bg-white p-6 shadow-[0_24px_60px_-15px_rgba(44,43,48,0.35)]">
        <button
          ref={closeRef}
          type="button"
          onClick={close}
          aria-label="닫기"
          className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-cream hover:text-ink"
        >
          <Icon name="close" className="h-4.5 w-4.5 h-[18px] w-[18px]" strokeWidth={2.2} />
        </button>

        <p id="welcome-title" className="pr-8 text-[17px] font-extrabold leading-snug text-ink">
          {companyName}님, 오늘도 화이팅! 👋
        </p>
        <p className="mt-1 text-[12px] text-muted">
          {pending
            ? "가입 승인이 완료되면 도매가 열람·주문이 가능합니다."
            : "오늘 추천 상품과 업데이트를 확인해보세요."}
        </p>

        <ul className="mt-4 space-y-2.5">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center gap-2.5 text-[13px]">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-500">
                <Icon name={r.icon} className="h-4 w-4" strokeWidth={1.8} />
              </span>
              <span className="flex-1 text-ink-soft">{r.label}</span>
              <span className="font-bold text-ink">
                {r.value}
                {r.hot && (
                  <span className="ml-1 rounded-pill bg-brand-500 px-1.5 py-0.5 text-[9px] font-extrabold leading-none text-white">
                    N
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>

        <Link
          href={pending ? "/account/pending" : "/new"}
          onClick={close}
          className="mt-5 flex h-11 items-center justify-center gap-1.5 rounded-pill bg-brand-500 text-[14px] font-bold text-white transition-colors hover:bg-brand-600"
        >
          {pending ? "승인 상태 확인하기" : "바로 확인하기"}
          <Icon name="arrowRight" className="h-4 w-4" strokeWidth={2.2} />
        </Link>

        <button
          type="button"
          onClick={close}
          className="mt-2 h-9 w-full text-[13px] text-muted transition-colors hover:text-ink"
        >
          닫기
        </button>
      </div>
    </div>
  );
}
