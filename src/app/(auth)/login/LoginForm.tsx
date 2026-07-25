"use client";

import { useActionState } from "react";
import { loginAction, type AuthState } from "@/lib/actions/auth";
import { AuthField } from "@/components/auth/AuthField";
import { SubmitButton } from "@/components/auth/SubmitButton";

export function LoginForm({ next }: { next: string }) {
  const [state, action] = useActionState<AuthState, FormData>(loginAction, {});
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <AuthField label="이메일 또는 아이디" name="email" type="text" placeholder="business@company.com" autoComplete="username" />
      <AuthField label="비밀번호" name="password" type="password" autoComplete="current-password" />
      {state.error && <p className="text-[13px] font-medium text-brand-600">{state.error}</p>}
      <SubmitButton>로그인</SubmitButton>
    </form>
  );
}
