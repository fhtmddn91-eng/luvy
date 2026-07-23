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

const PROTECTED = ["/category", "/search", "/products", "/cart", "/checkout", "/orders", "/admin"];

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
  const isProtected = PROTECTED.some((p) => pathname === p || pathname.startsWith(p + "/"));
  if (!isProtected) return NextResponse.next();

  if (await hasValidSession(req)) return NextResponse.next();

  const loginUrl = new URL("/login", req.url);
  loginUrl.searchParams.set("next", pathname + req.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/category/:path*",
    "/search/:path*",
    "/products/:path*",
    "/cart/:path*",
    "/checkout/:path*",
    "/orders/:path*",
    "/admin/:path*",
  ],
};
