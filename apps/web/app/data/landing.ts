export interface LandingBudgetSnapshot {
  dateLabel: string;
  periodLabel: string;
  daysLeft: number;
  availableMinor: string;
  periodLimitMinor: string;
  spentMinor: string;
  dailyAverageMinor: string;
}

export interface LandingEnvelope {
  name: string;
  amountMinor: string;
  tone: 'brand' | 'primary' | 'warning' | 'neutral';
}

export interface LandingAllocation {
  name: string;
  amountMinor: string;
}

export interface LandingGoal {
  name: string;
  savedMinor: string;
  targetMinor: string;
}

export interface LandingPlan {
  dateLabel: string;
  name: string;
  amountMinor: string;
}

export interface LandingCategoryShare {
  name: string;
  share: number;
}

export interface LandingCashFlowPoint {
  label: string;
  incomeMinor: string;
  expenseMinor: string;
}

export interface LandingStep {
  index: string;
  title: string;
  caption: string;
}

export interface LandingFaqItem {
  id: string;
  question: string;
  answer: string;
}

export interface LandingTextCard {
  title: string;
  text: string;
}

export const heroBudget: LandingBudgetSnapshot = {
  dateLabel: 'Сегодня, 13 сентября',
  periodLabel: 'Период 25.09 – 09.10',
  daysLeft: 7,
  availableMinor: '2180000',
  periodLimitMinor: '6300000',
  spentMinor: '4120000',
  dailyAverageMinor: '311400',
};

export const heroEnvelopes: LandingEnvelope[] = [
  { name: 'Обязательные', amountMinor: '5200000', tone: 'primary' },
  { name: 'Ремонт', amountMinor: '7000000', tone: 'warning' },
  { name: 'Автомобиль', amountMinor: '800000', tone: 'neutral' },
  { name: 'Свободные', amountMinor: '2180000', tone: 'brand' },
];

export const heroTrustPoints: string[] = [
  'Без сложных таблиц',
  'Адаптивный интерфейс',
  'Без банковской привязки на старте',
];

export const problemCards: LandingTextCard[] = [
  {
    title: 'На карте 120 000 ₽',
    text: 'Но часть этих денег уже нужна для ипотеки, ремонта и других обязательных платежей.',
  },
  {
    title: 'До следующей выплаты ещё несколько дней',
    text: 'Сколько можно потратить сегодня, чтобы не остаться без денег позже?',
  },
  {
    title: 'Вы откладывали на ремонт',
    text: 'Но накопления и повседневные деньги смешались в одном остатке.',
  },
];

export const conceptAccounts: string[] = ['Карта', 'Счёт', 'Наличные'];

export const conceptEnvelopes: string[] = [
  'Ремонт',
  'Автомобиль',
  'Текущие',
  'Обязательные',
  'Свободные',
];

export const cycleMilestones: { dateLabel: string; caption: string }[] = [
  { dateLabel: '10 сентября', caption: 'Новый цикл' },
  { dateLabel: '25 сентября', caption: 'Следующая выплата' },
  { dateLabel: '9 октября', caption: 'Граница периода' },
  { dateLabel: '10 октября', caption: 'Новый цикл' },
];

export const cyclePeriods: { label: string; range: string }[] = [
  { label: 'Период 1', range: '10.09 – 24.09' },
  { label: 'Период 2', range: '25.09 – 09.10' },
];

export const availableExplainers: LandingTextCard[] = [
  {
    title: 'Считаем по фактическим операциям',
    text: 'В расчёт идут подтверждённые доходы и расходы, а не ожидаемая сумма будущей выплаты.',
  },
  {
    title: 'Вычитаем то, что уже обещано',
    text: 'Обязательные платежи и накопления остаются зарезервированными и не попадают в доступный остаток.',
  },
  {
    title: 'Считаем до границы периода',
    text: 'Остаток и дневной ориентир рассчитаны до конца текущего периода, а не до конца календарного месяца.',
  },
];

export const allocationExplainers: LandingTextCard[] = [
  {
    title: 'Доход остаётся одним',
    text: 'Распределение не создаёт новых поступлений и не удваивает сумму в отчётах.',
  },
  {
    title: 'Распределений может быть несколько',
    text: 'Обязательные платежи, текущие расходы и накопления получают свою часть за одно действие.',
  },
  {
    title: 'Нераспределённое видно сразу',
    text: 'Понятно, какая часть поступления ещё ждёт распределения.',
  },
];

export const allocationData: {
  incomeName: string;
  incomeMinor: string;
  allocations: LandingAllocation[];
} = {
  incomeName: 'Зарплата',
  incomeMinor: '10600000',
  allocations: [
    { name: 'Обязательные', amountMinor: '5000000' },
    { name: 'Текущие расходы', amountMinor: '3600000' },
    { name: 'Ремонт', amountMinor: '2000000' },
  ],
};

export const goalData: LandingGoal[] = [
  { name: 'Ремонт', savedMinor: '7000000', targetMinor: '12000000' },
  { name: 'Автомобиль', savedMinor: '1800000', targetMinor: '3000000' },
  { name: 'Отпуск', savedMinor: '4200000', targetMinor: '10000000' },
];

