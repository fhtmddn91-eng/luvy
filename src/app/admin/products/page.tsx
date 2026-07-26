import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { won } from "@/lib/format";
import { categories } from "@/lib/mock/categories";
import { setProductStatus, deleteProduct } from "@/lib/actions/admin-products";
import { ProductThumb } from "@/components/product/ProductThumb";
import {
 PageHeader,
 Panel,
 StatusPill,
 TableWrap,
 Th,
 EmptyState,
 btnPrimary,
} from "@/components/ui/Panel";

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

 const liveCount = products.filter((p) => p.status === "ACTIVE").length;

 return (
 <div>
 <PageHeader
 eyebrow="Catalog"
 title="상품 관리"
 description={`전체 ${products.length}개 · 판매중 ${liveCount}개`}
 action={
 <Link href="/admin/products/new" className={btnPrimary}>
 + 상품 등록
 </Link>
 }
 />

 <form className="rise rise-1 mb-4" action="/admin/products">
 <div className="relative max-w-sm">
 <input
 name="q"
 defaultValue={query}
 placeholder="상품명 또는 브랜드 검색"
 className="h-11 w-full border border-hairline bg-white pl-4 pr-20 text-[14px] text-ink-deep placeholder:text-muted focus:border-ink-deep focus:outline-none"
 />
 <button
 type="submit"
 className="absolute right-1.5 top-1/2 -translate-y-1/2 px-3.5 py-1.5 text-[13px] font-semibold text-ink-soft transition-colors hover:text-ink-deep"
 >
 검색
 </button>
 </div>
 </form>

 <div className="rise rise-2">
 <Panel flush>
 {products.length === 0 ? (
 <EmptyState>
 {query ? `‘${query}’ 검색 결과가 없습니다.` : "등록된 상품이 없습니다."}
 </EmptyState>
 ) : (
 <TableWrap minWidth={860}>
 <thead>
 <tr className="border-b border-hairline-soft">
 <Th>상품</Th>
 <Th>브랜드</Th>
 <Th>카테고리</Th>
 <Th align="right">최저 도매가</Th>
 <Th align="center">상태</Th>
 <Th align="right">관리</Th>
 </tr>
 </thead>
 <tbody>
 {products.map((p) => {
 const minTier = [...p.priceTiers].sort((a, b) => a.unitPrice - b.unitPrice)[0];
 const live = p.status === "ACTIVE";
 return (
 <tr
 key={p.id}
 className="border-b border-hairline-soft last:border-0 transition-colors hover:bg-canvas"
 >
 <td className="px-5 py-3 sm:px-6">
 <Link
 href={`/admin/products/${p.id}`}
 className="flex items-center gap-3 font-semibold text-ink-deep hover:text-ink-deep"
 >
 <ProductThumb
 id={p.id}
 brand={p.brand}
 image={p.image || undefined}
 alt={p.name}
 compact
 tone="neutral"
 className="h-11 w-11 shrink-0 text-[7px]"
 />
 <span className="line-clamp-2">{p.name}</span>
 </Link>
 </td>
 <td className="px-5 py-3 text-[13px] text-ink-soft sm:px-6">{p.brand}</td>
 <td className="px-5 py-3 text-[13px] text-ink-soft sm:px-6">
 {categoryName(p.categorySlug)}
 </td>
 <td className="whitespace-nowrap px-5 py-3 text-right font-semibold text-ink-deep sm:px-6">
 {minTier ? won(minTier.unitPrice) : "—"}
 </td>
 <td className="px-5 py-3 text-center sm:px-6">
 <StatusPill tone={live ? "positive" : "neutral"}>
 {live ? "판매중" : "숨김"}
 </StatusPill>
 </td>
 <td className="px-5 py-3 sm:px-6">
 <div className="flex items-center justify-end gap-3 whitespace-nowrap text-[13px]">
 <form
 action={setProductStatus.bind(null, p.id, live ? "HIDDEN" : "ACTIVE")}
 >
 <button
 type="submit"
 className="text-ink-soft transition-colors hover:text-ink-deep"
 >
 {live ? "숨김" : "판매"}
 </button>
 </form>
 <span aria-hidden className="h-3 w-px bg-hairline" />
 <Link
 href={`/admin/products/${p.id}`}
 className="text-ink-soft transition-colors hover:text-ink-deep"
 >
 수정
 </Link>
 <span aria-hidden className="h-3 w-px bg-hairline" />
 <form action={deleteProduct.bind(null, p.id)}>
 <button
 type="submit"
 className="text-muted transition-colors hover:text-ink-deep"
 >
 삭제
 </button>
 </form>
 </div>
 </td>
 </tr>
 );
 })}
 </tbody>
 </TableWrap>
 )}
 </Panel>
 </div>
 </div>
 );
}
