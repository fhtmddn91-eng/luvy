import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getHomeStats } from "@/lib/home-stats";
import { HeroBanner } from "@/components/home/HeroBanner";
import { WelcomeGreeting } from "@/components/home/WelcomeGreeting";
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
      {/* 인사 카드는 로그인 직후 1회만 (luvy_welcome 쿠키를 보고 스스로 판단).
          히어로에 같은 카드를 상주시키면 인사가 두 번 보이므로 여기 하나만 둔다. */}
      <WelcomeGreeting companyName={user?.companyName ?? "LUVY"} rows={stats} />
      <HeroBanner banners={banners} />
      <QuickMenu />
      <NewProducts />
      <NoticeStrip notices={notices} />
      <FeatureGrid />
    </>
  );
}
