import Link from "next/link";
import { getLogoUrl } from "@/lib/settings";

/**
 * 로고.
 *
 * 관리자가 설정에서 이미지를 올렸으면 그 이미지를, 없으면 기본 LUVY 워드마크를 쓴다.
 * ("로고를 바꾸려면?" 의 답이 배포가 아니라 관리자 화면이 되도록)
 *
 * href={null} 이면 링크 없이 로고만 표시한다 (비로그인 인증 페이지에서 사용:
 * 폐쇄몰이라 "/" 로 보내면 다시 로그인으로 튕겨 루프가 된다).
 */
export async function Logo({ href = "/" }: { href?: string | null }) {
  const custom = await getLogoUrl();

  const inner = custom ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={custom} alt="LUVY" className="h-9 w-auto max-w-[190px] object-contain" />
  ) : (
    <>
      <span className="relative inline-flex h-9 w-9 items-center justify-center">
        <svg viewBox="0 0 36 36" className="h-9 w-9" aria-hidden>
          <defs>
            <linearGradient id="luvyL" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#f4aec6" />
              <stop offset="55%" stopColor="#e7568a" />
              <stop offset="100%" stopColor="#d63f77" />
            </linearGradient>
          </defs>
          <path
            d="M9 5c0 8.5 0 14 0 18.5C9 27 11.2 29 15 29h11"
            fill="none"
            stroke="url(#luvyL)"
            strokeWidth="5.5"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span className="text-[26px] font-extrabold tracking-[0.14em] text-ink">LUVY</span>
    </>
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
