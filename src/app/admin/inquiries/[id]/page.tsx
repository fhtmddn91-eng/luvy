import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { dateFmt } from "@/lib/format";
import { INQUIRY_TYPES } from "@/lib/inquiry";
import { InquiryAnswerForm } from "@/components/admin/InquiryAnswerForm";

export default async function AdminInquiryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAdmin();
  const { id } = await params;

  const inquiry = await db.inquiry.findUnique({
    where: { id },
    include: {
      user: { select: { companyName: true, email: true, phone: true, ownerName: true } },
    },
  });
  if (!inquiry) notFound();

  return (
    <div className="max-w-[760px]">
      <Link href="/admin/inquiries" className="text-[13px] text-muted hover:text-ink">
        ← 문의 목록
      </Link>

      <div className="mt-3 rounded-2xl border border-line bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-pill bg-brand-50 px-2.5 py-1 text-[11px] font-bold text-brand-600">
            {INQUIRY_TYPES[inquiry.type as keyof typeof INQUIRY_TYPES] ?? inquiry.type}
          </span>
          <span
            className={`rounded-pill px-2.5 py-1 text-[11px] font-bold ${
              inquiry.status === "ANSWERED" ? "bg-brand-500 text-white" : "bg-line text-ink-soft"
            }`}
          >
            {inquiry.status === "ANSWERED" ? "답변 완료" : "답변 대기"}
          </span>
          <span className="text-[12px] text-muted">{dateFmt(inquiry.createdAt)}</span>
        </div>

        <h1 className="mt-3 text-[19px] font-extrabold text-ink">{inquiry.title}</h1>
        <p className="mt-3 whitespace-pre-line border-t border-line pt-4 text-[14px] leading-relaxed text-ink-soft">
          {inquiry.content}
        </p>
      </div>

      <div className="mt-4 rounded-2xl border border-line bg-cream p-5 sm:p-6">
        <h2 className="text-[14px] font-bold text-ink">문의 회원</h2>
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-[13px] text-ink-soft sm:grid-cols-2">
          <div className="flex gap-2">
            <dt className="w-14 shrink-0 text-muted">상호명</dt>
            <dd className="font-semibold">{inquiry.user.companyName}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-14 shrink-0 text-muted">대표자</dt>
            <dd>{inquiry.user.ownerName}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-14 shrink-0 text-muted">이메일</dt>
            <dd className="break-all">{inquiry.user.email}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="w-14 shrink-0 text-muted">연락처</dt>
            <dd>{inquiry.user.phone}</dd>
          </div>
        </dl>
      </div>

      <div className="mt-4 rounded-2xl border border-line bg-white p-5 sm:p-6">
        <h2 className="mb-3 text-[14px] font-bold text-ink">
          답변
          {inquiry.answeredAt && (
            <span className="ml-2 text-[12px] font-medium text-muted">
              {dateFmt(inquiry.answeredAt)} 답변됨
            </span>
          )}
        </h2>
        <InquiryAnswerForm inquiryId={inquiry.id} defaultAnswer={inquiry.answer ?? undefined} />
      </div>
    </div>
  );
}
