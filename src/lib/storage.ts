import "server-only";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

/**
 * 업로드 저장 드라이버. dev/데모는 public/uploads 로컬 저장.
 * 배포 환경에서 영구 보관이 필요하면 이 모듈만 S3 등으로 교체한다.
 * (Railway 기본 파일시스템은 재배포 시 초기화됨 — DEPLOY.md 참고)
 */

const UPLOAD_DIR = path.join(process.cwd(), "public", "uploads");
const MAX_BYTES = 5 * 1024 * 1024; // 5MB

const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

export type UploadResult = { ok: true; url: string } | { ok: false; error: string };

/** 이미지 파일을 저장하고 공개 URL 경로(/uploads/..)를 반환. */
export async function saveImageUpload(file: File): Promise<UploadResult> {
  const ext = EXT_BY_MIME[file.type];
  if (!ext) return { ok: false, error: "JPG/PNG/WebP/AVIF 이미지만 업로드할 수 있습니다." };
  if (file.size <= 0) return { ok: false, error: "빈 파일입니다." };
  if (file.size > MAX_BYTES) return { ok: false, error: "이미지는 5MB 이하만 가능합니다." };

  const name = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}.${ext}`;
  await mkdir(UPLOAD_DIR, { recursive: true });
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(UPLOAD_DIR, name), buffer);
  return { ok: true, url: `/uploads/${name}` };
}

/** 저장된 업로드 삭제(교체 시 이전 파일 정리). /uploads/ 경로만 허용. */
export async function deleteImageUpload(url: string): Promise<void> {
  if (!url.startsWith("/uploads/")) return;
  const name = path.basename(url); // 경로 탈출 방지
  try {
    await unlink(path.join(UPLOAD_DIR, name));
  } catch {
    // 이미 없으면 무시
  }
}

/* ── 사업자등록증 (비공개 저장) ─────────────────────────────────────
 * 민감 서류이므로 public/ 이 아닌 비공개 디렉터리에 저장하고,
 * 관리자 전용 API 라우트를 통해서만 읽는다.
 */

const BIZCERT_DIR = path.join(process.cwd(), "private-uploads", "bizcert");
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

  const name = `${Date.now()}-${crypto.randomBytes(8).toString("hex")}.${ext}`;
  await mkdir(BIZCERT_DIR, { recursive: true });
  await writeFile(path.join(BIZCERT_DIR, name), Buffer.from(await file.arrayBuffer()));
  return { ok: true, name };
}

/** 관리자 열람용 읽기. 파일명만 받아 경로 탈출을 차단한다. */
export async function readBizCert(
  name: string,
): Promise<{ data: Buffer; contentType: string } | null> {
  const safe = path.basename(name);
  if (safe !== name || !safe) return null;
  const ext = safe.split(".").pop() ?? "";
  const contentType =
    { jpg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" }[ext];
  if (!contentType) return null;
  try {
    const { readFile } = await import("node:fs/promises");
    const data = await readFile(path.join(BIZCERT_DIR, safe));
    return { data, contentType };
  } catch {
    return null;
  }
}
