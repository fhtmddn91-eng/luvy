import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { readBizCert } from "@/lib/storage";

/**
 * 사업자등록증 열람 — 관리자 전용.
 * /api 는 폐쇄몰 미들웨어 매처에서 제외되므로 여기서 직접 세션·권한을 검사한다.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const user = await getSession();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { name } = await params;
  const file = await readBizCert(name);
  if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });

  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.contentType,
      // 심사 서류는 브라우저·프록시에 캐시하지 않는다
      "Cache-Control": "private, no-store",
      "Content-Disposition": `inline; filename="${name}"`,
    },
  });
}
