import Link from "next/link";
import { ProductThumb } from "./ProductThumb";
import { won } from "@/lib/format";
import { getMoq, resolveUnitPrice, type Tier } from "@/lib/pricing";

export interface ProductCardData {
  id: string;
  name: string;
  brand: string;
  image?: string;
  priceTiers: Tier[];
}

export function ProductCard({ product }: { product: ProductCardData }) {
  const moq = getMoq(product.priceTiers);
  const fromPrice = resolveUnitPrice(product.priceTiers, moq);
  return (
    <Link
      href={`/products/${product.id}`}
      className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-white transition-shadow hover:shadow-[var(--shadow-card)]"
    >
      <ProductThumb
        id={product.id}
        brand={product.brand}
        image={product.image}
        alt={product.name}
        className="aspect-square w-full"
      />
      <div className="flex flex-1 flex-col p-4">
        <span className="text-[12px] font-semibold text-brand-500">{product.brand}</span>
        <h3 className="mt-1 line-clamp-2 flex-1 text-[14px] font-medium text-ink group-hover:text-brand-600">
          {product.name}
        </h3>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-x-2 gap-y-1">
          <div>
            <span className="text-[11px] text-muted">도매가</span>
            <p className="whitespace-nowrap text-[15px] font-extrabold text-ink sm:text-[16px]">{won(fromPrice)}~</p>
          </div>
          <span className="whitespace-nowrap rounded-pill bg-brand-50 px-2 py-1 text-[11px] font-bold text-brand-600 sm:px-2.5">
            MOQ {moq}
          </span>
        </div>
      </div>
    </Link>
  );
}
