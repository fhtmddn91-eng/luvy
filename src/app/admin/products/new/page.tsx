import { ProductForm } from "@/components/admin/ProductForm";
import { createProduct } from "@/lib/actions/admin-products";

export default function NewProductPage() {
  return (
    <div>
      <h1 className="mb-6 text-[22px] font-extrabold text-ink">상품 등록</h1>
      <ProductForm action={createProduct} />
    </div>
  );
}
