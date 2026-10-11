// HTTP server: JSON API under /api, recipe images under /images, the PWA from ./web.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, writeFile, mkdir, unlink, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { Store, type RecipeInput, type Settings } from "./db.ts";
import { formatIngredientsText, parseIngredientsText, type Ingredient } from "./ingredients.ts";
import { absoluteUrl, extractRecipe, fetchPage, pageText, readLimited, type RecipeDraft } from "./scrape.ts";
import { AiError, aiEnabled, recipeFromImages, recipeFromText, recipeFromUrl, type ImageInput } from "./ai.ts";
import { BringError, bring, bringEnabled } from "./bring.ts";
import { addDays, isDate, shoppingForWeek, today, weekStart } from "./planner.ts";

const PORT = Number(process.env.PORT ?? 8080);
const DATA_DIR = process.env.DATA_DIR ?? "/data";
const WEB_DIR = fileURLToPath(new URL("../web/", import.meta.url));
const IMAGE_DIR = join(DATA_DIR, "images");
const MAX_BODY = 40 * 1024 * 1024;

const store = new Store(DATA_DIR);

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// --- helpers ---

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, "Request too large");
    chunks.push(chunk);
  }
  if (size === 0) return {};
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(json);
}

const str = (v: unknown, max = 10_000): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const posInt = (v: unknown, fallback: number, max = 1000): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
};
const id = (v: string | undefined): number => {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, "Invalid id");
  return n;
};

function cleanIngredients(v: unknown): Ingredient[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((i): i is Record<string, unknown> => Boolean(i) && typeof i === "object")
    .map((i) => {
      const q = i.quantity === null || i.quantity === undefined || i.quantity === "" ? null : Number(i.quantity);
      const ing: Ingredient = { quantity: q !== null && Number.isFinite(q) && q > 0 ? q : null, unit: str(i.unit, 20), name: str(i.name, 200) };
      if (str(i.note, 200)) ing.note = str(i.note, 200);
      if (i.pantry) ing.pantry = true;
      return ing;
    })
    .filter((i) => i.name);
}

/** Accepts either structured fields or the editor's text fields (ingredientsText / stepsText). */
function recipeInput(body: Record<string, unknown>, existing?: RecipeInput): RecipeInput {
  const title = str(body.title, 300);
  if (!title) throw new HttpError(400, "Title is required");
  const ingredients =
    typeof body.ingredientsText === "string" ? parseIngredientsText(body.ingredientsText) : cleanIngredients(body.ingredients);
  const steps =
    typeof body.stepsText === "string"
      ? body.stepsText.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)
      : Array.isArray(body.steps)
        ? body.steps.map((s) => str(s, 5000)).filter(Boolean)
        : [];
  const tags = (Array.isArray(body.tags) ? body.tags : typeof body.tags === "string" ? body.tags.split(",") : [])
    .map((t) => str(t, 40).toLowerCase())
    .filter(Boolean)
    .slice(0, 20);
  const image = body.image === undefined ? existing?.image ?? null : str(body.image, 2000) || null;
  if (image && !/^(https?:\/\/|\/images\/)/.test(image)) throw new HttpError(400, "Invalid image URL");
  const sourceUrl = str(body.sourceUrl, 2000) || null;
  return {
    title,
    description: str(body.description, 2000),
    servings: posInt(body.servings, 2, 50),
    totalMinutes: body.totalMinutes === null || body.totalMinutes === "" || body.totalMinutes === undefined ? null : posInt(body.totalMinutes, 0, 2000) || null,
    image,
    sourceUrl: sourceUrl && /^https?:\/\//.test(sourceUrl) ? sourceUrl : null,
    sourceType: ["url", "photo", "text", "manual"].includes(String(body.sourceType)) ? String(body.sourceType) : existing?.sourceType ?? "manual",
    tags,
    ingredients,
    steps,
    notes: str(body.notes, 5000),
    favorite: body.favorite === undefined ? existing?.favorite ?? false : Boolean(body.favorite),
  };
}

