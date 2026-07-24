import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

const items = [
  {
    emoji: "🚀",
    title: "처음 시작한다면?",
    desc: "초보 셀러 추천 상품 모음",
    href: "/best",
    bg: "from-brand-50 to-brand-100",
  },
  {
    emoji: "✨",
    title: "이번주 신상품",
    desc: "새롭게 업데이트된 신상품",
    href: "/new",
    bg: "from-[#F3EFFB] to-[#E7DFF7]",
  },
  {
    emoji: "🏆",
    title: "많이 팔리는 상품",
    desc: "구매량 높은 인기 상품 TOP 100",
    href: "/best",
    bg: "from-[#FDF6E3] to-[#FAEBC8]",
  },
  {
    emoji: "📦",
    title: "판매자료 다운로드",
    desc: "상세페이지·썸네일·옵션이미지 무료 제공",
    href: "/partner",
    bg: "from-[#E9F7F1] to-[#D6EFE3]",
  },
];

export function QuickMenu() {
  return (
    <section className="mx-auto max-w-[1280px] px-4 pt-8 sm:px-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {items.map((item) => (
          <Link
            key={item.title}
            href={item.href}
            className={`group flex items-center gap-2.5 rounded-2xl bg-gradient-to-br ${item.bg} p-4 transition-shadow hover:shadow-[var(--shadow-card)] sm:gap-3 sm:p-5`}
          >
            <span className="text-[24px] sm:text-[28px]">{item.emoji}</span>
            <span className="min-w-0 flex-1">
              <span className="block break-keep text-[14px] font-extrabold leading-snug text-ink sm:text-[15px]">{item.title}</span>
              <span className="mt-0.5 hidden truncate text-[12px] text-ink-soft sm:block">{item.desc}</span>
            </span>
            <span className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/80 text-brand-500 transition-transform group-hover:translate-x-0.5 sm:flex">
              <Icon name="chevronRight" className="h-4 w-4" strokeWidth={2.2} />
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
