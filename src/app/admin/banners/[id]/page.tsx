import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { BannerForm } from "@/components/admin/BannerForm";
import { updateBanner } from "@/lib/actions/admin-banners";

export default async function EditBannerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const banner = await db.banner.findUnique({ where: { id } });
  if (!banner) notFound();

  return (
    <div>
      <h1 className="mb-6 text-[22px] font-extrabold text-ink">배너 수정</h1>
      <BannerForm action={updateBanner.bind(null, id)} banner={banner} />
    </div>
  );
}
