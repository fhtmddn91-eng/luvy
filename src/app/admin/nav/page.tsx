import { requireAdmin } from "@/lib/auth";
import { getAllNavLinks } from "@/lib/navLinks";
import { NavLinkForm } from "@/components/admin/NavLinkForm";
import {
  toggleNavLink,
  deleteNavLink,
  moveNavLink,
  seedDefaultNavLinks,
} from "@/lib/actions/admin-nav";
import { PageHeader, Panel, StatusPill, EmptyState, btnPrimary } from "@/components/ui/Panel";

export default async function AdminNavPage() {
  await requireAdmin();
  const links = await getAllNavLinks();

  return (
    <div>
      <PageHeader
        eyebrow="Storefront"
        title="상단 메뉴"
        description="검색창 아래 줄에 보이는 메뉴입니다. 순서·문구·링크를 바꾸면 매장에 바로 반영됩니다."
      />

      <div className="rise rise-1">
        <Panel title={`메뉴 (${links.length})`} flush>
          {links.length === 0 ? (
            <EmptyState>
              <p className="mb-4">
                아직 메뉴를 설정하지 않았습니다. 지금은 기본 메뉴(이번주 추천 · 신상품 · 인기상품 ·
                기획전 · 고객지원)가 그대로 보이고 있습니다.
              </p>
              <form action={seedDefaultNavLinks}>
                <button type="submit" className={btnPrimary}>
                  기본 메뉴 불러오기
                </button>
              </form>
            </EmptyState>
          ) : (
            <ul className="divide-y divide-hairline-soft">
              {links.map((l, i) => (
                <li key={l.id} className="px-5 py-4 sm:px-6">
                  <div className="mb-3 flex items-center gap-3">
                    <span className="font-display text-[13px] text-muted">{i + 1}</span>
                    <StatusPill
                      tone={l.active ? "bg-ink-deep text-white" : "bg-hairline-soft text-muted"}
                    >
                      {l.active ? "노출" : "숨김"}
                    </StatusPill>
                    <span className="ml-auto flex items-center gap-3 text-[13px]">
                      <form action={moveNavLink.bind(null, l.id, "up")}>
                        <button
                          type="submit"
                          disabled={i === 0}
                          className="px-1 text-muted hover:text-ink-deep disabled:opacity-25"
                          aria-label="위로"
                        >
                          ▲
                        </button>
                      </form>
                      <form action={moveNavLink.bind(null, l.id, "down")}>
                        <button
                          type="submit"
                          disabled={i === links.length - 1}
                          className="px-1 text-muted hover:text-ink-deep disabled:opacity-25"
                          aria-label="아래로"
                        >
                          ▼
                        </button>
                      </form>
                      <span aria-hidden className="h-3 w-px bg-hairline" />
                      <form action={toggleNavLink.bind(null, l.id)}>
                        <button type="submit" className="text-ink-soft hover:text-ink-deep">
                          {l.active ? "숨김" : "노출"}
                        </button>
                      </form>
                      <span aria-hidden className="h-3 w-px bg-hairline" />
                      <form action={deleteNavLink.bind(null, l.id)}>
                        <button type="submit" className="text-muted hover:text-ink-deep">
                          삭제
                        </button>
                      </form>
                    </span>
                  </div>
                  <NavLinkForm item={{ id: l.id, label: l.label, href: l.href, badge: l.badge }} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div className="rise rise-2 mt-4">
        <Panel title="메뉴 추가">
          <NavLinkForm />
        </Panel>
      </div>
    </div>
  );
}
