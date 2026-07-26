import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { MEMBER_STATUS, memberStatusLabel, memberStatusTone } from "@/lib/memberStatus";
import {
  PageHeader,
  Panel,
  StatusPill,
  TableWrap,
  Th,
  EmptyState,
  FilterTabs,
} from "@/components/ui/Panel";

const dateFmt = (d: Date) =>
  new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const bizFmt = (n: string) =>
  n.length === 10 ? `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5)}` : n;

const filters = ["ALL", "PENDING", "APPROVED", "REJECTED"];

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  await requireAdmin();
  const { status } = await searchParams;
  const active = status && MEMBER_STATUS[status] ? status : "ALL";

  const [members, pendingCount] = await Promise.all([
    db.user.findMany({
      where: { role: "MEMBER", ...(active === "ALL" ? {} : { status: active }) },
      include: { _count: { select: { orders: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.user.count({ where: { role: "MEMBER", status: "PENDING" } }),
  ]);

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="회원 관리"
        description={`사업자 회원 ${members.length}명${pendingCount > 0 ? ` · 승인 대기 ${pendingCount}명` : ""}`}
      />

      <div className="rise rise-1">
        <FilterTabs
          items={filters.map((f) => ({
            href: f === "ALL" ? "/admin/members" : `/admin/members?status=${f}`,
            label: f === "ALL" ? "전체" : memberStatusLabel(f),
            active: active === f,
            count: f === "PENDING" && pendingCount > 0 ? pendingCount : undefined,
          }))}
        />
      </div>

      <div className="rise rise-2">
        <Panel flush>
          {members.length === 0 ? (
            <EmptyState>해당 조건의 회원이 없습니다.</EmptyState>
          ) : (
            <TableWrap minWidth={760}>
              <thead>
                <tr className="border-b border-hairline-soft">
                  <Th>상호명</Th>
                  <Th>사업자번호</Th>
                  <Th>이메일</Th>
                  <Th align="center">주문</Th>
                  <Th align="center">상태</Th>
                  <Th align="right">가입일</Th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr
                    key={m.id}
                    className="border-b border-hairline-soft last:border-0 transition-colors hover:bg-canvas"
                  >
                    <td className="px-5 py-3.5 sm:px-6">
                      <Link
                        href={`/admin/members/${m.id}`}
                        className="font-semibold text-ink-deep hover:text-brand-600"
                      >
                        {m.companyName}
                      </Link>
                      <span className="block text-[12px] text-muted">{m.ownerName}</span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 font-display text-[13.5px] tracking-[0.02em] text-ink-soft sm:px-6">
                      {bizFmt(m.businessNumber)}
                    </td>
                    <td className="max-w-[200px] truncate px-5 py-3.5 text-[13px] text-ink-soft sm:px-6">
                      {m.email}
                    </td>
                    <td className="px-5 py-3.5 text-center font-display text-[15px] text-ink-deep sm:px-6">
                      {m._count.orders}
                    </td>
                    <td className="px-5 py-3.5 text-center sm:px-6">
                      <StatusPill tone={memberStatusTone(m.status)}>
                        {memberStatusLabel(m.status)}
                      </StatusPill>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-right text-[13px] text-muted sm:px-6">
                      {dateFmt(m.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          )}
        </Panel>
      </div>
    </div>
  );
}
