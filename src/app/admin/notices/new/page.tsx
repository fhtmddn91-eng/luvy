import { NoticeForm } from "@/components/admin/NoticeForm";
import { createNotice } from "@/lib/actions/admin-notices";

export default function NewNoticePage() {
  return (
    <div>
      <h1 className="mb-6 text-[22px] font-extrabold text-ink">공지 추가</h1>
      <NoticeForm action={createNotice} />
    </div>
  );
}
