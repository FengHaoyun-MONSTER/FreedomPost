export function formatCommissionEarnings(commissionCents: number, currency: string): string {
  const normalizedCurrency = currency.trim().toUpperCase() || "CNY";
  if (normalizedCurrency === "CNY") {
    const amount = new Intl.NumberFormat("zh-CN", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(commissionCents / 100);
    return `${amount}元`;
  }

  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: normalizedCurrency,
    minimumFractionDigits: 2
  }).format(commissionCents / 100);
}
