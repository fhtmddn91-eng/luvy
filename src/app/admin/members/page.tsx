import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { MEMBER_STATUS, memberStatusLabel, memberStatusTone } from "@/lib/memberStatus";

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

  const members = await db.user.findMany({
    where: { role: "MEMBER", ...(active === "ALL" ? {} : { status: active }) },
    include: { _count: { select: { orders: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <h1 className="text-[22px] font-extrabold text-ink">회원 관리</h1>
      <p className="mt-1 text-[13px] text-muted">사업자 회원 {members.length}명</p>

      <div className="mt-5 flex flex-wrap gap-2">
        {filters.map((f) => (
          <Link
            key={f}
            href={f === "ALL" ? "/admin/members" : `/admin/members?status=${f}`}
            className={`rounded-pill px-4 py-1.5 text-[13px] font-semibold transition-colors ${
              active === f ? "bg-brand-500 text-white" : "bg-white text-ink-soft hover:bg-brand-50"
            }`}
          >
            {f === "ALL" ? "전체" : memberStatusLabel(f)}
          </Link>
        ))}
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-white">
        <table className="w-full text-[14px]">
          <thead>
            <tr className="border-b border-line bg-cream/60 text-left text-[12px] text-muted">
              <th className="px-4 py-3 font-medium">상호명</th>
              <th className="px-4 py-3 font-medium">사업자번호</th>
              <th className="px-4 py-3 font-medium">이메일</th>
              <th className="px-4 py-3 text-center font-medium">주문</th>
              <th className="px-4 py-3 text-center font-medium">상태</th>
              <th className="px-4 py-3 text-right font-medium">가입일</th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">회원이 없습니다.</td>
              </tr>
            ) : (
              members.map((m) => (
                <tr key={m.id} className="border-b border-line/60">
                  <td className="px-4 py-3">
                    <Link href={`/admin/members/${m.id}`} className="font-semibold text-ink hover:text-brand-600">
                      {m.companyName}
                    </Link>
                    <span className="block text-[12px] text-muted">{m.ownerName}</span>
                  </td>
                  <td className="px-4 py-3 text-ink-soft">{bizFmt(m.businessNumber)}</td>
                  <td className="px-4 py-3 text-ink-soft">{m.email}</td>
                  <td className="px-4 py-3 text-center text-ink-soft">{m._count.orders}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`rounded-pill px-2.5 py-1 text-[12px] font-bold ${memberStatusTone(m.status)}`}>
                      {memberStatusLabel(m.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-muted">{dateFmt(m.createdAt)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
