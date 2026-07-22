import Link from "next/link";
import { db } from "@/lib/db";
import { toggleNoticeActive, deleteNotice } from "@/lib/actions/admin-notices";

const kindLabel: Record<string, string> = { notice: "공지사항", stock: "입고 소식", event: "이벤트" };

export default async function AdminNoticesPage() {
  const notices = await db.notice.findMany({ orderBy: { sortOrder: "asc" } });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-extrabold text-ink">공지 관리</h1>
          <p className="mt-1 text-[13px] text-muted">메인 공지 스트립 · {notices.length}개</p>
        </div>
        <Link href="/admin/notices/new" className="rounded-pill bg-brand-500 px-5 py-2.5 text-[14px] font-bold text-white hover:bg-brand-600">
          + 공지 추가
        </Link>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <table className="w-full text-[14px]">
          <thead>
            <tr className="border-b border-line bg-cream/60 text-left text-[12px] text-muted">
              <th className="px-4 py-3 font-medium">순서</th>
              <th className="px-4 py-3 font-medium">구분</th>
              <th className="px-4 py-3 font-medium">내용</th>
              <th className="px-4 py-3 text-center font-medium">노출</th>
              <th className="px-4 py-3 text-right font-medium">관리</th>
            </tr>
          </thead>
          <tbody>
            {notices.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">공지가 없습니다.</td></tr>
            ) : (
              notices.map((n) => (
                <tr key={n.id} className="border-b border-line/60">
                  <td className="px-4 py-3 text-ink-soft">{n.sortOrder}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-pill bg-brand-50 px-2.5 py-1 text-[12px] font-bold text-brand-600">
                      {kindLabel[n.kind] ?? n.tag}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <Link href={`/admin/notices/${n.id}`} className="font-medium text-ink hover:text-brand-600">{n.text}</Link>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`rounded-pill px-2.5 py-1 text-[12px] font-bold ${n.active ? "bg-brand-50 text-brand-600" : "bg-line text-muted"}`}>
                      {n.active ? "노출중" : "숨김"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-3">
                      <form action={toggleNoticeActive.bind(null, n.id, !n.active)}>
                        <button type="submit" className="text-[13px] text-ink-soft hover:text-brand-600">
                          {n.active ? "숨김" : "노출"}
                        </button>
                      </form>
                      <Link href={`/admin/notices/${n.id}`} className="text-[13px] text-ink-soft hover:text-brand-600">수정</Link>
                      <form action={deleteNotice.bind(null, n.id)}>
                        <button type="submit" className="text-[13px] text-muted hover:text-brand-600">삭제</button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
