import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { NoticeForm } from "@/components/admin/NoticeForm";
import { updateNotice } from "@/lib/actions/admin-notices";

export default async function EditNoticePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const notice = await db.notice.findUnique({ where: { id } });
  if (!notice) notFound();

  return (
    <div>
      <h1 className="mb-6 text-[22px] font-extrabold text-ink">공지 수정</h1>
      <NoticeForm action={updateNotice.bind(null, id)} notice={notice} />
    </div>
  );
}
