/**
 * 파일 앞부분(매직 바이트)으로 실제 형식을 판별한다.
 *
 * 업로드 검증을 `file.type` 만으로 하면 브라우저가 보내주는 값을 그대로 믿는 것이다.
 * 공격자는 HTML/스크립트 파일을 `image/png` 라고 선언해 올릴 수 있다.
 * 확장자가 .png 면 브라우저가 실행하진 않지만(+ nosniff 헤더), 서버에 임의 파일이
 * 쌓이는 것 자체가 위험하므로 내용으로 한 번 더 확인한다.
 */

export type ImageKind = "jpg" | "png" | "webp" | "gif" | "avif" | "pdf";

const startsWith = (b: Uint8Array, sig: number[], at = 0): boolean =>
  sig.every((v, i) => b[at + i] === v);

/** 판별 불가면 null. 최소 12바이트를 넘겨야 webp/avif 까지 구분된다. */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
  if (bytes.length < 4) return null;

  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  // GIF87a / GIF89a
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return "gif";
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return "pdf"; // %PDF
  // RIFF....WEBP
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "webp";
  }
  // ....ftypavif / ftypavis
  if (startsWith(bytes, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = String.fromCharCode(...bytes.slice(8, 12));
    if (brand === "avif" || brand === "avis") return "avif";
  }
  return null;
}

/** 선언된 MIME 과 실제 내용이 같은 계열인지 */
export function matchesMime(kind: ImageKind | null, mime: string): boolean {
  if (!kind) return false;
  const expected: Record<string, ImageKind> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/avif": "avif",
    "application/pdf": "pdf",
  };
  return expected[mime] === kind;
}
