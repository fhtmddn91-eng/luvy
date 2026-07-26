import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { dateFmt } from "@/lib/format";
import { INQUIRY_TYPES } from "@/lib/inquiry";
import {
  PageHeader,
  Panel,
  StatusPill,
  TableWrap,
  Th,
  EmptyState,
  FilterTabs,
} from "@/components/ui/Panel";

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

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="문의 관리"
        description="1:1 문의 · 입점 · 대량구매 · 제휴 문의"
      />

      <div className="rise rise-1">
        <FilterTabs
          items={[
            { href: "/admin/inquiries", label: "전체", active: !filter },
            {
              href: "/admin/inquiries?status=OPEN",
              label: "답변 대기",
              active: filter === "OPEN",
              count: openCount > 0 ? openCount : undefined,
            },
            {
              href: "/admin/inquiries?status=ANSWERED",
              label: "답변 완료",
              active: filter === "ANSWERED",
            },
          ]}
        />
      </div>

      <div className="rise rise-2">
        <Panel flush>
          {inquiries.length === 0 ? (
            <EmptyState>해당 조건의 문의가 없습니다.</EmptyState>
          ) : (
            <TableWrap minWidth={720}>
              <thead>
                <tr className="border-b border-hairline-soft">
                  <Th>유형</Th>
                  <Th>제목</Th>
                  <Th>회원</Th>
                  <Th align="center">상태</Th>
                  <Th align="right">접수일</Th>
                </tr>
              </thead>
              <tbody>
                {inquiries.map((inq) => {
                  const answered = inq.status === "ANSWERED";
                  return (
                    <tr
                      key={inq.id}
                      className="border-b border-hairline-soft last:border-0 transition-colors hover:bg-canvas"
                    >
                      <td className="whitespace-nowrap px-5 py-3.5 text-[12px] text-muted sm:px-6">
                        {INQUIRY_TYPES[inq.type as keyof typeof INQUIRY_TYPES] ?? inq.type}
                      </td>
                      <td className="px-5 py-3.5 sm:px-6">
                        <Link
                          href={`/admin/inquiries/${inq.id}`}
                          className="font-semibold text-ink-deep hover:text-ink-deep"
                        >
                          {inq.title}
                        </Link>
                      </td>
                      <td className="px-5 py-3.5 text-[13px] text-ink-soft sm:px-6">
                        {inq.user.companyName}
                      </td>
                      <td className="px-5 py-3.5 text-center sm:px-6">
                        <StatusPill
                          tone={answered ? "bg-ink-deep text-white" : "bg-[#fdf3e4] text-[#95651a]"}
                        >
                          {answered ? "답변 완료" : "답변 대기"}
                        </StatusPill>
                      </td>
                      <td className="whitespace-nowrap px-5 py-3.5 text-right text-[13px] text-muted sm:px-6">
                        {dateFmt(inq.createdAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </Panel>
      </div>
    </div>
  );
}
