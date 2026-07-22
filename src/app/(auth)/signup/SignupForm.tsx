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
      <AuthField label="상호명" name="companyName" placeholder="(주)러비상사" />
      <AuthField label="사업자등록번호" name="businessNumber" placeholder="123-45-67890" />
      <AuthField label="대표자명" name="ownerName" />
      <AuthField label="연락처" name="phone" placeholder="010-0000-0000" autoComplete="tel" />
      {state.error && <p className="text-[13px] font-medium text-brand-600">{state.error}</p>}
      <SubmitButton>회원가입</SubmitButton>
    </form>
  );
}