function withText<T extends { ingredients: Ingredient[]; steps: string[] }>(r: T) {
  return { ...r, ingredientsText: formatIngredientsText(r.ingredients), stepsText: r.steps.join("\n\n") };
}

// --- images ---

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };

async function saveImage(recipeId: number, data: Buffer, mediaType: string): Promise<string> {
  const ext = IMAGE_TYPES[mediaType];
  if (!ext) throw new HttpError(400, "Unsupported image type");
  await mkdir(IMAGE_DIR, { recursive: true });
  const name = `${recipeId}-${Date.now()}${ext}`;
  await writeFile(join(IMAGE_DIR, name), data);
  return `/images/${name}`;
}

async function removeLocalImage(image: string | null): Promise<void> {
  if (!image?.startsWith("/images/")) return;
  await unlink(join(IMAGE_DIR, image.slice("/images/".length).replace(/[\\/]/g, ""))).catch(() => {});
}

/** Copy a remote image (e.g. HelloFresh CDN) locally so recipes keep their picture. Best effort. */
async function localizeImage(recipeId: number, url: string): Promise<void> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    const type = (res.headers.get("content-type") ?? "").split(";")[0];
    if (!res.ok || !IMAGE_TYPES[type]) return;
    const buf = await readLimited(res, 8 * 1024 * 1024);
    const current = store.getRecipe(recipeId);
    if (current?.image !== url) return;
    store.setRecipeImage(recipeId, await saveImage(recipeId, buf, type));
  } catch (err) {
    console.warn(`could not download image for recipe ${recipeId}:`, (err as Error).message);
  }
}

function parseImages(v: unknown): ImageInput[] {
  if (!Array.isArray(v) || v.length === 0) throw new HttpError(400, "No images provided");
  if (v.length > 8) throw new HttpError(400, "At most 8 photos per recipe");
  return v.map((img) => {
    const o = img as Record<string, unknown>;
    let data = str(o?.data, MAX_BODY);
    let mediaType = str(o?.mediaType, 40);
    const dataUrl = data.match(/^data:(image\/[a-z]+);base64,(.*)$/s);
    if (dataUrl) [, mediaType, data] = dataUrl;
    if (!IMAGE_TYPES[mediaType]) throw new HttpError(400, `Unsupported image type ${mediaType || "(none)"}`);
    if (!data) throw new HttpError(400, "Empty image");
    return { data, mediaType: mediaType as ImageInput["mediaType"] };
  });
}

// --- import ---

function extractUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"']+/);
  return m ? m[0].replace(/[.,;)]+$/, "") : null;
}

async function importFromUrl(url: string): Promise<RecipeDraft & { method: string }> {
  let html: string;
  try {
    html = await fetchPage(url);
  } catch (err) {
    if (aiEnabled()) return { ...(await recipeFromUrl(url)), method: "ai-fetch" };
    throw new HttpError(502, `${(err as Error).message}. The site may block automatic downloads; try the Text or Photos import.`);
  }
  const structured = extractRecipe(html, url);
  if (structured && structured.ingredients.length > 0) return { ...structured, method: "structured" };
  if (!aiEnabled()) {
    if (structured) return { ...structured, method: "structured" };
    throw new HttpError(422, "No recipe data found on that page (AI fallback is not configured).");
  }
  const draft = await recipeFromText(pageText(html), url);
  return { ...draft, image: draft.image ?? structured?.image ?? ogImage(html, url), method: "ai" };
}

function ogImage(html: string, pageUrl: string): string | null {
  const m = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i);
  return m ? absoluteUrl(m[1], pageUrl) : null;
}

// --- routes ---

