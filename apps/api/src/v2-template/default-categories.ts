import { CategoryType } from '@prisma/client';

export interface DefaultCategory {
  templateKey: string;
  name: string;
  categoryType: CategoryType;
  parentTemplateKey: string | null;
  comment: string | null;
  icon: string | null;
  displayOrder: number;
}
interface CategoryLeaf {
  templateKey: string;
  name: string;
  icon: string;
  comment?: string;
}
interface CategoryGroup {
  templateKey: string;
  name: string;
  children: readonly CategoryLeaf[];
}

// Keys mirror apps/web/app/components/operations/category-icon.ts — update both together.
const INCOME_CATEGORY_GROUPS: readonly CategoryGroup[] = [
  {
    templateKey: 'income-group-salary',
    name: 'Зарплата',
    children: [
      {
        templateKey: 'income-advance',
        name: 'Аванс',
        icon: 'hand-coins',
        comment: 'аванс, часть зарплаты, предоплата',
      },
      {
        templateKey: 'income-salary',
        name: 'Расчёт',
        icon: 'banknote',
        comment: 'зарплата, расчёт, оклад',
      },
      {
        templateKey: 'income-bonus',
        name: 'Премия',
        icon: 'award',
        comment: 'премия, бонус, bonus',
      },
    ],
  },
  {
    templateKey: 'income-group-other',
    name: 'Прочий доход',
    children: [
      {
        templateKey: 'income-sale',
        name: 'Продажа',
        icon: 'circle-dollar-sign',
        comment: 'продажа личных вещей',
      },
      { templateKey: 'income-gift', name: 'Подарок', icon: 'gift', comment: 'подарок, наследство' },
      {
        templateKey: 'income-cashback',
        name: 'Кэшбэк',
        icon: 'credit-card',
        comment: 'кэшбэк, cashback, возврат',
      },
      {
        templateKey: 'income-deposit-interest',
        name: 'Проценты по вкладам',
        icon: 'percent',
        comment: 'проценты, вклад, депозит',
      },
      {
        templateKey: 'income-social',
        name: 'Социальные выплаты',
        icon: 'hand-coins',
        comment: 'пособия, выплаты, пенсия',
      },
    ],
  },
];

