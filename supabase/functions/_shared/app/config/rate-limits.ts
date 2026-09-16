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
