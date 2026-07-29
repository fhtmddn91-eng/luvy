import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { toggleFaqActive, deleteFaq, seedDefaultFaqs } from "@/lib/actions/admin-faqs";
import { PageHeader, Panel, StatusPill, EmptyState, btnPrimary } from "@/components/ui/Panel";

export default async function AdminFaqsPage() {
  await requireAdmin();
  const faqs = await db.faq.findMany({ orderBy: { sortOrder: "asc" } });

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="FAQ 관리"
        description={`전체 ${faqs.length}개 · 표시 ${faqs.filter((f) => f.active).length}개`}
        action={
          <Link href="/admin/faqs/new" className={btnPrimary}>
            + FAQ 등록
          </Link>
        }
      />

      <div className="rise rise-1">
        <Panel flush>
          {faqs.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <p className="text-[14px] text-muted">
                아직 DB에 FAQ가 없어 기본 목록이 표시되고 있습니다.
              </p>
              <form action={seedDefaultFaqs} className="mt-4">
                <button type="submit" className={btnPrimary}>
                  기본 FAQ 14개 불러와서 수정하기
                </button>
              </form>
            </div>
          ) : (
            <ul className="divide-y divide-hairline-soft">
              {faqs.map((f) => (
                <li key={f.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5 sm:px-6">
                  <span className="w-20 shrink-0 text-[12px] font-bold text-muted">
                    {f.category}
                  </span>
                  <Link
                    href={`/admin/faqs/${f.id}`}
                    className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink-deep hover:underline hover:underline-offset-4"
                  >
                    {f.question}
                  </Link>
                  <StatusPill tone={f.active ? "bg-ink-deep text-white" : "bg-hairline-soft text-muted"}>
                    {f.active ? "표시" : "숨김"}
                  </StatusPill>
                  <div className="flex items-center gap-3 text-[13px]">
                    <form action={toggleFaqActive.bind(null, f.id, !f.active)}>
                      <button type="submit" className="text-ink-soft hover:text-ink-deep">
                        {f.active ? "숨김" : "표시"}
                      </button>
                    </form>
                    <span aria-hidden className="h-3 w-px bg-hairline" />
                    <form action={deleteFaq.bind(null, f.id)}>
                      <button type="submit" className="text-muted hover:text-ink-deep">
                        삭제
                      </button>
                    </form>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}