const EXPENSE_CATEGORY_GROUPS: readonly CategoryGroup[] = [
  {
    templateKey: 'expense-group-housing',
    name: 'Жилье',
    children: [
      {
        templateKey: 'expense-mortgage',
        name: 'Ипотека',
        icon: 'house',
        comment: 'ипотека, кредит на жильё, ипотечный платёж, mortgage',
      },
      {
        templateKey: 'expense-rent',
        name: 'Аренда',
        icon: 'key-round',
        comment: 'аренда, аренда квартиры, съём, rent',
      },
      {
        templateKey: 'expense-utilities',
        name: 'Коммуналка',
        icon: 'zap',
        comment: 'коммуналка, жкх, квартплата, свет, газ, вода, отопление, utilities',
      },
    ],
  },
  {
    templateKey: 'expense-group-credit',
    name: 'Кредиты',
    children: [
      {
        templateKey: 'expense-consumer-loan',
        name: 'Потребительский кредит',
        icon: 'credit-card',
        comment: 'кредит, потребительский, займ',
      },
      {
        templateKey: 'expense-insurance',
        name: 'Страхование',
        icon: 'shield-check',
        comment: 'страховка, залог, страхование жизни, insurance',
      },
      {
        templateKey: 'expense-taxes',
        name: 'Налоги',
        icon: 'landmark',
        comment: 'налог, налоги, пени, налог на имущество, tax',
      },
    ],
  },
  {
    templateKey: 'expense-group-communication',
    name: 'Связь',
    children: [
      {
        templateKey: 'expense-internet',
        name: 'Интернет',
        icon: 'wifi',
        comment: 'интернет, wifi',
      },
      {
        templateKey: 'expense-mobile',
        name: 'Мобильная связь',
        icon: 'smartphone',
        comment: 'связь, мобильный, сотовый',
      },
    ],
  },
  {
    templateKey: 'expense-group-food',
    name: 'Еда',
    children: [
      {
        templateKey: 'expense-fast-food',
        name: 'Фастфуд',
        icon: 'coffee',
        comment: 'мак, kfc, ростикс, шаурма, бургер',
      },
      {
        templateKey: 'expense-groceries',
        name: 'Продукты',
        icon: 'shopping-cart',
        comment: 'продукты, магазин, супермаркет, продукты питания, маркет, гипермаркет, grocery',
      },
      {
        templateKey: 'expense-cafes',
        name: 'Кафе и рестораны',
        icon: 'utensils',
        comment: 'кафе, ресторан, обед, ужин, cafe',
      },
      {
        templateKey: 'expense-food-delivery',
        name: 'Доставка еды',
        icon: 'truck',
        comment: 'доставка, еда, самокат, delivery',
      },
      {
        templateKey: 'expense-alcohol',
        name: 'Алкоголь',
        icon: 'wine',
        comment: 'алкоголь, вино, пиво, крепкое',
      },
    ],
  },
  {
    templateKey: 'expense-group-transport',
    name: 'Транспорт',
    children: [
      {
        templateKey: 'expense-taxi',
        name: 'Такси',
        icon: 'car',
        comment: 'такси, uber, yandex go',
      },
      {
        templateKey: 'expense-fuel',
        name: 'Бензин',
        icon: 'fuel',
        comment: 'бензин, заправка, дизель, азс',
      },
      {
        templateKey: 'expense-parking',
        name: 'Парковка',
        icon: 'square-parking',
        comment: 'парковка, паркинг, стоянка',
      },
      {
        templateKey: 'expense-car-service',
        name: 'Автосервис',
        icon: 'wrench',
        comment: 'автозапчасти, ремонт авто, шиномонтаж, замена масла, то',
      },
    ],
  },
  {
    templateKey: 'expense-group-health',
    name: 'Здоровье',
    children: [
      {
        templateKey: 'expense-clinic',
        name: 'Клиника',
        icon: 'stethoscope',
        comment: 'клиника, поликлиника',
      },
      {
        templateKey: 'expense-pharmacy',
        name: 'Аптека',
        icon: 'pill',
        comment: 'аптека, лекарства, таблетки, медикаменты',
      },
      {
        templateKey: 'expense-dental',
        name: 'Стоматология',
        icon: 'syringe',
        comment: 'стоматолог, зубы, dental',
      },
      {
        templateKey: 'expense-beauty',
        name: 'Красота',
        icon: 'heart-pulse',
        comment: 'красота, спа, парикмахерская, косметика, ногти, массаж',
      },
      {
        templateKey: 'expense-sport',
        name: 'Спорт и фитнес',
        icon: 'dumbbell',
        comment: 'спорт, фитнес, спортзал, зал, бассейн',
      },
    ],
  },
  {
    templateKey: 'expense-group-shopping',
    name: 'Покупки',
    children: [
      {
        templateKey: 'expense-clothes',
        name: 'Одежда',
        icon: 'shirt',
        comment: 'одежда, обувь, платье, clothes, shoes',
      },
      {
        templateKey: 'expense-marketplaces',
        name: 'Маркетплейсы',
        icon: 'package',
        comment: 'маркетплейсы, вайлдберриз, озон, алиэкспресс, wildberries',
      },
      {
        templateKey: 'expense-electronics',
        name: 'Электроника',
        icon: 'smartphone',
        comment: 'электроника, техника, телефон, ноутбук, компьютер, gadgets',
      },
    ],
  },
  {
    templateKey: 'expense-group-entertainment',
    name: 'Развлечения',
    children: [
      {
        templateKey: 'expense-leisure',
        name: 'Досуг',
        icon: 'ticket',
        comment: 'кино, боулинг, парк',
      },
      {
        templateKey: 'expense-children-leisure',
        name: 'Досуг детей',
        icon: 'palette',
        comment: 'игровые, аттракционы',
      },
      {
        templateKey: 'expense-subscriptions',
        name: 'Подписки',
        icon: 'repeat',
        comment: 'netflix, spotify, youtube, кинопоиск, подписка',
      },
      {
        templateKey: 'expense-travel',
        name: 'Путешествия',
        icon: 'plane',
        comment: 'путешествия, отпуск, отель, тур, поездка, авиабилеты, travel',
      },
      { templateKey: 'expense-gifts', name: 'Подарки', icon: 'gift', comment: 'подарки, сюрприз' },
    ],
  },
  {
    templateKey: 'expense-group-kids',
    name: 'Дети',
    children: [
      {
        templateKey: 'expense-kindergarten',
        name: 'Детский сад',
        icon: 'baby',
        comment: 'детский сад, ясли, дошкольное',
      },
      {
        templateKey: 'expense-school',
        name: 'Школа',
        icon: 'school',
        comment: 'школа, учебники, форма, канцелярия',
      },
      {
        templateKey: 'expense-activities',
        name: 'Секции и кружки',
        icon: 'volleyball',
        comment: 'секции, кружки, репетитор',
      },
    ],
  },
  {
    templateKey: 'expense-group-home',
    name: 'Дом',
    children: [
      {
        templateKey: 'expense-household',
        name: 'Хозтовары',
        icon: 'sparkles',
        comment: 'хозтовары, посуда, мебель, интерьер',
      },
      {
        templateKey: 'expense-repair',
        name: 'Ремонт',
        icon: 'hammer',
        comment: 'ремонт, стройка, инструменты, отделка',
      },
      {
        templateKey: 'expense-pets',
        name: 'Питомцы',
        icon: 'paw-print',
        comment: 'питомцы, животные, собака, кошка, ветеринар',
      },
      {
        templateKey: 'expense-cleaning-supplies',
        name: 'Бытовая химия',
        icon: 'spray-can',
        comment: 'бытовая химия, чистящие средства, порошок',
      },
    ],
  },
];

