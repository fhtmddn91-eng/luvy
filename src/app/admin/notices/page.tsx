import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { toggleNoticeActive, deleteNotice } from "@/lib/actions/admin-notices";
import {
  PageHeader,
  Panel,
  StatusPill,
  TableWrap,
  Th,
  EmptyState,
  btnPrimary,
} from "@/components/ui/Panel";

const kindLabel: Record<string, string> = {
  notice: "공지사항",
  stock: "입고 소식",
  event: "이벤트",
};

export default async function AdminNoticesPage() {
  await requireAdmin();
  const notices = await db.notice.findMany({ orderBy: { sortOrder: "asc" } });

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="공지 관리"
        description={`메인 공지 스트립 · ${notices.length}개`}
        action={
          <Link href="/admin/notices/new" className={btnPrimary}>
            + 공지 추가
          </Link>
        }
      />

      <div className="rise rise-1">
        <Panel flush>
          {notices.length === 0 ? (
            <EmptyState>등록된 공지가 없습니다.</EmptyState>
          ) : (
            <TableWrap minWidth={660}>
              <thead>
                <tr className="border-b border-hairline-soft">
                  <Th align="center">순서</Th>
                  <Th>구분</Th>
                  <Th>내용</Th>
                  <Th align="center">노출</Th>
                  <Th align="right">관리</Th>
                </tr>
              </thead>
              <tbody>
                {notices.map((n) => (
                  <tr
                    key={n.id}
                    className="border-b border-hairline-soft last:border-0 transition-colors hover:bg-canvas"
                  >
                    <td className="px-5 py-3.5 text-center font-display text-[15px] text-muted sm:px-6">
                      {n.sortOrder}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 sm:px-6">
                      <StatusPill tone="bg-brand-50 text-brand-600">
                        {kindLabel[n.kind] ?? n.tag}
                      </StatusPill>
                    </td>
                    <td className="px-5 py-3.5 sm:px-6">
                      <Link
                        href={`/admin/notices/${n.id}`}
                        className="font-medium text-ink-deep hover:text-brand-600"
                      >
                        {n.text}
                      </Link>
                      {n.body && (
                        <span className="mt-0.5 block text-[12px] text-muted">상세 본문 있음</span>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-center sm:px-6">
                      <StatusPill
                        tone={n.active ? "bg-ink-deep text-white" : "bg-hairline-soft text-muted"}
                      >
                        {n.active ? "노출중" : "숨김"}
                      </StatusPill>
                    </td>
                    <td className="px-5 py-3.5 sm:px-6">
                      <div className="flex items-center justify-end gap-3 whitespace-nowrap text-[13px]">
                        <form action={toggleNoticeActive.bind(null, n.id, !n.active)}>
                          <button
                            type="submit"
                            className="text-ink-soft transition-colors hover:text-brand-600"
                          >
                            {n.active ? "숨김" : "노출"}
                          </button>
                        </form>
                        <span aria-hidden className="h-3 w-px bg-hairline" />
                        <Link
                          href={`/admin/notices/${n.id}`}
                          className="text-ink-soft transition-colors hover:text-brand-600"
                        >
                          수정
                        </Link>
                        <span aria-hidden className="h-3 w-px bg-hairline" />
                        <form action={deleteNotice.bind(null, n.id)}>
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
