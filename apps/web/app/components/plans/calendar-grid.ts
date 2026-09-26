import { addDays, format, startOfMonth, startOfWeek } from 'date-fns';

export interface CalendarCell {
  date: string;
  inCurrentMonth: boolean;
}

export function buildCalendarGrid(monthAnchor: string): CalendarCell[] {
  const month = startOfMonth(parsePlainDate(monthAnchor));
  const gridStart = startOfWeek(month, { weekStartsOn: 1 });

  return Array.from({ length: 42 }, (_, index) => {
    const day = addDays(gridStart, index);
    return {
      date: format(day, 'yyyy-MM-dd'),
      inCurrentMonth: day.getMonth() === month.getMonth(),
    };
  });
}

function parsePlainDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(year as number, (month as number) - 1, day as number);
}
