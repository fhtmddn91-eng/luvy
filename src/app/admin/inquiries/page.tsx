import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { dateFmt } from "@/lib/format";
import { INQUIRY_TYPES } from "@/lib/inquiry";

export default async function AdminInquiriesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();
  const { status } = await searchParams;
  const filter = status === "OPEN" || status === "ANSWERED" ? status : undefined;

  const [inquiries, openCount] = await Promise.all([
    db.inquiry.findMany({
      where: filter ? { status: filter } : undefined,
      include: { user: { select: { companyName: true, email: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.inquiry.count({ where: { status: "OPEN" } }),
  ]);

  const tabs = [
    { label: "전체", value: undefined },
    { label: `답변 대기 (${openCount})`, value: "OPEN" },
    { label: "답변 완료", value: "ANSWERED" },
  ];

  return (
    <div>
      <h1 className="text-[22px] font-extrabold text-ink">문의 관리</h1>
      <p className="mt-1 text-[13px] text-muted">1:1 문의 · 입점 · 대량구매 · 제휴 문의</p>

      <div className="mt-4 flex gap-2">
        {tabs.map((t) => (
          <Link
            key={t.label}
            href={t.value ? `/admin/inquiries?status=${t.value}` : "/admin/inquiries"}
            className={`rounded-pill px-4 py-1.5 text-[13px] font-bold ${
              filter === t.value
                ? "bg-brand-500 text-white"
                : "bg-white text-ink-soft border border-line hover:border-brand-300"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      <div className="mt-4 overflow-x-auto rounded-2xl border border-line bg-white">
        <table className="w-full min-w-[640px] text-[14px]">
          <thead>
            <tr className="border-b border-line bg-cream/60 text-left text-[12px] text-muted">
              <th className="px-4 py-3 font-medium">유형</th>
              <th className="px-4 py-3 font-medium">제목</th>
              <th className="px-4 py-3 font-medium">회원</th>
              <th className="px-4 py-3 text-center font-medium">상태</th>
              <th className="px-4 py-3 text-right font-medium">접수일</th>
            </tr>
          </thead>
          <tbody>
            {inquiries.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted">
                  문의가 없습니다.
                </td>
              </tr>
            ) : (
              inquiries.map((inq) => (
                <tr key={inq.id} className="border-b border-line/60">
                  <td className="whitespace-nowrap px-4 py-3 text-[12px] text-ink-soft">
                    {INQUIRY_TYPES[inq.type as keyof typeof INQUIRY_TYPES] ?? inq.type}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/inquiries/${inq.id}`}
                      className="font-semibold text-ink hover:text-brand-600"
                    >
                      {inq.title}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{inq.user.companyName}</td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`rounded-pill px-2.5 py-1 text-[12px] font-bold ${
                        inq.status === "ANSWERED"
                          ? "bg-brand-50 text-brand-600"
                          : "bg-line text-ink-soft"
                      }`}
                    >
                      {inq.status === "ANSWERED" ? "답변 완료" : "답변 대기"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right text-muted">
                    {dateFmt(inq.createdAt)}
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
