import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { BannerForm } from "@/components/admin/BannerForm";
import { updateBanner } from "@/lib/actions/admin-banners";
import { PageHeader } from "@/components/ui/Panel";

export default async function EditBannerPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const banner = await db.banner.findUnique({ where: { id } });
  if (!banner) notFound();

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="배너 수정"
        description={banner.title.replace(/\n/g, " ")}
      />
      <BannerForm action={updateBanner.bind(null, id)} banner={banner} />
    </div>
  );
}
