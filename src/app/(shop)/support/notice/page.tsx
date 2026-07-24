import Link from "next/link";
import { db } from "@/lib/db";
import { dateFmt } from "@/lib/format";

export default async function NoticeListPage() {
  const notices = await db.notice.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
  });

  return (
    <div className="mx-auto max-w-[880px] px-4 py-10 sm:px-6">
      <p className="text-[13px] font-semibold text-brand-500">NOTICE</p>
      <h1 className="mt-1 text-[26px] font-extrabold text-ink sm:text-[28px]">공지사항</h1>
      <p className="mb-6 mt-1 text-[13px] text-muted">{notices.length}개의 공지</p>

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        {notices.length === 0 ? (
          <p className="py-16 text-center text-[14px] text-muted">등록된 공지가 없습니다.</p>
        ) : (
          <ul className="divide-y divide-line/70">
            {notices.map((n) => (
              <li key={n.id}>
                <Link
                  href={`/support/notice/${n.id}`}
                  className="flex items-center gap-3 px-4 py-4 transition-colors hover:bg-brand-50/40 sm:px-6"
                >
                  <span className="shrink-0 rounded-pill bg-brand-50 px-2.5 py-1 text-[11px] font-bold text-brand-600">
                    {n.tag}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-ink">
                    {n.text}
                  </span>
                  <span className="shrink-0 text-[12px] text-muted">{dateFmt(n.createdAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-6 text-center">
        <Link href="/support" className="text-[13px] text-muted hover:text-brand-500">
          ← 고객센터로 돌아가기
        </Link>
      </div>
    </div>
  );
}
