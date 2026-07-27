import { requireUser } from "@/lib/auth";
import { PartnerInquiry } from "@/components/support/PartnerInquiry";

export default async function PartnerApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string }>;
}) {
  await requireUser();
  const { submitted } = await searchParams;

  return (
    <PartnerInquiry
      eyebrow="PARTNER APPLY"
      title="입점 문의"
      intro="브랜드사·제조사·수입사의 입점을 환영합니다. 상품 소개와 함께 문의를 남겨주시면 MD가 검토 후 연락드립니다."
      points={[
        "회사(브랜드) 소개와 주력 상품군",
        "취급 상품 수와 대표 상품 3~5개",
        "희망 공급가 조건(협의 가능 여부)",
        "인증·허가 보유 현황 (KC 등)",
      ]}
      type="PARTNER_APPLY"
      back="/partner/apply"
      submitted={Boolean(submitted)}
      titlePlaceholder="예) OO브랜드 러브젤 3종 입점 문의"
      contentPlaceholder="브랜드 소개, 상품 구성, 공급 조건 등을 자유롭게 적어주세요."
    />
  );
}
