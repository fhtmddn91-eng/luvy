"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import type { NoticeFormState } from "@/lib/actions/admin-notices";

export interface NoticeFormData {
  id: string;
  kind: string;
  tag: string;
  text: string;
  sortOrder: number;
  active: boolean;
}

type Action = (prev: NoticeFormState, formData: FormData) => Promise<NoticeFormState>;

const inputCls =
  "h-11 w-full rounded-lg border border-line bg-white px-3 text-[14px] text-ink focus:border-brand-400 focus:outline-none";
const labelCls = "mb-1.5 block text-[13px] font-semibold text-ink-soft";

const KINDS = [
  { value: "notice", label: "공지사항" },
  { value: "stock", label: "입고 소식" },
  { value: "event", label: "이벤트" },
];

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="h-11 rounded-pill bg-brand-500 px-8 text-[14px] font-bold text-white hover:bg-brand-600 disabled:opacity-60">
      {pending ? "저장 중…" : "저장"}
    </button>
  );
}

export function NoticeForm({ action, notice }: { action: Action; notice?: NoticeFormData }) {
  const [state, formAction] = useActionState<NoticeFormState, FormData>(action, {});

  return (
    <form action={formAction} className="max-w-[640px] space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className={labelCls}>구분</label>
          <select name="kind" defaultValue={notice?.kind ?? "notice"} className={inputCls}>
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls}>태그 라벨</label>
          <input name="tag" defaultValue={notice?.tag} placeholder="공지사항" className={inputCls} />
        </div>
      </div>
      <div>
        <label className={labelCls}>내용</label>
        <input name="text" defaultValue={notice?.text} className={inputCls} />
      </div>
      <div className="flex items-end gap-6">
        <div>
          <label className={labelCls}>정렬 순서</label>
          <input name="sortOrder" type="number" defaultValue={notice?.sortOrder ?? 0} className={`${inputCls} w-28`} />
        </div>
        <label className="flex h-11 items-center gap-2 text-[14px] text-ink">
          <input name="active" type="checkbox" defaultChecked={notice?.active ?? true} className="h-4 w-4 accent-brand-500" />
          노출
        </label>
      </div>

      {state.error && <p className="text-[13px] font-medium text-brand-600">{state.error}</p>}

      <div className="flex items-center gap-3 pt-2">
        <SaveButton />
        <Link href="/admin/notices" className="text-[14px] text-muted hover:text-ink">취소</Link>
      </div>
    </form>
  );
}
