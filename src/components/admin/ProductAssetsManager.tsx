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
  setAssetTarget,
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

/** 타일에 붙는 자리 표시 — 대표만 강조한다 (상세가 대부분이라) */
const KIND_LABEL: Record<string, string> = {
  MAIN: "대표",
  DETAIL: "상세",
  GIF: "GIF",
  OPTION: "옵션",
};

interface BoxItem {
  zh: string;
  ko: string;
  mode?: "translate" | "keep" | "erase";
  dx?: number;
  dy?: number;
  scale?: number;
  weight?: string;
}

/** 위치 보정 한 칸 = 이미지 폭·높이의 0.5% */
const NUDGE = 5;

const WEIGHTS = [
  { v: "", label: "자동" },
  { v: "Regular", label: "보통" },
  { v: "SemiBold", label: "중간" },
  { v: "Bold", label: "굵게" },
  { v: "ExtraBold", label: "아주 굵게" },
];

/**
 * 문구 한 줄의 편집 컨트롤 — 처리방식·위치·크기·굵기.
 *
 * 번역문 input 은 defaultValue, 처리방식·위치·크기는 useState 초기값 — **둘 다
 * 마운트될 때 한 번만** item 을 읽는다. 그래서 이 컴포넌트가 재사용되면 왼쪽
 * 원문(zh)만 새 값으로 바뀌고 오른쪽 입력은 앞 이미지 값이 남는다. 운영에서
 * "원문과 수정 문구가 다르게 보이는데 새로고침하면 맞다"로 신고된 증상이 이것이고,
 * 그 상태로 저장하면 엉뚱한 문구가 실제로 들어간다.
 * 고치는 방법은 값을 밀어넣는 게 아니라 **key 로 새로 마운트시키는 것**이다
 * (호출부의 key 두 곳 참고).
 */
