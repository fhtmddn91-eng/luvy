import Link from "next/link";
import { db } from "@/lib/db";
import { Icon } from "@/components/ui/Icon";
import { ProductThumb } from "@/components/product/ProductThumb";

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

export async function QuickMenu() {
  // 카드 우측 장식 썸네일. 사진이 등록된 상품을 우선 사용하고(image desc → 빈 문자열이 뒤로),
  // 사진이 없으면 ProductThumb이 브랜드 타일로 대체한다.
  const thumbs = await db.product.findMany({
    where: { status: "ACTIVE" },
    orderBy: [{ image: "desc" }, { createdAt: "desc" }],
    take: items.length,
    select: { id: true, brand: true, image: true },
  });

  return (
    <section className="mx-auto max-w-[1280px] px-4 pt-8 sm:px-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {items.map((item, i) => {
          const thumb = thumbs[i];
          return (
            <Link
              key={item.title}
              href={item.href}
              className={`group flex items-center gap-2.5 rounded-2xl bg-gradient-to-br ${item.bg} p-4 transition-shadow hover:shadow-[var(--shadow-card)] sm:gap-3 sm:p-5`}
            >
              <span className="text-[24px] sm:text-[28px]">{item.emoji}</span>
              <span className="min-w-0 flex-1">
                <span className="block break-keep text-[14px] font-extrabold leading-snug text-ink sm:text-[15px]">
                  {item.title}
                </span>
                <span className="mt-0.5 hidden truncate text-[12px] text-ink-soft sm:block">
                  {item.desc}
                </span>
              </span>
              <span className="hidden h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/80 text-brand-500 transition-transform group-hover:translate-x-0.5 sm:flex">
                <Icon name="chevronRight" className="h-4 w-4" strokeWidth={2.2} />
              </span>
              {/* 카드 폭이 넉넉할 때만 노출: 모바일 2열(좁음)과 lg 4열(232px, 제목 눌림) 구간에서는 숨김 */}
              {thumb && (
                <span className="hidden shrink-0 sm:block lg:hidden xl:block">
                  <ProductThumb
                    id={thumb.id}
                    brand={thumb.brand}
                    image={thumb.image || undefined}
                    className="h-12 w-12 rounded-xl text-[6px] xl:h-14 xl:w-14"
                  />
                </span>
              )}
            </Link>
          );
        })}
      </div>
    </section>
  );
}
