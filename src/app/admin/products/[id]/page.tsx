import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { ProductForm } from "@/components/admin/ProductForm";
import { updateProduct } from "@/lib/actions/admin-products";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const product = await db.product.findUnique({ where: { id }, include: { priceTiers: true } });
  if (!product) notFound();

  const boundAction = updateProduct.bind(null, id);

  return (
    <div>
      <h1 className="mb-6 text-[22px] font-extrabold text-ink">상품 수정</h1>
      <ProductForm
        action={boundAction}
        product={{
          id: product.id,
          name: product.name,
          brand: product.brand,
          categorySlug: product.categorySlug,
          description: product.description,
          basePrice: product.basePrice,
          status: product.status,
          image: product.image || undefined,
          priceTiers: product.priceTiers.map((t) => ({ minQty: t.minQty, unitPrice: t.unitPrice })),
        }}
      />
    </div>
  );
}
