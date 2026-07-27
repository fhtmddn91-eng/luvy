import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import type { HomeStatRow } from "@/lib/home-stats";

/**
 * 회원 인사 카드 — 오늘의 업데이트/추천 요약.
 * 히어로에 상주하지 않고, 로그인 직후 한 번만 팝업으로 띄운다(WelcomeGreeting).
 */
export function GreetingCard({
  companyName,
  rows,
  onNavigate,
}: {
  companyName: string;
  rows: HomeStatRow[];
  /** 링크를 눌러 이동할 때 팝업을 닫기 위한 콜백 */
  onNavigate?: () => void;
}) {
  return (
    <>
      <p className="pr-8 text-[16px] font-extrabold text-ink">
        {companyName}님, 오늘도 화이팅! 👋
      </p>
      <p className="mt-1 text-[12px] text-muted">
        오늘 추천 상품과 업데이트를 확인해보세요.
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
        href="/new"
        onClick={onNavigate}
        className="mt-4 flex h-11 items-center justify-center rounded-pill bg-brand-500 text-[14px] font-bold text-white transition-colors hover:bg-brand-600"
      >
        바로 확인하기
      </Link>
    </>
  );
}
