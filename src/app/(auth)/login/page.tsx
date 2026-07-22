import Link from "next/link";
import { AuthCard } from "@/components/auth/AuthCard";
import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <AuthCard
      title="파트너 로그인"
      subtitle="LUVY 사업자 회원 전용 서비스입니다."
      footer={
        <>
          아직 회원이 아니신가요?{" "}
          <Link href="/signup" className="font-semibold text-brand-600 hover:underline">
            회원가입
          </Link>
        </>
      }
    >
      <LoginForm next={next ?? "/"} />
      <p className="mt-5 rounded-xl bg-brand-50 px-4 py-3 text-center text-[12px] text-brand-600">
        데모 계정: demo@luvy.co.kr / luvy1234
      </p>
    </AuthCard>
  );
}
