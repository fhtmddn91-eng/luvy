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
  /** 슬라이드별 배경. 비어 있으면 아래 기본 이미지를 쓴다 */
  image?: string;
  imageMobile?: string;
}

/** 배너를 아직 안 만들었거나 이미지를 안 올렸을 때 쓰는 기본 배경 */
const DEFAULT_DESKTOP = "/hero/hero-desktop.png";
const DEFAULT_MOBILE = "/hero/hero-mobile.png";

const FALLBACK: HeroBannerData = {
  id: "fallback",
  eyebrow: "LOVE YOUR BUSINESS",
  title: "상세페이지 만들 시간에\n하나 더 파세요",
  subtitle: "썸네일·상세페이지·GIF까지 완성된 판매자료를 드립니다.\n내려받아 그대로 올리면 판매 준비 끝.",
  primaryLabel: "가입하고 판매자료 받기",
  primaryHref: "/signup",
  secondaryLabel: "판매자료 미리보기",
  secondaryHref: "/partner",
};

const AUTOPLAY_MS = 6000;

export function HeroBanner({
  banners: input,
  widget,
  sidebar,
}: {
  banners: HeroBannerData[];
  /** 히어로 우측 오버레이 슬롯 — 회원 인사·요약 카드 */
  widget?: React.ReactNode;
  /** 히어로 왼쪽에 상시 노출되는 전체 카테고리 기둥 (넓은 화면 전용) */
  sidebar?: React.ReactNode;
}) {
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
  // 모바일 전용 이미지가 없으면 PC 이미지를, 그것도 없으면 기본 배경을 쓴다
  const desktopSrc = banner.image || DEFAULT_DESKTOP;
  const mobileSrc = banner.imageMobile || banner.image || DEFAULT_MOBILE;

  return (
    <section
      className="relative overflow-hidden bg-brand-50"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Hero visual area — provided background image (desktop / mobile) */}
      <div className="relative">
        {/* key: 슬라이드가 넘어갈 때 배경도 함께 바뀐다 */}
        <div key={banner.id} className="absolute inset-0">
          <Image
            src={desktopSrc}
            alt=""
            fill
            priority
            sizes="100vw"
            className="hidden object-cover object-right lg:block"
          />
          <Image
            src={mobileSrc}
            alt=""
            fill
            priority
            sizes="100vw"
            className="object-cover object-bottom lg:hidden"
          />
        </div>

        {/*
         * 카피 뒤에 깔리는 흰 그라데이션.
         * 배경 사진의 왼쪽 위가 비어 있지 않으면(물건이 가운데까지 차 있는 컷)
         * 제목 두 번째 줄이 사진에 묻혀 안 읽힌다 → 글자가 놓이는 쪽만 덮는다.
         * 모바일은 카피가 위쪽, 데스크톱은 왼쪽에 있으므로 방향을 달리한다.
         */}
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-b from-white/85 via-white/40 to-transparent lg:bg-gradient-to-r lg:from-white/85 lg:via-white/35 lg:to-transparent"
        />

        {/*
         * 카테고리 기둥 + 카피를 **진짜 2단**으로 놓는다.
         * 예전에는 기둥을 절대배치하고 카피에 고정 여백(268px)을 줬는데,
         * 화면 폭에 따라 카피가 눌려 제목이 4줄로 깨졌다. 기둥은 고정 폭,
         * 카피는 남는 폭을 그대로 받게 하면 어느 폭에서도 안 밀린다.
         */}
        <div className="relative z-10 mx-auto flex max-w-[1280px] px-6">
          {sidebar && <div className="hidden shrink-0 lg:block">{sidebar}</div>}

          <div className="relative min-w-0 flex-1">
          {/*
           * 모바일 배너 높이. 예전 540px 는 화면(844px)의 82% 를 먹어서
           * 첫 화면에 상품이 하나도 안 보였다 → 절반 수준으로 낮춘다.
           */}
          <div className="flex min-h-[300px] flex-col justify-start pt-7 sm:min-h-[440px] sm:pt-10 lg:min-h-[460px] lg:justify-center lg:pt-0">
            <div
              key={banner.id}
              // 좌측 여백은 이전 배너 화살표(44px)가 앉을 자리
              className={`hero-enter max-w-full lg:max-w-[620px] ${sidebar ? "lg:pl-14" : "lg:pl-4"}`}
            >
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
                  className="group inline-flex items-center gap-1.5 rounded-pill bg-brand-500 px-5 py-2.5 text-[13px] font-bold text-white shadow-[var(--shadow-card)] transition-all hover:bg-brand-600 hover:shadow-lg sm:gap-2 sm:px-7 sm:py-3.5 sm:text-[15px]"
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
                    className="group inline-flex items-center gap-1.5 rounded-pill border border-brand-300 bg-white/70 px-5 py-2.5 text-[13px] font-bold text-brand-600 transition-all hover:border-brand-400 hover:bg-white sm:gap-2 sm:px-7 sm:py-3.5 sm:text-[15px]"
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

          {/* 회원 인사 카드 (우측 오버레이) */}
          {widget && (
            <div className="absolute right-10 top-1/2 z-20 hidden -translate-y-1/2 xl:block">
              {widget}
            </div>
          )}

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
          <div className="absolute bottom-5 left-0 flex items-center gap-2 lg:left-1/2 lg:-translate-x-1/2">
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
