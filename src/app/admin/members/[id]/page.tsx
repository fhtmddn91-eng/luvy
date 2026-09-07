import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { won } from "@/lib/format";
import { memberStatusLabel, memberStatusTone } from "@/lib/memberStatus";
import { orderStatusLabel } from "@/lib/orderStatus";
import { setMemberStatus } from "@/lib/actions/admin-members";
import { TempPasswordForm } from "@/components/admin/TempPasswordForm";
import { MemberGradeForm } from "@/components/admin/MemberGradeForm";
import { MemberDiscountForm } from "@/components/admin/MemberDiscountForm";
import { PointAdjustForm } from "@/components/admin/PointAdjustForm";
import { PAID_STATUSES, bucketOrders, type BucketView } from "@/lib/purchaseStats";
import { getGrades, gradeName, pointSummary } from "@/lib/memberPoints";

const dateFmt = (d: Date) =>
  new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(d);
const dateTimeFmt = (d: Date) =>
  new Intl.DateTimeFormat("ko-KR", { dateStyle: "short", timeStyle: "short" }).format(d);

const bizFmt = (n: string) =>
  n.length === 10 ? `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5)}` : n;

/** 구매 현황 표의 단위 (운영자 요청서 1번: 월별·주별·일별) */
const VIEWS: { key: BucketView; label: string; hint: string }[] = [
  { key: "month", label: "월별", hint: "최근 12개월" },
  { key: "week", label: "주별", hint: "최근 12주 · 월요일 시작" },
  { key: "day", label: "일별", hint: "최근 30일" },
];

const LEDGER_KIND: Record<string, string> = {
  ACCRUE: "적립",
  REVERSE: "회수",
  ADJUST: "관리자 조정",
  USE: "사용",
  REFUND: "환급",
  EXPIRE: "만료",
};

