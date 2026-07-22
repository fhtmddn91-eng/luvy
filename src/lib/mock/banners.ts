import type { Banner } from "@/lib/types";

export const banners: Banner[] = [
  {
    id: "b1",
    eyebrow: "LOVE YOUR BUSINESS",
    title: "LUVY, 당신의 비즈니스를\n더 빛나게",
    subtitle:
      "신뢰할 수 있는 제품과 파트너십으로\n성인 라이프스타일 비즈니스의 성공을 함께합니다.",
    primaryCta: { label: "회원가입하고 혜택받기", href: "/signup" },
    secondaryCta: { label: "B2B 안내 보기", href: "/partner" },
    bg: "from-brand-100 via-cream to-brand-50",
  },
  {
    id: "b2",
    eyebrow: "NEW ARRIVALS",
    title: "이번 주 입고된\n프리미엄 신상품",
    subtitle:
      "엄선된 글로벌 브랜드의 신상품을\n합리적인 도매가로 가장 먼저 만나보세요.",
    primaryCta: { label: "신상품 보러가기", href: "/new" },
    secondaryCta: { label: "브랜드관 둘러보기", href: "/brands" },
    bg: "from-brand-50 via-cream to-brand-100",
  },
  {
    id: "b3",
    eyebrow: "PARTNER BENEFIT",
    title: "전담 파트너가\n1:1로 함께합니다",
    subtitle:
      "재고 관리부터 빠른 배송까지,\n안정적인 물류 시스템으로 매출을 키우세요.",
    primaryCta: { label: "파트너 신청하기", href: "/partner" },
    secondaryCta: { label: "혜택 자세히 보기", href: "/events" },
    bg: "from-cream via-brand-50 to-brand-100",
  },
  {
    id: "b4",
    eyebrow: "BEST SELLER",
    title: "지금 가장 많이 팔린\n베스트 아이템",
    subtitle:
      "현장에서 검증된 인기 상품으로\n회전율 높은 매대를 구성해보세요.",
    primaryCta: { label: "베스트 보러가기", href: "/best" },
    secondaryCta: { label: "카테고리 전체", href: "/category" },
    bg: "from-brand-100 via-brand-50 to-cream",
  },
  {
    id: "b5",
    eyebrow: "WELCOME OFFER",
    title: "신규 가입 시\n10,000P 즉시 지급",
    subtitle:
      "지금 LUVY의 파트너가 되고\n첫 주문부터 특별한 혜택을 받아보세요.",
    primaryCta: { label: "지금 가입하기", href: "/signup" },
    secondaryCta: { label: "이벤트 전체 보기", href: "/events" },
    bg: "from-brand-50 via-cream to-brand-50",
  },
];
