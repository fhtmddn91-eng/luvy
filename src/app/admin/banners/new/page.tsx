import { BannerForm } from "@/components/admin/BannerForm";
import { createBanner } from "@/lib/actions/admin-banners";

export default function NewBannerPage() {
  return (
    <div>
      <h1 className="mb-6 text-[22px] font-extrabold text-ink">배너 추가</h1>
      <BannerForm action={createBanner} />
    </div>
  );
}
