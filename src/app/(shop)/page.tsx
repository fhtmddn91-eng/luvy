import { db } from "@/lib/db";
import { HeroBanner } from "@/components/home/HeroBanner";
import { HeroWidget } from "@/components/home/HeroWidget";
import { QuickMenu } from "@/components/home/QuickMenu";
import { NewProducts } from "@/components/home/NewProducts";
import { NoticeStrip } from "@/components/home/NoticeStrip";
import { FeatureGrid } from "@/components/home/FeatureGrid";

export default async function HomePage() {
  const [banners, notices] = await Promise.all([
    db.banner.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.notice.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, take: 3 }),
  ]);

  return (
    <>
      <HeroBanner banners={banners} widget={<HeroWidget />} />
      <QuickMenu />
      <NewProducts />
      <NoticeStrip notices={notices} />
      <FeatureGrid />
    </>
  );
}
