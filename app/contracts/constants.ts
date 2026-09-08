export const Session = {
  cookieName: "ontos_session",
  prodCookieName: "__Host-ontos_session",
  maxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
} as const;

export const ErrorMessages = {
  unauthenticated: "Authentication required",
  insufficientRole: "Insufficient permissions",
} as const;

export const Paths = {
  login: "/login",
} as const;
