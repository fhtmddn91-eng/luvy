import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

const SESSION_COOKIE = "luvy_session";
const rawSecret = process.env.AUTH_SECRET;
if (!rawSecret && process.env.NODE_ENV === "production") {
  throw new Error("AUTH_SECRET environment variable is required in production");
}
const secret = new TextEncoder().encode(
  rawSecret ?? "dev-only-luvy-secret-change-in-prod-0123456789abcdef",
);

/**
 * 폐쇄몰(회원제): 로그인/회원가입을 제외한 모든 페이지는 세션이 있어야 접근 가능.
 * /api 는 matcher에서 제외 — 결제 웹훅은 공개여야 하고(/api/payments/webhook,
 * 서명 검증으로 보호), /api/payments/complete 는 핸들러 내부에서 세션을 검증한다.
 */
// 약관/개인정보처리방침은 가입 전에도 열람할 수 있어야 하므로 공개
const PUBLIC_PATHS = ["/login", "/signup", "/terms", "/privacy"];

async function hasValidSession(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, secret);
    return true;
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (isPublic) return NextResponse.next();

  if (await hasValidSession(req)) return NextResponse.next();

  const loginUrl = new URL("/login", req.url);
  const next = pathname + req.nextUrl.search;
  if (next !== "/") loginUrl.searchParams.set("next", next);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // 정적 자원(_next, 확장자 있는 파일)과 /api 를 제외한 모든 경로에 적용
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
