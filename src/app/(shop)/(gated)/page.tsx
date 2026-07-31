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

export default async function HomePage() {
  const [banners, notices, user, stats, tabs] = await Promise.all([
    db.banner.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.notice.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, take: 3 }),
    getSession(),
    getHomeStats(),
    getHomeTabs(),
  ]);

  return (
    <>
      {/* 인사 카드 — 히어로 우측 원래 자리에서 로그인 직후 1회만 떴다가 내려간다
          (luvy_welcome 쿠키를 보고 스스로 판단) */}
      <HeroBanner
        banners={banners}
        widget={<HeroGreeting companyName={user?.companyName ?? "LUVY"} rows={stats} />}
      />
      <QuickMenu />
      <ProductTabs tabs={tabs} />
      <NewProducts />
      <NoticeStrip notices={notices} />
      <FeatureGrid />
    </>
  );
}
