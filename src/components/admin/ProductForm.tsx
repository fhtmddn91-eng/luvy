"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { categories } from "@/lib/mock/categories";
import type { ProductFormState } from "@/lib/actions/admin-products";

export interface ProductFormData {
  id: string;
  name: string;
  brand: string;
  categorySlug: string;
  description: string;
  basePrice: number;
  status: string;
  image?: string;
  priceTiers: { minQty: number; unitPrice: number }[];
}

type Action = (prev: ProductFormState, formData: FormData) => Promise<ProductFormState>;

const inputCls =
  "h-11 w-full rounded-lg border border-line bg-white px-3 text-[14px] text-ink focus:border-brand-400 focus:outline-none";
const labelCls = "mb-1.5 block text-[13px] font-semibold text-ink-soft";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 rounded-pill bg-brand-500 px-8 text-[14px] font-bold text-white hover:bg-brand-600 disabled:opacity-60"
    >
      {pending ? "저장 중…" : "저장"}
    </button>
  );
}

export function ProductForm({ action, product }: { action: Action; product?: ProductFormData }) {
  const [state, formAction] = useActionState<ProductFormState, FormData>(action, {});
  const [tiers, setTiers] = useState<{ minQty: string; unitPrice: string }[]>(
    product?.priceTiers.length
      ? product.priceTiers.map((t) => ({ minQty: String(t.minQty), unitPrice: String(t.unitPrice) }))
      : [{ minQty: "", unitPrice: "" }],
  );

  const setTier = (i: number, key: "minQty" | "unitPrice", value: string) =>
    setTiers((rows) => rows.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)));

  return (
    <form action={formAction} className="max-w-[720px] space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>상품명</label>
          <input name="name" defaultValue={product?.name} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>브랜드</label>
          <input name="brand" defaultValue={product?.brand} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>카테고리</label>
          <select name="categorySlug" defaultValue={product?.categorySlug ?? ""} className={inputCls}>
            <option value="" disabled>선택</option>
            {categories.map((c) => (
              <option key={c.slug} value={c.slug}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>정가(참고용)</label>
          <input name="basePrice" type="number" defaultValue={product?.basePrice} className={inputCls} />
        </div>
      </div>

      <div>
        <label className={labelCls}>설명</label>
        <textarea name="description" rows={3} defaultValue={product?.description} className={`${inputCls} h-auto py-2.5`} />
      </div>

      <div>
        <label className={labelCls}>판매 상태</label>
        <select name="status" defaultValue={product?.status ?? "ACTIVE"} className={`${inputCls} w-40`}>
          <option value="ACTIVE">판매중</option>
          <option value="HIDDEN">숨김</option>
        </select>
      </div>

      <div>
        <label className={labelCls}>상품 이미지 (JPG/PNG/WebP, 5MB 이하)</label>
        <div className="flex items-center gap-4">
          {product?.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.image}
              alt="현재 이미지"
              className="h-20 w-20 rounded-xl border border-line object-cover"
            />
          )}
          <div className="flex-1">
            <input
              name="imageFile"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif"
              className="block w-full text-[13px] text-ink-soft file:mr-3 file:rounded-pill file:border-0 file:bg-brand-100 file:px-4 file:py-2 file:text-[13px] file:font-bold file:text-brand-600 hover:file:bg-brand-200"
            />
            <p className="mt-1 text-[12px] text-muted">
              {product?.image ? "새 이미지를 선택하면 기존 이미지를 교체합니다." : "선택하지 않으면 브랜드 타일이 표시됩니다."}
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-line bg-cream/50 p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[13px] font-bold text-ink">수량별 도매가 (티어)</span>
          <button
            type="button"
            onClick={() => setTiers((r) => [...r, { minQty: "", unitPrice: "" }])}
            className="rounded-lg bg-brand-100 px-3 py-1.5 text-[12px] font-bold text-brand-600 hover:bg-brand-200"
          >
            + 티어 추가
          </button>
        </div>
        <div className="space-y-2">
          {tiers.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-10 text-[12px] text-muted">최소</span>
              <input
                name="tierMinQty"
                type="number"
                value={t.minQty}
                onChange={(e) => setTier(i, "minQty", e.target.value)}
                placeholder="수량"
                className="h-10 w-28 rounded-lg border border-line bg-white px-3 text-[14px] focus:border-brand-400 focus:outline-none"
              />
              <span className="text-[12px] text-muted">개 이상 →</span>
              <input
                name="tierUnitPrice"
                type="number"
                value={t.unitPrice}
                onChange={(e) => setTier(i, "unitPrice", e.target.value)}
                placeholder="개당 단가"
                className="h-10 w-36 rounded-lg border border-line bg-white px-3 text-[14px] focus:border-brand-400 focus:outline-none"
              />
              <span className="text-[12px] text-muted">원</span>
              {tiers.length > 1 && (
                <button
                  type="button"
                  onClick={() => setTiers((r) => r.filter((_, idx) => idx !== i))}
                  className="ml-1 text-[13px] text-muted hover:text-brand-600"
                >
                  삭제
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {state.error && <p className="text-[13px] font-medium text-brand-600">{state.error}</p>}

      <div className="flex items-center gap-3 pt-2">
        <SaveButton />
        <Link href="/admin/products" className="text-[14px] text-muted hover:text-ink">
          취소
        </Link>
      </div>
    </form>
  );
}
