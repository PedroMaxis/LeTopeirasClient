const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const date = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});
const full = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full', timeStyle: 'short' });
const long = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long' });

const startOfDay = (ts: number) => new Date(ts).setHours(0, 0, 0, 0);

/** "Hoje às 21:02", "Ontem às 09:15" or "03/10/2026 21:02". */
export function formatTimestamp(ts: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / 86_400_000);
  if (days === 0) return `Hoje às ${time.format(ts)}`;
  if (days === 1) return `Ontem às ${time.format(ts)}`;
  return `${date.format(ts)} ${time.format(ts)}`;
}

/** "Hoje", "Ontem" or "8 de outubro de 2026", for the divider between days. */
export function formatDay(ts: number, now = Date.now()): string {
  const days = Math.round((startOfDay(now) - startOfDay(ts)) / 86_400_000);
  if (days === 0) return 'Hoje';
  if (days === 1) return 'Ontem';
  return long.format(ts);
}

export const sameDay = (a: number, b: number) => startOfDay(a) === startOfDay(b);

export const formatTime = (ts: number) => time.format(ts);
export const formatFull = (ts: number) => full.format(ts);
