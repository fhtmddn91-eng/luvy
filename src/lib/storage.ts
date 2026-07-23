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
