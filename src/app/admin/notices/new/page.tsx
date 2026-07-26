import { requireAdmin } from "@/lib/auth";
import { NoticeForm } from "@/components/admin/NoticeForm";
import { createNotice } from "@/lib/actions/admin-notices";
import { PageHeader } from "@/components/ui/Panel";

export default async function NewNoticePage() {
  await requireAdmin();
  return (
    <div>
      <PageHeader eyebrow="Catalog" title="공지 추가" description="메인 공지 스트립에 노출됩니다." />
      <NoticeForm action={createNotice} />
    </div>
  );
}
