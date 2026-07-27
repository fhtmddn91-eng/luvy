"use client";

import { useActionState } from "react";
import { signupAction, type AuthState } from "@/lib/actions/auth";
import { AuthField } from "@/components/auth/AuthField";
import { SubmitButton } from "@/components/auth/SubmitButton";

export function SignupForm() {
  const [state, action] = useActionState<AuthState, FormData>(signupAction, {});
  return (
    <form action={action} className="space-y-4">
      <AuthField label="이메일" name="email" type="email" placeholder="business@company.com" autoComplete="email" />
      <AuthField label="비밀번호 (8자 이상)" name="password" type="password" autoComplete="new-password" />
      <AuthField label="비밀번호 확인" name="passwordConfirm" type="password" autoComplete="new-password" />
      <div className="my-2 border-t border-line" />
      <AuthField label="상호명" name="companyName" placeholder="러비상사" />
      <AuthField label="사업자등록번호" name="businessNumber" placeholder="123-45-67890" />
      <AuthField label="대표자명" name="ownerName" />
      <AuthField label="휴대폰" name="phone" placeholder="010-0000-0000" autoComplete="tel" />
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-semibold text-ink-soft">
          사업자등록증 첨부 (JPG/PNG/PDF)
        </span>
        <input
          name="bizCert"
          type="file"
          required
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="block w-full rounded-xl border border-line bg-white px-3 py-3 text-[13px] text-ink-soft file:mr-3 file:rounded-pill file:border-0 file:bg-brand-100 file:px-4 file:py-1.5 file:text-[13px] file:font-bold file:text-brand-600 hover:file:bg-brand-200"
        />
        <span className="mt-1.5 block text-[12px] leading-relaxed text-muted">
          첨부해주신 사업자등록증은 가입 심사에만 사용되며, 관리자만 열람할 수 있습니다.
        </span>
      </label>
      {state.error && <p className="text-[13px] font-medium text-brand-600">{state.error}</p>}
      <SubmitButton>회원가입</SubmitButton>
    </form>
  );
}
