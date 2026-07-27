import type { Metadata } from "next";
import "./globals.css";

/** 카카오톡·슬랙 등 크롤러는 절대 URL을 요구하므로 metadataBase 로 기준을 잡는다. */
const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://luvyb2b.com";

const TITLE = "LUVY — 사업자 전용 B2B 도매몰";
const DESCRIPTION =
  "승인된 사업자 회원만 이용하는 폐쇄형 도매몰. 상세페이지·썸네일·GIF까지 판매에 필요한 자료를 전부 제공합니다.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s | LUVY" },
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: "LUVY",
    url: SITE_URL,
    title: TITLE,
    description: DESCRIPTION,
    /**
     * 공유 카드에 상품명·도매가가 들어가면 안 된다. 폐쇄몰의 핵심 자산인데
     * 링크 미리보기는 로그인 없이 아무나 보기 때문이다.
     * 그래서 실제 화면 캡처 대신 브랜드 카드를 따로 만들어 쓴다.
     * (원본 design/og-card.html — 재생성 방법은 DEPLOY.md 14번)
     */
    images: [
      { url: "/og.jpg", width: 1200, height: 630, alt: "LUVY — 사업자 전용 B2B 도매몰" },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og.jpg"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          as="style"
          crossOrigin="anonymous"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
