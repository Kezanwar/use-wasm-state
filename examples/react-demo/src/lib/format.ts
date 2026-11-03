const money = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const date = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "2-digit",
});

const count = new Intl.NumberFormat();

export const formatPrice = (value: number) => money.format(value);

/** The created column is days since epoch, which is four bytes a row. */
export const formatDate = (days: number) => date.format(days * 86_400_000);

export const formatCount = (value: number) => count.format(value);

export const formatMs = (ms: number) => (ms < 10 ? `${ms.toFixed(1)}ms` : `${Math.round(ms)}ms`);
