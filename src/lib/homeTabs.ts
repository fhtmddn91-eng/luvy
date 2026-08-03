import "server-only";
import { db } from "@/lib/db";
import {
  fillTab,
  rankIds,
  orderByIds,
  marginRate,
  DEFAULT_SECTIONS,
  HOME_TAB_SIZE,
  type HomeMode,
} from "@/lib/homeSections";
import type { Tier } from "@/lib/pricing";

export interface TabProduct {
  id: string;
  name: string;
  brand: string;
  image: string;
  /** 카드가 품절 배지를 그리려면 재고 정보가 필요하다 */
  trackStock: boolean;
  stock: number;
  priceTiers: Tier[];
}

export interface HomeTab {
  id: string;
  label: string;
  products: TabProduct[];
}

const productSelect = {
  id: true,
  name: true,
  brand: true,
  image: true,
  trackStock: true,
  stock: true,
  priceTiers: true,
} as const;

/** 판매 수량 기준 순위 */
async function popularIds(): Promise<string[]> {
  const rows = await db.orderItem.groupBy({
    by: ["productId"],
    _sum: { quantity: true },
  });
  return rankIds(rows.map((r) => ({ productId: r.productId, value: r._sum.quantity ?? 0 })));
}

/**
 * 재구매 순위 — "몇 번 팔렸나"가 아니라 "같은 회원이 두 번 이상 산 상품인가"로 센다.
 * 한 회원이 대량으로 한 번 사면 인기 탭에는 올라도 재구매 탭에는 오르지 않아야 한다.
 */
async function repeatIds(): Promise<string[]> {
  const rows = await db.orderItem.findMany({
    select: { productId: true, order: { select: { userId: true } } },
  });
  // productId → (userId → 주문 횟수)
  const perProduct = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const byUser = perProduct.get(r.productId) ?? new Map<string, number>();
    byUser.set(r.order.userId, (byUser.get(r.order.userId) ?? 0) + 1);
    perProduct.set(r.productId, byUser);
  }
  const scored = [...perProduct.entries()].map(([productId, byUser]) => ({
    productId,
    value: [...byUser.values()].filter((n) => n >= 2).length,
  }));
  return rankIds(scored);
}

/**
 * 마진율 순위 — 소비자가(basePrice) 대비 최저 도매 단가의 남는 비율.
 * 주문 데이터가 필요 없어서 오픈 직후에도 실제 값으로 정렬된다.
 */
async function marginIds(): Promise<string[]> {
  const rows = await db.product.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, basePrice: true, priceTiers: { select: { unitPrice: true } } },
  });
  const scored = rows.map((p) => ({
    productId: p.id,
    value: marginRate(p.basePrice, Math.min(...p.priceTiers.map((t) => t.unitPrice), Infinity)),
  }));
  return rankIds(scored);
}

/**
 * 메인 상품 탭. 관리자가 설정한 게 없으면 기본 4탭으로 보여준다
 * (마이그레이션만 돌고 설정 전인 상태에서 메인이 비지 않도록).
 */
export async function getHomeTabs(): Promise<HomeTab[]> {
  const newest = await db.product.findMany({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    take: HOME_TAB_SIZE * 2,
    select: productSelect,
  });
  // 판매중 상품이 아예 없으면 탭을 통째로 감춘다
  if (newest.length === 0) return [];

  const sections = await db.homeSection.findMany({
    where: { active: true },
    orderBy: { sortOrder: "asc" },
    include: { picks: { orderBy: { sortOrder: "asc" }, select: { productId: true } } },
  });

  const configured =
    sections.length > 0
      ? sections
      : DEFAULT_SECTIONS.map((s, i) => ({ id: `default-${i}`, ...s, picks: [] as { productId: string }[] }));

  // 순위 계산은 탭마다 필요한 것만 (주문이 많아지면 매번 다 도는 게 아깝다)
  const needsPopular = configured.some((s) => s.mode === "AUTO_POPULAR");
  const needsRepeat = configured.some((s) => s.mode === "AUTO_REPEAT");
  const needsMargin = configured.some((s) => s.mode === "AUTO_MARGIN");
  const [popular, repeat, margin] = await Promise.all([
    needsPopular ? popularIds() : Promise.resolve([]),
    needsRepeat ? repeatIds() : Promise.resolve([]),
    needsMargin ? marginIds() : Promise.resolve([]),
  ]);

  // 순위·수동 선택에 등장하는 상품을 한 번에 가져온다
  const wanted = new Set<string>([
    ...popular,
    ...repeat,
    ...margin,
    ...configured.flatMap((s) => s.picks.map((p) => p.productId)),
  ]);
  const pool =
    wanted.size > 0
      ? await db.product.findMany({
          where: { id: { in: [...wanted] }, status: "ACTIVE" },
          select: productSelect,
        })
      : [];

  const toTab = (mode: HomeMode, pickIds: string[]): TabProduct[] => {
    const ranked =
      mode === "MANUAL"
        ? orderByIds(pool, pickIds)
        : mode === "AUTO_POPULAR"
          ? orderByIds(pool, popular)
          : mode === "AUTO_REPEAT"
            ? orderByIds(pool, repeat)
            : mode === "AUTO_MARGIN"
              ? orderByIds(pool, margin)
              : newest;
    // 규칙 결과가 모자라면 신상품으로 채운다
    return fillTab(ranked as TabProduct[], newest as TabProduct[]);
  };

  return configured
    .map((s) => ({
      id: s.id,
      label: s.label,
      products: toTab(s.mode as HomeMode, s.picks.map((p) => p.productId)),
    }))
    .filter((t) => t.products.length > 0);
}
