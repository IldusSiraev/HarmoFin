import {
  ArrowDownLeft,
  ArrowUpRight,
  Award,
  Baby,
  Banknote,
  Car,
  CircleDollarSign,
  Coffee,
  CreditCard,
  Dumbbell,
  Ellipsis,
  Fuel,
  Gift,
  Hammer,
  HandCoins,
  HeartPulse,
  House,
  KeyRound,
  Landmark,
  Package,
  Palette,
  PawPrint,
  Percent,
  Pill,
  Plane,
  Repeat,
  School,
  ShieldCheck,
  Shirt,
  ShoppingCart,
  Smartphone,
  Sparkles,
  SprayCan,
  SquareParking,
  Stethoscope,
  Syringe,
  Tag,
  Ticket,
  Truck,
  Utensils,
  Volleyball,
  Wallet,
  Wifi,
  Wine,
  Wrench,
  Zap,
} from '@lucide/vue';
import type { Component } from 'vue';

export interface CategoryIconOption {
  key: string;
  label: string;
  component: Component;
}

// The fixed icon catalog a user can pick from for a leaf category. Keys mirror
// CATEGORY_ICON_KEYS in apps/api/src/categories/category.schemas.ts — keep both in sync.
export const CATEGORY_ICON_OPTIONS: readonly CategoryIconOption[] = [
  { key: 'award', label: 'Награда', component: Award },
  { key: 'baby', label: 'Малыш', component: Baby },
  { key: 'banknote', label: 'Банкнота', component: Banknote },
  { key: 'car', label: 'Автомобиль', component: Car },
  { key: 'circle-dollar-sign', label: 'Деньги', component: CircleDollarSign },
  { key: 'coffee', label: 'Кофе', component: Coffee },
  { key: 'credit-card', label: 'Банковская карта', component: CreditCard },
  { key: 'dumbbell', label: 'Гантеля', component: Dumbbell },
  { key: 'ellipsis', label: 'Многоточие', component: Ellipsis },
  { key: 'fuel', label: 'Топливо', component: Fuel },
  { key: 'gift', label: 'Подарок', component: Gift },
  { key: 'hammer', label: 'Молоток', component: Hammer },
  { key: 'hand-coins', label: 'Монеты в руке', component: HandCoins },
  { key: 'heart-pulse', label: 'Пульс', component: HeartPulse },
  { key: 'house', label: 'Дом', component: House },
  { key: 'key-round', label: 'Ключ', component: KeyRound },
  { key: 'landmark', label: 'Учреждение', component: Landmark },
  { key: 'package', label: 'Посылка', component: Package },
  { key: 'palette', label: 'Палитра', component: Palette },
  { key: 'paw-print', label: 'Лапка', component: PawPrint },
  { key: 'percent', label: 'Процент', component: Percent },
  { key: 'pill', label: 'Таблетка', component: Pill },
  { key: 'plane', label: 'Самолёт', component: Plane },
  { key: 'repeat', label: 'Повтор', component: Repeat },
  { key: 'school', label: 'Школа', component: School },
  { key: 'shield-check', label: 'Щит', component: ShieldCheck },
  { key: 'shirt', label: 'Одежда', component: Shirt },
  { key: 'shopping-cart', label: 'Тележка покупок', component: ShoppingCart },
  { key: 'smartphone', label: 'Смартфон', component: Smartphone },
  { key: 'sparkles', label: 'Блёстки', component: Sparkles },
  { key: 'spray-can', label: 'Баллончик', component: SprayCan },
  { key: 'square-parking', label: 'Парковка', component: SquareParking },
  { key: 'stethoscope', label: 'Стетоскоп', component: Stethoscope },
  { key: 'syringe', label: 'Шприц', component: Syringe },
  { key: 'tag', label: 'Ярлык', component: Tag },
  { key: 'ticket', label: 'Билет', component: Ticket },
  { key: 'truck', label: 'Грузовик', component: Truck },
  { key: 'utensils', label: 'Приборы', component: Utensils },
  { key: 'volleyball', label: 'Мяч', component: Volleyball },
  { key: 'wallet', label: 'Кошелёк', component: Wallet },
  { key: 'wifi', label: 'Wi-Fi', component: Wifi },
  { key: 'wine', label: 'Вино', component: Wine },
  { key: 'wrench', label: 'Гаечный ключ', component: Wrench },
  { key: 'zap', label: 'Молния', component: Zap },
];

const ICONS: Record<string, Component> = Object.fromEntries(
  CATEGORY_ICON_OPTIONS.map((option) => [option.key, option.component]),
);

export function categoryIcon(
  icon: string | null,
  transactionType: 'INCOME' | 'EXPENSE',
): Component {
  const mapped = icon === null ? undefined : ICONS[icon];
  if (mapped !== undefined) return mapped;
  return transactionType === 'INCOME' ? ArrowDownLeft : ArrowUpRight;
}
