import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { ProductForm } from "@/components/admin/ProductForm";
import { updateProduct } from "@/lib/actions/admin-products";
import { PageHeader } from "@/components/ui/Panel";

export default async function EditProductPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  const product = await db.product.findUnique({ where: { id }, include: { priceTiers: true } });
  if (!product) notFound();

  const boundAction = updateProduct.bind(null, id);

  return (
    <div>
      <PageHeader eyebrow="Catalog" title="상품 수정" description={product.name} />
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
          trackStock: product.trackStock,
          stock: product.stock,
          image: product.image || undefined,
          priceTiers: product.priceTiers.map((t) => ({ minQty: t.minQty, unitPrice: t.unitPrice })),
        }}
      />
    </div>
  );
}
