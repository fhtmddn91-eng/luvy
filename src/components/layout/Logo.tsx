import Link from "next/link";
import { getLogoUrl } from "@/lib/settings";

/**
 * 로고.
 *
 * 기본은 저장소에 커밋된 공식 로고(public/brand/logo.png)이고,
 * 관리자가 설정에서 이미지를 올리면 그것이 우선한다.
 * (기본값이 코드에 있으므로 DB가 비어도, 되돌리기를 눌러도 항상 공식 로고가 나온다)
 *
 * href={null} 이면 링크 없이 로고만 표시한다 (비로그인 인증 페이지에서 사용:
 * 폐쇄몰이라 "/" 로 보내면 다시 로그인으로 튕겨 루프가 된다).
 */
export async function Logo({ href = "/" }: { href?: string | null }) {
  const custom = await getLogoUrl();

  const src = custom || "/brand/logo.png";

  const inner = (
    // 워드마크가 가로로 길어서(≈6.5:1) 모바일에서 210px를 차지하면
    // 우측 아이콘들이 아랫줄로 밀려 헤더 전체가 어그러진다 → 폰에서는 축소
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt="LUVY"
      className="h-6 w-auto max-w-[150px] object-contain sm:h-8 sm:max-w-[210px] lg:h-9"
    />
  );

  if (href === null) {
    return <span className="flex select-none items-center gap-2">{inner}</span>;
  }

  return (
    <Link href={href} className="flex select-none items-center gap-2" aria-label="LUVY 홈">
      {inner}
    </Link>
  );
}
