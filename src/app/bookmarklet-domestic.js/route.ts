import { NextResponse } from "next/server";
import { buildDomesticBookmarkletSource } from "@/lib/import/bookmarkletDomestic";

/**
 * 국내 도매처 수집 북마클릿의 실제 추출 코드.
 *
 * 북마크바의 버튼은 이 파일을 매번 새로 불러 실행하는 로더라서
 * (domesticBookmarkletHref 참고), 셀렉터를 고치면 배포만으로 모든 운영자의
 * 북마크가 최신이 된다. 국내 몰은 로그인 벽 때문에 셀렉터를 미리 검증하지
 * 못했으므로, 이 "고치면 바로 반영" 성질이 특히 중요하다.
 *
 * 인증을 걸지 않는 이유는 1688 쪽(/bookmarklet.js)과 같다 —
 * 도매처 페이지에서 <script> 로 불러가는 크로스 사이트 요청이라 LUVY 세션
 * 쿠키가 실리지 않는다(SameSite=Lax). 내용도 공개 추출 로직뿐이며, 수집
 * "실행"은 여전히 관리자 세션이 있어야만 가능하다.
 */
export function GET() {
  return new NextResponse(buildDomesticBookmarkletSource(), {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      // 북마크가 항상 최신 코드를 받도록 캐시 금지
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
