import { NextResponse, type NextRequest } from "next/server";
import { readPublicUpload } from "@/lib/storage";

/**
 * 업로드 이미지 서빙 — DB(StoredFile)에서 읽는다.
 *
 * public/uploads 정적 서빙을 쓰지 않는 이유: next start 는 빌드 이후
 * 생긴 public/ 파일을 서빙하지 않아, 운영 중 올린 이미지가 404 가 된다.
 * URL 은 기존과 동일한 /uploads/{name} 이라 DB에 저장된 경로가 그대로 동작한다.
 *
 * 인증을 걸지 않는다 — 상품 썸네일·배너·로고는 로그인 전 화면(로그인·가입)에도
 * 나온다. 비공개 서류(사업자등록증)는 access 가 달라 여기서 조회되지 않는다.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const file = await readPublicUpload(name);
  if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.contentType,
      // 파일명이 업로드마다 새로 발급되므로 영구 캐시해도 안전하다
      "Cache-Control": "public, max-age=31536000, immutable",
      // next.config 의 /uploads/:path* 헤더와 같은 방어 — 라우트 응답에도 명시
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; sandbox",
    },
  });
}
