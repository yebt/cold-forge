/** API base URL, from `VITE_API_URL` at build time. The API client refuses non-https URLs (except localhost). */
export const API_URL: string = import.meta.env.VITE_API_URL || "http://localhost:3001";
