"use client";

import { useActionState, useState, startTransition } from "react";
import Link from "next/link";
import type { ProductFormState } from "@/lib/actions/admin-products";
import { Panel, btnPrimary } from "@/components/ui/Panel";
import { fieldCls, areaCls, labelCls, helpCls, errorCls } from "@/components/ui/form";

export interface ProductFormData {
 id: string;
 name: string;
 brand: string;
 categorySlug: string;
 sku: string | null;
 /** 대표 포함, 이 상품이 걸린 모든 카테고리 slug */
 categorySlugs: string[];
 description: string;
 basePrice: number;
 status: string;
 trackStock?: boolean;
 stock?: number;
 image?: string;
 priceTiers: { minQty: number; unitPrice: number }[];
 options?: { name: string; unitPrice: number; trackStock: boolean; stock: number }[];
}

/** 선택 상자·체크박스에 넘길 카테고리 (2단) */
export interface CategoryChoice {
 slug: string;
 name: string;
 parentSlug: string | null;
}

type Action = (prev: ProductFormState, formData: FormData) => Promise<ProductFormState>;

function SaveButton({ pending }: { pending: boolean }) {
 return (
 <button type="submit" disabled={pending} className={btnPrimary}>
 {pending ? "저장 중…" : "저장"}
 </button>
 );
}

