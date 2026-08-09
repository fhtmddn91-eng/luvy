import { requireApprovedUser } from "@/lib/auth";
import { RecentlyViewedRail } from "@/components/product/RecentlyViewedRail";

/**
 * 승인 회원 전용 구역.
 *
 * 폐쇄몰의 핵심 자산은 도매 단가표다. 가입만 하면 볼 수 있으면
 * 아무나 가짜 사업자번호로 가입해 전 상품 도매가를 긁어갈 수 있으므로,
 * **승인(APPROVED) 전에는 카탈로그 자체를 열지 않는다.**
 *
 * 이 그룹에 파일을 넣는 것만으로 게이트가 걸린다(라우트마다 검사를 넣다가
 * 한 곳을 빠뜨리는 사고를 구조적으로 막기 위함). 승인 없이 열려야 하는
 * 페이지 — 승인 안내 · 고객센터 · 약관 · 개인정보처리방침 — 는
 * 이 그룹 바깥, (shop) 직속에 둔다.
 */
export default async function GatedLayout({ children }: { children: React.ReactNode }) {
  await requireApprovedUser();
  return (
    <>
      {children}
      {/* 최근 본 상품 레일 — 승인 회원 구역 전체에서 따라다닌다 */}
      <RecentlyViewedRail />
    </>
  );
}
