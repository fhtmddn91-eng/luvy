"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import type { BannerFormState } from "@/lib/actions/admin-banners";
import { btnPrimary } from "@/components/ui/Panel";
import { fieldCls, labelCls, helpCls } from "@/components/ui/form";

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
 image?: string;
 imageMobile?: string;
}

/** 배경 이미지 한 칸 — 현재 이미지 미리보기 + 교체 + 기본으로 되돌리기 */
function ImageField({
 label,
 fileName,
 clearName,
 current,
 help,
}: {
 label: string;
 fileName: string;
 clearName: string;
 current?: string;
 help: string;
}) {
 return (
 <div>
 <label className={labelCls}>{label}</label>
 <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
 <div className="shrink-0">
 {current ? (
 // eslint-disable-next-line @next/next/no-img-element
 <img
 src={current}
 alt="현재 배경"
 className="h-20 w-32 border border-hairline object-cover"
 />
 ) : (
 <div className="flex h-20 w-32 items-center justify-center border border-dashed border-hairline text-center text-[11px] leading-tight text-muted">
 기본 이미지
 </div>
 )}
 </div>
 <div className="min-w-0 flex-1">
 <input
 name={fileName}
 type="file"
 accept="image/jpeg,image/png,image/webp,image/avif"
 className="block w-full text-[13px] text-ink-soft file:mr-3 file:border file:border-hairline file:bg-white file:px-4 file:py-2 file:text-[13px] file:font-semibold file:text-ink-deep hover:file:border-ink-deep"
 />
 <p className={helpCls}>{help}</p>
 {current && (
 <label className="mt-2 flex items-center gap-2 text-[13px] text-ink-deep">
 <input name={clearName} type="checkbox" className="h-4 w-4 accent-brand-500" />
 기본 이미지로 되돌리기
 </label>
 )}
 </div>
 </div>
 </div>
 );
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
 <div className="space-y-5 border-t border-hairline pt-5">
 <ImageField
 label="배경 이미지 (PC)"
 fileName="imageFile"
 clearName="imageClear"
 current={banner?.image}
 help="JPG · PNG · WebP · AVIF / 5MB 이하. 가로로 넓은 이미지(예: 2000×760)를 권합니다. 글자는 왼쪽에 겹쳐지므로 오른쪽에 그림이 오게 만드세요. 넣지 않으면 기본 배경을 씁니다."
 />
 <ImageField
 label="배경 이미지 (모바일)"
 fileName="imageMobileFile"
 clearName="imageMobileClear"
 current={banner?.imageMobile}
 help="세로로 긴 이미지(예: 780×900). 넣지 않으면 PC 이미지를, 그것도 없으면 기본 배경을 씁니다."
 />
 </div>

 <div className="flex items-end gap-6 border-t border-hairline pt-5">
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
