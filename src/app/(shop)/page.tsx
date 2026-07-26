import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getHomeStats } from "@/lib/home-stats";
import { HeroBanner } from "@/components/home/HeroBanner";
import { HeroWidget } from "@/components/home/HeroWidget";
import { WelcomeModal } from "@/components/home/WelcomeModal";
import { QuickMenu } from "@/components/home/QuickMenu";
import { NewProducts } from "@/components/home/NewProducts";
import { NoticeStrip } from "@/components/home/NoticeStrip";
import { FeatureGrid } from "@/components/home/FeatureGrid";

export default async function HomePage() {
  const [banners, notices, user, stats] = await Promise.all([
    db.banner.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.notice.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, take: 3 }),
    getSession(),
    getHomeStats(),
  ]);

  return (
    <>
      {/* 로그인 직후 1회만 노출 (luvy_welcome 쿠키를 보고 스스로 판단) */}
      <WelcomeModal
        companyName={user?.companyName ?? "LUVY"}
        rows={stats}
        pending={Boolean(user && user.status !== "APPROVED")}
      />
      <HeroBanner banners={banners} widget={<HeroWidget />} />
      <QuickMenu />
      <NewProducts />
      <NoticeStrip notices={notices} />
      <FeatureGrid />
    </>
  );
}
