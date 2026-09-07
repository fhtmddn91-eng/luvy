import { ProductCard, type ProductCardData } from "./ProductCard";

export function ProductGrid({
  products,
  discountBp,
}: {
  products: ProductCardData[];
  discountBp: number;
}) {
  if (products.length === 0) {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-2xl border border-dashed border-line text-[14px] text-muted">
        표시할 상품이 없습니다.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} discountBp={discountBp} />
      ))}
    </div>
  );
}
