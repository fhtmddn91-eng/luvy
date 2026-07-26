import { requireAdmin } from "@/lib/auth";
import { BannerForm } from "@/components/admin/BannerForm";
import { createBanner } from "@/lib/actions/admin-banners";
import { PageHeader } from "@/components/ui/Panel";

export default async function NewBannerPage() {
  await requireAdmin();
  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="배너 추가"
        description="메인 히어로 슬라이드를 추가합니다."
      />
      <BannerForm action={createBanner} />
    </div>
  );
}
