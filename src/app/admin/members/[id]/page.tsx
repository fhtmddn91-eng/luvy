import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { won } from "@/lib/format";
import { memberStatusLabel, memberStatusTone } from "@/lib/memberStatus";
import { orderStatusLabel } from "@/lib/orderStatus";
import { setMemberStatus } from "@/lib/actions/admin-members";
import { TempPasswordForm } from "@/components/admin/TempPasswordForm";

const dateFmt = (d: Date) =>
 new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(d);

const bizFmt = (n: string) =>
 n.length === 10 ? `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5)}` : n;

export default async function AdminMemberDetailPage({ params }: { params: Promise<{ id: string }> }) {
 await requireAdmin();
 const { id } = await params;
 const member = await db.user.findUnique({
 where: { id },
 include: { orders: { orderBy: { createdAt: "desc" }, take: 10 } },
 });
 if (!member) notFound();

 return (
 <div className="max-w-[760px]">
 <Link href="/admin/members" className="text-[13px] text-muted hover:text-ink-deep">← 회원 목록</Link>
 <div className="mt-2 flex items-center gap-3">
 <h1 className="text-[22px] font-extrabold text-ink-deep">{member.companyName}</h1>
 <span className={` px-2.5 py-1 text-[12px] font-bold ${memberStatusTone(member.status)}`}>
 {memberStatusLabel(member.status)}
 </span>
 </div>

 <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_300px]">
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

 <h2 className="mb-3 mt-6 text-[15px] font-bold text-ink-deep">최근 주문 ({member.orders.length})</h2>
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
 </div>
 </div>
 );
}
