import { createRoutes } from "./app.ts";
import { Store } from "./store.ts";

const store = new Store(process.env.DATABASE_PATH ?? "cold-forge.sqlite");

const server = Bun.serve({
  port: Number(process.env.PORT ?? 3001),
  routes: createRoutes(store),
  fetch: () => Response.json({ error: "not found" }, { status: 404 }),
});

console.log(`🧊 COLD FORGE API escuchando en ${server.url}`);