type Handler = (req: IncomingMessage, res: ServerResponse, params: string[], url: URL) => Promise<void>;
const routes: { method: string; pattern: RegExp; handler: Handler }[] = [];
const route = (method: string, path: string, handler: Handler) =>
  routes.push({ method, pattern: new RegExp(`^${path.replace(/:\w+/g, "([^/]+)")}$`), handler });

route("GET", "/api/status", async (_req, res) => {
  send(res, 200, { ai: aiEnabled(), bring: bringEnabled(), today: today() });
});

route("GET", "/api/recipes", async (_req, res) => {
  const history = store.recipeHistory(today());
  send(
    res,
    200,
    store.listRecipes().map(({ ingredients, steps, ...r }) => ({
      ...r,
      ingredientCount: ingredients.length,
      ingredientNames: ingredients.map((i) => i.name).join(", "),
      planned: history.get(r.id) ?? null,
    })),
  );
});

route("GET", "/api/recipes/:id", async (_req, res, [rid]) => {
  const recipe = store.getRecipe(id(rid));
  if (!recipe) throw new HttpError(404, "Recipe not found");
  send(res, 200, { ...withText(recipe), planned: store.recipeHistory(today()).get(recipe.id) ?? null });
});

route("POST", "/api/recipes", async (req, res) => {
  const body = await readJson(req);
  const recipe = store.createRecipe(recipeInput(body));
  if (recipe.image?.startsWith("http")) void localizeImage(recipe.id, recipe.image);
  send(res, 201, withText(recipe));
});

route("PUT", "/api/recipes/:id", async (req, res, [rid]) => {
  const existing = store.getRecipe(id(rid));
  if (!existing) throw new HttpError(404, "Recipe not found");
  const input = recipeInput(await readJson(req), existing);
  const recipe = store.updateRecipe(existing.id, input)!;
  if (existing.image !== recipe.image) await removeLocalImage(existing.image);
  if (recipe.image?.startsWith("http")) void localizeImage(recipe.id, recipe.image);
  send(res, 200, withText(recipe));
});

route("PATCH", "/api/recipes/:id", async (req, res, [rid]) => {
  const existing = store.getRecipe(id(rid));
  if (!existing) throw new HttpError(404, "Recipe not found");
  const body = await readJson(req);
  const recipe = store.updateRecipe(existing.id, { ...existing, favorite: body.favorite === undefined ? existing.favorite : Boolean(body.favorite) })!;
  send(res, 200, withText(recipe));
});

route("DELETE", "/api/recipes/:id", async (_req, res, [rid]) => {
  const existing = store.getRecipe(id(rid));
  if (existing) {
    store.deleteRecipe(existing.id);
    await removeLocalImage(existing.image);
  }
  send(res, 200, { ok: true });
});

route("POST", "/api/recipes/:id/image", async (req, res, [rid]) => {
  const existing = store.getRecipe(id(rid));
  if (!existing) throw new HttpError(404, "Recipe not found");
  const [img] = parseImages([(await readJson(req))]);
  const image = await saveImage(existing.id, Buffer.from(img.data, "base64"), img.mediaType);
  store.setRecipeImage(existing.id, image);
  await removeLocalImage(existing.image);
  send(res, 200, { image });
});

route("POST", "/api/import/url", async (req, res) => {
  const body = await readJson(req);
  const url = extractUrl(str(body.url, 2000));
  if (!url) throw new HttpError(400, "No URL found");
  send(res, 200, withText({ ...(await importFromUrl(url)), sourceType: "url" }));
});

route("POST", "/api/import/photos", async (req, res) => {
  const images = parseImages((await readJson(req)).images);
  send(res, 200, withText({ ...(await recipeFromImages(images)), sourceType: "photo" }));
});

route("POST", "/api/import/text", async (req, res) => {
  const text = str((await readJson(req)).text, 60_000);
  if (!text) throw new HttpError(400, "No text provided");
  const url = /^\s*https?:\/\/\S+\s*$/.test(text) ? extractUrl(text) : null;
  if (url) return send(res, 200, withText({ ...(await importFromUrl(url)), sourceType: "url" }));
  send(res, 200, withText({ ...(await recipeFromText(text)), sourceType: "text" }));
});

