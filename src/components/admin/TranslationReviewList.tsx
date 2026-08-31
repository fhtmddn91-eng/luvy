"use client";

import { useEffect, useMemo, useRef, useState, startTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  approveAssetCandidate,
  approveAssetCandidates,
  rejectAssetCandidate,
  startAssetRerender,
  uploadAssetCandidate,
  startAssetRegenerateWithHint,
  type TranslateState,
} from "@/lib/actions/admin-assets";
import { reviewReasonsSummary, hasSafetyRefusal, TRANSLATE_STATUS } from "@/lib/productPublishGate";
import { btnPrimary } from "@/components/ui/Panel";

export interface ReviewItem {
  id: string;
  kind: string;
  url: string;
  originalUrl: string | null;
  candidateUrl: string | null;
  translateStatus: string | null;
  reviewReasons: string | null;
  /** 문구 기록 유무 — 없으면 '지시 넣어 다시 만들기'가 안 된다 */
  hasBoxes: boolean;
  productId: string;
  productName: string;
}

/**
 * 번역 검수함 목록 (초보 운영자 기준, 2026-08-30 피드백 반영).
 *
 * 원칙:
 *  - 큰 비교: 원본 ↔ 번역본을 크게 나란히, 클릭하면 새 탭에서 원본 크기
 *  - 말은 전부 한국어 (reviewReasonsSummary)
 *  - 기본 버튼은 둘뿐: "이대로 내보내기" / "다시 만들기" — 나머지는 접어둔다
 *  - 여러 장 체크 → 한 번에 내보내기
 */
export function TranslationReviewList({ items }: { items: ReviewItem[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [batchMsg, setBatchMsg] = useState<string | null>(null);

  // 승인 가능한 장(후보가 있는 장)만 체크 대상이다
  const approvable = useMemo(
    () => items.filter((i) => i.candidateUrl && !done[i.id]),
    [items, done],
  );

  const run = (id: string, label: string, fn: () => Promise<TranslateState>) =>
    startTransition(async () => {
      setBusy(id);
      try {
        const r = await fn();
        if (r.error) setFailed((m) => ({ ...m, [id]: r.error! }));
        else {
          setFailed(({ [id]: _drop, ...rest }) => rest);
          setDone((m) => ({ ...m, [id]: r.notice ?? label }));
          // 서버가 기록한 새 상태·사유·후보를 다시 그린다 — 이게 없으면 결과가
          // 새로고침 전까지 안 보여 "눌러도 아무 일 없다"로 읽힌다 (2026-08-31 실측)
          router.refresh();
        }
      } catch {
        // 실측(2026-08-31): 연결만 끊기고 서버는 계속 일하는 경우가 대부분이다.
        // "다시 시도"를 권하면 이중 과금으로 이어진다 — 기다리라고 말해야 한다.
        setFailed((m) => ({
          ...m,
          [id]: "연결이 잠시 끊겼습니다 — 작업은 계속 진행 중일 수 있습니다. 다시 누르지 말고 잠시 후 자동 갱신을 기다려주세요.",
        }));
      } finally {
        setBusy(null);
      }
    });

  /** 시작형 액션(백그라운드 재생성) — 카드를 접지 않고 새로고침해 '진행 중' 카드로 바꾼다 */
  const runStart = (id: string, fn: () => Promise<TranslateState>) =>
    startTransition(async () => {
      setBusy(id);
      try {
        const r = await fn();
        if (r.error) setFailed((m) => ({ ...m, [id]: r.error! }));
        else {
          setFailed(({ [id]: _drop, ...rest }) => rest);
          router.refresh();
        }
      } catch {
        setFailed((m) => ({
          ...m,
          [id]: "연결이 잠시 끊겼습니다 — 작업은 계속 진행 중일 수 있습니다. 다시 누르지 말고 잠시 후 자동 갱신을 기다려주세요.",
        }));
      } finally {
        setBusy(null);
      }
    });

  // 진행 중(TRANSLATING) 카드가 있으면 8초마다 다시 그린다 — 재생성은 백그라운드로
  // 돌기 때문에, 폴링이 없으면 끝나도 화면이 모른다
  const hasWorking = items.some((i) => i.translateStatus === TRANSLATE_STATUS.TRANSLATING);
  useEffect(() => {
    if (!hasWorking) return;
    const t = setInterval(() => router.refresh(), 8000);
    return () => clearInterval(t);
  }, [hasWorking, router]);

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const approveChecked = () =>
    startTransition(async () => {
      const ids = [...checked];
      if (ids.length === 0) return;
      setBusy("__batch__");
      setBatchMsg(null);
      try {
        const r = await approveAssetCandidates(ids);
        setDone((m) => ({ ...m, ...Object.fromEntries(ids.map((id) => [id, "내보냈습니다"])) }));
        setChecked(new Set());
        setBatchMsg(`${r.approved}장을 내보냈습니다.${r.skipped ? ` (${r.skipped}장은 건너뜀)` : ""}`);
        router.refresh();
      } catch {
        setBatchMsg("일부가 처리되지 않았습니다 — 새로고침 후 남은 장을 확인해주세요.");
      } finally {
        setBusy(null);
      }
    });

  return (
    <div>
      {/* 상단 일괄 처리 줄 */}
      <div className="mb-4 flex flex-wrap items-center gap-3 border border-hairline bg-canvas px-4 py-3">
        <p className="text-[13px] text-ink-soft">
          아래에서 <b>왼쪽(원본)</b>과 <b>오른쪽(번역본)</b>을 비교하세요. 이미지를 클릭하면
          크게 볼 수 있습니다. 괜찮으면 <b>이대로 내보내기</b> — 그 전까지 손님에게는
          절대 나가지 않습니다.
        </p>
        {approvable.length > 1 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() =>
                setChecked((prev) =>
                  prev.size === approvable.length ? new Set() : new Set(approvable.map((i) => i.id)),
                )
              }
              className="border border-hairline px-3 py-1.5 text-[12px] font-bold text-ink-deep"
            >
              {checked.size === approvable.length ? "전체 해제" : `전체 선택 (${approvable.length}장)`}
            </button>
            <button
              type="button"
              disabled={checked.size === 0 || busy !== null}
              onClick={approveChecked}
              className={btnPrimary}
            >
              {busy === "__batch__" ? "내보내는 중…" : `선택한 ${checked.size}장 이대로 내보내기`}
            </button>
          </div>
        )}
        {batchMsg && <p className="w-full text-[12px] font-semibold text-ink-deep">{batchMsg}</p>}
      </div>

      <ul className="space-y-5">
        {items.map((item) => (
          <ReviewCard
            key={item.id}
            item={item}
            busy={busy}
            doneMsg={done[item.id]}
            failMsg={failed[item.id]}
            checked={checked.has(item.id)}
            onToggle={() => toggle(item.id)}
            run={run}
            runStart={runStart}
          />
        ))}
      </ul>
    </div>
  );
}

