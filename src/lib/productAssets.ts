/**
 * 상품 이미지(자산)의 종류·썸네일 규칙.
 *
 * 서버 액션에서 떼어낸 순수 규칙 — DB 없이 시험할 수 있어야 해서 따로 둔다.
 */

/** 관리자가 이미지를 올릴 때 고르는 자리 */
export type AssetTarget = "MAIN" | "DETAIL";

/**
 * 올린 파일의 kind.
 *
 * 상세 자리의 GIF 만 kind=GIF 로 따로 표시하고, 대표 자리에 올린 GIF 는 MAIN 을 유지한다.
 * 대표 갤러리·썸네일은 kind=MAIN 으로만 잡히기 때문 (수집 파이프라인과 같은 규칙).
 */
export function assetKindFor(
  target: AssetTarget,
  file: { mime?: string; url?: string },
): string {
  if (target === "MAIN") return "MAIN";
  const gif = file.mime === "image/gif" || (file.url ?? "").toLowerCase().endsWith(".gif");
  return gif ? "GIF" : "DETAIL";
}

export interface ThumbAsset {
  url: string;
  kind: string;
}

/**
 * 썸네일(Product.image)을 무엇으로 바꿀지 정한다. null 이면 그대로 둔다.
 *
 * - 대표이미지가 있으면 항상 첫 대표이미지를 따라간다. 번역·순서변경으로 파일이
 *   바뀌어도 썸네일이 저절로 맞춰진다.
 * - 대표이미지가 없는 상품(직접 등록)은 관리자가 상품 폼에서 올린 썸네일을
 *   **덮어쓰지 않는다**. 예전에는 상세 이미지를 올릴 때마다 썸네일이 그 이미지로
 *   바뀌어, 상품 폼에서 다시 올려 저장해야 원하는 썸네일이 남았다.
 * - 다만 지금 썸네일인 파일이 사라지는 중이면(replacing) 남은 이미지로 다시 잡아준다.
 *   깨진 썸네일을 남기지 않기 위한 장치다.
 *
 * @param assets sortOrder 오름차순으로 정렬된 상품의 전체 자산
 * @param replacing 이번 작업으로 없어지는 파일 URL (삭제·번역본 교체 등)
 */
export function nextThumbnail(
  current: string | null,
  assets: ThumbAsset[],
  replacing?: string,
): string | null {
  const main = assets.find((a) => a.kind === "MAIN")?.url;
  if (main) return main === current ? null : main;
  if (current && current !== replacing) return null;
  const next = assets[0]?.url ?? "";
  return next === current ? null : next;
}
