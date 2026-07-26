import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { toggleBannerActive, deleteBanner } from "@/lib/actions/admin-banners";
import {
  PageHeader,
  Panel,
  StatusPill,
  TableWrap,
  Th,
  EmptyState,
  btnPrimary,
} from "@/components/ui/Panel";

export default async function AdminBannersPage() {
  await requireAdmin();
  const banners = await db.banner.findMany({ orderBy: { sortOrder: "asc" } });

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="배너 관리"
        description={`메인 히어로 슬라이드 · ${banners.length}개`}
        action={
          <Link href="/admin/banners/new" className={btnPrimary}>
            + 배너 추가
          </Link>
        }
      />

      <div className="rise rise-1">
        <Panel flush>
          {banners.length === 0 ? (
            <EmptyState>등록된 배너가 없습니다.</EmptyState>
          ) : (
            <TableWrap minWidth={620}>
              <thead>
                <tr className="border-b border-hairline-soft">
                  <Th align="center">순서</Th>
                  <Th>라벨 / 제목</Th>
                  <Th align="center">노출</Th>
                  <Th align="right">관리</Th>
                </tr>
              </thead>
              <tbody>
                {banners.map((b) => (
                  <tr
                    key={b.id}
                    className="border-b border-hairline-soft last:border-0 transition-colors hover:bg-canvas"
                  >
                    <td className="px-5 py-3.5 text-center font-display text-[15px] text-muted sm:px-6">
                      {b.sortOrder}
                    </td>
                    <td className="px-5 py-3.5 sm:px-6">
                      <span className="eyebrow text-brand-500">{b.eyebrow}</span>
                      <Link
                        href={`/admin/banners/${b.id}`}
                        className="mt-0.5 block font-semibold text-ink-deep hover:text-brand-600"
                      >
                        {b.title.replace(/\n/g, " ")}
                      </Link>
                    </td>
                    <td className="px-5 py-3.5 text-center sm:px-6">
                      <StatusPill
                        tone={b.active ? "bg-ink-deep text-white" : "bg-hairline-soft text-muted"}
                      >
                        {b.active ? "노출중" : "숨김"}
                      </StatusPill>
                    </td>
                    <td className="px-5 py-3.5 sm:px-6">
                      <div className="flex items-center justify-end gap-3 whitespace-nowrap text-[13px]">
                        <form action={toggleBannerActive.bind(null, b.id, !b.active)}>
                          <button
                            type="submit"
                            className="text-ink-soft transition-colors hover:text-brand-600"
                          >
                            {b.active ? "숨김" : "노출"}
                          </button>
                        </form>
                        <span aria-hidden className="h-3 w-px bg-hairline" />
                        <Link
                          href={`/admin/banners/${b.id}`}
                          className="text-ink-soft transition-colors hover:text-brand-600"
                        >
                          수정
                        </Link>
                        <span aria-hidden className="h-3 w-px bg-hairline" />
                        <form action={deleteBanner.bind(null, b.id)}>
                          <button
                            type="submit"
                            className="text-muted transition-colors hover:text-brand-600"
                          >
                            삭제
                          </button>
                        </form>
                      </div>
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
