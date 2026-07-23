import type { NavLink } from "@/lib/types";

export const utilLinks: NavLink[] = [
  { label: "로그인", href: "/login" },
  { label: "회원가입", href: "/signup" },
  { label: "장바구니", href: "/cart" },
  { label: "주문조회", href: "/orders" },
  { label: "고객센터", href: "/support" },
];

export const gnbLinks: (NavLink & { badge?: string })[] = [
  { label: "이번주 추천", href: "/new", badge: "NEW" },
  { label: "신상품", href: "/new" },
  { label: "인기상품", href: "/best" },
  { label: "기획전", href: "/events" },
  { label: "고객지원", href: "/support" },
];

/** 검색창 하단 추천 검색어 */
export const recommendedKeywords = ["러브젤", "딜도", "SM", "애널", "콘돔", "마사지"];
