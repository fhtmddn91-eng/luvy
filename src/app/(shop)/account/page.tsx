import { CONTACT_POINT } from "@/lib/company";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { won } from "@/lib/format";
import { memberStatusLabel } from "@/lib/memberStatus";
import { orderStatusLabel, orderStatusTone } from "@/lib/orderStatus";
import { AccountShell } from "@/components/account/AccountShell";
import { Panel, StatusPill, EmptyState } from "@/components/ui/Panel";
import { Icon } from "@/components/ui/Icon";

const dateFmt = (d: Date) =>
  new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const bizFmt = (n: string) =>
  n.length === 10 ? `${n.slice(0, 3)}-${n.slice(3, 5)}-${n.slice(5)}` : n;

const HIDDEN_STATUSES = ["PENDING_PAYMENT", "PAYMENT_FAILED"];

const shortcuts = [
  { href: "/new", icon: "sparkle", title: "신상품", desc: "이번 주 입고" },
  { href: "/best", icon: "trophy", title: "인기상품", desc: "많이 팔리는 순" },
  { href: "/partner", icon: "download", title: "판매자료", desc: "상세페이지·썸네일" },
  { href: "/support", icon: "headset", title: "고객센터", desc: "문의·공지" },
] as const;

export default async function AccountPage() {
  const session = await requireUser();

  const [user, orders, inProgress, spent, openInquiries] = await Promise.all([
    db.user.findUnique({
      where: { id: session.id },
      select: {
        companyName: true,
        ownerName: true,
        email: true,
        phone: true,
        businessNumber: true,
        status: true,
        createdAt: true,
      },
    }),
    db.order.findMany({
      where: { userId: session.id, status: { notIn: HIDDEN_STATUSES } },
      include: { items: true },
      orderBy: { createdAt: "desc" },
      take: 3,
    }),
    db.order.count({
      where: { userId: session.id, status: { in: ["RECEIVED", "PREPARING", "SHIPPED"] } },
    }),
    db.order.aggregate({
      where: { userId: session.id, status: { notIn: [...HIDDEN_STATUSES, "CANCELED"] } },
      _sum: { total: true },
      _count: true,
    }),
    db.inquiry.count({ where: { userId: session.id, status: "OPEN" } }),
  ]);

  if (!user) return null;
  const approved = user.status === "APPROVED";

  return (
    <AccountShell
      current="/account"
      title="마이페이지"
      description={`${user.companyName}님, 오늘도 좋은 거래 되세요.`}
    >
      <div className="space-y-4">
        {/* 멤버십 카드 */}
        <div className="rise rise-1 overflow-hidden bg-ink-deep p-6 text-white sm:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="eyebrow font-display text-white/45">Business partner</p>
              <p className="mt-2 truncate text-[22px] font-bold tracking-[-0.01em] sm:text-[25px]">
                {user.companyName}
              </p>
              <p className="mt-1 text-[13px] text-white/55">
                {user.ownerName} · {bizFmt(user.businessNumber)}
              </p>
            </div>
            <StatusPill
              tone={approved ? "bg-white text-ink-deep" : "bg-white/15 text-white"}
            >
              {memberStatusLabel(user.status)}
            </StatusPill>
          </div>

          {/* 라벨이 접히면 3열 정렬이 흐트러지므로 짧은 단어만 사용 */}
          <div className="mt-7 grid grid-cols-3 gap-4 border-t border-white/10 pt-5">
            <div>
              <p className="eyebrow whitespace-nowrap text-white/40">Orders</p>
              <p className="mt-1.5 font-display text-[28px] leading-none">{spent._count}</p>
            </div>
            <div>
              <p className="eyebrow whitespace-nowrap text-white/40">Active</p>
              <p className="mt-1.5 font-display text-[28px] leading-none">{inProgress}</p>
            </div>
            <div className="min-w-0">
              <p className="eyebrow whitespace-nowrap text-white/40">Total</p>
              <p className="mt-1.5 truncate font-display text-[28px] leading-none">
                {(spent._sum.total ?? 0).toLocaleString("ko-KR")}
                <span className="ml-0.5 text-[13px] font-sans">원</span>
              </p>
            </div>
          </div>
        </div>

        {!approved && (
          <div className="rise rise-2 border border-[#f0dfc0] bg-[#fdf8ef] px-5 py-4 text-[13px] leading-relaxed text-[#7a5514]">
            가입 승인이 완료되면 도매가 열람과 주문이 가능합니다. 영업일 기준 1일 이내 처리됩니다.
          </div>
        )}

        {/* 바로가기 */}
        <div className="rise rise-2 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {shortcuts.map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="group border border-hairline bg-white px-4 py-4 transition-colors hover:border-ink-deep"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-canvas text-ink-deep">
                <Icon name={s.icon} className="h-4.5 w-4.5 h-[18px] w-[18px]" strokeWidth={1.7} />
              </span>
              <p className="mt-3 text-[13.5px] font-bold text-ink-deep group-hover:text-ink-deep">
                {s.title}
              </p>
              <p className="mt-0.5 text-[12px] text-muted">{s.desc}</p>
            </Link>
          ))}
        </div>

        {/* 최근 주문 */}
        <div className="rise rise-3">
          <Panel
            title="최근 주문"
            flush
            action={
              <Link
                href="/orders"
                className="text-[12px] font-semibold text-ink-soft transition-colors hover:text-ink-deep"
              >
                전체 보기 →
              </Link>
            }
          >
            {orders.length === 0 ? (
              <EmptyState>
                아직 주문 내역이 없습니다.
                <Link
                  href="/new"
                  className="ml-1.5 font-semibold text-ink-deep underline underline-offset-4"
                >
                  상품 보러가기
                </Link>
              </EmptyState>
            ) : (
              <ul className="divide-y divide-hairline-soft">
                {orders.map((o) => (
                  <li key={o.id}>
                    <Link
                      href={`/orders/${o.id}`}
                      className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 transition-colors hover:bg-canvas sm:px-6"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 text-[12px] text-muted">
                          <span className="font-display tracking-[0.04em]">
                            {o.id.slice(0, 8).toUpperCase()}
                          </span>
                          <span aria-hidden className="h-2.5 w-px bg-hairline" />
                          {dateFmt(o.createdAt)}
                        </p>
                        <p className="mt-1 truncate text-[14px] font-medium text-ink-deep">
                          {o.items[0]?.name}
                          {o.items.length > 1 ? ` 외 ${o.items.length - 1}건` : ""}
                        </p>
                      </div>
                      <StatusPill tone={orderStatusTone(o.status)}>
                        {orderStatusLabel(o.status)}
                      </StatusPill>
                      <p className="whitespace-nowrap text-[15px] font-bold text-ink-deep">
                        {won(o.total)}
                      </p>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        {/* 계정 정보 */}
        <div className="rise rise-4">
          <Panel
            title="계정 정보"
            action={
              openInquiries > 0 ? (
                <Link
                  href="/support/inquiry"
                  className="text-[12px] font-semibold text-ink-deep underline underline-offset-4"
                >
                  답변 대기 문의 {openInquiries}건
                </Link>
              ) : undefined
            }
          >
            <dl className="grid gap-x-8 gap-y-3.5 sm:grid-cols-2">
              {[
                ["상호명", user.companyName],
                ["대표자명", user.ownerName],
                ["사업자등록번호", bizFmt(user.businessNumber)],
                ["이메일", user.email],
                ["연락처", user.phone],
                ["가입일", dateFmt(user.createdAt)],
              ].map(([k, v]) => (
                <div key={k} className="flex gap-4 text-[13.5px]">
                  <dt className="w-[104px] shrink-0 text-muted">{k}</dt>
                  <dd className="min-w-0 break-all font-medium text-ink-deep">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-5 border-t border-hairline-soft pt-4 text-[12px] text-muted">
              계정 정보 변경이 필요하시면 고객센터 {CONTACT_POINT} 또는 1:1 문의로 요청해주세요.
            </p>
          </Panel>
        </div>
      </div>
    </AccountShell>
  );
}
