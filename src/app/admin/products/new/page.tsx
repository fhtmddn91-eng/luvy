import { requireAdmin } from "@/lib/auth";
import { ProductForm } from "@/components/admin/ProductForm";
import { createProduct } from "@/lib/actions/admin-products";
import { PageHeader } from "@/components/ui/Panel";

export default async function NewProductPage() {
  await requireAdmin();
  return (
    <div>
      <PageHeader eyebrow="Catalog" title="상품 등록" description="새 상품을 추가합니다." />
      <ProductForm action={createProduct} />
    </div>
  );
}
