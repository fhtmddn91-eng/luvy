import {
  User,
  UserRound,
  Heart,
  Sparkles,
  Hand,
  Droplet,
  Lightbulb,
  Store,
  ShieldCheck,
  Truck,
  Headset,
  CreditCard,
  BadgeCheck,
  ShoppingBag,
  Handshake,
  Search,
  ShoppingCart,
  Menu,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ArrowRight,
  Bell,
  CircleHelp,
  MessageCircle,
  Download,
  Package,
  Trophy,
  Gift,
  type LucideIcon,
} from "lucide-react";

const map: Record<string, LucideIcon> = {
  user: User,
  userRound: UserRound,
  heart: Heart,
  sparkle: Sparkles,
  hand: Hand,
  droplet: Droplet,
  lightbulb: Lightbulb,
  store: Store,
  shield: ShieldCheck,
  truck: Truck,
  headset: Headset,
  card: CreditCard,
  verified: BadgeCheck,
  bag: ShoppingBag,
  partner: Handshake,
  search: Search,
  cart: ShoppingCart,
  menu: Menu,
  chevronDown: ChevronDown,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  arrowRight: ArrowRight,
  bell: Bell,
  help: CircleHelp,
  chat: MessageCircle,
  download: Download,
  package: Package,
  trophy: Trophy,
  gift: Gift,
};

interface IconProps {
  name: string;
  className?: string;
  strokeWidth?: number;
}

export function Icon({ name, className, strokeWidth = 1.6 }: IconProps) {
  const Cmp = map[name];
  if (!Cmp) return null;
  return <Cmp className={className} strokeWidth={strokeWidth} />;
}
