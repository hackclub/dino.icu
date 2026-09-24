// disclosure: this build script is mostly claude-slop, but it's GOOD claude-slop
import { $ } from "bun";
import { mkdir, readdir, rm, cp } from "node:fs/promises";
import { availableParallelism } from "node:os";
import sharp from "sharp";

const REPO = "https://github.com/hackclub/dinosaurs";
const CACHE = "node_modules/.cache/dino-wall";
const REPO_DIR = `${CACHE}/repo`;
const AVIF_DIR = `${CACHE}/avif`;
const META_FILE = `${CACHE}/meta.json`;
const DIST = "dist";
const MAX_WIDTH = 640;
const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp)$/i;

type Look = { mono: boolean; bg: string };
type Meta = { w: number; h: number } & Partial<Look>;
type Dino = { id: string; name: string; path: string; w: number; h: number } & Look;

async function syncRepo() {
  if (await Bun.file(`${REPO_DIR}/.git/HEAD`).exists()) {
    await $`git -C ${REPO_DIR} fetch --depth 1 -q origin HEAD`;
    await $`git -C ${REPO_DIR} reset --hard -q FETCH_HEAD`;
  } else {
    await $`git clone --depth 1 -q ${REPO} ${REPO_DIR}`;
  }
}

// use the image SHA as the cache key
async function listImages() {
  const out = await $`git -C ${REPO_DIR} ls-tree -r -z HEAD`.text();
  return out
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const [info, path] = line.split("\t") as [string, string];
      return { sha: info.split(" ")[2]!, path };
    })
    .filter((f) => IMAGE_EXT.test(f.path));
}

function prettyName(path: string) {
  return path
    .split("/")
    .pop()!
    .replace(IMAGE_EXT, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SAMPLE = 32;
const hex = (n: number) => n.toString(16).padStart(2, "0");

// - mono: black and white, so give it a random background colour
// - bg: use the most common edge colour for the card
async function analyze(src: string): Promise<Look> {
  const { data } = await sharp(src, { density: src.toLowerCase().endsWith(".svg") ? 72 : undefined })
    .flatten({ background: "#fff" })
    .resize(SAMPLE, SAMPLE, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let colourful = 0;
  const edge = new Map<string, { n: number; r: number; g: number; b: number }>();
  // i totally know what's going on here
  for (let i = 0; i < data.length; i += 3) {
    const r = data[i]!, g = data[i + 1]!, b = data[i + 2]!;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 40) colourful++;
    const x = (i / 3) % SAMPLE, y = Math.floor(i / 3 / SAMPLE);
    if (x === 0 || y === 0 || x === SAMPLE - 1 || y === SAMPLE - 1) {
      const key = `${r >> 4},${g >> 4},${b >> 4}`;
      const e = edge.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
      edge.set(key, { n: e.n + 1, r: e.r + r, g: e.g + g, b: e.b + b });
    }
  }
  const top = [...edge.values()].reduce((a, b) => (b.n > a.n ? b : a));
  const bg = `#${hex(Math.round(top.r / top.n))}${hex(Math.round(top.g / top.n))}${hex(Math.round(top.b / top.n))}`;
  return { mono: colourful / (data.length / 3) < 0.01, bg };
}

async function convert(src: string, dest: string): Promise<Meta> {
  const isSvg = src.toLowerCase().endsWith(".svg");
  const isGif = src.toLowerCase().endsWith(".gif");
  const img = sharp(src, {
    animated: isGif,
    density: isSvg ? 300 : undefined,
    limitInputPixels: false,
  });
  const info = await img
    .resize({ width: MAX_WIDTH, withoutEnlargement: !isSvg })
    .avif({ quality: 55, effort: 4 })
    .toFile(dest);
  // for animated images, sharp reports the full sprite height, so use pageHeight
  return { w: info.width, h: (info as { pageHeight?: number }).pageHeight ?? info.height, ...(await analyze(src)) };
}

async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      while (i < items.length) await fn(items[i++]!);
    }),
  );
}

console.time("build");
await mkdir(AVIF_DIR, { recursive: true });
await syncRepo();

const files = await listImages();
const metaFile = Bun.file(META_FILE);
const meta: Record<string, Meta> = (await metaFile.exists()) ? await metaFile.json() : {};
const todo = files.filter((f) => meta[f.sha]?.bg === undefined);
console.log(`${files.length} dinos, ${files.length - todo.length} cached, ${todo.length} to convert`);

let done = 0;
const failed: string[] = [];
await pool(todo, Math.max(2, availableParallelism() / 2), async (f) => {
  try {
    const src = `${REPO_DIR}/${f.path}`;
    const cached = meta[f.sha];
    meta[f.sha] = cached ? { ...cached, ...(await analyze(src)) } : await convert(src, `${AVIF_DIR}/${f.sha}.avif`);
  } catch (err) {
    failed.push(`${f.path}: ${(err as Error).message}`);
  }
  if (++done % 50 === 0) {
    console.log(`  ${done}/${todo.length}`);
    await Bun.write(META_FILE, JSON.stringify(meta));
  }
});
await Bun.write(META_FILE, JSON.stringify(meta));
if (failed.length) console.warn(`Skipped ${failed.length}:\n  ${failed.join("\n  ")}`);

// get rid of the cache entries for dinos which were removed or changed upstream
const live = new Set(files.map((f) => f.sha));
for (const name of await readdir(AVIF_DIR)) {
  const sha = name.replace(".avif", "");
  if (!live.has(sha)) {
    await rm(`${AVIF_DIR}/${name}`);
    delete meta[sha];
  }
}
await Bun.write(META_FILE, JSON.stringify(meta));

// identical files share a blob SHA, so this also drops exact duplicates
const seen = new Set<string>();
const dinos: Dino[] = files
  .filter((f) => meta[f.sha] && !seen.has(f.sha) && seen.add(f.sha))
  .map((f) => ({ id: f.sha, name: prettyName(f.path), path: f.path, ...(meta[f.sha] as Meta & Look) }));

await rm(DIST, { recursive: true, force: true });
const result = await Bun.build({ entrypoints: ["./src/index.html"], outdir: DIST, minify: true });
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
await cp(AVIF_DIR, `${DIST}/dinos`, { recursive: true });
await cp("src/sw.js", `${DIST}/sw.js`);
await Bun.write(`${DIST}/dinos.json`, JSON.stringify(dinos));
console.log(`Wrote ${dinos.length} dinos to ${DIST}/`);
console.timeEnd("build");
