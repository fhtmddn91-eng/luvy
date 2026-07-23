"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { TrustBadges } from "./TrustBadges";

export interface HeroBannerData {
  id: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  primaryLabel: string;
  primaryHref: string;
  secondaryLabel: string;
  secondaryHref: string;
}

const FALLBACK: HeroBannerData = {
  id: "fallback",
  eyebrow: "LOVE YOUR BUSINESS",
  title: "LUVY, 당신의 비즈니스를\n더 빛나게",
  subtitle: "신뢰할 수 있는 제품과 파트너십으로\n성인 라이프스타일 비즈니스의 성공을 함께합니다.",
  primaryLabel: "회원가입하고 혜택받기",
  primaryHref: "/signup",
  secondaryLabel: "B2B 안내 보기",
  secondaryHref: "/partner",
};

const AUTOPLAY_MS = 6000;

export function HeroBanner({ banners: input }: { banners: HeroBannerData[] }) {
  const banners = input.length > 0 ? input : [FALLBACK];
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const count = banners.length;

  const go = useCallback(
    (next: number) => setIndex((next + count) % count),
    [count],
  );

  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => go(index + 1), AUTOPLAY_MS);
    return () => clearTimeout(t);
  }, [index, paused, go]);

  const banner = banners[index] ?? banners[0];

  return (
    <section
      className="relative overflow-hidden bg-brand-50"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Hero visual area — provided background image (desktop / mobile) */}
      <div className="relative">
        <div className="absolute inset-0">
          <Image
            src="/hero/hero-desktop.png"
            alt=""
            fill
            priority
            sizes="100vw"
            className="hidden object-cover object-right lg:block"
          />
          <Image
            src="/hero/hero-mobile.png"
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-bottom lg:hidden"
          />
        </div>

        {/* Copy overlaid on the empty (left / top) area of the image */}
        <div className="relative z-10 mx-auto max-w-[1280px] px-6">
          <div className="flex min-h-[540px] flex-col justify-start pt-12 lg:min-h-[460px] lg:justify-center lg:pt-0">
            <div key={banner.id} className="hero-enter max-w-full lg:max-w-[520px] lg:pl-4">
              <p className="text-[13px] font-bold uppercase tracking-[0.22em] text-brand-500">
                {banner.eyebrow}
              </p>
              <h1 className="mt-4 whitespace-pre-line text-[30px] font-extrabold leading-[1.18] tracking-tight text-ink sm:text-[38px] lg:mt-5 lg:text-[48px]">
                {banner.title}
              </h1>
              <p className="mt-4 hidden whitespace-pre-line text-[16px] leading-relaxed text-ink-soft sm:block lg:mt-5">
                {banner.subtitle}
              </p>

              <div className="mt-7 flex flex-wrap items-center gap-3 lg:mt-9">
                <Link
                  href={banner.primaryHref}
                  className="group inline-flex items-center gap-2 rounded-pill bg-brand-500 px-7 py-3.5 text-[15px] font-bold text-white shadow-[var(--shadow-card)] transition-all hover:bg-brand-600 hover:shadow-lg"
                >
                  {banner.primaryLabel}
                  <Icon
                    name="arrowRight"
                    className="h-4 w-4 transition-transform group-hover:translate-x-1"
                    strokeWidth={2.2}
                  />
                </Link>
                {banner.secondaryLabel && (
                  <Link
                    href={banner.secondaryHref || "/"}
                    className="group inline-flex items-center gap-2 rounded-pill border border-brand-300 bg-white/70 px-7 py-3.5 text-[15px] font-bold text-brand-600 transition-all hover:border-brand-400 hover:bg-white"
                  >
                    {banner.secondaryLabel}
                    <Icon
                      name="arrowRight"
                      className="h-4 w-4 transition-transform group-hover:translate-x-1"
                      strokeWidth={2.2}
                    />
                  </Link>
                )}
              </div>
            </div>
          </div>

          {/* Arrows */}
          <button
            type="button"
            onClick={() => go(index - 1)}
            aria-label="이전 배너"
            className="absolute left-0 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-ink shadow-[var(--shadow-soft)] transition-colors hover:bg-white lg:flex"
          >
            <Icon name="chevronLeft" className="h-5 w-5" strokeWidth={2} />
          </button>
          <button
            type="button"
            onClick={() => go(index + 1)}
            aria-label="다음 배너"
            className="absolute right-0 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/85 text-ink shadow-[var(--shadow-soft)] transition-colors hover:bg-white lg:flex"
          >
            <Icon name="chevronRight" className="h-5 w-5" strokeWidth={2} />
          </button>

          {/* Dots */}
          <div className="absolute bottom-5 left-6 flex items-center gap-2 lg:left-1/2 lg:-translate-x-1/2">
            {banners.map((b, i) => (
              <button
                key={b.id}
                type="button"
                onClick={() => go(i)}
                aria-label={`${i + 1}번 배너`}
                aria-current={i === index}
                className={`h-2 rounded-full transition-all ${
                  i === index
                    ? "w-6 bg-brand-500"
                    : "w-2 bg-brand-300/70 hover:bg-brand-300"
                }`}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Trust badges strip */}
      <div className="relative border-t border-brand-100 bg-cream">
        <div className="mx-auto max-w-[1280px] px-6 py-6">
          <TrustBadges />
        </div>
      </div>
    </section>
  );
}
