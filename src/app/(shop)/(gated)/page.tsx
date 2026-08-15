import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getHomeStats } from "@/lib/home-stats";
import { HeroBanner } from "@/components/home/HeroBanner";
import { HeroGreeting } from "@/components/home/HeroGreeting";
import { QuickMenu } from "@/components/home/QuickMenu";
import { NewProducts } from "@/components/home/NewProducts";
import { ProductTabs } from "@/components/home/ProductTabs";
import { NoticeStrip } from "@/components/home/NoticeStrip";
import { FeatureGrid } from "@/components/home/FeatureGrid";
import { getHomeTabs } from "@/lib/homeTabs";
import { getCategoryTree } from "@/lib/categories";
import { CategoryColumns } from "@/components/layout/CategoryMenu";

export default async function HomePage() {
  const [banners, notices, user, stats, tabs, tree] = await Promise.all([
    db.banner.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.notice.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, take: 3 }),
    getSession(),
    getHomeStats(),
    getHomeTabs(),
    getCategoryTree(),
  ]);

  return (
    <>
      {/* 배너 왼쪽에 전체 카테고리를 상시 노출하고, 오른쪽은 요약 카드로 채운다 —
          가운데가 비어 휑해 보인다는 피드백에 대한 조치 */}
      <HeroBanner
        banners={banners}
        widget={<HeroGreeting companyName={user?.companyName ?? "LUVY"} rows={stats} />}
        sidebar={
          <CategoryColumns
            className="h-full"
            tree={tree.map((t) => ({
              slug: t.slug,
              name: t.name,
              children: t.children.map((c) => ({ slug: c.slug, name: c.name })),
            }))}
          />
        }
      />
      <QuickMenu />
      <ProductTabs tabs={tabs} />
      <NewProducts />
      <NoticeStrip notices={notices} />
      <FeatureGrid />
    </>
  );
}
