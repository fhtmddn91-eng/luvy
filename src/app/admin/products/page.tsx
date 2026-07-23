import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { won } from "@/lib/format";
import { categories } from "@/lib/mock/categories";
import { setProductStatus, deleteProduct } from "@/lib/actions/admin-products";

const categoryName = (slug: string) => categories.find((c) => c.slug === slug)?.name ?? slug;

export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  await requireAdmin();
  const { q } = await searchParams;
  const query = (q ?? "").trim();

  const products = await db.product.findMany({
    where: query
      ? { OR: [{ name: { contains: query } }, { brand: { contains: query } }] }
      : undefined,
    include: { priceTiers: true },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-extrabold text-ink">상품 관리</h1>
          <p className="mt-1 text-[13px] text-muted">{products.length}개 상품</p>
        </div>
        <Link
          href="/admin/products/new"
          className="rounded-pill bg-brand-500 px-5 py-2.5 text-[14px] font-bold text-white hover:bg-brand-600"
        >
          + 상품 등록
        </Link>
      </div>

      <form className="mb-4" action="/admin/products">
        <input
          name="q"
          defaultValue={query}
          placeholder="상품명 또는 브랜드 검색"
          className="h-11 w-full max-w-sm rounded-lg border border-line bg-white px-4 text-[14px] focus:border-brand-400 focus:outline-none"
        />
      </form>

      <div className="overflow-hidden rounded-2xl border border-line bg-white">
        <table className="w-full text-[14px]">
          <thead>
            <tr className="border-b border-line bg-cream/60 text-left text-[12px] text-muted">
              <th className="px-4 py-3 font-medium">상품명</th>
              <th className="px-4 py-3 font-medium">브랜드</th>
              <th className="px-4 py-3 font-medium">카테고리</th>
              <th className="px-4 py-3 text-right font-medium">최저 도매가</th>
              <th className="px-4 py-3 text-center font-medium">상태</th>
              <th className="px-4 py-3 text-right font-medium">관리</th>
            </tr>
          </thead>
          <tbody>
            {products.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">상품이 없습니다.</td>
              </tr>
            ) : (
              products.map((p) => {
                const minTier = [...p.priceTiers].sort((a, b) => a.unitPrice - b.unitPrice)[0];
                return (
                  <tr key={p.id} className="border-b border-line/60">
                    <td className="px-4 py-3">
                      <Link href={`/admin/products/${p.id}`} className="font-semibold text-ink hover:text-brand-600">
                        {p.name}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-ink-soft">{p.brand}</td>
                    <td className="px-4 py-3 text-ink-soft">{categoryName(p.categorySlug)}</td>
                    <td className="px-4 py-3 text-right text-ink-soft">{minTier ? won(minTier.unitPrice) : "-"}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`rounded-pill px-2.5 py-1 text-[12px] font-bold ${p.status === "ACTIVE" ? "bg-brand-50 text-brand-600" : "bg-line text-muted"}`}>
                        {p.status === "ACTIVE" ? "판매중" : "숨김"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <form action={setProductStatus.bind(null, p.id, p.status === "ACTIVE" ? "HIDDEN" : "ACTIVE")}>
                          <button type="submit" className="text-[13px] text-ink-soft hover:text-brand-600">
                            {p.status === "ACTIVE" ? "숨김" : "판매"}
                          </button>
                        </form>
                        <Link href={`/admin/products/${p.id}`} className="text-[13px] text-ink-soft hover:text-brand-600">
                          수정
                        </Link>
                        <form action={deleteProduct.bind(null, p.id)}>
                          <button type="submit" className="text-[13px] text-muted hover:text-brand-600">
                            삭제
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
