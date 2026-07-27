"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { GreetingCard } from "./GreetingCard";
import type { HomeStatRow } from "@/lib/home-stats";

/** 로그인 성공 시 서버가 심어주는 1회용 쿠키 (httpOnly 아님 — 클라이언트가 지워야 함) */
const COOKIE = "luvy_welcome";

/** 카드가 떠 있는 시간. 지나면 스스로 내려간다 */
const SHOW_MS = 6000;
/** 내려가는 트랜지션 길이 — 아래 duration-500 과 맞춘다 */
const LEAVE_MS = 550;

/** 쿠키가 있으면 true를 반환하고 즉시 지운다 → 로그인 1회당 정확히 한 번만 뜬다 */
function consumeWelcomeFlag(): boolean {
  const found = document.cookie.split("; ").some((c) => c.trim() === `${COOKIE}=1`);
  if (found) document.cookie = `${COOKIE}=; Max-Age=0; path=/`;
  return found;
}

type Phase = "enter" | "shown" | "leave";

/**
 * 히어로 우측 원래 자리에서 로그인 직후에만 인사 카드를 띄운다.
 * 아래에서 살짝 떠올랐다가(enter) 몇 초 머문 뒤(shown) 다시 내려간다(leave).
 * 가운데 모달이 아니므로 딤·스크롤 잠금 없이 배너 위에 겹쳐만 진다.
 */
export function HeroGreeting({
  companyName,
  rows,
}: {
  companyName: string;
  rows: HomeStatRow[];
}) {
  const [phase, setPhase] = useState<Phase | null>(null);
  // 읽고 있는 중(호버)에는 내려가지 않도록 타이머가 참조
  const hoverRef = useRef(false);

  useEffect(() => {
    if (consumeWelcomeFlag()) setPhase("enter");
    // 주의: 여기서 shown 예약까지 하면 안 된다. StrictMode가 effect를 두 번 돌릴 때
    // 첫 실행이 쿠키를 지워 두 번째 실행이 빈손이 되고, 예약은 cleanup으로 취소돼
    // 카드가 enter(투명) 상태에 멈춘다. 예약은 phase를 보는 아래 effect가 맡는다.
  }, []);

  // 오프셋 상태로 한 프레임 그린 뒤 shown 으로 바꿔야 떠오르는 트랜지션이 걸린다
  useEffect(() => {
    if (phase !== "enter") return;
    const raf = requestAnimationFrame(() =>
      requestAnimationFrame(() => setPhase("shown")),
    );
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  // 머무는 시간이 지나면 내려간다. 호버 중이면 내려가기를 미룬다.
  useEffect(() => {
    if (phase !== "shown") return;
    let timer: ReturnType<typeof setTimeout>;
    const tryLeave = () => {
      if (hoverRef.current) timer = setTimeout(tryLeave, 1500);
      else setPhase("leave");
    };
    timer = setTimeout(tryLeave, SHOW_MS);
    return () => clearTimeout(timer);
  }, [phase]);

  // 내려가는 트랜지션이 끝나면 DOM에서 제거
  useEffect(() => {
    if (phase !== "leave") return;
    const t = setTimeout(() => setPhase(null), LEAVE_MS);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase === null) return null;

  const shown = phase === "shown";

  return (
    <div
      data-phase={phase}
      onMouseEnter={() => (hoverRef.current = true)}
      onMouseLeave={() => (hoverRef.current = false)}
      className={`relative w-[290px] rounded-2xl border border-white/60 bg-white/90 p-5 shadow-[var(--shadow-card)] backdrop-blur transition-all duration-500 ease-out motion-reduce:transition-none ${
        shown ? "translate-y-0 opacity-100" : "translate-y-5 opacity-0"
      }`}
    >
      <button
        type="button"
        onClick={() => setPhase("leave")}
        aria-label="닫기"
        className="absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-full text-muted transition-colors hover:bg-cream hover:text-ink"
      >
        <Icon name="close" className="h-4 w-4" strokeWidth={2.2} />
      </button>

      <GreetingCard
        companyName={companyName}
        rows={rows}
        onNavigate={() => setPhase("leave")}
      />
    </div>
  );
}
