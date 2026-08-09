import path from "node:path";
import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { buildZip, type ZipEntry } from "@/lib/zip";

/**
 * 판매자료 일괄 다운로드 (ZIP).
 *
 * 상세페이지 이미지를 한 장씩 저장하는 건 거래처 입장에서 20번 클릭이라,
 * 대표/상세를 통째로 받을 수 있게 한다.
 *
 * /api 는 미들웨어 밖이므로 여기서 직접 승인 회원 세션을 검사한다 —
 * 도매 판매자료는 폐쇄몰의 핵심 자산이고, 링크만 알면 받을 수 있으면
 * 게이트를 우회하는 셈이 된다.
 */

/** 화면의 묶음 버튼과 1:1 로 대응한다. GIF·옵션은 상세자료에 함께 담는다. */
const GROUPS: Record<string, { kinds: string[]; label: string }> = {
  MAIN: { kinds: ["MAIN"], label: "대표이미지" },
  DETAIL: { kinds: ["DETAIL", "GIF", "OPTION"], label: "상세페이지" },
  ALL: { kinds: ["MAIN", "DETAIL", "GIF", "OPTION"], label: "전체" },
};

const PREFIX: Record<string, string> = {
  MAIN: "대표",
  DETAIL: "상세",
  GIF: "GIF",
  OPTION: "옵션",
};

/** 파일명에 쓰면 곤란한 문자를 걷어낸다. */
function slug(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 40) || "product";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getSession();
  if (!user || user.status !== "APPROVED") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const group = GROUPS[(req.nextUrl.searchParams.get("kind") ?? "ALL").toUpperCase()];
  if (!group) return NextResponse.json({ error: "bad kind" }, { status: 400 });

  const product = await db.product.findUnique({
    where: { id },
    select: {
      name: true,
      status: true,
      assets: {
        where: { kind: { in: group.kinds } },
        orderBy: { sortOrder: "asc" },
        select: { kind: true, url: true },
      },
    },
  });
  if (!product || product.status !== "ACTIVE") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  if (product.assets.length === 0) {
    return NextResponse.json({ error: "empty" }, { status: 404 });
  }

  // 업로드는 DB(StoredFile)에 있다. 장당 질의하면 20번 왕복이라 한 번에 읽는다.
  const names = product.assets.map((a) => path.basename(a.url));
  const files = await db.storedFile.findMany({
    where: { name: { in: names }, access: "public" },
    select: { name: true, data: true },
  });
  const byName = new Map(files.map((f) => [f.name, f.data]));

  const counters: Record<string, number> = {};
  const entries: ZipEntry[] = [];
  for (const asset of product.assets) {
    const data = byName.get(path.basename(asset.url));
    if (!data) continue; // 파일이 지워진 자산은 건너뛴다 — 나머지는 받을 수 있어야 한다
    const prefix = PREFIX[asset.kind] ?? "이미지";
    counters[prefix] = (counters[prefix] ?? 0) + 1;
    const ext = path.extname(asset.url) || ".jpg";
    entries.push({
      name: `${prefix}-${String(counters[prefix]).padStart(2, "0")}${ext}`,
      data,
    });
  }
  if (entries.length === 0) {
    return NextResponse.json({ error: "empty" }, { status: 404 });
  }

  const zip = buildZip(entries);
  const filename = `${slug(product.name)}-${group.label}.zip`;
  return new NextResponse(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      // 한글 파일명을 지원하지 않는 브라우저를 위해 ASCII 이름을 함께 보낸다
      "Content-Disposition":
        `attachment; filename="luvy-assets.zip"; ` +
        `filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Content-Length": String(zip.length),
      "Cache-Control": "private, no-store",
    },
  });
}
