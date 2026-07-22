import Link from "next/link";
import { Logo } from "@/components/layout/Logo";

interface AuthCardProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
}

export function AuthCard({ title, subtitle, children, footer }: AuthCardProps) {
  return (
    <div className="mx-auto flex min-h-[70vh] max-w-[440px] flex-col justify-center px-6 py-16">
      <div className="mb-8 text-center">
        <div className="mb-6 flex justify-center">
          <Logo />
        </div>
        <h1 className="text-[24px] font-extrabold text-ink">{title}</h1>
        <p className="mt-2 text-[14px] text-muted">{subtitle}</p>
      </div>
      <div className="rounded-2xl border border-line bg-white p-7 shadow-[var(--shadow-soft)]">
        {children}
      </div>
      <div className="mt-6 text-center text-[14px] text-muted">{footer}</div>
      <Link href="/" className="mt-4 text-center text-[13px] text-muted hover:text-brand-500">
        ← 메인으로 돌아가기
      </Link>
    </div>
  );
}
