import { Icon } from "@/components/ui/Icon";
import { trustBadges } from "@/lib/mock/trust";

export function TrustBadges() {
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-5 md:grid-cols-4">
      {trustBadges.map((badge, i) => (
        <div key={badge.title} className="flex items-center gap-3">
          {i > 0 && (
            <span className="hidden h-9 w-px bg-brand-200/70 md:block" aria-hidden />
          )}
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/70 text-brand-500 shadow-[var(--shadow-soft)]">
            <Icon name={badge.icon} className="h-5 w-5" strokeWidth={1.7} />
          </span>
          {/* 모바일은 2열이라 폭이 좁다 — 데스크톱 크기를 그대로 쓰면 "전담 파트너 /
              지원", "전국 당일/ / 익일 발송" 처럼 서너 줄로 갈라진다(실측 390px). */}
          <div className="leading-tight">
            <p className="text-[15px] font-bold text-ink md:text-[22px]">{badge.title}</p>
            <p className="text-[13px] text-muted md:text-[18px]">{badge.desc}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
