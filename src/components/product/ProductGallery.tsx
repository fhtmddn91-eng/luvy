"use client";

/* eslint-disable @next/next/no-img-element */
import { useState } from "react";
import { ProductThumb } from "./ProductThumb";

/**
 * 상품 대표이미지 갤러리.
 *
 * 수집 상품은 대표이미지가 5~10장 들어오는데 한 장만 보여주면
 * 나머지는 "판매자료 다운로드"에서나 확인된다 — 관리자 화면과
 * 상품 페이지가 달라 보이는 원인이었다.
 */
export function ProductGallery({
  id,
  brand,
  name,
  images,
}: {
  id: string;
  brand: string;
  name: string;
  images: string[];
}) {
  const [active, setActive] = useState(0);
  const current = images[active] ?? images[0] ?? "";

  return (
    <div>
      <ProductThumb
        id={id}
        brand={brand}
        image={current}
        alt={name}
        className="aspect-square w-full rounded-2xl"
      />
      {images.length > 1 && (
        <ul className="mt-3 grid grid-cols-5 gap-2 sm:grid-cols-6">
          {images.map((url, i) => (
            <li key={url}>
              <button
                type="button"
                onClick={() => setActive(i)}
                aria-label={`${name} 이미지 ${i + 1}`}
                aria-current={i === active}
                className={`block w-full overflow-hidden rounded-lg border transition-colors ${
                  i === active ? "border-brand-500" : "border-line hover:border-brand-300"
                }`}
              >
                <img
                  src={url}
                  alt=""
                  loading="lazy"
                  className="aspect-square w-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
