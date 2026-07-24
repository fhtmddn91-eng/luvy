import { requireUser } from "@/lib/auth";
import { PartnerInquiry } from "@/components/support/PartnerInquiry";

export default async function PartnerBulkPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string }>;
}) {
  await requireUser();
  const { submitted } = await searchParams;

  return (
    <PartnerInquiry
      eyebrow="BULK ORDER"
      title="대량구매 상담"
      intro="표기된 도매가보다 더 좋은 조건이 필요한 대량 발주·정기 납품은 별도 견적으로 진행합니다. 수량과 일정만 알려주시면 견적서를 보내드립니다."
      points={[
        "필요한 상품명과 수량 (예: 울트라 씬 콘돔 12P × 500개)",
        "1회성 발주인지, 정기 납품인지",
        "희망 납기 일정과 배송지(권역)",
        "세금계산서·정산 관련 요청 사항",
      ]}
      type="BULK"
      back="/partner/bulk"
      submitted={Boolean(submitted)}
      titlePlaceholder="예) 워터 젤 100ml 500개 견적 요청"
      contentPlaceholder="상품·수량·납기·배송지를 적어주시면 빠르게 견적을 드릴 수 있습니다."
    />
  );
}