export default async function AdminMemberDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
}) {
  await requireAdmin();
  const { id } = await params;
  const { view: rawView } = await searchParams;
  const view: BucketView = VIEWS.some((v) => v.key === rawView) ? (rawView as BucketView) : "month";
  const now = new Date();
  // 월별 12개월이 가장 긴 범위 — 그 시작부터 한 번만 읽고 세 표를 전부 만든다
  const since = new Date(now.getFullYear(), now.getMonth() - 11, 1);

  // 만료 정리를 먼저 — 화면의 잔액이 곧 쓸 수 있는 잔액이어야 한다
  const summary = await pointSummary(id, now);
  const [member, paidOrders, paidTotal, ledger, grades] = await Promise.all([
    db.user.findUnique({
      where: { id },
      include: { orders: { orderBy: { createdAt: "desc" }, take: 10 } },
    }),
    db.order.findMany({
      where: { userId: id, status: { in: [...PAID_STATUSES] }, createdAt: { gte: since } },
      select: { createdAt: true, total: true },
    }),
    db.order.aggregate({
      where: { userId: id, status: { in: [...PAID_STATUSES] } },
      _sum: { total: true },
      _count: true,
    }),
    db.pointLedger.findMany({ where: { userId: id }, orderBy: { createdAt: "desc" }, take: 30 }),
    getGrades(),
  ]);
  if (!member) notFound();

  const buckets = bucketOrders(paidOrders, view, now);
  const viewMeta = VIEWS.find((v) => v.key === view)!;

  return (
    <div className="max-w-[960px]">
      <Link href="/admin/members" className="text-[13px] text-muted hover:text-ink-deep">← 회원 목록</Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-[22px] font-extrabold text-ink-deep">{member.companyName}</h1>
        <span className={`px-2.5 py-1 text-[12px] font-bold ${memberStatusTone(member.status)}`}>
          {memberStatusLabel(member.status)}
        </span>
        <span className="border border-ink-deep px-2.5 py-1 text-[12px] font-bold text-ink-deep">
          {gradeName(grades, member.gradeCode)} 등급
        </span>
        <span className="text-[13px] text-ink-soft">
          포인트 <b className="font-display text-[15px] text-ink-deep">{summary.balance.toLocaleString("ko-KR")}</b>P
          {summary.expiringSoon > 0 && (
            <span className="ml-2 text-[12px] text-brand-600">30일 내 {summary.expiringSoon.toLocaleString("ko-KR")}P 소멸 예정</span>
          )}
        </span>
        {member.gradeLocked && (
          <span className="bg-hairline-soft px-2 py-1 text-[11px] font-bold text-ink-soft">등급 수동 고정</span>
        )}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_300px]">
        <div className="space-y-4">
          <section className="border border-hairline bg-white p-6">
            <h2 className="mb-4 text-[15px] font-bold text-ink-deep">사업자 정보</h2>
            <dl className="space-y-2 text-[14px] text-ink-soft">
              <div className="flex gap-3"><dt className="w-24 shrink-0 text-muted">대표자명</dt><dd>{member.ownerName}</dd></div>
              <div className="flex gap-3"><dt className="w-24 shrink-0 text-muted">사업자번호</dt><dd>{bizFmt(member.businessNumber)}</dd></div>
              <div className="flex gap-3"><dt className="w-24 shrink-0 text-muted">이메일</dt><dd>{member.email}</dd></div>
              <div className="flex gap-3"><dt className="w-24 shrink-0 text-muted">연락처</dt><dd>{member.phone}</dd></div>
              <div className="flex gap-3"><dt className="w-24 shrink-0 text-muted">가입일</dt><dd>{dateFmt(member.createdAt)}</dd></div>
            </dl>

            <h2 className="mb-3 mt-6 text-[15px] font-bold text-ink-deep">사업자등록증</h2>
            {member.bizCertFile ? (
              member.bizCertFile.endsWith(".pdf") ? (
                <a
                  href={`/api/admin/bizcert/${member.bizCertFile}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 border border-ink-deep px-4 py-2.5 text-[12px] font-bold uppercase tracking-[0.12em] text-ink-deep transition-colors hover:bg-ink-deep hover:text-white"
                >
                  PDF 열기 ↗
                </a>
              ) : (
                <a href={`/api/admin/bizcert/${member.bizCertFile}`} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/admin/bizcert/${member.bizCertFile}`}
                    alt={`${member.companyName} 사업자등록증`}
                    className="max-h-[420px] w-full max-w-[440px] border border-hairline object-contain transition-opacity hover:opacity-90"
                  />
                  <span className="mt-1.5 block text-[12px] text-muted">클릭하면 원본 크기로 열립니다.</span>
                </a>
              )
            ) : (
              <p className="text-[13px] text-muted">
                첨부된 사업자등록증이 없습니다. (첨부 기능 도입 전에 가입한 회원)
              </p>
            )}
          </section>

          {/* 구매 현황 — 결제가 확인된 주문만(접수됨·취소 제외). 운영자 요청서 1번 */}
          <section className="border border-hairline bg-white p-6">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 className="text-[15px] font-bold text-ink-deep">구매 현황</h2>
                <p className="mt-1 text-[12.5px] text-muted">
                  누적 <b className="text-ink-deep">{won(paidTotal._sum.total ?? 0)}</b> · 결제 확인 주문 {paidTotal._count}건
                  <span className="ml-1.5">(입금 전 접수·취소 주문은 제외)</span>
                </p>
              </div>
              <div className="flex items-center gap-1 text-[13px]">
                {VIEWS.map((v) => (
                  <Link
                    key={v.key}
                    href={`/admin/members/${member.id}?view=${v.key}`}
                    className={`px-2.5 py-1 font-semibold ${
                      view === v.key ? "bg-ink-deep text-white" : "text-ink-soft hover:text-ink-deep"
                    }`}
                  >
                    {v.label}
                  </Link>
                ))}
              </div>
            </div>
            <p className="mt-3 text-[12px] text-muted">{viewMeta.hint}</p>
            <table className="mt-2 w-full text-[13.5px]">
              <thead>
                <tr className="border-b border-hairline text-[12px] text-muted">
                  <th className="py-2 text-left font-semibold">기간</th>
                  <th className="py-2 text-right font-semibold">주문</th>
                  <th className="py-2 text-right font-semibold">구매금액</th>
                </tr>
              </thead>
              <tbody>
                {buckets.map((b) => (
                  <tr key={b.label} className={`border-b border-hairline-soft last:border-0 ${b.count === 0 ? "text-muted" : "text-ink-deep"}`}>
                    <td className="py-2 font-display tracking-[0.02em]">{b.label}</td>
                    <td className="py-2 text-right">{b.count > 0 ? `${b.count}건` : "—"}</td>
                    <td className="py-2 text-right font-semibold">{b.total > 0 ? won(b.total) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="border border-hairline bg-white p-6">
            <h2 className="mb-3 text-[15px] font-bold text-ink-deep">포인트 내역 (최근 {ledger.length}건)</h2>
            {ledger.length === 0 ? (
              <p className="text-[13px] text-muted">포인트 내역이 없습니다. 주문이 배송완료되면 등급 적립률로 쌓입니다.</p>
            ) : (
              <ul className="divide-y divide-line text-[13px]">
                {ledger.map((l) => (
                  <li key={l.id} className="flex items-start justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <span className="mr-2 text-[11px] font-bold text-muted">{LEDGER_KIND[l.kind] ?? l.kind}</span>
                      <span className="text-ink-soft">{l.reason}</span>
                      {l.orderId && (
                        <Link href={`/admin/orders/${l.orderId}`} className="ml-2 text-[12px] text-muted underline underline-offset-4 hover:text-ink-deep">
                          주문 {l.orderId.slice(0, 8).toUpperCase()}
                        </Link>
                      )}
                      <span className="block text-[11.5px] text-muted">{dateTimeFmt(l.createdAt)}</span>
                    </div>
                    <span className={`shrink-0 font-display text-[15px] ${l.amount < 0 ? "text-brand-600" : "text-ink-deep"}`}>
                      {l.amount > 0 ? "+" : ""}{l.amount.toLocaleString("ko-KR")}P
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="border border-hairline bg-white p-6">
            <h2 className="mb-3 text-[15px] font-bold text-ink-deep">최근 주문 ({member.orders.length})</h2>
            {member.orders.length === 0 ? (
              <p className="text-[13px] text-muted">주문 내역이 없습니다.</p>
            ) : (
              <ul className="divide-y divide-line text-[13px]">
                {member.orders.map((o) => (
                  <li key={o.id} className="flex items-center justify-between py-2">
                    <Link href={`/admin/orders/${o.id}`} className="font-semibold text-ink-deep underline underline-offset-4">
                      {o.id.slice(0, 8).toUpperCase()}
                    </Link>
                    <span className="text-muted">{orderStatusLabel(o.status)}</span>
                    <span className="font-semibold text-ink-deep">{won(o.total)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-4">
          <section className="h-fit border border-hairline bg-white p-6">
            <h2 className="mb-4 text-[15px] font-bold text-ink-deep">가입 심사</h2>
            <div className="space-y-2">
              <form action={setMemberStatus.bind(null, member.id, "APPROVED")}>
                <button
                  type="submit"
                  disabled={member.status === "APPROVED"}
                  className="h-11 w-full bg-ink-deep text-[12px] font-bold uppercase tracking-[0.12em] text-white transition-opacity hover:opacity-80 disabled:opacity-40"
                >
                  승인
                </button>
              </form>
              <form action={setMemberStatus.bind(null, member.id, "REJECTED")}>
                <button
                  type="submit"
                  disabled={member.status === "REJECTED"}
                  className="h-11 w-full border border-hairline bg-white text-[14px] font-bold text-ink-soft hover:border-ink-deep hover:text-ink-deep disabled:opacity-40"
                >
                  반려
                </button>
              </form>
              {member.status !== "PENDING" && (
                <form action={setMemberStatus.bind(null, member.id, "PENDING")}>
                  <button type="submit" className="h-9 w-full text-[12px] text-muted hover:text-ink-deep">
                    대기 상태로 되돌리기
                  </button>
                </form>
              )}
            </div>

            {member.role !== "ADMIN" && (
              <div className="mt-6 border-t border-hairline pt-5">
                <h2 className="mb-3 text-[15px] font-bold text-ink-deep">계정 복구</h2>
                <TempPasswordForm memberId={member.id} />
              </div>
            )}
          </section>

          {/* 등급·포인트 — 운영자 요청서 2·3번 */}
          <section className="h-fit border border-hairline bg-white p-6">
            <h2 className="mb-3 text-[15px] font-bold text-ink-deep">회원 등급</h2>
            <MemberGradeForm memberId={member.id} current={member.gradeCode} locked={member.gradeLocked} grades={grades} />
            <p className="mt-2 text-[12px] leading-relaxed text-muted">
              적립률·할인율·자동 승급 기준은 「설정 › 회원 등급」에서 바꿉니다. 자동 승급은 올라가기만 하며, 수동 고정을 켜면 건드리지 않습니다.
            </p>

            {/* 이 거래처만의 할인율 — 등급 기본값을 덮어쓴다 */}
            <div className="mt-6 border-t border-hairline pt-5">
              <h2 className="mb-3 text-[15px] font-bold text-ink-deep">이 거래처 할인율</h2>
              <MemberDiscountForm
                memberId={member.id}
                current={member.discountBp}
                gradeName={gradeName(grades, member.gradeCode)}
                gradeDiscountBp={grades.find((g) => g.code === member.gradeCode)?.discountBp ?? 0}
              />
            </div>

            <div className="mt-6 border-t border-hairline pt-5">
              <h2 className="mb-1 text-[15px] font-bold text-ink-deep">포인트</h2>
              <p className="mb-3 text-[13px] text-ink-soft">
                잔액 <b className="font-display text-[17px] text-ink-deep">{summary.balance.toLocaleString("ko-KR")}</b>P
              </p>
              <PointAdjustForm memberId={member.id} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
