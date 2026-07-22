import Link from "next/link";
import { db } from "@/lib/db";
import { toggleBannerActive, deleteBanner } from "@/lib/actions/admin-banners";

export default async function AdminBannersPage() {
  const banners = await db.banner.findMany({ orderBy: { sortOrder: "asc" } });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-extrabold text-ink">배너 관리</h1>
          <p className="mt-1 text-[13px] text-muted">메인 히어로 슬라이드 · {banners.length}개</p>
        </div>
        <Link href="/admin/banners/new" className="rounded-pill bg-brand-500 px-5 py-2.5 text-[14px] font-bold text-white hover:bg-brand-600">
          + 배너 추가
        </Link>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <table className="w-full text-[14px]">
          <thead>
            <tr className="border-b border-line bg-cream/60 text-left text-[12px] text-muted">
              <th className="px-4 py-3 font-medium">순서</th>
              <th className="px-4 py-3 font-medium">라벨 / 제목</th>
              <th className="px-4 py-3 text-center font-medium">노출</th>
              <th className="px-4 py-3 text-right font-medium">관리</th>
            </tr>
          </thead>
          <tbody>
            {banners.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-10 text-center text-muted">배너가 없습니다.</td></tr>
            ) : (
              banners.map((b) => (
                <tr key={b.id} className="border-b border-line/60">
                  <td className="px-4 py-3 text-ink-soft">{b.sortOrder}</td>
                  <td className="px-4 py-3">
                    <span className="text-[12px] font-semibold text-brand-500">{b.eyebrow}</span>
                    <Link href={`/admin/banners/${b.id}`} className="block font-semibold text-ink hover:text-brand-600">
                      {b.title.replace(/\n/g, " ")}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`rounded-pill px-2.5 py-1 text-[12px] font-bold ${b.active ? "bg-brand-50 text-brand-600" : "bg-line text-muted"}`}>
                      {b.active ? "노출중" : "숨김"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-3">
                      <form action={toggleBannerActive.bind(null, b.id, !b.active)}>
                        <button type="submit" className="text-[13px] text-ink-soft hover:text-brand-600">
                          {b.active ? "숨김" : "노출"}
                        </button>
                      </form>
                      <Link href={`/admin/banners/${b.id}`} className="text-[13px] text-ink-soft hover:text-brand-600">수정</Link>
                      <form action={deleteBanner.bind(null, b.id)}>
                        <button type="submit" className="text-[13px] text-muted hover:text-brand-600">삭제</button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
