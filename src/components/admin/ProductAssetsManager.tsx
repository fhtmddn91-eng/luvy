"use client";

import { useEffect, useRef, useState, startTransition } from "react";
import { useActionState } from "react";
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

function UploadButton({ pending }: { pending: boolean }) {
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
  const [state, formAction, pending] = useActionState<AssetFormState, FormData>(bound, {});
  const fileRef = useRef<HTMLInputElement>(null);
  // 몇 장 골랐는지 즉시 보여준다 — "첨부가 됐는지" 확인용
  const [picked, setPicked] = useState(0);

  // form action={} 대신 직접 dispatch — React 19는 <form action> 제출이 끝나면
  // 폼을 자동 리셋해서, 한 장이라도 실패하면 고른 파일이 전부 사라진다.
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => formAction(fd));
  };

  // 성공했을 때만 선택을 비운다 (실패 시엔 남겨서 바로 재시도 가능)
  useEffect(() => {
    if (state.ok !== undefined && !state.error && fileRef.current) {
      fileRef.current.value = "";
      setPicked(0);
    }
  }, [state]);

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

      <form onSubmit={submit} className="mt-4 space-y-2 border-t border-hairline-soft pt-4">
        <label htmlFor="asset-files" className={labelCls}>
          상세 이미지 추가 (여러 장 선택 가능)
        </label>
        <input
          id="asset-files"
          ref={fileRef}
          type="file"
          name="files"
          multiple
          accept="image/*"
          onChange={(e) => setPicked(e.target.files?.length ?? 0)}
          className="block w-full text-[13px] text-ink-soft file:mr-3 file:border file:border-hairline file:bg-white file:px-4 file:py-2 file:text-[12px] file:font-bold file:text-ink-deep hover:file:border-ink-deep"
        />
        {picked > 0 && (
          <p className="text-[12px] font-bold text-ink-deep">{picked}장 선택됨 — 아래 버튼을 눌러야 업로드됩니다.</p>
        )}
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
        <UploadButton pending={pending} />
      </form>
    </div>
  );
}
