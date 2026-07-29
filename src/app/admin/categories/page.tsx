import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getAllCategories } from "@/lib/categories";
import {
  renameCategory,
  toggleCategoryActive,
  moveCategory,
  deleteCategory,
} from "@/lib/actions/admin-categories";
import { CategoryAddForm } from "@/components/admin/CategoryAddForm";
import { PageHeader, Panel, StatusPill, EmptyState } from "@/components/ui/Panel";

export default async function AdminCategoriesPage() {
  await requireAdmin();
  const cats = await getAllCategories();

  // 카테고리별 상품 수 — 삭제 가능 여부 안내용
  const counts = await db.product.groupBy({ by: ["categorySlug"], _count: { _all: true } });
  const countOf = (slug: string) =>
    counts.find((c) => c.categorySlug === slug)?._count._all ?? 0;

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="카테고리 관리"
        description={`전체 ${cats.length}개 · 표시 ${cats.filter((c) => c.active).length}개`}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rise rise-1">
          <Panel flush>
            {cats.length === 0 ? (
              <EmptyState>카테고리가 없습니다.</EmptyState>
            ) : (
              <ul className="divide-y divide-hairline-soft">
                {cats.map((c, i) => {
                  const productCount = countOf(c.slug);
                  return (
                    <li key={c.slug} className="flex flex-wrap items-center gap-3 px-5 py-3.5 sm:px-6">
                      {/* 순서 */}
                      <div className="flex flex-col">
                        <form action={moveCategory.bind(null, c.slug, "up")}>
                          <button
                            type="submit"
                            disabled={i === 0}
                            aria-label={`${c.name} 위로`}
                            className="px-1 text-[11px] leading-none text-muted hover:text-ink-deep disabled:opacity-25"
                          >
                            ▲
                          </button>
                        </form>
                        <form action={moveCategory.bind(null, c.slug, "down")}>
                          <button
                            type="submit"
                            disabled={i === cats.length - 1}
                            aria-label={`${c.name} 아래로`}
                            className="px-1 text-[11px] leading-none text-muted hover:text-ink-deep disabled:opacity-25"
                          >
                            ▼
                          </button>
                        </form>
                      </div>

                      {/* 이름 (즉시 수정) */}
                      <form action={renameCategory.bind(null, c.slug)} className="flex min-w-0 flex-1 items-center gap-2">
                        <input
                          name="name"
                          defaultValue={c.name}
                          maxLength={30}
                          className="h-9 w-full min-w-0 max-w-[220px] border border-transparent bg-transparent px-2 text-[14px] font-semibold text-ink-deep transition-colors hover:border-hairline focus:border-ink-deep focus:bg-white focus:outline-none"
                        />
                        <button
                          type="submit"
                          className="shrink-0 text-[12px] font-semibold text-muted hover:text-ink-deep"
                        >
                          저장
                        </button>
                      </form>

                      <span className="hidden font-display text-[12px] tracking-[0.04em] text-muted sm:inline">
                        /{c.slug}
                      </span>
                      <span className="text-[12px] text-muted">상품 {productCount}</span>

                      <StatusPill tone={c.active ? "bg-ink-deep text-white" : "bg-hairline-soft text-muted"}>
                        {c.active ? "표시" : "숨김"}
                      </StatusPill>

                      <div className="flex items-center gap-3 text-[13px]">
                        <form action={toggleCategoryActive.bind(null, c.slug)}>
                          <button type="submit" className="text-ink-soft hover:text-ink-deep">
                            {c.active ? "숨김" : "표시"}
                          </button>
                        </form>
                        {productCount === 0 && (
                          <>
                            <span aria-hidden className="h-3 w-px bg-hairline" />
                            <form action={deleteCategory.bind(null, c.slug)}>
                              <button type="submit" className="text-muted hover:text-ink-deep">
                                삭제
                              </button>
                            </form>
                          </>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            숨기면 매장 메뉴에서 빠지고 해당 카테고리 페이지도 닫힙니다 (상품은 그대로 남습니다).
            상품이 있는 카테고리는 삭제 대신 숨김을 쓰세요.
          </p>
        </div>

        <div className="rise rise-2 h-fit">
          <Panel title="새 카테고리">
            <CategoryAddForm />
          </Panel>
        </div>
      </div>
    </div>
  );
}
