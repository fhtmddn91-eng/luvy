import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { HOME_MODES, homeModeLabel } from "@/lib/homeSections";
import {
  seedDefaultSections,
  updateSection,
  toggleSection,
  moveSection,
  deleteSection,
  addPick,
  removePick,
  movePick,
} from "@/lib/actions/admin-home";
import { HomeSectionAddForm } from "@/components/admin/HomeSectionAddForm";
import { PageHeader, Panel, StatusPill, EmptyState, btnPrimary } from "@/components/ui/Panel";
import { fieldCls } from "@/components/ui/form";

export default async function AdminHomePage() {
  await requireAdmin();
  const sections = await db.homeSection.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      picks: {
        orderBy: { sortOrder: "asc" },
        include: { product: { select: { id: true, name: true, sku: true, status: true } } },
      },
    },
  });

  return (
    <div>
      <PageHeader
        eyebrow="Storefront"
        title="메인 상품 탭"
        description={`메인 화면 상품 탭 · ${sections.length}개`}
      />

      {sections.length === 0 && (
        <div className="rise rise-1 mb-4">
          <Panel>
            <p className="text-[13.5px] leading-relaxed text-ink-soft">
              아직 탭을 설정하지 않았습니다. 지금 매장에는 기본 4탭(HOT · 이번주 추천 · 입문
              추천 · 재구매 높은)이 보이고 있습니다. 아래 버튼을 누르면 그 4개를 그대로
              가져와서 이름·방식을 바꿀 수 있게 됩니다.
            </p>
            <form action={seedDefaultSections} className="mt-4">
              <button type="submit" className={btnPrimary}>
                기본 탭 불러오기
              </button>
            </form>
          </Panel>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="rise rise-1 space-y-4">
          {sections.length === 0 ? (
            <Panel flush>
              <EmptyState>설정된 탭이 없습니다.</EmptyState>
            </Panel>
          ) : (
            sections.map((s, i) => (
              <Panel key={s.id} flush>
                <div className="flex flex-wrap items-center gap-3 border-b border-hairline-soft px-5 py-3.5 sm:px-6">
                  <div className="flex flex-col">
                    <form action={moveSection.bind(null, s.id, "up")}>
                      <button
                        type="submit"
                        disabled={i === 0}
                        aria-label={`${s.label} 위로`}
                        className="px-1 text-[11px] leading-none text-muted hover:text-ink-deep disabled:opacity-25"
                      >
                        ▲
                      </button>
                    </form>
                    <form action={moveSection.bind(null, s.id, "down")}>
                      <button
                        type="submit"
                        disabled={i === sections.length - 1}
                        aria-label={`${s.label} 아래로`}
                        className="px-1 text-[11px] leading-none text-muted hover:text-ink-deep disabled:opacity-25"
                      >
                        ▼
                      </button>
                    </form>
                  </div>

                  <form
                    action={updateSection.bind(null, s.id)}
                    className="flex min-w-0 flex-1 flex-wrap items-center gap-2"
                  >
                    <input
                      name="label"
                      defaultValue={s.label}
                      maxLength={20}
                      aria-label="탭 이름"
                      className="h-9 w-full min-w-0 max-w-[180px] border border-transparent bg-transparent px-2 text-[14px] font-semibold text-ink-deep transition-colors hover:border-hairline focus:border-ink-deep focus:bg-white focus:outline-none"
                    />
                    <select
                      name="mode"
                      defaultValue={s.mode}
                      aria-label="표시 방식"
                      className={`${fieldCls} h-9 w-auto min-w-[190px] text-[13px]`}
                    >
                      {Object.entries(HOME_MODES).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      className="shrink-0 text-[12px] font-semibold text-muted hover:text-ink-deep"
                    >
                      저장
                    </button>
                  </form>

                  <StatusPill tone={s.active ? "bg-ink-deep text-white" : "bg-hairline-soft text-muted"}>
                    {s.active ? "표시" : "숨김"}
                  </StatusPill>
                  <div className="flex items-center gap-3 text-[13px]">
                    <form action={toggleSection.bind(null, s.id)}>
                      <button type="submit" className="text-ink-soft hover:text-ink-deep">
                        {s.active ? "숨김" : "표시"}
                      </button>
                    </form>
                    <span aria-hidden className="h-3 w-px bg-hairline" />
                    <form action={deleteSection.bind(null, s.id)}>
                      <button type="submit" className="text-muted hover:text-ink-deep">
                        삭제
                      </button>
                    </form>
                  </div>
                </div>

                {/* 직접 고르기일 때만 상품 지정이 의미가 있다 */}
                {s.mode === "MANUAL" ? (
                  <div className="px-5 py-4 sm:px-6">
                    {s.picks.length === 0 ? (
                      <p className="mb-3 text-[13px] text-muted">
                        아직 고른 상품이 없습니다. 상품을 넣기 전까지는 신상품이 대신 나옵니다.
                      </p>
                    ) : (
                      <ul className="mb-3 space-y-1.5">
                        {s.picks.map((p, j) => (
                          <li key={p.productId} className="flex flex-wrap items-center gap-2 text-[13.5px]">
                            <form action={movePick.bind(null, s.id, p.productId, "up")}>
                              <button
                                type="submit"
                                disabled={j === 0}
                                aria-label="위로"
                                className="px-1 text-[11px] text-muted hover:text-ink-deep disabled:opacity-25"
                              >
                                ▲
                              </button>
                            </form>
                            <form action={movePick.bind(null, s.id, p.productId, "down")}>
                              <button
                                type="submit"
                                disabled={j === s.picks.length - 1}
                                aria-label="아래로"
                                className="px-1 text-[11px] text-muted hover:text-ink-deep disabled:opacity-25"
                              >
                                ▼
                              </button>
                            </form>
                            <Link
                              href={`/admin/products/${p.productId}`}
                              className="min-w-0 flex-1 truncate font-medium text-ink-deep hover:underline"
                            >
                              {p.product.name}
                            </Link>
                            {p.product.sku && (
                              <span className="font-display text-[11px] tracking-[0.04em] text-muted">
                                {p.product.sku}
                              </span>
                            )}
                            {p.product.status !== "ACTIVE" && (
                              <span className="text-[12px] font-semibold text-brand-600">
                                숨김 상품 — 매장에 안 나옵니다
                              </span>
                            )}
                            <form action={removePick.bind(null, s.id, p.productId)}>
                              <button type="submit" className="text-[12px] text-muted hover:text-ink-deep">
                                빼기
                              </button>
                            </form>
                          </li>
                        ))}
                      </ul>
                    )}
                    <form action={addPick.bind(null, s.id)} className="flex flex-wrap items-center gap-2">
                      <input
                        name="q"
                        placeholder="상품명 또는 품번"
                        aria-label="추가할 상품"
                        className={`${fieldCls} h-9 w-full max-w-[260px] text-[13px]`}
                      />
                      <button
                        type="submit"
                        className="border border-hairline px-3.5 py-1.5 text-[12px] font-semibold text-ink-soft transition-colors hover:border-ink-deep hover:text-ink-deep"
                      >
                        + 상품 추가
                      </button>
                    </form>
                  </div>
                ) : (
                  <p className="px-5 py-3.5 text-[13px] text-muted sm:px-6">
                    {homeModeLabel(s.mode)} — 자동으로 채워집니다. 결과가 모자라면 신상품으로
                    메꿉니다.
                  </p>
                )}
              </Panel>
            ))
          )}
        </div>

        <div className="rise rise-2 h-fit space-y-4">
          <Panel title="새 탭">
            <HomeSectionAddForm />
          </Panel>
          <Panel title="참고">
            <p className="text-[12.5px] leading-relaxed text-muted">
              탭 하나에 상품 8개까지 나옵니다. 주문이 쌓이기 전에는 인기·재구매 탭이 비므로
              신상품으로 채워집니다.
              <br />
              <br />
              탭을 전부 지우면 매장에는 기본 4탭이 다시 보입니다.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
