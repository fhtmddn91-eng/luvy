import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { getAdminCategoryTree, type CategoryRow } from "@/lib/categories";
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
  const tree = await getAdminCategoryTree();
  const flatCount = tree.reduce((n, t) => n + 1 + t.children.length, 0);
  const shownCount = tree.reduce(
    (n, t) => n + (t.active ? 1 : 0) + t.children.filter((c) => c.active).length,
    0,
  );

  // 카테고리별 상품 수 — 조인 테이블 기준(다중 카테고리 포함), 삭제 가능 여부 안내용
  const counts = await db.productCategory.groupBy({
    by: ["categorySlug"],
    _count: { _all: true },
  });
  const countOf = (slug: string) =>
    counts.find((c) => c.categorySlug === slug)?._count._all ?? 0;

  /** 대분류 한 줄 + 그 아래 세부 카테고리 줄 */
  const row = (c: CategoryRow, opts: { first: boolean; last: boolean; child: boolean }) => {
    const productCount = countOf(c.slug);
    const hasChildren = !opts.child && (tree.find((t) => t.slug === c.slug)?.children.length ?? 0) > 0;
    const removable = productCount === 0 && !hasChildren;

    return (
      <li
        key={c.slug}
        className={`flex flex-wrap items-center gap-3 py-3.5 pr-5 sm:pr-6 ${
          opts.child ? "bg-canvas/60 pl-10 sm:pl-12" : "pl-5 sm:pl-6"
        }`}
      >
        {/* 순서 — 같은 상위 안에서만 움직인다 */}
        <div className="flex flex-col">
          <form action={moveCategory.bind(null, c.slug, "up")}>
            <button
              type="submit"
              disabled={opts.first}
              aria-label={`${c.name} 위로`}
              className="px-1 text-[11px] leading-none text-muted hover:text-ink-deep disabled:opacity-25"
            >
              ▲
            </button>
          </form>
          <form action={moveCategory.bind(null, c.slug, "down")}>
            <button
              type="submit"
              disabled={opts.last}
              aria-label={`${c.name} 아래로`}
              className="px-1 text-[11px] leading-none text-muted hover:text-ink-deep disabled:opacity-25"
            >
              ▼
            </button>
          </form>
        </div>

        {opts.child && <span aria-hidden className="-ml-1 text-[12px] text-muted">└</span>}

        {/* 이름 (즉시 수정) */}
        <form action={renameCategory.bind(null, c.slug)} className="flex min-w-0 flex-1 items-center gap-2">
          <input
            name="name"
            defaultValue={c.name}
            maxLength={30}
            className={`h-9 w-full min-w-0 max-w-[220px] border border-transparent bg-transparent px-2 text-[14px] text-ink-deep transition-colors hover:border-hairline focus:border-ink-deep focus:bg-white focus:outline-none ${
              opts.child ? "font-medium" : "font-semibold"
            }`}
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
          {removable && (
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
  };

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="카테고리 관리"
        description={`전체 ${flatCount}개 · 표시 ${shownCount}개`}
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rise rise-1">
          <Panel flush>
            {tree.length === 0 ? (
              <EmptyState>카테고리가 없습니다.</EmptyState>
            ) : (
              <ul className="divide-y divide-hairline-soft">
                {tree.flatMap((top, i) => [
                  row(top, { first: i === 0, last: i === tree.length - 1, child: false }),
                  ...top.children.map((kid, j) =>
                    row(kid, {
                      first: j === 0,
                      last: j === top.children.length - 1,
                      child: true,
                    }),
                  ),
                ])}
              </ul>
            )}
          </Panel>
          <p className="mt-3 text-[12px] leading-relaxed text-muted">
            대분류는 헤더 카테고리 줄에 나오고, 그 아래 세부 카테고리는 대분류 페이지 안에서
            버튼으로 보입니다. 대분류를 열면 세부 카테고리 상품까지 함께 나옵니다.
            <br />
            대분류를 숨기면 아래 세부 카테고리도 함께 숨겨집니다. 상품이 걸려 있거나 세부
            카테고리가 남아 있으면 삭제 대신 숨김을 쓰세요.
          </p>
        </div>

        <div className="rise rise-2 h-fit">
          <Panel title="새 카테고리">
            <CategoryAddForm parents={tree.map((t) => ({ slug: t.slug, name: t.name }))} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
