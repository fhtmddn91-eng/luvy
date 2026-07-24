import Link from "next/link";
import { db } from "@/lib/db";
import { Icon } from "@/components/ui/Icon";
import { dateFmt } from "@/lib/format";

const quickLinks = [
  { href: "/support/notice", icon: "bell", title: "공지사항", desc: "배송·운영·이벤트 소식" },
  { href: "/support/faq", icon: "help", title: "자주 묻는 질문", desc: "가입·주문·배송·반품 안내" },
  { href: "/support/inquiry", icon: "chat", title: "1:1 문의", desc: "영업일 기준 24시간 내 답변" },
  { href: "/orders", icon: "truck", title: "주문/배송 조회", desc: "내 주문 진행 상태 확인" },
] as const;

export default async function SupportPage() {
  const notices = await db.notice.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    take: 5,
  });

  return (
    <div className="mx-auto max-w-[1080px] px-4 py-10 sm:px-6">
      <p className="text-[13px] font-semibold text-brand-500">SUPPORT</p>
      <h1 className="mt-1 text-[26px] font-extrabold text-ink sm:text-[28px]">고객센터</h1>
      <p className="mb-8 mt-1 text-[14px] text-muted">
        무엇을 도와드릴까요? 파트너님의 비즈니스를 빠르게 지원합니다.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 sm:gap-4">
        {quickLinks.map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="group rounded-2xl border border-line bg-white p-5 transition-shadow hover:shadow-[var(--shadow-card)]"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-500">
              <Icon name={l.icon} className="h-5 w-5" strokeWidth={1.8} />
            </span>
            <p className="mt-3 text-[15px] font-bold text-ink group-hover:text-brand-600">{l.title}</p>
            <p className="mt-0.5 text-[12px] text-muted">{l.desc}</p>
          </Link>
        ))}
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-[1fr_320px]">
        {/* 최근 공지 */}
        <section className="rounded-2xl border border-line bg-white p-5 sm:p-6">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[16px] font-bold text-ink">최근 공지</h2>
            <Link href="/support/notice" className="text-[13px] font-semibold text-muted hover:text-brand-500">
              전체 보기
            </Link>
          </div>
          {notices.length === 0 ? (
            <p className="py-8 text-center text-[14px] text-muted">등록된 공지가 없습니다.</p>
          ) : (
            <ul className="divide-y divide-line/70">
              {notices.map((n) => (
                <li key={n.id}>
                  <Link
                    href={`/support/notice/${n.id}`}
                    className="flex items-center gap-3 py-3 hover:text-brand-600"
                  >
                    <span className="shrink-0 rounded-pill bg-brand-50 px-2.5 py-1 text-[11px] font-bold text-brand-600">
                      {n.tag}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{n.text}</span>
                    <span className="hidden shrink-0 text-[12px] text-muted sm:block">
                      {dateFmt(n.createdAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 운영 안내 */}
        <aside className="rounded-2xl border border-line bg-cream p-5 sm:p-6">
          <h2 className="text-[16px] font-bold text-ink">고객센터 운영 안내</h2>
          <p className="mt-3 text-[24px] font-extrabold tracking-tight text-brand-600">1600-0000</p>
          <dl className="mt-3 space-y-1.5 text-[13px] text-ink-soft">
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-muted">평일</dt>
              <dd>10:00 ~ 17:00</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-muted">점심시간</dt>
              <dd>12:00 ~ 13:00</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-16 shrink-0 text-muted">휴무</dt>
              <dd>주말·공휴일</dd>
            </div>
          </dl>
          <p className="mt-4 border-t border-line pt-4 text-[12px] leading-relaxed text-muted">
            전화 연결이 어려운 시간에는 1:1 문의를 남겨주시면
            영업일 기준 24시간 내 답변드립니다.
          </p>
        </aside>
      </div>
    </div>
  );
}
