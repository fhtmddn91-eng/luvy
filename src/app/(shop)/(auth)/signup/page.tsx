import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { SignupForm } from "./SignupForm";

export default function SignupPage() {
  return (
    <AuthCard
      title="사업자 회원가입"
      subtitle="만 19세 이상 사업자 회원만 가입할 수 있습니다."
      footer={
        <>
          이미 회원이신가요?{" "}
          <Link href="/login" className="font-semibold text-brand-600 hover:underline">
            로그인
          </Link>
        </>
      }
    >
      <SignupForm />
    </AuthCard>
  );
}