// Plan

route("GET", "/api/plan", async (_req, res, _p, url) => {
  const start = url.searchParams.get("start");
  const from = weekStart(isDate(start) ? start : today());
  const days = posInt(url.searchParams.get("days"), 7, 42);
  const to = addDays(from, days - 1);
  const entries = store.listPlan(from, to).map((e) => {
    const r = e.recipeId ? store.getRecipe(e.recipeId) : null;
    return {
      ...e,
      recipe: r ? { id: r.id, title: r.title, image: r.image, totalMinutes: r.totalMinutes, servings: r.servings } : null,
    };
  });
  send(res, 200, { from, to, today: today(), entries });
});

function planInput(body: Record<string, unknown>, existing?: { date: string; recipeId: number | null; note: string; servings: number }) {
  const date = body.date === undefined ? existing?.date : body.date;
  if (!isDate(date)) throw new HttpError(400, "Invalid date");
  const recipeId = body.recipeId === undefined ? existing?.recipeId ?? null : body.recipeId === null ? null : Number(body.recipeId);
  if (recipeId !== null && !store.getRecipe(recipeId)) throw new HttpError(400, "Unknown recipe");
  const note = body.note === undefined ? existing?.note ?? "" : str(body.note, 300);
  if (recipeId === null && !note) throw new HttpError(400, "A plan entry needs a recipe or a note");
  const servings = posInt(body.servings, existing?.servings ?? store.getSettings().defaultServings, 50);
  return { date, recipeId, note, servings };
}

route("POST", "/api/plan", async (req, res) => {
  send(res, 201, store.addPlanEntry(planInput(await readJson(req))));
});

route("PUT", "/api/plan/:id", async (req, res, [pid]) => {
  const existing = store.getPlanEntry(id(pid));
  if (!existing) throw new HttpError(404, "Plan entry not found");
  send(res, 200, store.updatePlanEntry(existing.id, planInput(await readJson(req), existing)));
});

route("DELETE", "/api/plan/:id", async (_req, res, [pid]) => {
  store.deletePlanEntry(id(pid));
  send(res, 200, { ok: true });
});

// Shopping

function weekParam(v: unknown): string {
  return weekStart(isDate(v) ? v : today());
}

route("GET", "/api/shopping", async (_req, res, _p, url) => {
  send(res, 200, shoppingForWeek(store, weekParam(url.searchParams.get("week"))));
});

route("PUT", "/api/shopping/check", async (req, res) => {
  const body = await readJson(req);
  const key = str(body.key, 300);
  if (!key) throw new HttpError(400, "Missing key");
  store.setShoppingCheck(weekParam(body.week), key, Boolean(body.checked));
  send(res, 200, { ok: true });
});

route("POST", "/api/shopping/extras", async (req, res) => {
  const body = await readJson(req);
  const text = str(body.text, 200);
  if (!text) throw new HttpError(400, "Empty item");
  store.addExtra(weekParam(body.week), text);
  send(res, 201, { ok: true });
});

route("PUT", "/api/shopping/extras/:id", async (req, res, [eid]) => {
  store.setExtraChecked(id(eid), Boolean((await readJson(req)).checked));
  send(res, 200, { ok: true });
});

route("DELETE", "/api/shopping/extras/:id", async (_req, res, [eid]) => {
  store.deleteExtra(id(eid));
  send(res, 200, { ok: true });
});

route("POST", "/api/shopping/bring", async (req, res) => {
  const body = await readJson(req);
  const settings = store.getSettings();
  if (!settings.bringListUuid) throw new HttpError(400, "Pick a Bring! list in Settings first");
  const view = shoppingForWeek(store, weekParam(body.week));
  const items = view.items.filter((i) => !i.checked).map((i) => ({ name: i.name, spec: i.amountText }));
  items.push(...view.extras.filter((e) => !e.checked).map((e) => ({ name: e.text, spec: "" })));
  await bring().addItems(settings.bringListUuid, items);
  send(res, 200, { sent: items.length, list: settings.bringListName });
});

