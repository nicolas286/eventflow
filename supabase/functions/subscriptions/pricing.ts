type Plan = "starter" | "pro";

export function planToPricing(plan: Plan) {
  if (plan === "starter") {
    return {
      value: "15.99",
      currency: "EUR",
      interval: "1 month",
    };
  }

  return {
    value: "25.99",
    currency: "EUR",
    interval: "1 month",
  };
}

function parseCsvEnv(name: string) {
  return (Deno.env.get(name) ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function getEarlyAdopterConfig() {
  const active =
    String(Deno.env.get("EARLY_ADOPTER_ACTIVE") ?? "").trim().toLowerCase() ===
      "true";

  const code = String(Deno.env.get("EARLY_ADOPTER_CODE") ?? "").trim()
    .toUpperCase();

  const percentRaw = Number(Deno.env.get("EARLY_ADOPTER_PERCENT") ?? "0");
  const percent = Number.isFinite(percentRaw)
    ? Math.max(0, Math.min(100, Math.trunc(percentRaw)))
    : 0;

  const allowedPlans = parseCsvEnv("EARLY_ADOPTER_ALLOWED_PLANS");

  return {
    active,
    code,
    percent,
    allowedPlans,
  };
}

export function resolvePromo(params: {
  promoCode: string | null | undefined;
  plan: Plan;
}) {
  const cfg = getEarlyAdopterConfig();

  if (!cfg.active || !params.promoCode || !cfg.code) {
    return {
      applied: false,
      promoCode: null,
      discountPercent: 0,
    };
  }

  if (params.promoCode !== cfg.code) {
    return {
      applied: false,
      promoCode: null,
      discountPercent: 0,
    };
  }

  if (cfg.allowedPlans.length > 0 && !cfg.allowedPlans.includes(params.plan)) {
    return {
      applied: false,
      promoCode: null,
      discountPercent: 0,
    };
  }

  return {
    applied: true,
    promoCode: cfg.code,
    discountPercent: cfg.percent,
  };
}

export function applyDiscount(
  pricing: ReturnType<typeof planToPricing>,
  discountPercent: number,
) {
  if (!discountPercent || discountPercent <= 0) return pricing;

  const base = Number(pricing.value);
  const finalValue = Math.max(0, base * (1 - discountPercent / 100));

  return {
    ...pricing,
    value: finalValue.toFixed(2),
  };
}

export function resolvePricing(params: {
  plan: Plan;
  promoCode: string | null | undefined;
  current: {
    status?: string | null;
    billing_price_value?: string | null;
    billing_currency?: string | null;
    discount_percent?: number | null;
    promo_code?: string | null;
  } | null;
}) {
  const currentStatus = String(params.current?.status ?? "").trim()
    .toLowerCase();
  const storedValue = params.current?.billing_price_value?.trim();
  const storedCurrency = params.current?.billing_currency?.trim() || "EUR";
  const storedDiscount = Number(params.current?.discount_percent ?? 0);

  const shouldReuseStoredPricing = currentStatus === "active" &&
    Boolean(storedValue);

  if (shouldReuseStoredPricing && storedValue) {
    return {
      pricing: {
        value: storedValue,
        currency: storedCurrency,
        interval: "1 month",
      },
      promo: {
        applied: storedDiscount > 0,
        promoCode: params.current?.promo_code ?? null,
        discountPercent: storedDiscount,
      },
      reusedStoredPricing: true,
    };
  }

  const basePricing = planToPricing(params.plan);
  const promo = resolvePromo({
    promoCode: params.promoCode,
    plan: params.plan,
  });

  const pricing = applyDiscount(basePricing, promo.discountPercent);

  return {
    pricing,
    promo,
    reusedStoredPricing: false,
  };
}
