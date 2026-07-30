"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { runImport } from "@/lib/import/pipeline";
import type { ImportPayload } from "@/lib/import/types";

export interface ImportFormState {
  ok?: boolean;
  message?: string;
  productId?: string;
  summary?: string[];
}

/**
 * 북마클릿이 복사해준 JSON을 붙여넣어 상품을 수집한다.
 * 같은 오리진 폼 액션이므로 관리자 세션이 정상 적용된다.
 */
export async function importFrom1688(
  _prev: ImportFormState,
  formData: FormData,
): Promise<ImportFormState> {
  await requireAdmin();

  const pasted = String(formData.get("payload") ?? "").trim();
  if (!pasted) return { ok: false, message: "붙여넣을 데이터가 없습니다." };

  let payload: ImportPayload;
  if (pasted.startsWith("{")) {
    try {
      payload = JSON.parse(pasted) as ImportPayload;
    } catch {
      return {
        ok: false,
        message: "JSON을 해석할 수 없습니다. 북마클릿이 복사한 내용을 그대로 붙여넣어 주세요.",
      };
    }
  } else if (pasted.startsWith("http")) {
    // URL만 붙여넣은 경우 — HTML은 봇 차단으로 못 읽으므로 안내
    return {
      ok: false,
      message:
        "URL만으로는 수집할 수 없습니다. 1688은 서버 접근을 차단하므로, 해당 상품 페이지에서 북마클릿을 실행해 복사한 데이터를 붙여넣어 주세요.",
    };
  } else {
    // 페이지 HTML을 그대로 붙여넣은 경우 (이미지만 회수하는 폴백)
    payload = { html: pasted, url: String(formData.get("url") ?? "") };
  }

  const result = await runImport(payload);

  await audit({
    action: "PRODUCT_IMPORT",
    target: "product",
    targetId: result.productId ?? "",
    summary: result.ok
      ? `1688 수집 성공 — ${result.detail?.koTitle ?? "제목 없음"}`
      : `1688 수집 실패 — ${result.message}`,
    meta: result.ok
      ? {
          images: (result.detail?.mainCount ?? 0) + (result.detail?.detailCount ?? 0),
          gif: result.detail?.gifCount ?? 0,
          translated: result.detail?.translated ?? false,
        }
      : undefined,
  });

  revalidatePath("/admin/import");
  revalidatePath("/admin/products");

  if (!result.ok) {
    return { ok: false, message: result.message, productId: result.productId };
  }

  const d = result.detail;
  const summary = d
    ? [
        `상품명: ${d.koTitle}`,
        d.translated ? "AI 번역·카테고리 자동 분류 적용" : `번역 미적용 (${d.translateNote ?? "사유 불명"}) — 직접 수정 필요`,
        `대표 이미지 ${d.mainCount}장 · 상세 이미지 ${d.detailCount}장${d.gifCount > 0 ? ` (GIF ${d.gifCount}장 포함)` : ""}`,
        d.failures.length > 0
          ? `내려받기 실패 ${d.failures.length}건: ${d.failures[0].reason}`
          : "이미지 전량 내려받기 성공",
        "가격은 0원으로 등록됐습니다. 도매가를 입력한 뒤 판매 전환하세요.",
      ]
    : undefined;

  return { ok: true, message: result.message, productId: result.productId, summary };
}
