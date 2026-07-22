import type { Metadata } from "next";
import "./globals.css";
import { UtilBar } from "@/components/layout/UtilBar";
import { Header } from "@/components/layout/Header";
import { CategoryBar } from "@/components/layout/CategoryBar";
import { Footer } from "@/components/layout/Footer";

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
      </head>
      <body>
        <UtilBar />
        <Header />
        <CategoryBar />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
