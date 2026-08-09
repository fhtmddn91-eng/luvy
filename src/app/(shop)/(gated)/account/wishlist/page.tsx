import Link from "next/link";
import { requireApprovedUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { won } from "@/lib/format";
import { getMoq, resolveUnitPrice } from "@/lib/pricing";
import { AccountShell } from "@/components/account/AccountShell";
import { Panel, EmptyState } from "@/components/ui/Panel";
import { ProductThumb } from "@/components/product/ProductThumb";
import { removeFromWishlist } from "@/lib/actions/wishlist";

export const dynamic = "force-dynamic";

export default async function WishlistPage() {
  const user = await requireApprovedUser();

  const rows = await db.wishlist.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: {
      productId: true,
      product: {
        select: {
          id: true,
          name: true,
          brand: true,
          image: true,
          status: true,
          basePrice: true,
          priceTiers: { select: { minQty: true, unitPrice: true } },
        },
      },
    },
  });
  // 숨김 처리된 상품은 목록에서 빼되 찜 자체는 남긴다(다시 판매하면 되살아난다)
  const items = rows.filter((r) => r.product.status === "ACTIVE");

  return (
    <AccountShell
      title="찜한 상품"
      description="관심 상품을 모아두고 발주할 때 한 번에 확인하세요."
      current="/account/wishlist"
    >
      <Panel title={`관심 상품 ${items.length}개`} flush>
        {items.length === 0 ? (
          <div className="px-5 py-5 sm:px-6">
            <EmptyState>
              아직 찜한 상품이 없습니다. 상품 페이지의 하트 버튼을 눌러 담아보세요.
            </EmptyState>
          </div>
        ) : (
          <ul className="divide-y divide-hairline">
            {items.map(({ product: p }) => {
              const moq = getMoq(p.priceTiers);
              return (
                <li key={p.id} className="flex items-center gap-4 px-5 py-4 sm:px-6">
                  <Link href={`/products/${p.id}`} className="shrink-0">
                    <ProductThumb
                      id={p.id}
                      brand={p.brand}
                      image={p.image}
                      alt={p.name}
                      compact
                      tone="neutral"
                      className="h-16 w-16"
                    />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-semibold text-muted">{p.brand}</p>
                    <Link
                      href={`/products/${p.id}`}
                      className="block truncate text-[14px] font-bold text-ink-deep hover:text-brand-600"
                    >
                      {p.name}
                    </Link>
                    <p className="mt-0.5 text-[12.5px] text-muted">
                      공급가 {won(resolveUnitPrice(p.priceTiers, moq))} · MOQ {moq}
                      {p.basePrice > 0 && ` · 권장 판매가 ${won(p.basePrice)}`}
                    </p>
                  </div>
                  <form action={removeFromWishlist} className="shrink-0">
                    <input type="hidden" name="productId" value={p.id} />
                    <button
                      type="submit"
                      className="border border-hairline px-3 py-1.5 text-[12.5px] font-semibold text-muted transition-colors hover:border-ink-deep hover:text-ink-deep"
                    >
                      찜 해제
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </AccountShell>
  );
}