function BoxRow({ item, index }: { item: BoxItem; index: number }) {
  const [mode, setMode] = useState<string>(item.mode ?? "translate");
  const [dx, setDx] = useState<number>(item.dx ?? 0);
  const [dy, setDy] = useState<number>(item.dy ?? 0);
  const [scale, setScale] = useState<number>(item.scale ?? 1);
  const editable = mode === "translate";

  return (
    <div className="border-b border-hairline-soft pb-2">
      <div className="grid gap-1 sm:grid-cols-[1fr_1.4fr] sm:gap-2">
        <p className="truncate self-center text-[12px] text-muted" title={item.zh}>
          {item.zh}
        </p>
        <input
          name={`ko-${index}`}
          defaultValue={item.ko}
          disabled={!editable}
          className={`${fieldCls} h-10 text-[13px] disabled:bg-canvas disabled:text-muted`}
        />
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px]">
        <select
          name={`mode-${index}`}
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          className="border border-hairline bg-white px-2 py-1 font-bold text-ink-deep"
        >
          <option value="translate">한국어로 번역</option>
          <option value="keep">원문 그대로</option>
          <option value="erase">글자 지우기</option>
        </select>

        {editable && (
          <>
            <span className="flex items-center gap-1 text-muted">
              위치
              <button type="button" onClick={() => setDx(dx - NUDGE)} className="border border-hairline px-1.5 py-0.5 hover:border-ink-deep">←</button>
              <button type="button" onClick={() => setDx(dx + NUDGE)} className="border border-hairline px-1.5 py-0.5 hover:border-ink-deep">→</button>
              <button type="button" onClick={() => setDy(dy - NUDGE)} className="border border-hairline px-1.5 py-0.5 hover:border-ink-deep">↑</button>
              <button type="button" onClick={() => setDy(dy + NUDGE)} className="border border-hairline px-1.5 py-0.5 hover:border-ink-deep">↓</button>
              {(dx !== 0 || dy !== 0) && (
                <button type="button" onClick={() => { setDx(0); setDy(0); }} className="ml-0.5 font-bold text-ink-deep hover:underline">
                  초기화
                </button>
              )}
            </span>

            <label className="flex items-center gap-1 text-muted">
              크기
              <input
                type="range"
                min={0.5}
                max={2.5}
                step={0.1}
                value={scale}
                onChange={(e) => setScale(Number(e.target.value))}
                className="w-24 accent-ink-deep"
              />
              <span className="w-8 font-bold text-ink-deep">{scale.toFixed(1)}x</span>
            </label>

            <label className="flex items-center gap-1 text-muted">
              굵기
              <select
                name={`weight-${index}`}
                defaultValue={item.weight ?? ""}
                className="border border-hairline bg-white px-2 py-1 text-ink-deep"
              >
                {WEIGHTS.map((w) => (
                  <option key={w.v} value={w.v}>{w.label}</option>
                ))}
              </select>
            </label>
          </>
        )}
      </div>

      <input type="hidden" name={`dx-${index}`} value={dx} />
      <input type="hidden" name={`dy-${index}`} value={dy} />
      <input type="hidden" name={`scale-${index}`} value={scale} />
      {!editable && <input type="hidden" name={`weight-${index}`} value="" />}
    </div>
  );
}

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

  let items: BoxItem[] = [];
  try {
    items = JSON.parse(asset.ocrData ?? "[]") as BoxItem[];
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
            고친 뒤 저장하면 원본 이미지에서 새로 만들어집니다. 항목마다 <b>원문 그대로</b> 두거나
            <b> 글자 지우기</b>를 고를 수 있고, 위치·크기·굵기도 조절됩니다.
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

        <form action={formAction} className="space-y-3">
          {/* key 에 파일명을 섞는다 — 번역본은 저장할 때마다 새 파일로 바뀌므로,
              편집기를 띄운 채 이 이미지가 다시 렌더되면(일괄 번역 등) 행이 새로
              마운트돼 바뀐 문구를 읽는다. 순번만 쓰면 옛 값이 그대로 남는다. */}
          {items.map((it, i) => (
            <BoxRow key={`${asset.url}#${i}`} item={it} index={i} />
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
 * 상품 이미지 관리 — 대표이미지와 상세페이지 이미지/GIF.
 *
 * 대표이미지(MAIN)는 상품 상세 상단 갤러리와 목록 썸네일에, 상세페이지 이미지
 * (DETAIL·GIF)는 상세 하단에 순서대로 이어 붙는다. 둘 다 회원의 '판매자료 다운로드'
 * 목록에 종류별로 나뉘어 나오므로, 자리를 잘못 잡으면 대표이미지 묶음이 비어 버린다.
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
  // 대표이미지가 아직 없으면 대표부터 올리는 게 맞다
  const [target, setTarget] = useState<"MAIN" | "DETAIL">(
    assets.some((a) => a.kind === "MAIN") ? "DETAIL" : "MAIN",
  );

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
          아직 등록된 이미지가 없습니다. 아래에서 <b>대표이미지</b>(상세 상단 갤러리·목록
          썸네일)와 <b>상세페이지 이미지</b>를 각각 올릴 수 있습니다.
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
                  <span className="flex items-center gap-1 font-bold">
                    {i + 1}
                    <span
                      className={`px-1 py-px font-extrabold ${
                        a.kind === "MAIN"
                          ? "bg-brand-500 text-white"
                          : "border border-hairline text-muted"
                      }`}
                    >
                      {KIND_LABEL[a.kind] ?? a.kind}
                    </span>
                  </span>
                  <span>{kb(a.bytes)}</span>
                </div>
                {/* 대표 ↔ 상세 자리 바꾸기 — 잘못 올렸을 때 다시 올리지 않아도 되게 */}
                <form action={setAssetTarget.bind(null, a.id, a.kind === "MAIN" ? "DETAIL" : "MAIN")}>
                  <button
                    type="submit"
                    className="mt-1 w-full border border-hairline py-0.5 text-[10px] font-bold text-ink-deep hover:border-ink-deep"
                  >
                    {a.kind === "MAIN" ? "상세로 내리기" : "대표로 올리기"}
                  </button>
                </form>
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
            // key=자산 id — 없으면 편집기를 띄운 채 다른 이미지의 '문구 수정'을
            // 눌렀을 때 React 가 같은 인스턴스를 재사용해, 왼쪽 원문만 새 이미지
            // 것으로 바뀌고 번역문·처리방식은 앞 이미지 것이 그대로 남았다.
            // (아래 BoxRow 주석 참고 — 폼이 전부 비제어 입력이라 벌어지는 일)
            <TranslationEditor
              key={editingAsset.id}
              asset={editingAsset}
              onClose={() => setEditing(null)}
            />
          )}
        </>
      )}

      <form onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        startTransition(() => formAction(fd));
      }} className="mt-4 space-y-2 border-t border-hairline-soft pt-4">
        <span className={labelCls}>어느 자리에 올릴까요?</span>
        <div className="flex flex-wrap gap-2">
          {([
            { v: "MAIN", label: "대표이미지", help: "상세 상단 갤러리 · 목록 썸네일" },
            { v: "DETAIL", label: "상세페이지 이미지", help: "상세 하단에 이어 붙는 긴 이미지" },
          ] as const).map((t) => (
            <label
              key={t.v}
              className={`flex-1 cursor-pointer border px-3 py-2 ${
                target === t.v ? "border-ink-deep bg-canvas" : "border-hairline bg-white"
              }`}
            >
              <input
                type="radio"
                name="target"
                value={t.v}
                checked={target === t.v}
                onChange={() => setTarget(t.v)}
                className="mr-1.5 accent-ink-deep"
              />
              <span className="text-[13px] font-bold text-ink-deep">{t.label}</span>
              <span className="mt-0.5 block text-[11px] text-muted">{t.help}</span>
            </label>
          ))}
        </div>

        <label htmlFor="asset-files" className={labelCls}>
          {target === "MAIN" ? "대표이미지" : "상세 이미지"} 추가 (여러 장 선택 가능)
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
          JPG·PNG·WebP·GIF, 장당 5MB 이하. 대표이미지는 상세 상단 갤러리에, 상세페이지
          이미지는 그 아래에 순서대로 이어 붙습니다. 움직이는 GIF 는 그대로 움직입니다.
          잘못 올렸으면 타일의 <b>대표로 올리기 / 상세로 내리기</b>로 바꿀 수 있습니다.
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
