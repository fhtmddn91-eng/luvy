"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import { importFrom1688, type ImportFormState } from "@/lib/actions/admin-import";
import { Panel, btnPrimary } from "@/components/ui/Panel";
import { areaCls, labelCls, helpCls } from "@/components/ui/form";

function RunButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={btnPrimary}>
      {pending ? "수집 중… (이미지 다운로드에 30초 이상 걸릴 수 있습니다)" : "수집 실행"}
    </button>
  );
}

export function ImportForm() {
  const [state, formAction] = useActionState<ImportFormState, FormData>(importFrom1688, {});

  return (
    <form action={formAction} className="space-y-4">
      <Panel title="수집 데이터 붙여넣기">
        <label className={labelCls}>북마클릿이 복사한 JSON</label>
        <textarea
          name="payload"
          rows={8}
          placeholder='1688 상품페이지에서 북마클릿을 실행한 뒤 Ctrl+V 로 붙여넣으세요. {"url":"https://detail.1688.com/offer/...","extracted":{...}}'
          className={`${areaCls} font-mono text-[12px]`}
        />
        <p className={helpCls}>
          페이지 HTML을 그대로 붙여넣어도 이미지만은 회수됩니다(제목·가격은 누락).
        </p>

        <div className="mt-4">
          <RunButton />
        </div>
      </Panel>

      {state.message && (
        <div
          className={`border px-5 py-4 text-[13px] ${
            state.ok ? "border-ink-deep bg-white" : "border-brand-500 bg-brand-50"
          }`}
        >
          <p className={`font-bold ${state.ok ? "text-ink-deep" : "text-brand-700"}`}>
            {state.message}
          </p>
          {state.summary && (
            <ul className="mt-3 space-y-1 text-ink-soft">
              {state.summary.map((s) => (
                <li key={s} className="flex gap-2">
                  <span className="text-muted">·</span>
                  {s}
                </li>
              ))}
            </ul>
          )}
          {state.productId && (
            <Link
              href={`/admin/products/${state.productId}`}
              className="mt-4 inline-block border border-ink-deep px-4 py-2 text-[11px] font-bold uppercase tracking-[0.12em] text-ink-deep transition-colors hover:bg-ink-deep hover:text-white"
            >
              상품 수정으로 이동 →
            </Link>
          )}
        </div>
      )}
    </form>
  );
}