route("GET", "/api/bring/lists", async (_req, res) => {
  send(res, 200, await bring().lists());
});

// Settings

route("GET", "/api/settings", async (_req, res) => {
  send(res, 200, store.getSettings());
});

route("PUT", "/api/settings", async (req, res) => {
  const body = await readJson(req);
  const patch: Partial<Settings> = {};
  if (body.defaultServings !== undefined) patch.defaultServings = posInt(body.defaultServings, 2, 50);
  if (body.pantryStaples !== undefined) {
    const list = Array.isArray(body.pantryStaples) ? body.pantryStaples : String(body.pantryStaples).split(/[\n,]/);
    patch.pantryStaples = list.map((s) => str(s, 100)).filter(Boolean);
  }
  if (body.bringListUuid !== undefined) {
    patch.bringListUuid = str(body.bringListUuid, 100) || null;
    patch.bringListName = str(body.bringListName, 200) || null;
  }
  send(res, 200, store.updateSettings(patch));
});

// --- static files ---

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
};

async function serveFile(res: ServerResponse, root: string, relPath: string, cache: string): Promise<boolean> {
  const path = normalize(join(root, relPath));
  if (!path.startsWith(root)) return false;
  try {
    const info = await stat(path);
    if (!info.isFile()) return false;
    const data = await readFile(path);
    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
      "Cache-Control": cache,
      "Content-Length": data.length,
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";

  if (url.pathname.startsWith("/api/")) {
    for (const r of routes) {
      if (r.method !== method) continue;
      const m = url.pathname.match(r.pattern);
      if (m) return r.handler(req, res, m.slice(1).map(decodeURIComponent), url);
    }
    throw new HttpError(404, "Not found");
  }

  if (method !== "GET" && method !== "HEAD") throw new HttpError(405, "Method not allowed");

  // PWA share target: sharing a recipe link from the phone opens the importer.
  if (url.pathname === "/share") {
    const shared = [url.searchParams.get("url"), url.searchParams.get("text"), url.searchParams.get("title")].filter(Boolean).join(" ");
    const target = extractUrl(shared);
    res.writeHead(302, { Location: target ? `/#/import?url=${encodeURIComponent(target)}` : "/#/import" });
    return void res.end();
  }

  if (url.pathname.startsWith("/images/")) {
    const name = url.pathname.slice("/images/".length);
    if (await serveFile(res, IMAGE_DIR + "/", name, "public, max-age=31536000, immutable")) return;
    throw new HttpError(404, "Not found");
  }

  const rel = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const cache = /\.(png|svg|ico)$/.test(rel) ? "public, max-age=86400" : "no-cache";
  if (await serveFile(res, WEB_DIR, rel, cache)) return;
  if (!extname(rel) && (await serveFile(res, WEB_DIR, "index.html", "no-cache"))) return;
  throw new HttpError(404, "Not found");
}

const server = createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    const status = err instanceof HttpError || err instanceof AiError || err instanceof BringError ? err.status : 500;
    if (status === 500) console.error(`${req.method} ${req.url}:`, err);
    else if (status >= 500) console.warn(`${req.method} ${req.url}: ${(err as Error).message}`);
    if (!res.headersSent) send(res, status, { error: status === 500 ? "Internal server error" : (err as Error).message });
    else res.end();
  });
});

server.requestTimeout = 5 * 60_000; // photo imports can take a while
server.listen(PORT, () => {
  console.log(`food-planner listening on :${PORT} (data: ${DATA_DIR}, ai: ${aiEnabled()}, bring: ${bringEnabled()})`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close();
    store.db.close();
    process.exit(0);
  });
}
