import { NextResponse } from "next/server";
import { BOOKMARKLET_SOURCE } from "@/lib/import/bookmarklet";

/**
 * 1688 수집 북마클릿의 실제 추출 코드.
 *
 * 북마크바의 버튼은 이 파일을 매번 새로 불러 실행하는 로더라서
 * (bookmarkletHref 참고), 추출 로직을 고치면 배포만으로 모든 운영자의
 * 북마크가 최신이 된다.
 *
 * 인증을 걸지 않는 이유: 1688 페이지에서 <script> 로 불러가는데, 크로스
 * 사이트 요청이라 LUVY 세션 쿠키가 실리지 않는다(SameSite=Lax). 내용도
 * 페이지에서 상품 정보를 추출하는 공개 로직뿐이라 비밀이 아니다 — 수집
 * "실행"은 여전히 관리자 세션이 있어야만 가능하다.
 * (경로에 점(.)이 있어 미들웨어 세션 검사가 원래 적용되지 않는 영역이다)
 */
export function GET() {
  return new NextResponse(BOOKMARKLET_SOURCE, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      // 북마크가 항상 최신 코드를 받도록 캐시 금지
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
