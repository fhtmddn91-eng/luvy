export interface Category {
  slug: string;
  name: string;
  /** lucide-style icon key rendered by the CategoryBar */
  icon: string;
}

export interface NavLink {
  label: string;
  href: string;
  hasDropdown?: boolean;
}

export interface Banner {
  id: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  primaryCta: { label: string; href: string };
  secondaryCta: { label: string; href: string };
  /** background gradient utility classes */
  bg: string;
}

export interface TrustBadge {
  icon: string;
  title: string;
  desc: string;
}

export type NoticeKind = "notice" | "stock" | "event";

export interface Notice {
  kind: NoticeKind;
  tag: string;
  text: string;
}

export interface Feature {
  icon: string;
  title: string;
  desc: string;
}

/** Reserved for the next phase (product listing / detail). */
export interface Product {
  id: string;
  name: string;
  brand: string;
  categorySlug: string;
  price: number;
  listPrice?: number;
  image: string;
  badge?: string;
}

export interface CartItem {
  productId: string;
  quantity: number;
}
