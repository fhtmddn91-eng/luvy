"use client";

import { useRef } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  addProductAssets,
  deleteProductAsset,
  moveProductAsset,
  type AssetFormState,
} from "@/lib/actions/admin-assets";
import { errorCls, helpCls, labelCls } from "@/components/ui/form";
import { btnPrimary } from "@/components/ui/Panel";

export interface AssetRow {
  id: string;
  kind: string;
  url: string;
  bytes: number;
}

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`);

function UploadButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={btnPrimary}>
      {pending ? "업로드 중…" : "선택한 파일 업로드"}
    </button>
  );
}

/**
 * 상세페이지 이미지/GIF 관리.
 * 여기 올린 이미지는 상품 상세 하단에 순서대로 이어 붙어 렌더되고,
 * 회원의 '판매자료 다운로드' 목록에도 함께 나온다.
 */
export function ProductAssetsManager({
  productId,
  assets,
}: {
  productId: string;
  assets: AssetRow[];
}) {
  const bound = addProductAssets.bind(null, productId);
  const [state, formAction] = useActionState<AssetFormState, FormData>(bound, {});
  const fileRef = useRef<HTMLInputElement>(null);

  return (
    <div>
      {assets.length === 0 ? (
        <p className="text-[13px] text-muted">
          아직 상세 이미지가 없습니다. 아래에서 올리면 상품 상세 하단에 순서대로 표시됩니다.
        </p>
      ) : (
        <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {assets.map((a, i) => (
            <li key={a.id} className="border border-hairline bg-white p-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={a.url}
                alt={`상세 이미지 ${i + 1}`}
                loading="lazy"
                className="aspect-square w-full bg-canvas object-contain"
              />
              <div className="mt-1 flex items-center justify-between text-[10px] text-muted">
                <span className="font-bold">
                  {i + 1}
                  {a.kind === "GIF" && <span className="ml-1 bg-ink-deep px-1 py-px font-extrabold text-white">GIF</span>}
                </span>
                <span>{kb(a.bytes)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-[11px]">
                <span className="flex gap-1">
                  <form action={moveProductAsset.bind(null, a.id, "up")}>
                    <button type="submit" disabled={i === 0} aria-label="앞으로" className="px-1 text-muted hover:text-ink-deep disabled:opacity-25">◀</button>
                  </form>
                  <form action={moveProductAsset.bind(null, a.id, "down")}>
                    <button type="submit" disabled={i === assets.length - 1} aria-label="뒤로" className="px-1 text-muted hover:text-ink-deep disabled:opacity-25">▶</button>
                  </form>
                </span>
                <form action={deleteProductAsset.bind(null, a.id)}>
                  <button type="submit" className="px-1 font-semibold text-muted hover:text-ink-deep">삭제</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form action={formAction} className="mt-4 space-y-2 border-t border-hairline-soft pt-4">
        <label htmlFor="asset-files" className={labelCls}>
          상세 이미지 추가 (여러 장 선택 가능)
        </label>
        <input
          id="asset-files"
          ref={fileRef}
          type="file"
          name="files"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="block w-full text-[13px] text-ink-soft file:mr-3 file:border file:border-hairline file:bg-white file:px-4 file:py-2 file:text-[12px] file:font-bold file:text-ink-deep hover:file:border-ink-deep"
        />
        <p className={helpCls}>
          JPG·PNG·WebP·GIF, 장당 5MB 이하. 위에서부터 순서대로 상세페이지에 이어 붙습니다.
          움직이는 GIF 는 그대로 움직입니다.
        </p>
        {state.error && <p className={errorCls}>{state.error}</p>}
        {state.ok !== undefined && !state.error && (
          <p className="border border-hairline bg-canvas px-4 py-3 text-[13px] font-semibold text-ink-deep">
            {state.ok}장 업로드되었습니다.
          </p>
        )}
        <UploadButton />
      </form>
    </div>
  );
}
