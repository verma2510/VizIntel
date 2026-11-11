export const API_URL: string = import.meta.env.VITE_API_URL ?? "";

export const authHeaders = (token: string | null): Record<string, string> =>
  token ? { Authorization: `Bearer ${token}` } : {};
