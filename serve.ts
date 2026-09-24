const root = `${import.meta.dir}/dist`;

const server = Bun.serve({
  port: Number(Bun.env.PORT ?? 4321),
  async fetch(req) {
    let path = decodeURIComponent(new URL(req.url).pathname);
    if (path.endsWith("/")) path += "index.html";
    const file = Bun.file(root + path);
    if (!(await file.exists())) return new Response("Not found", { status: 404 });
    const headers: Record<string, string> = path.startsWith("/dinos/") ? { "Cache-Control": "public, max-age=31536000, immutable" } : {};
    return new Response(file, { headers });
  },
});
console.log(`We're ALIVE at ${server.url}!`);
