import { requireAdmin } from "@/lib/auth";
import { ProductForm } from "@/components/admin/ProductForm";
import { getAllCategories } from "@/lib/categories";
import { createProduct } from "@/lib/actions/admin-products";
import { PageHeader } from "@/components/ui/Panel";

export default async function NewProductPage() {
  await requireAdmin();
  return (
    <div>
      <PageHeader eyebrow="Catalog" title="상품 등록" description="새 상품을 추가합니다." />
      {/* "상세페이지는 어디서 올리나요"라는 문의가 실제로 들어왔다 — 구조를 미리 알려준다 */}
      <p className="mb-4 max-w-[760px] border border-hairline bg-canvas px-4 py-3 text-[13px] leading-relaxed text-ink-soft">
        여기서는 <strong className="text-ink-deep">목록 썸네일</strong> 한 장까지 넣고
        저장하세요 (첫 대표이미지로도 함께 등록됩니다).{" "}
        <strong className="text-ink-deep">나머지 대표이미지</strong>와{" "}
        <strong className="text-ink-deep">상세페이지 이미지·GIF</strong>는 저장 직후 열리는
        상품 수정 화면 하단의 <strong className="text-ink-deep">상품 이미지</strong> 패널에서
        자리를 골라 올릴 수 있습니다.
      </p>
      <ProductForm action={createProduct} categories={await getAllCategories()} />
    </div>
  );
}
