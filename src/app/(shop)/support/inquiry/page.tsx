import Link from "next/link";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { InquiryForm } from "@/components/support/InquiryForm";
import { INQUIRY_TYPES } from "@/lib/inquiry";
import { dateFmt } from "@/lib/format";

export default async function InquiryPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string }>;
}) {
  const user = await requireUser();
  const { submitted } = await searchParams;

  const inquiries = await db.inquiry.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    take: 20,
  });

  return (
    <div className="mx-auto max-w-[880px] px-4 py-10 sm:px-6">
      <p className="text-[13px] font-semibold text-brand-500">1:1 INQUIRY</p>
      <h1 className="mt-1 text-[26px] font-extrabold text-ink sm:text-[28px]">1:1 문의</h1>
      <p className="mb-8 mt-1 text-[14px] text-muted">
        영업일 기준 24시간 내 답변드립니다. 급한 문의는 고객센터 1600-0000으로 연락해주세요.
      </p>

      {submitted && (
        <div className="mb-6 rounded-2xl border border-brand-200 bg-brand-50 px-5 py-4 text-[14px] font-semibold text-brand-700">
          문의가 접수되었습니다. 답변이 등록되면 아래 문의 내역에서 확인할 수 있습니다.
        </div>
      )}

      <section className="rounded-2xl border border-line bg-white p-5 sm:p-6">
        <h2 className="mb-4 text-[16px] font-bold text-ink">문의 작성</h2>
        <InquiryForm />
      </section>

      <section className="mt-8">
        <h2 className="mb-3 text-[16px] font-bold text-ink">내 문의 내역</h2>
        {inquiries.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line py-12 text-center text-[14px] text-muted">
            접수된 문의가 없습니다.
          </div>
        ) : (
          <div className="space-y-3">
            {inquiries.map((inq) => (
              <details key={inq.id} className="group overflow-hidden rounded-2xl border border-line bg-white">
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-4 sm:px-5 [&::-webkit-details-marker]:hidden">
                  <span
                    className={`shrink-0 rounded-pill px-2.5 py-1 text-[11px] font-bold ${
                      inq.status === "ANSWERED"
                        ? "bg-brand-500 text-white"
                        : "bg-line text-muted"
                    }`}
                  >
                    {inq.status === "ANSWERED" ? "답변 완료" : "답변 대기"}
                  </span>
                  <span className="hidden shrink-0 text-[12px] text-muted sm:inline">
                    {INQUIRY_TYPES[inq.type as keyof typeof INQUIRY_TYPES] ?? inq.type}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink">
                    {inq.title}
                  </span>
                  <span className="shrink-0 text-[12px] text-muted">{dateFmt(inq.createdAt)}</span>
                </summary>
                <div className="border-t border-line/60 px-4 py-4 text-[14px] leading-relaxed text-ink-soft sm:px-5">
                  <p className="whitespace-pre-line">{inq.content}</p>
                  {inq.answer && (
                    <div className="mt-4 rounded-xl bg-cream p-4">
                      <p className="mb-1 text-[12px] font-bold text-brand-600">
                        LUVY 답변
                        {inq.answeredAt && (
                          <span className="ml-2 font-medium text-muted">{dateFmt(inq.answeredAt)}</span>
                        )}
                      </p>
                      <p className="whitespace-pre-line">{inq.answer}</p>
                    </div>
                  )}
                </div>
              </details>
            ))}
          </div>
        )}
      </section>

      <div className="mt-8 text-center">
        <Link href="/support" className="text-[13px] text-muted hover:text-brand-500">
          ← 고객센터로 돌아가기
        </Link>
      </div>
    </div>
  );
}
