import { HeroBanner } from "@/components/home/HeroBanner";
import { NoticeStrip } from "@/components/home/NoticeStrip";
import { FeatureGrid } from "@/components/home/FeatureGrid";

export default function HomePage() {
  return (
    <>
      <HeroBanner />
      <NoticeStrip />
      <FeatureGrid />
    </>
  );
}
