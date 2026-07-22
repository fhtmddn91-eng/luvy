import { db } from "@/lib/db";
import { HeroBanner } from "@/components/home/HeroBanner";
import { NoticeStrip } from "@/components/home/NoticeStrip";
import { FeatureGrid } from "@/components/home/FeatureGrid";

export default async function HomePage() {
  const [banners, notices] = await Promise.all([
    db.banner.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
    db.notice.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }),
  ]);

  return (
    <>
      <HeroBanner banners={banners} />
      <NoticeStrip notices={notices} />
      <FeatureGrid />
    </>
  );
}
