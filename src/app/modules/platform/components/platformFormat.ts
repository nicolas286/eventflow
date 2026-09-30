export function formatMoney(cents: number, currency = "EUR") {
  return new Intl.NumberFormat("fr-BE", { style: "currency", currency }).format(cents / 100);
}

export function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("fr-BE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "—";
}
