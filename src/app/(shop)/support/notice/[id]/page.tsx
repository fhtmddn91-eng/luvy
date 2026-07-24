import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { dateFmt } from "@/lib/format";

export default async function NoticeDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const notice = await db.notice.findUnique({ where: { id } });
  if (!notice || !notice.active) notFound();

  return (
    <div className="mx-auto max-w-[880px] px-4 py-10 sm:px-6">
      <article className="rounded-2xl border border-line bg-white p-5 sm:p-8">
        <div className="flex items-center gap-3">
          <span className="rounded-pill bg-brand-50 px-2.5 py-1 text-[11px] font-bold text-brand-600">
            {notice.tag}
          </span>
          <span className="text-[12px] text-muted">{dateFmt(notice.createdAt)}</span>
        </div>
        <h1 className="mt-3 text-[20px] font-extrabold leading-snug text-ink sm:text-[22px]">
          {notice.text}
        </h1>
        <div className="mt-6 border-t border-line pt-6 text-[14px] leading-relaxed text-ink-soft">
          {notice.body ? (
            <div className="whitespace-pre-line">{notice.body}</div>
          ) : (
            <p className="text-muted">상세 내용이 없는 공지입니다.</p>
          )}
        </div>
      </article>

      <div className="mt-6 flex items-center justify-between text-[13px]">
        <Link href="/support/notice" className="text-muted hover:text-brand-500">
          ← 목록으로
        </Link>
        <Link href="/support/inquiry" className="font-semibold text-brand-500 hover:text-brand-600">
          문의하기
        </Link>
      </div>
    </div>
  );
}
