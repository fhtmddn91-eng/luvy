"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import type { FaqFormState } from "@/lib/actions/admin-faqs";
import { btnPrimary } from "@/components/ui/Panel";
import { fieldCls, areaCls, labelCls, helpCls, errorCls } from "@/components/ui/form";

type Action = (prev: FaqFormState, formData: FormData) => Promise<FaqFormState>;

export interface FaqFormData {
  category: string;
  question: string;
  answer: string;
  sortOrder: number;
  active: boolean;
}

function SubmitButton({ isNew }: { isNew: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className={btnPrimary}>
      {pending ? "저장 중…" : isNew ? "FAQ 등록" : "수정 저장"}
    </button>
  );
}

export function FaqForm({ action, faq }: { action: Action; faq?: FaqFormData }) {
  const [state, formAction] = useActionState<FaqFormState, FormData>(action, {});

  return (
    <form action={formAction} className="max-w-[640px] space-y-4">
      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <div>
          <label htmlFor="faq-category" className={labelCls}>
            분류
          </label>
          <input
            id="faq-category"
            name="category"
            defaultValue={faq?.category}
            maxLength={30}
            placeholder="예) 배송"
            className={fieldCls}
          />
          <p className={helpCls}>같은 분류끼리 묶여서 표시됩니다.</p>
        </div>
        <div>
          <label htmlFor="faq-order" className={labelCls}>
            순서
          </label>
          <input
            id="faq-order"
            name="sortOrder"
            type="number"
            defaultValue={faq?.sortOrder ?? 0}
            className={fieldCls}
          />
        </div>
      </div>

      <div>
        <label htmlFor="faq-q" className={labelCls}>
          질문
        </label>
        <input
          id="faq-q"
          name="question"
          defaultValue={faq?.question}
          maxLength={200}
          className={fieldCls}
        />
      </div>

      <div>
        <label htmlFor="faq-a" className={labelCls}>
          답변
        </label>
        <textarea
          id="faq-a"
          name="answer"
          rows={7}
          defaultValue={faq?.answer}
          maxLength={2000}
          className={areaCls}
        />
      </div>

      <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-soft">
        <input type="checkbox" name="active" defaultChecked={faq?.active ?? true} />
        표시 (끄면 목록에서 숨김)
      </label>

      {state.error && <p className={errorCls}>{state.error}</p>}

      <div className="flex items-center gap-3">
        <SubmitButton isNew={!faq} />
        <Link href="/admin/faqs" className="text-[13px] text-muted hover:text-ink-deep">
          취소
        </Link>
      </div>
    </form>
  );
}
