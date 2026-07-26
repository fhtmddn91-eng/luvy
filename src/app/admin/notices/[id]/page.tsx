import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { NoticeForm } from "@/components/admin/NoticeForm";
import { updateNotice } from "@/lib/actions/admin-notices";
import { PageHeader } from "@/components/ui/Panel";

export default async function EditNoticePage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const notice = await db.notice.findUnique({ where: { id } });
  if (!notice) notFound();

  return (
    <div>
      <PageHeader eyebrow="Catalog" title="공지 수정" description={notice.text} />
      <NoticeForm action={updateNotice.bind(null, id)} notice={notice} />
    </div>
  );
}
