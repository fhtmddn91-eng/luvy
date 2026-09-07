import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { won } from "@/lib/format";
import { MEMBER_STATUS, memberStatusLabel, memberStatusTone } from "@/lib/memberStatus";
import { PAID_STATUSES, periodStart } from "@/lib/purchaseStats";
import { getGrades, gradeName, expireAllDuePoints } from "@/lib/memberPoints";
import { effectiveDiscountBp, formatDiscountPercent } from "@/lib/discount";
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

/** 구매금액 기간 탭 (운영자 요청서 1번) — 값은 purchaseStats.periodStart 가 해석한다 */
const PERIODS: { key: string; label: string }[] = [
  { key: "all", label: "전체 기간" },
  { key: "month", label: "이번 달" },
  { key: "week", label: "이번 주" },
  { key: "today", label: "오늘" },
];

export default async function AdminMembersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; period?: string; sort?: string }>;
}) {
  await requireAdmin();
  const { status, period: rawPeriod, sort } = await searchParams;
  const active = status && MEMBER_STATUS[status] ? status : "ALL";
  const period = PERIODS.some((p) => p.key === rawPeriod) ? (rawPeriod as string) : "all";
  const bySpent = sort === "spent";
  const since = periodStart(period, new Date());

  // 크론이 없어 목록이 열릴 때 전체 회원의 만료 포인트를 정리한다 — 목록의 잔액이 진실이어야 한다
  await expireAllDuePoints();

  const [members, pendingCount, spentRows, grades] = await Promise.all([
    db.user.findMany({
      where: { role: "MEMBER", ...(active === "ALL" ? {} : { status: active }) },
      include: { _count: { select: { orders: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.user.count({ where: { role: "MEMBER", status: "PENDING" } }),
    // 회원별 구매금액 — 결제가 확인된 주문만(접수됨·취소 제외), 기간 탭이 있으면 그 이후만
    db.order.groupBy({
      by: ["userId"],
      where: { status: { in: [...PAID_STATUSES] }, ...(since ? { createdAt: { gte: since } } : {}) },
      _sum: { total: true },
    }),
    getGrades(),
  ]);
  const spentBy = new Map(spentRows.map((r) => [r.userId, r._sum.total ?? 0]));
  const spentOf = (id: string) => spentBy.get(id) ?? 0;
  const rows = bySpent ? [...members].sort((a, b) => spentOf(b.id) - spentOf(a.id)) : members;
  const periodTotal = rows.reduce((sum, m) => sum + spentOf(m.id), 0);

  /** 다른 조건은 유지한 채 하나만 바꾼 주소 */
  const hrefWith = (patch: { status?: string; period?: string; sort?: string }) => {
    const sp = new URLSearchParams();
    const s = patch.status ?? active;
    const p = patch.period ?? period;
    const so = patch.sort ?? (bySpent ? "spent" : "");
    if (s !== "ALL") sp.set("status", s);
    if (p !== "all") sp.set("period", p);
    if (so) sp.set("sort", so);
    const qs = sp.toString();
    return `/admin/members${qs ? `?${qs}` : ""}`;
  };

  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? "전체 기간";

  return (
    <div>
      <PageHeader
        eyebrow="Operations"
        title="회원 관리"
        description={`사업자 회원 ${members.length}명${pendingCount > 0 ? ` · 승인 대기 ${pendingCount}명` : ""} · ${periodLabel} 구매금액 ${won(periodTotal)}`}
      />

      <div className="rise rise-1">
        <FilterTabs
          items={filters.map((f) => ({
            href: hrefWith({ status: f }),
            label: f === "ALL" ? "전체" : memberStatusLabel(f),
            active: active === f,
            count: f === "PENDING" && pendingCount > 0 ? pendingCount : undefined,
          }))}
        />
      </div>

      {/* 구매금액 기간·정렬 — 회원별 구매금액을 월·주·일로 보고 싶다는 요청(2026-09-05 요청서 1번) */}
      <div className="rise rise-1 mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
        <span className="font-semibold text-ink-soft">구매금액 기간</span>
        <div className="flex items-center gap-1">
          {PERIODS.map((p) => (
            <Link
              key={p.key}
              href={hrefWith({ period: p.key })}
              className={`px-2.5 py-1 font-semibold ${
                period === p.key ? "bg-ink-deep text-white" : "text-ink-soft hover:text-ink-deep"
              }`}
            >
              {p.label}
            </Link>
          ))}
        </div>
        <span aria-hidden className="h-3 w-px bg-hairline" />
        <Link
          href={hrefWith({ sort: bySpent ? "" : "spent" })}
          className={`px-2.5 py-1 font-semibold ${bySpent ? "bg-ink-deep text-white" : "text-ink-soft hover:text-ink-deep"}`}
        >
          {bySpent ? "구매금액순 ✓" : "구매금액순으로 보기"}
        </Link>
      </div>

      <div className="rise rise-2">
        <Panel flush>
          {rows.length === 0 ? (
            <EmptyState>해당 조건의 회원이 없습니다.</EmptyState>
          ) : (
            <TableWrap minWidth={1000}>
              <thead>
                <tr className="border-b border-hairline-soft">
                  <Th>상호명</Th>
                  <Th>사업자번호</Th>
                  <Th align="center">등급</Th>
                  <Th align="center">할인</Th>
                  <Th align="right">포인트</Th>
                  <Th align="right">구매금액 ({periodLabel})</Th>
                  <Th align="center">주문</Th>
                  <Th align="center">상태</Th>
                  <Th align="right">가입일</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr
                    key={m.id}
                    className="border-b border-hairline-soft last:border-0 transition-colors hover:bg-canvas"
                  >
                    <td className="px-5 py-3.5 sm:px-6">
                      <Link
                        href={`/admin/members/${m.id}`}
                        className="font-semibold text-ink-deep hover:text-ink-deep"
                      >
                        {m.companyName}
                      </Link>
                      <span className="block text-[12px] text-muted">
                        {m.ownerName} · {m.email}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 font-display text-[13.5px] tracking-[0.02em] text-ink-soft sm:px-6">
                      {bizFmt(m.businessNumber)}
                    </td>
                    <td className="px-5 py-3.5 text-center sm:px-6">
                      <StatusPill tone={m.gradeCode === "BASIC" ? "bg-hairline-soft text-ink-soft" : "border border-ink-deep text-ink-deep"}>
                        {gradeName(grades, m.gradeCode)}
                      </StatusPill>
                    </td>
                    {/* 개별 지정은 굵게 — 등급을 봐도 알 수 없는 값이라 목록에서 구분되어야 한다 */}
                    <td className="whitespace-nowrap px-5 py-3.5 text-center font-display text-[13.5px] sm:px-6">
                      {(() => {
                        const gradeBp = grades.find((g) => g.code === m.gradeCode)?.discountBp ?? 0;
                        const bp = effectiveDiscountBp(m.discountBp, gradeBp);
                        if (bp === 0) return <span className="text-muted">—</span>;
                        const own = m.discountBp !== null;
                        return (
                          <span
                            className={own ? "font-bold text-ink-deep" : "text-ink-soft"}
                            title={own ? "이 거래처 개별 지정" : "등급 기본값"}
                          >
                            {formatDiscountPercent(bp)}%{own && <span className="ml-0.5 text-[11px]">개별</span>}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-right font-display text-[13.5px] text-ink-soft sm:px-6">
                      {m.pointBalance > 0 ? `${m.pointBalance.toLocaleString("ko-KR")}P` : <span className="text-muted">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-right font-semibold text-ink-deep sm:px-6">
                      {spentOf(m.id) > 0 ? won(spentOf(m.id)) : <span className="text-muted">—</span>}
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
