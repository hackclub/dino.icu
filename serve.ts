import { resolve, sep } from "node:path";

const root = resolve(import.meta.dir, "dist");

const server = Bun.serve({
  port: Number(Bun.env.PORT ?? 4321),
  async fetch(req) {
    let path: string;
    try {
      path = decodeURIComponent(new URL(req.url).pathname);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    if (path.endsWith("/")) path += "index.html";
    const full = resolve(root, `.${path}`);
    if (!full.startsWith(root + sep)) return new Response("Not found", { status: 404 });
    const file = Bun.file(full);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    const headers: Record<string, string> = path.startsWith("/dinos/")
      ? { "Cache-Control": "public, max-age=31536000, immutable" }
      : { "Cache-Control": "no-cache" };
    return new Response(file, { headers });
  },
});
console.log(`We're ALIVE at ${server.url}!`);
