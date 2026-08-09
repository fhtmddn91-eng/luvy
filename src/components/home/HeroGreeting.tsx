"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { GreetingCard } from "./GreetingCard";
import type { HomeStatRow } from "@/lib/home-stats";

/** 닫기를 누르면 그 탭에서는 다시 뜨지 않는다(다음 방문에는 다시 보인다) */
const DISMISS_KEY = "luvy:greeting-dismissed";

/**
 * 히어로 오른쪽 요약 카드.
 *
 * 예전에는 로그인 직후 몇 초만 떴다 사라졌는데, 그러고 나면 배너 오른쪽이
 * 통째로 비어 사이트가 휑해 보였다(실사용 피드백) → 상시 노출로 바꾸고,
 * 대신 닫기를 누른 탭에서는 다시 띄우지 않는다.
 */
export function HeroGreeting({
  companyName,
  rows,
}: {
  companyName: string;
  rows: HomeStatRow[];
}) {
  // 서버 HTML 과 어긋나지 않도록 마운트 후에만 그린다(세션 저장소는 클라이언트에만 있다)
  const [visible, setVisible] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    try {
      if (window.sessionStorage.getItem(DISMISS_KEY) === "1") return;
    } catch {
      // 저장소가 막힌 환경 — 그냥 띄운다
    }
    setVisible(true);
  }, []);

  // 한 프레임 뒤에 상태를 바꿔야 떠오르는 트랜지션이 걸린다
  useEffect(() => {
    if (!visible) return;
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  const dismiss = () => {
    try {
      window.sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // 저장이 막혀도 이번 화면에서는 닫힌다
    }
    setShown(false);
    setTimeout(() => setVisible(false), 400);
  };

  if (!visible) return null;

  return (
    <div
      className={`relative w-[290px] rounded-2xl border border-white/60 bg-white/90 p-5 shadow-[var(--shadow-card)] backdrop-blur transition-all duration-500 ease-out motion-reduce:transition-none ${
        shown ? "translate-y-0 opacity-100" : "translate-y-5 opacity-0"
      }`}
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label="닫기"
        className="absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-cream hover:text-ink"
      >
        <Icon name="close" className="h-4 w-4" strokeWidth={2.2} />
      </button>

      <GreetingCard companyName={companyName} rows={rows} onNavigate={dismiss} />
    </div>
  );
}
