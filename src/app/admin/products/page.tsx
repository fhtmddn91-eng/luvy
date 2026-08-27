import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { won } from "@/lib/format";
import { getAllCategories } from "@/lib/categories";
import { setProductStatus, deleteProduct, setProductBrand } from "@/lib/actions/admin-products";
import { isPlaceholderBrand, BLOCKING_TRANSLATE_STATUSES } from "@/lib/productPublishGate";
import { ProductThumb } from "@/components/product/ProductThumb";
import { stockLabel, stockState } from "@/lib/stock";
import {
 PageHeader,
 Panel,
 StatusPill,
 TableWrap,
 Th,
 EmptyState,
 btnPrimary,
} from "@/components/ui/Panel";



export default async function AdminProductsPage({
 searchParams,
}: {
 searchParams: Promise<{ q?: string }>;
}) {
 await requireAdmin();
 const { q } = await searchParams;
 const query = (q ?? "").trim();

 const cats = await getAllCategories();
 /** 세부 카테고리는 "남성용품 › 오나홀" 로 상위까지 보여준다 */
 const categoryName = (slug: string) => {
 const self = cats.find((c) => c.slug === slug);
 if (!self) return slug;
 const parent = self.parentSlug ? cats.find((c) => c.slug === self.parentSlug) : undefined;
 return parent ? `${parent.name} › ${self.name}` : self.name;
 };

 const products = await db.product.findMany({
 where: query
 ? {
 OR: [
 { name: { contains: query } },
 { brand: { contains: query } },
 // 품번은 대문자로 저장되므로 소문자로 쳐도 찾히게 한다
 { sku: { contains: query.toUpperCase() } },
 ],
 }
 : undefined,
 include: { priceTiers: true },
 orderBy: { createdAt: "desc" },
 });

 const liveCount = products.filter((p) => p.status === "ACTIVE").length;

 // 번역 검증에 막힌 이미지 수 — 판매 보류 배지에 사유로 보여준다 (설계 v2.1)
 const blockedRows = await db.productAsset.groupBy({
 by: ["productId"],
 where: {
 // 게이트와 같은 목록을 쓴다 — 따로 적어 두면 새 상태가 생겼을 때 어긋난다
 translateStatus: { in: BLOCKING_TRANSLATE_STATUSES },
 },
 _count: { _all: true },
 });
 const blockedByProduct = new Map(blockedRows.map((r) => [r.productId, r._count._all]));

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
 <TableWrap minWidth={940}>
 <thead>
 <tr className="border-b border-hairline-soft">
 <Th>상품</Th>
 <Th>브랜드</Th>
 <Th>카테고리</Th>
 <Th align="right">최저 도매가</Th>
 <Th align="center">재고</Th>
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
 <span className="min-w-0">
 <span className="line-clamp-2">{p.name}</span>
 {p.sku && (
 <span className="mt-0.5 block font-display text-[11px] tracking-[0.04em] text-muted">
 {p.sku}
 </span>
 )}
 </span>
 </Link>
 </td>
 {/* 브랜드는 목록에서 바로 친다 — 수집 상품은 브랜드를 모른 채 들어와서,
 수백 건을 상품마다 수정 폼 열어 채울 수 없다. 아직 안 채운 칸은 테두리로 표시 */}
 <td className="px-5 py-3 text-[13px] text-ink-soft sm:px-6">
 <form action={setProductBrand.bind(null, p.id)}>
 <input
 name="brand"
 defaultValue={isPlaceholderBrand(p.brand) ? "" : p.brand}
 placeholder="브랜드 입력"
 aria-label={`${p.name} 브랜드`}
 className={`w-full min-w-[7rem] max-w-[11rem] rounded-md border bg-white px-2 py-1 text-[13px] text-ink-deep outline-none transition-colors focus:border-ink-deep ${
 isPlaceholderBrand(p.brand) ? "border-amber-400 placeholder:text-amber-700" : "border-hairline"
 }`}
 />
 </form>
 </td>
 <td className="px-5 py-3 text-[13px] text-ink-soft sm:px-6">
 {categoryName(p.categorySlug)}
 </td>
 <td className="whitespace-nowrap px-5 py-3 text-right font-semibold text-ink-deep sm:px-6">
 {minTier ? won(minTier.unitPrice) : "—"}
 </td>
 <td className="whitespace-nowrap px-5 py-3 text-center text-[13px] font-semibold sm:px-6">
 <span
 className={
 stockState(p) === "sold_out"
 ? "text-brand-600"
 : stockState(p) === "low"
 ? "text-[#95651a]"
 : "text-ink-soft"
 }
 >
 {stockLabel(p)}
 </span>
 </td>
 <td className="px-5 py-3 text-center sm:px-6">
 <StatusPill tone={live ? "bg-ink-deep text-white" : "bg-hairline-soft text-muted"}>
 {live ? "판매중" : p.publishRequestedAt ? "판매 보류" : "숨김"}
 </StatusPill>
 {/* 보류 사유는 실제 원인을 적는다 — 브랜드가 비어 막힌 상품에 "번역 검증
 대기"를 띄우면 운영자가 영원히 안 오는 번역을 기다린다 */}
 {(p.publishRequestedAt || blockedByProduct.has(p.id)) && (
 <span className="mt-1 block text-[11px] font-semibold text-amber-700">
 {[
 blockedByProduct.has(p.id) ? `번역 확인 필요 ${blockedByProduct.get(p.id)}장` : null,
 isPlaceholderBrand(p.brand) ? "브랜드 미정" : null,
 ]
 .filter(Boolean)
 .join(" · ") || "번역 검증 대기"}
 </span>
 )}
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
