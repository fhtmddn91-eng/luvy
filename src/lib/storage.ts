import "server-only";
import path from "node:path";
import crypto from "node:crypto";
import { db } from "@/lib/db";
import { sniffImage, matchesMime } from "@/lib/imageSniff";

/**
 * 업로드 저장 드라이버 — **DB(StoredFile) 저장**.
 *
 * 파일시스템에 저장하지 않는 이유 (실서버에서 셋 다 실제로 겪었다):
 *  1. Railway 컨테이너 디스크는 재배포마다 초기화된다 → 파일 유실
 *  2. next start 는 빌드 이후 생긴 public/ 파일을 서빙하지 않는다 → 저장돼도 404
 *  3. 백업이 DB 하나로 끝난다
 *
 * URL 형태는 그대로 /uploads/{name} — 서빙만 정적 파일이 아니라
 * app/uploads/[name]/route.ts 가 DB에서 읽어 응답한다.
 */

const MAX_BYTES = 5 * 1024 * 1024; // 5MB

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};

export type UploadResult = { ok: true; url: string } | { ok: false; error: string };

const newName = (ext: string) =>
  `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;

async function insertPublic(name: string, mime: string, data: Buffer): Promise<void> {
  await db.storedFile.create({
    data: { name, mime, access: "public", bytes: data.byteLength, data: new Uint8Array(data) },
  });
}

/** 이미지 파일을 저장하고 공개 URL 경로(/uploads/..)를 반환. */
export async function saveImageUpload(file: File): Promise<UploadResult> {
  const ext = EXT_BY_MIME[file.type];
  if (!ext) return { ok: false, error: "JPG/PNG/WebP/AVIF/GIF 이미지만 업로드할 수 있습니다." };
  if (file.size <= 0) return { ok: false, error: "빈 파일입니다." };
  if (file.size > MAX_BYTES) return { ok: false, error: "이미지는 5MB 이하만 가능합니다." };

  const buffer = Buffer.from(await file.arrayBuffer());
  // 내용으로 한 번 더 확인 — file.type 은 브라우저가 보내는 값이라 위조 가능하다
  if (!matchesMime(sniffImage(buffer), file.type)) {
    return { ok: false, error: "이미지 파일이 아니거나 형식이 확장자와 다릅니다." };
  }

  const name = newName(ext);
  await insertPublic(name, file.type, buffer);
  return { ok: true, url: `/uploads/${name}` };
}

/**
 * 원격에서 받아온 바이트를 저장(외부 소스 미러링용).
 * File 객체가 없는 경로라 MIME을 직접 넘긴다.
 */
export async function saveImageBuffer(
  data: Buffer,
  mime: string,
  maxBytes = MAX_BYTES,
): Promise<UploadResult> {
  const ext = EXT_BY_MIME[mime];
  if (!ext) return { ok: false, error: `지원하지 않는 이미지 형식입니다 (${mime}).` };
  if (data.byteLength <= 0) return { ok: false, error: "빈 파일입니다." };
  if (data.byteLength > maxBytes) {
    return { ok: false, error: `이미지가 너무 큽니다 (${Math.round(data.byteLength / 1024)}KB).` };
  }

  if (!matchesMime(sniffImage(data), mime)) {
    return { ok: false, error: "내려받은 파일이 이미지가 아닙니다." };
  }

  const name = newName(ext);
  await insertPublic(name, mime, data);
  return { ok: true, url: `/uploads/${name}` };
}

/** 저장된 업로드 삭제(교체 시 이전 파일 정리). /uploads/ 경로만 허용. */
export async function deleteImageUpload(url: string): Promise<void> {
  if (!url.startsWith("/uploads/")) return;
  const name = path.basename(url); // 경로 탈출 방지
  await db.storedFile.deleteMany({ where: { name, access: "public" } });
  // 디스크 시절 파일이 남아 있으면 같이 정리 (로컬 개발 환경)
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(path.join(process.cwd(), "public", "uploads", name));
  } catch {
    // 없으면 무시
  }
}

/** 공개 파일 읽기 — /uploads/[name] 라우트 전용 */
export async function readPublicUpload(
  name: string,
): Promise<{ data: Buffer; contentType: string } | null> {
  const safe = path.basename(name);
  if (safe !== name || !safe) return null;

  const row = await db.storedFile.findUnique({ where: { name: safe } });
  if (row && row.access === "public") {
    return { data: Buffer.from(row.data), contentType: row.mime };
  }

  // 디스크 시절 업로드(로컬 개발) 폴백 — DB에 없을 때만
  const ext = safe.split(".").pop() ?? "";
  const mime = Object.entries(EXT_BY_MIME).find(([, e]) => e === ext)?.[0];
  if (!mime) return null;
  try {
    const { readFile } = await import("node:fs/promises");
    const data = await readFile(path.join(process.cwd(), "public", "uploads", safe));
    return { data, contentType: mime };
  } catch {
    return null;
  }
}

/* ── 사업자등록증 (비공개 저장) ─────────────────────────────────────
 * 민감 서류이므로 access="bizcert" 로 저장하고, 공개 라우트에서는
 * 절대 조회되지 않는다. 관리자 전용 API 라우트만 읽는다.
 */

const BIZCERT_MAX_BYTES = 10 * 1024 * 1024; // 10MB

const BIZCERT_EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

export type BizCertResult = { ok: true; name: string } | { ok: false; error: string };

/** 사업자등록증 저장. 저장 파일명만 반환(DB에 파일명 저장, URL 아님). */
export async function saveBizCertUpload(file: File): Promise<BizCertResult> {
  const ext = BIZCERT_EXT_BY_MIME[file.type];
  if (!ext) return { ok: false, error: "사업자등록증은 JPG/PNG/WebP 이미지 또는 PDF만 가능합니다." };
  if (file.size <= 0) return { ok: false, error: "빈 파일입니다." };
  if (file.size > BIZCERT_MAX_BYTES) return { ok: false, error: "사업자등록증은 10MB 이하만 가능합니다." };

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!matchesMime(sniffImage(buffer), file.type)) {
    return { ok: false, error: "이미지 또는 PDF 파일이 아닙니다. 원본 파일로 다시 첨부해주세요." };
  }

  const name = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
  await db.storedFile.create({
    data: {
      name,
      mime: file.type,
      access: "bizcert",
      bytes: buffer.byteLength,
      data: new Uint8Array(buffer),
    },
  });
  return { ok: true, name };
}

/** 관리자 열람용 읽기. 파일명만 받아 경로 탈출을 차단한다. */
export async function readBizCert(
  name: string,
): Promise<{ data: Buffer; contentType: string } | null> {
  const safe = path.basename(name);
  if (safe !== name || !safe) return null;

  const row = await db.storedFile.findUnique({ where: { name: safe } });
  if (row && row.access === "bizcert") {
    return { data: Buffer.from(row.data), contentType: row.mime };
  }

  // 디스크 시절 저장분 폴백 (로컬 개발)
  const ext = safe.split(".").pop() ?? "";
  const contentType =
    { jpg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" }[ext];
  if (!contentType) return null;
  try {
    const { readFile } = await import("node:fs/promises");
    const data = await readFile(
      path.join(process.cwd(), "private-uploads", "bizcert", safe),
    );
    return { data, contentType };
  } catch {
    return null;
  }
}

/**
 * 다른 곳에서 아직 쓰는 파일이면 지우지 않는다.
 *
 * 썸네일(Product.image)은 첫 대표이미지와 **같은 파일을 가리킨다**.
 * 그래서 썸네일을 새로 올릴 때 옛 파일을 그냥 지우면 그 파일을 쓰던
 * 상세 이미지까지 깨진다(실사례: 상품 2개의 상세 이미지가 빈 칸이 됐다).
 */
export async function deleteUploadIfUnused(
  url: string,
  opts: { exceptAssetId?: string } = {},
): Promise<void> {
  if (!url.startsWith("/uploads/")) return;
  const stillUsed = await db.productAsset.count({
    where: {
      OR: [{ url }, { originalUrl: url }],
      ...(opts.exceptAssetId ? { NOT: { id: opts.exceptAssetId } } : {}),
    },
  });
  if (stillUsed > 0) return;
  await deleteImageUpload(url);
}