function ReviewCard({
  item,
  busy,
  doneMsg,
  failMsg,
  checked,
  onToggle,
  run,
  runStart,
}: {
  item: ReviewItem;
  busy: string | null;
  doneMsg?: string;
  failMsg?: string;
  checked: boolean;
  onToggle: () => void;
  run: (id: string, label: string, fn: () => Promise<TranslateState>) => void;
  runStart: (id: string, fn: () => Promise<TranslateState>) => void;
}) {
  const hintRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const disabled = busy !== null;

  const originalSrc = item.originalUrl ?? item.url;
  // 지금 손님에게 나가는 그림이 이미 승인된 번역본인가 — 이 경우 후보를 버려도
  // 원본이 아니라 그 승인본이 유지된다 (rejectAssetCandidate 와 같은 판별식)
  const liveIsApproved = !!item.originalUrl && item.url !== item.originalUrl;
  // 번역본이 이미 손님에게 나가 있으면 그것, 아니면 검수 대기 후보
  const resultSrc = item.candidateUrl ?? (liveIsApproved ? item.url : null);
  const reasons = reviewReasonsSummary(item.reviewReasons);
  const retryable = item.translateStatus === TRANSLATE_STATUS.RETRYABLE;
  /** 이 카드가 지금 처리 중인가 — 30초~1분 걸리는 작업이라 표시가 없으면 고장으로 읽힌다 */
  const working = busy === item.id;
  /**
   * 안전필터 거부 — 재생성해도 또 거부될 가능성이 높다(성인용품 특성상 구조적).
   * 유료 버튼을 앞세우면 ₩100 씩 헛돈을 쓰게 유도하므로, 무료 직접 업로드를
   * 첫 번째 선택지로 올린다 (2026-08-31 운영 실측: 거부 4건 전부 이 패턴).
   */
  const refused = hasSafetyRefusal(item.reviewReasons);

  /** 직접 업로드 블록 — 거부 카드에선 본문에, 그 외엔 "다른 방법"에 들어간다 */
  const uploadBlock = (
    <div>
      <label className="mb-1 block font-bold text-ink-deep" htmlFor={`rv-file-${item.id}`}>
        직접 고친 이미지 올리기 (무료)
      </label>
      <input
        id={`rv-file-${item.id}`}
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="w-full"
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          const f = fileRef.current?.files?.[0];
          if (!f) return;
          const fd = new FormData();
          fd.set("file", f);
          run(item.id, "올렸습니다 — 위에서 확인하고 내보내주세요", () =>
            uploadAssetCandidate(item.id, {}, fd),
          );
        }}
        className="mt-1 border border-ink-deep px-3 py-1.5 font-bold text-ink-deep disabled:opacity-40"
      >
        올리기
      </button>
    </div>
  );

  // 백그라운드 재생성 진행 중 — 버튼 없이 상태만. 폴링이 끝나면 결과 카드로 바뀐다
  if (item.translateStatus === TRANSLATE_STATUS.TRANSLATING) {
    return (
      <li className="border border-hairline bg-white p-4">
        <p className="text-[13px] font-bold text-ink-deep">
          {item.productName}
          <span className="ml-2 text-[11px] font-semibold text-muted">
            {item.kind === "MAIN" ? "대표 이미지" : "상세 이미지"}
          </span>
        </p>
        <p className="mt-2 border-l-2 border-ink-deep bg-canvas px-3 py-2 text-[13px] font-bold text-ink-deep">
          AI가 다시 만드는 중입니다… 보통 1~2분 걸립니다. 이 화면은 자동으로 갱신됩니다.
        </p>
      </li>
    );
  }

  if (doneMsg) {
    return (
      <li className="border border-hairline bg-white px-4 py-3 text-[13px] text-ink-soft">
        <b className="text-ink-deep">{item.productName}</b> — {doneMsg}
      </li>
    );
  }

  return (
    <li className="border border-hairline bg-white p-4">
      {/* 어느 상품의 몇 번째 이미지인지 + 상품으로 가는 길 */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] font-bold text-ink-deep">
          {item.productName}
          <span className="ml-2 text-[11px] font-semibold text-muted">
            {item.kind === "MAIN" ? "대표 이미지" : "상세 이미지"}
          </span>
        </p>
        <Link
          href={`/admin/products/${item.productId}`}
          className="text-[12px] font-semibold text-muted hover:text-ink-deep hover:underline"
        >
          상품 페이지에서 보기 →
        </Link>
      </div>

      {working && (
        <p className="mb-3 border-l-2 border-ink-deep bg-canvas px-3 py-2 text-[13px] font-bold text-ink-deep">
          처리 중입니다… 30초~1분 걸립니다. 이 화면을 닫지 말고 기다려주세요.
        </p>
      )}
      {reasons && (
        <p className="mb-3 border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-[13px] leading-relaxed text-amber-900">
          {reasons}
        </p>
      )}

      {/* 큰 비교 — 클릭하면 새 탭에서 원본 크기 */}
      <div className={`grid gap-3 ${resultSrc ? "sm:grid-cols-2" : ""}`}>
        <figure className="m-0 min-w-0">
          <figcaption className="mb-1 text-[12px] font-bold text-muted">원본</figcaption>
          <a href={originalSrc} target="_blank" rel="noreferrer" title="클릭하면 크게 보기">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={originalSrc} alt="번역 전 원본" loading="lazy" className="max-h-[420px] w-full border border-hairline-soft bg-white object-contain" />
          </a>
        </figure>
        {resultSrc ? (
          <figure className="m-0 min-w-0">
            <figcaption className="mb-1 text-[12px] font-bold text-ink-deep">
              번역본{item.candidateUrl ? " (내보내기 전)" : ""}
            </figcaption>
            <a href={resultSrc} target="_blank" rel="noreferrer" title="클릭하면 크게 보기">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={resultSrc} alt="번역본" loading="lazy" className="max-h-[420px] w-full border border-hairline-soft bg-white object-contain" />
            </a>
          </figure>
        ) : (
          <p className="self-center border border-dashed border-hairline px-4 py-6 text-center text-[13px] text-muted">
            번역본이 만들어지지 않았습니다.
            <br />
            아래 <b>다시 만들기</b>를 누르거나, 직접 고친 이미지를 올려주세요.
          </p>
        )}
      </div>

      {failMsg && <p className="mt-2 text-[13px] font-semibold text-red-700">{failMsg}</p>}

      {/* 기본 버튼 둘 */}
      {/* 거부 카드: 무료 업로드가 정답 — 유료 재생성을 앞세우면 헛돈을 쓴다 */}
      {refused && !item.candidateUrl ? (
        <div className="mt-3 space-y-2 text-[13px]">
          <p className="text-ink-soft">
            노출 수위가 있는 이미지는 AI가 전체를 다시 만들지 못할 수 있습니다. 그 경우{" "}
            <b>글자 부분만 잘라 자동으로 고칩니다</b> (글자 수에 따라 약 100~600원).
            직접 고친 이미지를 올리면 무료입니다.
          </p>
          {uploadBlock}
          <button
            type="button"
            disabled={disabled}
            onClick={() => runStart(item.id, () => startAssetRerender(item.id))}
            className="border border-hairline px-3 py-1.5 text-[12px] font-semibold text-muted hover:text-ink-deep disabled:opacity-40"
          >
            AI로 다시 만들기 (약 100~600원)
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {item.candidateUrl && (
            <label className="flex cursor-pointer items-center gap-2 text-[13px] font-bold text-ink-deep">
              <input type="checkbox" checked={checked} onChange={onToggle} disabled={disabled} className="size-4 accent-ink-deep" />
              선택
            </label>
          )}
          {item.candidateUrl && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => run(item.id, "내보냈습니다", () => approveAssetCandidate(item.id))}
              className={btnPrimary}
            >
              이대로 내보내기
            </button>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={() => runStart(item.id, () => startAssetRerender(item.id))}
            className="border border-amber-500 px-3 py-2 text-[13px] font-bold text-amber-900 disabled:opacity-40"
          >
            {retryable ? "다시 시도하기" : "다시 만들기"} (약 100원)
          </button>
        </div>
      )}

      {/* 고급 — 접어둔다 */}
      <details className="mt-3 border-t border-hairline-soft pt-2">
        <summary className="cursor-pointer text-[12px] font-semibold text-muted hover:text-ink-deep">
          다른 방법 (지시 넣어 다시 만들기 · 직접 올리기 · 번역본 버리기)
        </summary>
        <div className="mt-2 space-y-3 text-[12px]">
          {item.hasBoxes && (
            <div>
              <label className="mb-1 block font-bold text-ink-deep" htmlFor={`rv-hint-${item.id}`}>
                무엇이 잘못됐는지 적고 다시 만들기 (약 100원)
              </label>
              <textarea
                id={`rv-hint-${item.id}`}
                ref={hintRef}
                rows={2}
                maxLength={300}
                placeholder="예) 하단 표의 글자가 잘렸습니다. 더 작은 글씨로 넣어주세요."
                className="w-full border border-hairline bg-white p-2"
              />
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  const fd = new FormData();
                  fd.set("hint", hintRef.current?.value ?? "");
                  runStart(item.id, () => startAssetRegenerateWithHint(item.id, {}, fd));
                }}
                className="mt-1 border border-amber-500 px-3 py-1.5 font-bold text-amber-900 disabled:opacity-40"
              >
                지시대로 다시 만들기
              </button>
            </div>
          )}
          {!(refused && !item.candidateUrl) && uploadBlock}
          {item.hasBoxes && item.originalUrl && (
            <p>
              <Link
                href={`/admin/products/${item.productId}?editAsset=${item.id}`}
                className="font-bold text-ink-deep underline underline-offset-2 hover:text-muted"
              >
                문구 수정 열기 →
              </Link>
              <span className="ml-2 text-muted">
                문구를 하나하나 직접 고쳐서 다시 만들 수 있습니다 (약 100원)
              </span>
            </p>
          )}
          {item.candidateUrl && (
            <button
              type="button"
              disabled={disabled}
              onClick={() =>
                run(
                  item.id,
                  liveIsApproved
                    ? "새 번역본을 버렸습니다 — 지금 나가는 그림은 그대로입니다"
                    : "번역본을 버리고 원본을 유지합니다",
                  () => rejectAssetCandidate(item.id),
                )
              }
              className="border border-hairline px-3 py-1.5 font-semibold text-muted hover:text-ink-deep disabled:opacity-40"
            >
              {liveIsApproved ? "이 번역본 버리기 (지금 그림 유지)" : "이 번역본 버리기 (원본 유지)"}
            </button>
          )}
        </div>
      </details>
    </li>
  );
}
