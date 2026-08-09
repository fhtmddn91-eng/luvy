"use client";

import { useEffect, useRef, useState, startTransition } from "react";
import { useActionState } from "react";
import {
  addProductAssets,
  deleteProductAsset,
  moveProductAsset,
  reorderProductAssets,
  translateProductAsset,
  updateAssetTranslation,
  revertAssetTranslation,
  type AssetFormState,
  type TranslateState,
} from "@/lib/actions/admin-assets";
import { errorCls, helpCls, labelCls, fieldCls } from "@/components/ui/form";
import { btnPrimary } from "@/components/ui/Panel";

export interface AssetRow {
  id: string;
  kind: string;
  url: string;
  bytes: number;
  /** 번역 전 원본 — 있으면 "번역된 이미지" */
  originalUrl?: string | null;
  /** OCR 문구 JSON — 문구 수정 편집기의 데이터 */
  ocrData?: string | null;
}

const kb = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`);

function UploadButton({ pending }: { pending: boolean }) {
  return (
    <button type="submit" disabled={pending} className={btnPrimary}>
      {pending ? "업로드 중…" : "선택한 파일 업로드"}
    </button>
  );
}

/** 번역된 이미지의 문구별 수정 편집기 — 저장하면 원본에서 다시 렌더된다 */
function TranslationEditor({ asset, onClose }: { asset: AssetRow; onClose: () => void }) {
  const bound = updateAssetTranslation.bind(null, asset.id);
  const [state, formAction, pending] = useActionState<TranslateState, FormData>(bound, {});

  let items: { zh: string; ko: string }[] = [];
  try {
    items = JSON.parse(asset.ocrData ?? "[]") as { zh: string; ko: string }[];
  } catch {
    items = [];
  }

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  return (
    <div className="mt-4 border border-ink-deep bg-white p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[13px] font-bold text-ink-deep">번역 문구 수정</p>
          <p className={helpCls}>
            고친 뒤 저장하면 원본 이미지에서 새로 만들어집니다. 문구를 비우면 그 항목은
            번역하지 않고 원문 그대로 둡니다.
          </p>
        </div>
        <button type="button" onClick={onClose} className="text-[12px] font-bold text-muted hover:text-ink-deep">
          닫기 ✕
        </button>
      </div>

      {/* 미리보기를 크게 — 작으면 고친 문구가 제대로 들어갔는지 확인이 안 된다 */}
      <div className="mt-3 grid gap-5 lg:grid-cols-[minmax(320px,42%)_1fr]">
        <a href={asset.url} target="_blank" rel="noreferrer" className="block self-start">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={asset.url}
            alt="번역된 이미지"
            className="w-full border border-hairline bg-canvas object-contain"
          />
          <span className="mt-1 block text-[11px] text-muted">클릭하면 원래 크기로 열립니다</span>
        </a>

        <form action={formAction} className="space-y-2">
          {items.map((it, i) => (
            <div key={i} className="grid gap-1 sm:grid-cols-2 sm:gap-2">
              <p className="truncate self-center text-[12px] text-muted" title={it.zh}>
                {it.zh}
              </p>
              <input name={`ko-${i}`} defaultValue={it.ko} className={`${fieldCls} h-10 text-[13px]`} />
            </div>
          ))}
          {state.error && <p className={errorCls}>{state.error}</p>}
          <button type="submit" disabled={pending} className={btnPrimary}>
            {pending ? "다시 만드는 중…" : "저장하고 다시 만들기"}
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * 상세페이지 이미지/GIF 관리.
 * 여기 올린 이미지는 상품 상세 하단에 순서대로 이어 붙어 렌더되고,
 * 회원의 '판매자료 다운로드' 목록에도 함께 나온다.
 * 이미지 속 중국어는 골라서 한국어로 번역할 수 있다 (원본 보존, 문구 수정 가능).
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

  // 번역 대상 선택 + 진행 상태
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [trErrors, setTrErrors] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);

  // 드래그 순서 변경 — 저장 전까지는 화면에서만 순서를 바꾼다
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);

  const view = order
    ? (order.map((id) => assets.find((a) => a.id === id)).filter(Boolean) as AssetRow[])
    : assets;

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = assets.length > 0 && selected.size === assets.length;
  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(assets.map((a) => a.id)));
  };

  const onDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = view.map((a) => a.id);
    const from = ids.indexOf(dragId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    ids.splice(to, 0, ids.splice(from, 1)[0]);
    setOrder(ids);
    setDragId(null);
  };

  const saveOrder = async () => {
    if (!order) return;
    setSavingOrder(true);
    setOrderError(null);
    try {
      const r = await reorderProductAssets(productId, order);
      if (r.error) setOrderError(r.error);
      else setOrder(null); // 서버 순서와 같아졌으니 화면 임시 순서를 버린다
    } catch {
      setOrderError("순서 저장에 실패했습니다. 다시 시도해주세요.");
    }
    setSavingOrder(false);
  };

  // 순차 실행 — 한 번에 몰아 보내면 OCR API 한도(분당 요청)에 걸린다
  const runTranslate = async () => {
    const ids = assets.filter((a) => selected.has(a.id)).map((a) => a.id);
    if (ids.length === 0) return;
    setTrErrors([]);
    setProgress({ done: 0, total: ids.length });
    const errs: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      const idx = assets.findIndex((a) => a.id === ids[i]);
      try {
        const r = await translateProductAsset(ids[i]);
        if (r.error) errs.push(`${idx + 1}번: ${r.error}`);
      } catch {
        errs.push(`${idx + 1}번: 요청 실패 (네트워크)`);
      }
      setProgress({ done: i + 1, total: ids.length });
    }
    setTrErrors(errs);
    setProgress(null);
    setSelected(new Set());
  };

  const editingAsset = assets.find((a) => a.id === editing && a.ocrData) ?? null;

  // 성공했을 때만 파일 선택을 비운다 (실패 시엔 남겨서 바로 재시도 가능)
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
        <>
          {/* 번역 도구줄 */}
          <div className="mb-3 flex flex-wrap items-center gap-3 border border-hairline bg-canvas px-4 py-3">
            <p className="w-full text-[12px] text-ink-soft">
              이미지를 체크한 뒤 번역을 누르면 이미지 속 중국어가 한국어로 바뀝니다. 원본은
              보존되어 언제든 복원할 수 있습니다. 타일을 끌어다 놓으면 순서를 바꿀 수 있습니다.
            </p>
            <label className="flex cursor-pointer items-center gap-2 text-[12px] font-bold text-ink-deep">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                disabled={progress !== null}
                className="size-4 accent-ink-deep"
              />
              전체 선택 ({assets.length}장)
            </label>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={runTranslate}
                disabled={selected.size === 0 || progress !== null}
                className={btnPrimary}
              >
                {progress
                  ? `번역 중… ${progress.done}/${progress.total}`
                  : `선택한 ${selected.size}장 한국어로 번역`}
              </button>
              {selected.size > 0 && !progress && (
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="text-[12px] font-bold text-muted hover:text-ink-deep"
                >
                  선택 해제
                </button>
              )}
            </div>
            {progress && (
              <p className="text-[12px] text-muted">
                장당 10~30초 걸립니다. 화면을 닫지 말고 기다려주세요.
              </p>
            )}
          </div>
          {trErrors.length > 0 && (
            <div className="mb-3 border border-brand-500 bg-brand-50 px-4 py-3 text-[12px] text-brand-700">
              {trErrors.map((e) => (
                <p key={e}>{e}</p>
              ))}
            </div>
          )}

          {order && (
            <div className="mb-3 flex flex-wrap items-center gap-3 border border-ink-deep bg-white px-4 py-3">
              <p className="text-[12px] font-bold text-ink-deep">
                순서를 바꿨습니다. 저장해야 상세페이지에 반영됩니다.
              </p>
              <button type="button" onClick={saveOrder} disabled={savingOrder} className={btnPrimary}>
                {savingOrder ? "저장 중…" : "순서 저장"}
              </button>
              <button
                type="button"
                onClick={() => { setOrder(null); setOrderError(null); }}
                className="text-[12px] font-bold text-muted hover:text-ink-deep"
              >
                되돌리기
              </button>
              {orderError && <p className={errorCls}>{orderError}</p>}
            </div>
          )}

          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {view.map((a, i) => (
              <li
                key={a.id}
                draggable={progress === null}
                onDragStart={() => setDragId(a.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => onDrop(a.id)}
                onDragEnd={() => setDragId(null)}
                className={`border bg-white p-1.5 ${dragId === a.id ? "opacity-40" : ""} ${
                  selected.has(a.id) ? "border-ink-deep" : "border-hairline"
                } ${progress === null ? "cursor-grab active:cursor-grabbing" : ""}`}
              >
                <label className="relative block cursor-pointer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={a.url}
                    alt={`상세 이미지 ${i + 1}`}
                    loading="lazy"
                    className="aspect-square w-full bg-canvas object-contain"
                  />
                  <input
                    type="checkbox"
                    checked={selected.has(a.id)}
                    onChange={() => toggle(a.id)}
                    disabled={progress !== null}
                    aria-label={`${i + 1}번 이미지 번역 대상으로 선택`}
                    className="absolute left-1 top-1 size-4 accent-ink-deep"
                  />
                  {a.originalUrl && (
                    <span className="absolute right-1 top-1 bg-ink-deep px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-white">
                      한글
                    </span>
                  )}
                </label>
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
                      <button type="submit" disabled={i === 0 || order !== null} aria-label="앞으로" className="px-1 text-muted hover:text-ink-deep disabled:opacity-25">◀</button>
                    </form>
                    <form action={moveProductAsset.bind(null, a.id, "down")}>
                      <button type="submit" disabled={i === view.length - 1 || order !== null} aria-label="뒤로" className="px-1 text-muted hover:text-ink-deep disabled:opacity-25">▶</button>
                    </form>
                  </span>
                  <form action={deleteProductAsset.bind(null, a.id)}>
                    <button type="submit" className="px-1 font-semibold text-muted hover:text-ink-deep">삭제</button>
                  </form>
                </div>
                {a.originalUrl && (
                  <div className="mt-1 flex items-center justify-between border-t border-hairline-soft pt-1 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setEditing(editing === a.id ? null : a.id)}
                      className="px-1 font-semibold text-ink-deep hover:underline"
                    >
                      문구 수정
                    </button>
                    <form
                      action={revertAssetTranslation.bind(null, a.id)}
                      onSubmit={() => startTransition(() => setEditing(null))}
                    >
                      <button type="submit" className="px-1 font-semibold text-muted hover:text-ink-deep">
                        원본 복원
                      </button>
                    </form>
                  </div>
                )}
              </li>
            ))}
          </ul>

          {editingAsset && (
            <TranslationEditor asset={editingAsset} onClose={() => setEditing(null)} />
          )}
        </>
      )}

      <form onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }} className="mt-4 space-y-2 border-t border-hairline-soft pt-4">
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
