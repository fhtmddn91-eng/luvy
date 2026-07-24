"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { answerInquiry, type InquiryFormState } from "@/lib/actions/inquiries";

function SubmitButton({ answered }: { answered: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="h-11 rounded-pill bg-brand-500 px-8 text-[14px] font-bold text-white hover:bg-brand-600 disabled:opacity-60"
    >
      {pending ? "저장 중…" : answered ? "답변 수정" : "답변 등록"}
    </button>
  );
}

export function InquiryAnswerForm({
  inquiryId,
  defaultAnswer,
}: {
  inquiryId: string;
  defaultAnswer?: string;
}) {
  const bound = answerInquiry.bind(null, inquiryId);
  const [state, formAction] = useActionState<InquiryFormState, FormData>(bound, {});

  return (
    <form action={formAction} className="space-y-3">
      <textarea
        name="answer"
        rows={6}
        defaultValue={defaultAnswer}
        placeholder="답변 내용을 입력하세요. 등록 시 회원의 1:1 문의 내역에 즉시 표시됩니다."
        className="w-full rounded-lg border border-line bg-white px-3 py-2.5 text-[14px] leading-relaxed text-ink focus:border-brand-400 focus:outline-none"
      />
      {state.error && <p className="text-[13px] font-medium text-brand-600">{state.error}</p>}
      <SubmitButton answered={Boolean(defaultAnswer)} />
    </form>
  );
}
