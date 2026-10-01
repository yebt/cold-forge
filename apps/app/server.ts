import index from "./src/index.html";

const API_URL = process.env.API_URL ?? "http://localhost:3001";

/** Serves the React app and proxies `/api/*` to the API so the browser only talks to one origin. */
const server = Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  development: process.env.NODE_ENV !== "production",
  routes: {
    "/api/*": (req) => {
      const url = new URL(req.url);
      return fetch(new URL(url.pathname + url.search, API_URL), {
        method: req.method,
        headers: req.headers,
        body: req.body,
      });
    },
    "/*": index,
  },
});

console.log(`❄️ COLD FORGE web en ${server.url} (API → ${API_URL})`);