const EXPENSE_STANDALONE_CATEGORIES: readonly CategoryLeaf[] = [
  { templateKey: 'expense-other', name: 'Прочее', icon: 'ellipsis' },
];

function buildDefaultCategories(): DefaultCategory[] {
  const rows: DefaultCategory[] = [];
  let order = 0;
  const push = (
    templateKey: string,
    name: string,
    categoryType: CategoryType,
    parentTemplateKey: string | null,
    comment: string | null,
    icon: string | null,
  ) => {
    rows.push({
      templateKey,
      name,
      categoryType,
      parentTemplateKey,
      comment,
      icon,
      displayOrder: order++,
    });
  };
  for (const group of INCOME_CATEGORY_GROUPS) {
    push(group.templateKey, group.name, CategoryType.INCOME, null, null, null);
    for (const leaf of group.children) {
      push(
        leaf.templateKey,
        leaf.name,
        CategoryType.INCOME,
        group.templateKey,
        leaf.comment ?? null,
        leaf.icon,
      );
    }
  }
  for (const group of EXPENSE_CATEGORY_GROUPS) {
    push(group.templateKey, group.name, CategoryType.EXPENSE, null, null, null);
    for (const leaf of group.children) {
      push(
        leaf.templateKey,
        leaf.name,
        CategoryType.EXPENSE,
        group.templateKey,
        leaf.comment ?? null,
        leaf.icon,
      );
    }
  }
  for (const leaf of EXPENSE_STANDALONE_CATEGORIES) {
    push(leaf.templateKey, leaf.name, CategoryType.EXPENSE, null, leaf.comment ?? null, leaf.icon);
  }
  return rows;
}

export const DEFAULT_CATEGORIES: readonly DefaultCategory[] = buildDefaultCategories();
