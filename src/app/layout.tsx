import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LUVY — 성인 라이프스타일 B2B 플랫폼",
  description:
    "신뢰할 수 있는 제품과 파트너십으로 성인 라이프스타일 비즈니스의 성공을 함께합니다. LUVY B2B 도매 플랫폼.",
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
        {/* 숫자·영문 라벨용 세리프. 로드 실패해도 Pretendard로 폴백되어 깨지지 않는다. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
