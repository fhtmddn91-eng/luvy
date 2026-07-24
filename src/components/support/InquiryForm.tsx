"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createInquiry, type InquiryFormState } from "@/lib/actions/inquiries";
import { INQUIRY_TYPES, type InquiryType } from "@/lib/inquiry";

const inputCls =
  "h-11 w-full rounded-lg border border-line bg-white px-3 text-[14px] text-ink focus:border-brand-400 focus:outline-none";
const labelCls = "mb-1.5 block text-[13px] font-semibold text-ink-soft";

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 rounded-pill bg-brand-500 px-8 text-[14px] font-bold text-white hover:bg-brand-600 disabled:opacity-60"
    >
      {pending ? "접수 중…" : "문의 접수"}
    </button>
  );
}

/**
 * 공용 문의 폼.
 * - type을 고정하면(입점/대량/제휴) 유형 선택 없이 해당 유형으로 접수된다.
 * - back: 접수 후 돌아갈 경로 (?submitted=1 부착)
 */
export function InquiryForm({
  type,
  back = "/support/inquiry",
  titlePlaceholder,
  contentPlaceholder,
}: {
  type?: InquiryType;
  back?: string;
  titlePlaceholder?: string;
  contentPlaceholder?: string;
}) {
  const [state, formAction] = useActionState<InquiryFormState, FormData>(createInquiry, {});

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="back" value={back} />
      {type ? (
        <input type="hidden" name="type" value={type} />
      ) : (
        <div>
          <label className={labelCls}>문의 유형</label>
          <select name="type" defaultValue="GENERAL" className={inputCls}>
            {Object.entries(INQUIRY_TYPES).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label className={labelCls}>제목</label>
        <input
          name="title"
          maxLength={100}
          placeholder={titlePlaceholder ?? "문의 제목을 입력해주세요"}
          className={inputCls}
        />
      </div>
      <div>
        <label className={labelCls}>내용</label>
        <textarea
          name="content"
          rows={7}
          maxLength={2000}
          placeholder={
            contentPlaceholder ??
            "문의 내용을 자세히 적어주시면 더 정확한 답변을 드릴 수 있습니다."
          }
          className="w-full rounded-lg border border-line bg-white px-3 py-2.5 text-[14px] leading-relaxed text-ink focus:border-brand-400 focus:outline-none"
        />
      </div>

      {state.error && <p className="text-[13px] font-medium text-brand-600">{state.error}</p>}

      <div className="pt-1">
        <SubmitButton />
      </div>
    </form>
  );
}