export function ProductForm({
 action,
 product,
 categories,
}: {
 action: Action;
 product?: ProductFormData;
 categories: CategoryChoice[];
}) {
 const [state, formAction, pending] = useActionState<ProductFormState, FormData>(action, {});
 // 첨부한 썸네일 미리보기 — "첨부가 됐는지" 눈으로 확인할 수 있게
 const [preview, setPreview] = useState<string | null>(null);
 const [tiers, setTiers] = useState<{ minQty: string; unitPrice: string }[]>(
 product?.priceTiers.length
 ? product.priceTiers.map((t) => ({ minQty: String(t.minQty), unitPrice: String(t.unitPrice) }))
 : [{ minQty: "", unitPrice: "" }],
 );

 // 대표 카테고리는 "추가로 넣을 카테고리" 목록에서 빼야 하므로 상태로 들고 있는다
 const [primary, setPrimary] = useState(product?.categorySlug ?? "");
 const [extras, setExtras] = useState<string[]>(
 (product?.categorySlugs ?? []).filter((s) => s !== (product?.categorySlug ?? "")),
 );

 const setTier = (i: number, key: "minQty" | "unitPrice", value: string) =>
 setTiers((rows) => rows.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));

 // 상품 옵션(색상·사이즈). 비어 있으면 옵션 없는 상품으로 저장된다
 const [options, setOptions] = useState<
 { name: string; unitPrice: string; trackStock: boolean; stock: string }[]
 >(
 (product?.options ?? []).map((o) => ({
 name: o.name,
 unitPrice: o.unitPrice ? String(o.unitPrice) : "",
 trackStock: o.trackStock,
 stock: String(o.stock),
 })),
 );
 const setOption = (i: number, patch: Partial<(typeof options)[number]>) =>
 setOptions((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

 const toggleExtra = (slug: string) =>
 setExtras((cur) => (cur.includes(slug) ? cur.filter((s) => s !== slug) : [...cur, slug]));

 const tops = categories.filter((c) => c.parentSlug === null);
 const childrenOf = (slug: string) => categories.filter((c) => c.parentSlug === slug);
 const nameOf = (slug: string) => categories.find((c) => c.slug === slug)?.name ?? slug;

 // form action={} 대신 직접 dispatch — React 19는 <form action> 제출이 끝나면
 // 폼을 자동 리셋해서, 검증 에러가 떠도 입력값과 첨부 파일이 전부 사라진다.
 const submit = (e: React.FormEvent<HTMLFormElement>) => {
 e.preventDefault();
 const fd = new FormData(e.currentTarget);
 startTransition(() => formAction(fd));
 };

 return (
 <form onSubmit={submit} className="max-w-[760px] space-y-4">
 <div className="rise rise-1">
 <Panel title="기본 정보">
 <div className="grid gap-4 sm:grid-cols-2">
 <div className="sm:col-span-2">
 <label className={labelCls}>상품명</label>
 <input name="name" defaultValue={product?.name} className={fieldCls} />
 </div>
 <div>
 <label className={labelCls}>브랜드</label>
 <input name="brand" defaultValue={product?.brand} className={fieldCls} />
 </div>
 <div>
 <label className={labelCls}>대표 카테고리</label>
 <select
 name="categorySlug"
 value={primary}
 onChange={(e) => setPrimary(e.target.value)}
 className={fieldCls}
 >
 <option value="" disabled>
 선택
 </option>
 {tops.map((top) => {
 const kids = childrenOf(top.slug);
 if (kids.length === 0) {
 return (
 <option key={top.slug} value={top.slug}>
 {top.name}
 </option>
 );
 }
 return (
 <optgroup key={top.slug} label={top.name}>
 <option value={top.slug}>{top.name} (전체)</option>
 {kids.map((k) => (
 <option key={k.slug} value={k.slug}>
 {k.name}
 </option>
 ))}
 </optgroup>
 );
 })}
 </select>
 <p className={helpCls}>상세 페이지에 표시되고, 목록에서 이 상품의 소속으로 잡힙니다.</p>
 </div>
 <div>
 <label className={labelCls}>품번 (선택)</label>
 <input
 name="sku"
 defaultValue={product?.sku ?? ""}
 maxLength={32}
 autoComplete="off"
 placeholder="예) LV-2601"
 className={fieldCls}
 />
 <p className={helpCls}>
 자체 관리 번호입니다. 주문서·엑셀에 함께 나옵니다. 비워두면 쓰지 않습니다.
 </p>
 </div>
 <div>
 <label className={labelCls}>권장 판매가</label>
 <input
 name="basePrice"
 type="number"
 min={0}
 defaultValue={product?.basePrice}
 className={fieldCls}
 />
 <p className={helpCls}>
 거래처가 소비자에게 판매할 때 권장하는 가격입니다. 상품 페이지에 도매가와 함께 표시됩니다.
 </p>
 </div>
 <div>
 <label className={labelCls}>판매 상태</label>
 <select name="status" defaultValue={product?.status ?? "ACTIVE"} className={fieldCls}>
 <option value="ACTIVE">판매중</option>
 <option value="HIDDEN">숨김</option>
 </select>
 </div>
 <div className="sm:col-span-2 border-t border-hairline pt-4">
 <label className="flex cursor-pointer items-start gap-2.5">
 <input
 name="trackStock"
 type="checkbox"
 defaultChecked={product?.trackStock ?? false}
 className="mt-0.5 h-4 w-4 accent-ink-deep"
 />
 <span>
 <span className="block text-[13.5px] font-bold text-ink-deep">재고 관리 사용</span>
 <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">
 켜면 재고 수량만큼만 주문받고, 0이 되면 자동으로 품절 처리됩니다.
 주문 후 사입하는 무재고 상품은 꺼두세요.
 </span>
 </span>
 </label>
 <div className="mt-3">
 <label className={labelCls}>재고 수량</label>
 <input
 name="stock"
 type="number"
 min={0}
 defaultValue={product?.stock ?? 0}
 className={`${fieldCls} w-40`}
 />
 <p className={helpCls}>재고 관리를 끄면 이 값은 사용되지 않습니다.</p>
 </div>
 </div>
 <div className="sm:col-span-2 border-t border-hairline pt-4">
 <label className={labelCls}>추가로 노출할 카테고리 (선택)</label>
 <p className="mb-2.5 text-[12px] leading-relaxed text-muted">
 한 상품을 여러 매대에 함께 올릴 때 씁니다. 대표 카테고리
 {primary ? ` (${nameOf(primary)})` : ""}는 자동으로 포함되므로 고르지 않아도 됩니다.
 </p>
 <div className="space-y-2.5">
 {tops.map((top) => {
 const group = [top, ...childrenOf(top.slug)].filter((c) => c.slug !== primary);
 if (group.length === 0) return null;
 return (
 <div key={top.slug} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
 <span className="w-[92px] shrink-0 text-[12px] font-semibold text-ink-soft">
 {top.name}
 </span>
 {group.map((c) => (
 <label
 key={c.slug}
 className="flex cursor-pointer items-center gap-1.5 text-[13px] text-ink-deep"
 >
 <input
 type="checkbox"
 name="extraCategories"
 value={c.slug}
 checked={extras.includes(c.slug)}
 onChange={() => toggleExtra(c.slug)}
 className="h-3.5 w-3.5 accent-ink-deep"
 />
 {c.slug === top.slug ? `${c.name} (전체)` : c.name}
 </label>
 ))}
 </div>
 );
 })}
 </div>
 <p className={helpCls}>
 신상품·인기상품은 여기서 지정하지 않습니다 — 등록일과 판매량으로 자동 계산됩니다.
 </p>
 </div>
 <div className="sm:col-span-2">
 <label className={labelCls}>상세 설명</label>
 <textarea
 name="description"
 rows={8}
 defaultValue={product?.description}
 className={areaCls}
 />
 </div>
 </div>
 </Panel>
 </div>

 <div className="rise rise-2">
 {/* 아래 "상품 이미지" 패널의 대표이미지와 헷갈리지 않게 이름을 나눈다 */}
        <Panel title="목록 썸네일">
 <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
 <div className="shrink-0">
 {preview || product?.image ? (
 // eslint-disable-next-line @next/next/no-img-element
 <img
 src={preview ?? product?.image}
 alt={preview ? "첨부한 이미지 미리보기" : "현재 등록된 이미지"}
 className="h-24 w-24 border border-hairline object-cover"
 />
 ) : (
 <div className="flex h-24 w-24 items-center justify-center border border-dashed border-hairline text-[11px] text-muted">
 없음
 </div>
 )}
 {preview && (
 <p className="mt-1 w-24 text-center text-[10px] font-bold text-ink-deep">첨부됨</p>
 )}
 </div>
 <div className="min-w-0 flex-1">
 <input
 name="imageFile"
 type="file"
 accept="image/*"
 onChange={(e) => {
 const f = e.target.files?.[0] ?? null;
 setPreview((prev) => {
 if (prev) URL.revokeObjectURL(prev);
 return f ? URL.createObjectURL(f) : null;
 });
 }}
 className="block w-full text-[13px] text-ink-soft file:mr-3 file:border file:border-hairline file:bg-white file:px-4 file:py-2 file:text-[13px] file:font-semibold file:text-ink-deep hover:file:border-ink-deep"
 />
 <p className={helpCls}>
 JPG · PNG · WebP · AVIF / 5MB 이하. 대표이미지를 등록하면 첫
                대표이미지가 썸네일이 되므로 여기 올린 이미지는 쓰이지 않습니다.{" "}
 {product?.image
 ? "새 이미지를 선택하면 기존 이미지를 교체하고 이전 파일은 삭제됩니다."
 : "선택하지 않으면 브랜드 타일이 표시됩니다."}
 </p>
 </div>
 </div>
 </Panel>
 </div>

 <div className="rise rise-3">
 <Panel
 title="수량별 도매가"
 action={
 <button
 type="button"
 onClick={() => setTiers((r) => [...r, { minQty: "", unitPrice: "" }])}
 className="border border-hairline px-3.5 py-1.5 text-[12px] font-semibold text-ink-soft transition-colors hover:border-ink-deep hover:text-ink-deep"
 >
 + 티어 추가
 </button>
 }
 >
 <div className="space-y-2.5">
 {tiers.map((t, i) => (
 <div key={i} className="flex flex-wrap items-center gap-2">
 <span className="text-[12px] text-muted">최소</span>
 <input
 name="tierMinQty"
 type="number"
 value={t.minQty}
 onChange={(e) => setTier(i, "minQty", e.target.value)}
 placeholder="수량"
 className={`${fieldCls} w-24`}
 />
 <span className="text-[12px] text-muted">개 이상 →</span>
 <input
 name="tierUnitPrice"
 type="number"
 value={t.unitPrice}
 onChange={(e) => setTier(i, "unitPrice", e.target.value)}
 placeholder="개당 단가"
 className={`${fieldCls} w-32`}
 />
 <span className="text-[12px] text-muted">원</span>
 {tiers.length > 1 && (
 <button
 type="button"
 onClick={() => setTiers((r) => r.filter((_, idx) => idx !== i))}
 className="ml-auto text-[13px] text-muted transition-colors hover:text-ink-deep sm:ml-1"
 >
 삭제
 </button>
 )}
 </div>
 ))}
 </div>
 <p className={helpCls}>
 가장 낮은 수량이 최소 주문 수량(MOQ)이 됩니다. 수량이 많을수록 단가를 낮게 설정하세요.
 </p>
 </Panel>
 </div>

 <div className="rise rise-3">
 <Panel
 title="상품 옵션 (선택)"
 action={
 <button
 type="button"
 onClick={() =>
 setOptions((r) => [...r, { name: "", unitPrice: "", trackStock: false, stock: "0" }])
 }
 className="border border-hairline px-3.5 py-1.5 text-[12px] font-semibold text-ink-soft transition-colors hover:border-ink-deep hover:text-ink-deep"
 >
 + 옵션 추가
 </button>
 }
 >
 {options.length === 0 ? (
 <p className={helpCls}>
 색상·사이즈처럼 고를 것이 있으면 추가하세요. 옵션을 하나라도 넣으면
 거래처는 <strong className="text-ink-deep">옵션을 골라야</strong> 주문할 수 있습니다.
 </p>
 ) : (
 <div className="space-y-2.5">
 {options.map((o, i) => (
 <div key={i} className="flex flex-wrap items-center gap-2 border-b border-hairline-soft pb-2.5 last:border-0">
 <input
 name="optionName"
 value={o.name}
 onChange={(e) => setOption(i, { name: e.target.value })}
 placeholder="옵션명 (예: 레드)"
 className={`${fieldCls} w-40`}
 />
 <input
 name="optionPrice"
 type="number"
 min={0}
 value={o.unitPrice}
 onChange={(e) => setOption(i, { unitPrice: e.target.value })}
 placeholder="옵션 단가"
 className={`${fieldCls} w-32`}
 />
 <span className="text-[12px] text-muted">원 (비우면 수량별 도매가)</span>
 <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-ink-soft">
 <input
 type="checkbox"
 checked={o.trackStock}
 onChange={(e) => setOption(i, { trackStock: e.target.checked })}
 className="h-4 w-4 accent-ink-deep"
 />
 재고 관리
 </label>
 <input
 name="optionStock"
 type="number"
 min={0}
 value={o.stock}
 onChange={(e) => setOption(i, { stock: e.target.value })}
 placeholder="재고"
 className={`${fieldCls} w-24`}
 disabled={!o.trackStock}
 />
 {/* 체크박스는 꺼져 있으면 전송되지 않으므로 값을 따로 실어 보낸다 */}
 <input type="hidden" name="optionTrack" value={o.trackStock ? "1" : "0"} />
 <button
 type="button"
 onClick={() => setOptions((r) => r.filter((_, idx) => idx !== i))}
 className="ml-auto text-[13px] text-muted transition-colors hover:text-ink-deep"
 >
 삭제
 </button>
 </div>
 ))}
 <p className={helpCls}>
 옵션 단가를 비우면 위의 수량별 도매가를 그대로 씁니다. 재고 관리를 끄면 수량 제한 없이 주문받습니다.
 </p>
 </div>
 )}
 </Panel>
 </div>

 {state.error && <p className={errorCls}>{state.error}</p>}

 <div className="flex items-center gap-4 pt-1">
 <SaveButton pending={pending} />
 <Link
 href="/admin/products"
 className="text-[13.5px] text-muted transition-colors hover:text-ink-deep"
 >
 취소
 </Link>
 </div>
 </form>
 );
}
