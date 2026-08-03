import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * 보안 헤더.
 *
 * CSP 에서 'unsafe-inline' 을 빼면 Next 의 인라인 부트스트랩이 막혀 앱이 깨진다.
 * 그래서 스크립트 차단보다 실효가 큰 항목에 집중한다 — 폼 전송 대상 고정(로그인 폼
 * 하이재킹 차단), 프레임 삽입 차단(클릭재킹), 출처 제한.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.portone.io",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "font-src 'self' https://cdn.jsdelivr.net data:",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://api.portone.io",
  // 결제창이 iframe 으로 열리므로 포트원만 허용
  "frame-src 'self' https://cdn.portone.io https://*.portone.io",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  // 선언한 Content-Type 을 브라우저가 추측하지 않게 (업로드 파일 XSS 방지)
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: __dirname,
  // 서버 종류를 알려주는 헤더 제거
  poweredByHeader: false,
  experimental: {
    serverActions: {
      /**
       * 서버 액션 본문 한도. 기본 1MB 라서 상품·배너 이미지 업로드가
       * 전송 단계에서 500 으로 잘렸다 (앱 정책은 이미지 5MB·GIF 20MB·
       * 등록증 10MB — 검증은 storage.ts 가 한다. 여기는 통로만 연다).
       */
      bodySizeLimit: "25mb",
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        // 업로드 파일은 어떤 경우에도 인라인 실행되지 않도록 한 겹 더
        source: "/uploads/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Content-Security-Policy", value: "default-src 'none'; img-src 'self'; sandbox" },
        ],
      },
    ];
  },
};

export default nextConfig;
