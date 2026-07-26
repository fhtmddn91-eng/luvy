"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import type { BannerFormState } from "@/lib/actions/admin-banners";
import { btnPrimary } from "@/components/ui/Panel";
import { fieldCls, labelCls } from "@/components/ui/form";

export interface BannerFormData {
 id: string;
 eyebrow: string;
 title: string;
 subtitle: string;
 primaryLabel: string;
 primaryHref: string;
 secondaryLabel: string;
 secondaryHref: string;
 sortOrder: number;
 active: boolean;
}

type Action = (prev: BannerFormState, formData: FormData) => Promise<BannerFormState>;

const inputCls = fieldCls;

function SaveButton() {
 const { pending } = useFormStatus();
 return (
 <button type="submit" disabled={pending} className={btnPrimary}>
 {pending ? "저장 중…" : "저장"}
 </button>
 );
}

export function BannerForm({ action, banner }: { action: Action; banner?: BannerFormData }) {
 const [state, formAction] = useActionState<BannerFormState, FormData>(action, {});

 return (
 <form
 action={formAction}
 className="rise max-w-[760px] space-y-5 border border-hairline bg-white p-5 sm:p-6"
 >
 <div>
 <label className={labelCls}>상단 라벨 (eyebrow)</label>
 <input name="eyebrow" defaultValue={banner?.eyebrow} placeholder="LOVE YOUR BUSINESS" className={inputCls} />
 </div>
 <div>
 <label className={labelCls}>제목 (줄바꿈 가능)</label>
 <textarea name="title" rows={2} defaultValue={banner?.title} className={`${inputCls} h-auto py-2.5`} />
 </div>
 <div>
 <label className={labelCls}>부제 (줄바꿈 가능)</label>
 <textarea name="subtitle" rows={2} defaultValue={banner?.subtitle} className={`${inputCls} h-auto py-2.5`} />
 </div>
 <div className="grid grid-cols-2 gap-4">
 <div>
 <label className={labelCls}>기본 버튼 문구</label>
 <input name="primaryLabel" defaultValue={banner?.primaryLabel} className={inputCls} />
 </div>
 <div>
 <label className={labelCls}>기본 버튼 링크</label>
 <input name="primaryHref" defaultValue={banner?.primaryHref ?? "/"} className={inputCls} />
 </div>
 <div>
 <label className={labelCls}>보조 버튼 문구</label>
 <input name="secondaryLabel" defaultValue={banner?.secondaryLabel} className={inputCls} />
 </div>
 <div>
 <label className={labelCls}>보조 버튼 링크</label>
 <input name="secondaryHref" defaultValue={banner?.secondaryHref ?? "/"} className={inputCls} />
 </div>
 </div>
 <div className="flex items-end gap-6">
 <div>
 <label className={labelCls}>정렬 순서</label>
 <input name="sortOrder" type="number" defaultValue={banner?.sortOrder ?? 0} className={`${inputCls} w-28`} />
 </div>
 <label className="flex h-11 items-center gap-2 text-[14px] text-ink-deep">
 <input name="active" type="checkbox" defaultChecked={banner?.active ?? true} className="h-4 w-4 accent-brand-500" />
 노출
 </label>
 </div>

 {state.error && <p className="text-[13px] font-medium text-brand-600">{state.error}</p>}

 <div className="flex items-center gap-3 pt-2">
 <SaveButton />
 <Link href="/admin/banners" className="text-[13.5px] text-muted hover:text-ink-deep">취소</Link>
 </div>
 </form>
 );
}
