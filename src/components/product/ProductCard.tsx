import Link from "next/link";
import { ProductThumb } from "./ProductThumb";
import { won } from "@/lib/format";
import { getMoq, hasPrice, resolveUnitPrice, memberUnitPrice, type Tier } from "@/lib/pricing";
import { isSoldOut } from "@/lib/stock";
import { discountLabel } from "@/lib/discount";

export interface ProductCardData {
  id: string;
  name: string;
  brand: string;
  image?: string;
  trackStock?: boolean;
  stock?: number;
  /** 권장 소비자가. 0이면 아직 안 정한 것이라 표시하지 않는다 */
  basePrice?: number;
  priceTiers: Tier[];
}

/**
 * `discountBp` 에 기본값을 두지 않는다 — 새 목록 화면이 빠뜨리면 그 화면만
 * 조용히 정가로 보이고, 주문서(할인가)와 금액이 갈린다. 필수 prop 이면 타입이 잡는다.
 */
export function ProductCard({ product, discountBp }: { product: ProductCardData; discountBp: number }) {
  const moq = getMoq(product.priceTiers);
  const listPrice = resolveUnitPrice(product.priceTiers, moq);
  const fromPrice = memberUnitPrice(product.priceTiers, moq, discountBp);
  const discounted = fromPrice < listPrice;
  const soldOut = isSoldOut({
    trackStock: product.trackStock ?? false,
    stock: product.stock ?? 0,
  });
  return (
    <Link
      href={`/products/${product.id}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-white transition-shadow hover:shadow-[var(--shadow-card)]"
    >
      <div className="relative">
        <ProductThumb
          id={product.id}
          brand={product.brand}
          image={product.image}
          alt={product.name}
          className={`aspect-square w-full ${soldOut ? "opacity-45" : ""}`}
        />
        {soldOut && (
          <span className="absolute left-2.5 top-2.5 bg-ink/85 px-2.5 py-1 text-[11px] font-extrabold text-white">
            품절
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <span className="text-[12px] font-semibold text-brand-500">{product.brand}</span>
        <h3 className="mt-1 line-clamp-2 flex-1 text-[14px] font-medium text-ink group-hover:text-brand-600">
          {product.name}
        </h3>
        {/* 권장 판매가 — 거래처가 마진을 바로 가늠할 수 있게 공급가 위에 둔다 */}
        {(product.basePrice ?? 0) > 0 && (
          <p className="mt-2 whitespace-nowrap text-[11.5px] text-muted">
            권장 판매가 <span className="font-semibold">{won(product.basePrice ?? 0)}</span>
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap items-end justify-between gap-x-2 gap-y-1">
          <div>
            <span className="text-[11px] text-muted">공급가</span>
            <p className="whitespace-nowrap text-[15px] font-extrabold text-ink sm:text-[16px]">
              {hasPrice(product.priceTiers) ? `${won(fromPrice)}~` : (
                <span className="text-[13px] font-bold text-muted">가격 준비중</span>
              )}
            </p>
            {/* 정가 취소선 — 할인을 받고 있다는 사실이 목록에서부터 보여야 한다 */}
            {discounted && hasPrice(product.priceTiers) && (
              <p className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-[11.5px]">
                <span className="text-muted line-through">{won(listPrice)}</span>
                <span className="font-bold text-brand-600">{discountLabel(discountBp)}</span>
              </p>
            )}
          </div>
          <span className="whitespace-nowrap rounded-pill bg-brand-50 px-2 py-1 text-[11px] font-bold text-brand-600 sm:px-2.5">
            MOQ {moq}
          </span>
        </div>
      </div>
    </Link>
  );
}
