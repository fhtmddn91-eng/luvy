"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { categories } from "@/lib/mock/categories";
import type { ProductFormState } from "@/lib/actions/admin-products";
import { Panel, btnPrimary } from "@/components/ui/Panel";
import { fieldCls, areaCls, labelCls, helpCls, errorCls } from "@/components/ui/form";

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

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={btnPrimary}>
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
    <form action={formAction} className="max-w-[760px] space-y-4">
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
              <label className={labelCls}>카테고리</label>
              <select
                name="categorySlug"
                defaultValue={product?.categorySlug ?? ""}
                className={fieldCls}
              >
                <option value="" disabled>
                  선택
                </option>
                {categories.map((c) => (
                  <option key={c.slug} value={c.slug}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>정가 (참고용)</label>
              <input
                name="basePrice"
                type="number"
                defaultValue={product?.basePrice}
                className={fieldCls}
              />
            </div>
            <div>
              <label className={labelCls}>판매 상태</label>
              <select name="status" defaultValue={product?.status ?? "ACTIVE"} className={fieldCls}>
                <option value="ACTIVE">판매중</option>
                <option value="HIDDEN">숨김</option>
              </select>
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
        <Panel title="상품 이미지">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div className="shrink-0">
              {product?.image ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={product.image}
                  alt="현재 등록된 이미지"
                  className="h-24 w-24 rounded-xl border border-hairline object-cover"
                />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded-xl border border-dashed border-hairline text-[11px] text-muted">
                  없음
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <input
                name="imageFile"
                type="file"
                accept="image/jpeg,image/png,image/webp,image/avif"
                className="block w-full text-[13px] text-ink-soft file:mr-3 file:rounded-pill file:border file:border-hairline file:bg-white file:px-4 file:py-2 file:text-[13px] file:font-semibold file:text-ink-deep hover:file:border-ink-deep"
              />
              <p className={helpCls}>
                JPG · PNG · WebP · AVIF / 5MB 이하.{" "}
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
              className="rounded-pill border border-hairline px-3.5 py-1.5 text-[12px] font-semibold text-ink-soft transition-colors hover:border-ink-deep hover:text-ink-deep"
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
                    className="ml-auto text-[13px] text-muted transition-colors hover:text-brand-600 sm:ml-1"
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

      {state.error && <p className={errorCls}>{state.error}</p>}

      <div className="flex items-center gap-4 pt-1">
        <SaveButton />
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
