export const registerTicketsRateLimits = {
  ingress: {
    scope: "edge-ingress:register-tickets:1m",
    limit: 300,
    windowSeconds: 60,
  },
  registration: {
    scope: "register-tickets:10m",
    windowSeconds: 600,
  },
} as const;

export const accountRateLimits = {
  deletion: {
    scope: "accounts:delete:1h",
    limit: 5,
    windowSeconds: 3_600,
  },
} as const;
