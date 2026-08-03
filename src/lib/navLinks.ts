import "server-only";
import { cache } from "react";
import { db } from "@/lib/db";

/**
 * 상단 메뉴(GNB)는 DB(NavLink)가 원본이다.
 * 코드에 박아두면 문구 하나 바꾸는 데도 배포가 필요하다.
 *
 * DB가 비어 있으면(이관 전 배포) 기존 메뉴를 그대로 보여준다 —
 * 마이그레이션만 돌고 시드가 안 된 상태에서 헤더가 텅 비는 걸 막는다.
 */
export const FALLBACK_NAV: { label: string; href: string; badge: string }[] = [
  { label: "이번주 추천", href: "/new", badge: "NEW" },
  { label: "신상품", href: "/new", badge: "" },
  { label: "인기상품", href: "/best", badge: "" },
  { label: "기획전", href: "/events", badge: "" },
  { label: "고객지원", href: "/support", badge: "" },
];

export const getNavLinks = cache(async () => {
  try {
    const rows = await db.navLink.findMany({
      where: { active: true },
      orderBy: { sortOrder: "asc" },
    });
    return rows.length > 0
      ? rows.map((r) => ({ label: r.label, href: r.href, badge: r.badge }))
      : FALLBACK_NAV;
  } catch (e) {
    // 조회가 실패해도 헤더는 떠야 한다 — 위 폴백을 둔 취지가 예외로 무력화되면 안 된다
    console.error("[nav] 조회 실패 — 기본 메뉴 사용:", e);
    return FALLBACK_NAV;
  }
});

/** 어드민용 — 숨긴 항목 포함 전체 */
export const getAllNavLinks = cache(() =>
  db.navLink.findMany({ orderBy: { sortOrder: "asc" } }),
);