export const upcomingPlans: { items: LandingPlan[]; reservedMinor: string } = {
  items: [
    { dateLabel: '20 сентября', name: 'Подписки', amountMinor: '300000' },
    { dateLabel: '25 сентября', name: 'Секции', amountMinor: '600000' },
    { dateLabel: '26 сентября', name: 'Ипотека', amountMinor: '3600000' },
    { dateLabel: '01 октября', name: 'Детский сад', amountMinor: '300000' },
  ],
  reservedMinor: '5200000',
};

export const analyticsData: {
  categories: LandingCategoryShare[];
  cashFlow: LandingCashFlowPoint[];
  planVsFact: { label: string; planMinor: string; factMinor: string }[];
} = {
  categories: [
    { name: 'Продукты', share: 24 },
    { name: 'Жильё', share: 21 },
    { name: 'Дети', share: 14 },
    { name: 'Автомобиль', share: 10 },
    { name: 'Досуг', share: 8 },
    { name: 'Прочее', share: 23 },
  ],
  cashFlow: [
    { label: 'Апр', incomeMinor: '10200000', expenseMinor: '8900000' },
    { label: 'Май', incomeMinor: '9800000', expenseMinor: '9100000' },
    { label: 'Июн', incomeMinor: '10600000', expenseMinor: '8700000' },
    { label: 'Июл', incomeMinor: '11200000', expenseMinor: '9600000' },
    { label: 'Авг', incomeMinor: '9900000', expenseMinor: '9400000' },
    { label: 'Сен', incomeMinor: '10600000', expenseMinor: '8200000' },
  ],
  planVsFact: [
    { label: 'Обязательные', planMinor: '5000000', factMinor: '5200000' },
    { label: 'Текущие', planMinor: '3600000', factMinor: '3300000' },
    { label: 'Накопления', planMinor: '2000000', factMinor: '2000000' },
  ],
};

export const howItWorksSteps: LandingStep[] = [
  { index: '01', title: 'Получили зарплату', caption: '+106 000 ₽' },
  { index: '02', title: 'Распределили', caption: 'Обязательные, текущие, ремонт' },
  { index: '03', title: 'Оплатили покупку', caption: '−2 450 ₽, продукты' },
  { index: '04', title: 'Узнали остаток', caption: 'Можно потратить 21 800 ₽' },
  { index: '05', title: 'Накопления продолжают расти', caption: 'Ремонт 70 000 ₽' },
];

export const audienceCards: LandingTextCard[] = [
  {
    title: 'Семья',
    text: 'Общие расходы, обязательные платежи и цели в одной финансовой системе.',
  },
  { title: 'Пара', text: 'Понятная финансовая картина без необходимости вести несколько таблиц.' },
  { title: 'Один человек', text: 'Бюджет под ваши выплаты, цели и реальные финансовые привычки.' },
];

export const securityCards: LandingTextCard[] = [
  {
    title: 'Защищённый доступ',
    text: 'Авторизация, восстановление пароля и управление активными сессиями.',
  },
  {
    title: 'Изоляция бюджета',
    text: 'Данные бюджетов изолированы и недоступны другим пользователям.',
  },
  { title: 'История изменений', text: 'Изменения финансовых данных сохраняются в журнале.' },
];

export const faqItems: LandingFaqItem[] = [
  {
    id: 'what-is',
    question: 'Что такое HarmoFin?',
    answer:
      'HarmoFin — веб-приложение для управления личным и семейным бюджетом, которое связывает фактические движения денег по счетам с их назначением в конвертах и категориями расходов.',
  },
  {
    id: 'difference',
    question: 'Чем HarmoFin отличается от обычного учёта расходов?',
    answer:
      'Он показывает не только баланс счетов, но и назначение денег и доступную сумму до следующей границы финансового периода.',
  },
  {
    id: 'stable-income',
    question: 'Нужно ли получать одинаковую зарплату каждый месяц?',
    answer: 'Нет. HarmoFin работает с фактически полученной суммой.',
  },
  {
    id: 'goals',
    question: 'Можно ли копить на отдельные цели?',
    answer: 'Да. Для этого используются конверты для накоплений.',
  },
  {
    id: 'bank-sync',
    question: 'Есть ли банковская синхронизация?',
    answer: 'Пока нет. Банковские интеграции появятся на следующих этапах.',
  },
  {
    id: 'mobile',
    question: 'Можно ли пользоваться с телефона?',
    answer: 'Да. Интерфейс адаптируется под смартфоны и планшеты.',
  },
];

export const landingNavLinks: { href: string; label: string }[] = [
  { href: '#features', label: 'Возможности' },
  { href: '#how-it-works', label: 'Как это работает' },
  { href: '#security', label: 'Безопасность' },
  { href: '#faq', label: 'FAQ' },
];

export const footerProductLinks: { href: string; label: string }[] = [
  { href: '#features', label: 'Возможности' },
  { href: '#how-it-works', label: 'Как это работает' },
  { href: '#security', label: 'Безопасность' },
  { href: '#faq', label: 'FAQ' },
];

// TODO: these become real links (with `href`) once /privacy, /terms and /contacts pages exist.
// Until then LandingFooter renders them as plain, non-interactive text.
export const footerInfoLinks: { label: string }[] = [
  { label: 'Политика конфиденциальности' },
  { label: 'Пользовательское соглашение' },
  { label: 'Контакты' },
];
