import { Icon } from "@/components/ui/Icon";
import { trustBadges } from "@/lib/mock/trust";

export function TrustBadges() {
  return (
    <div className="grid grid-cols-2 gap-x-8 gap-y-5 md:grid-cols-4">
      {trustBadges.map((badge, i) => (
        <div
          key={badge.title}
          className="relative flex items-center justify-center gap-3"
        >
          {/* 칸 사이 구분선. 흐름에서 빼 절대배치로 둔다 — 흐름에 두면 구분선
              폭과 gap 만큼 그 칸의 내용이 오른쪽으로 밀려, 첫 칸만 중앙이
              어긋난다. -left-4 는 gap-x-8 의 절반이라 칸 사이 정중앙에 선다. */}
          {i > 0 && (
            <span
              className="absolute -left-4 top-1/2 hidden h-12 w-px -translate-y-1/2 bg-brand-200/70 md:block"
              aria-hidden
            />
          )}
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/70 text-brand-500 shadow-[var(--shadow-soft)]">
            <Icon name={badge.icon} className="h-5 w-5" strokeWidth={1.7} />
          </span>
          {/* 크기를 22px/18px 까지 올려봤으나 배지 줄이 무거워 되돌렸다.
              이 자리는 보조 정보라 본문보다 작아야 한다. */}
          <div className="leading-tight">
            <p className="text-[15.5px] font-bold text-ink">{badge.title}</p>
            <p className="text-[13px] text-muted">{badge.desc}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
