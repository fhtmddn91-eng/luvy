"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { GreetingCard } from "./GreetingCard";
import type { HomeStatRow } from "@/lib/home-stats";

/** 로그인 성공 시 서버가 심어주는 1회용 쿠키 (httpOnly 아님 — 클라이언트가 지워야 함) */
const COOKIE = "luvy_welcome";

/** 쿠키가 있으면 true를 반환하고 즉시 지운다 → 로그인 1회당 정확히 한 번만 뜬다 */
function consumeWelcomeFlag(): boolean {
  const found = document.cookie.split("; ").some((c) => c.trim() === `${COOKIE}=1`);
  if (found) document.cookie = `${COOKIE}=; Max-Age=0; path=/`;
  return found;
}

/**
 * 인사 카드를 로그인 직후 한 번만 팝업으로 띄운다.
 *
 * 같은 카드를 히어로에 상주시키면서 팝업까지 띄우면 같은 인사가 두 번 보인다.
 * 그래서 상주 위젯은 없애고, 이 팝업 하나만 남겼다.
 */
export function WelcomeGreeting({
  companyName,
  rows,
}: {
  companyName: string;
  rows: HomeStatRow[];
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
      aria-label="회원 인사"
    >
      {/* 배경 딤 — 클릭하면 닫힘 */}
      <button
        type="button"
        aria-label="닫기"
        onClick={close}
        className="welcome-fade absolute inset-0 cursor-default bg-ink/40 backdrop-blur-[2px]"
      />

      <div className="welcome-pop relative w-[290px] rounded-2xl bg-white p-5 shadow-[0_24px_60px_-15px_rgba(44,43,48,0.35)]">
        <button
          ref={closeRef}
          type="button"
          onClick={close}
          aria-label="닫기"
          className="absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-cream hover:text-ink"
        >
          <Icon name="close" className="h-[18px] w-[18px]" strokeWidth={2.2} />
        </button>

        <GreetingCard companyName={companyName} rows={rows} onNavigate={close} />
      </div>
    </div>
  );
}
