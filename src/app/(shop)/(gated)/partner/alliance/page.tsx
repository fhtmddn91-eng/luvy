import { requireUser } from "@/lib/auth";
import { PartnerInquiry } from "@/components/support/PartnerInquiry";

export default async function PartnerAlliancePage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string }>;
}) {
  await requireUser();
  const { submitted } = await searchParams;

  return (
    <PartnerInquiry
      eyebrow="ALLIANCE"
      title="제휴 제안"
      intro="마케팅, 콘텐츠, 유통망, 물류 등 LUVY와 함께 성장할 제휴 제안을 기다립니다."
      points={[
        "제안 주체(회사/채널) 소개",
        "제휴 형태 (마케팅/유통/물류/콘텐츠 등)",
        "기대 효과와 협력 범위",
        "참고 자료 링크 (회사 소개서, 채널 URL 등)",
      ]}
      type="ALLIANCE"
      back="/partner/alliance"
      submitted={Boolean(submitted)}
      titlePlaceholder="예) 성인 커머스 유튜브 채널 공동 프로모션 제안"
      contentPlaceholder="제안 내용과 기대 효과, 연락 가능한 채널을 적어주세요."
    />
  );
}
