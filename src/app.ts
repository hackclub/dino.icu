type Dino = { id: string; name: string; path: string; w: number; h: number; mono: boolean; bg: string };

const BATCH = 30;
const MIN_COL_WIDTH = 240;
const REPO_BLOB = "https://github.com/hackclub/dinosaurs/blob/main/";
// the site looks insanely boring without this because 99% of the dinos only use black and white :(
// so, we add some COLOUR :)
const PALETTE = [
  "#ffd43b", "#ff8a65", "#69db7c", "#4dabf7", "#f783ac",
  "#b197fc", "#ffa94d", "#38d9a9", "#e599f7", "#a9e34b",
];

const grid = document.getElementById("grid")!;
const sentinel = document.getElementById("sentinel")!;

let dinos: Dino[] = [];
let tiles: { el: HTMLElement; ratio: number }[] = [];
let cols: { el: HTMLElement; height: number }[] = [];
let rendered = 0;
let lastColour = "";

function isDark(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r! + 0.587 * g! + 0.114 * b! < 140;
}

function randomColour() {
  let c;
  do c = PALETTE[Math.floor(Math.random() * PALETTE.length)]!;
  while (c === lastColour);
  return (lastColour = c);
}

function shuffle<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j]!, arr[i]!];
  }
  return arr;
}

function makeTile(d: Dino) {
  const a = document.createElement("a");
  a.className = "dino";
  // every card takes its image's paper colour, so the drawing reads as frameless :)
  if (d.mono) a.classList.add("mono");
  const paper = d.mono ? randomColour() : d.bg;
  a.style.setProperty("--paper", paper);
  if (isDark(paper)) a.classList.add("dark");
  a.href = REPO_BLOB + d.path.split("/").map(encodeURIComponent).join("/");
  a.target = "_blank";
  a.rel = "noopener";
  const img = document.createElement("img");
  img.src = `./dinos/${d.id}.avif`;
  img.alt = d.name;
  img.loading = "lazy";
  img.decoding = "async";
  img.width = d.w;
  img.height = d.h;
  const label = document.createElement("span");
  label.textContent = d.name;
  a.append(img, label);
  return a;
}

function place(tile: { el: HTMLElement; ratio: number }) {
  const col = cols.reduce((a, b) => (b.height < a.height ? b : a));
  col.el.append(tile.el);
  col.height += tile.ratio + 0.15; // rough allowance for padding + label
}

function layout() {
  const n = Math.max(2, Math.floor(grid.clientWidth / MIN_COL_WIDTH));
  if (n === cols.length) return;
  grid.replaceChildren();
  cols = Array.from({ length: n }, () => {
    const el = document.createElement("div");
    el.className = "col";
    grid.append(el);
    return { el, height: 0 };
  });
  tiles.forEach(place);
}

function renderMore() {
  const next = dinos.slice(rendered, rendered + BATCH);
  for (const d of next) {
    const tile = { el: makeTile(d), ratio: d.h / d.w };
    tiles.push(tile);
    place(tile);
  }
  rendered += next.length;
  if (rendered >= dinos.length) observer.disconnect();
}

const LOOKAHEAD = 1500;

function fill() {
  while (rendered < dinos.length && sentinel.getBoundingClientRect().top < innerHeight + LOOKAHEAD) {
    renderMore();
  }
}

const observer = new IntersectionObserver(
  (entries) => {
    if (entries.some((e) => e.isIntersecting)) fill();
  },
  { rootMargin: `${LOOKAHEAD}px 0px` },
);

let resizeFrame = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => {
    layout();
    fill();
  });
});

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {});
}

dinos = shuffle(JSON.parse(document.getElementById("dinos")!.textContent!));
layout();
fill();
observer.observe(sentinel);
