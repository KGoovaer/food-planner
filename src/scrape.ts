// Extract a recipe from a web page: HelloFresh's embedded Next.js data first (it has per-serving
// amounts and marks pantry items), then any schema.org/Recipe JSON-LD, which most recipe sites publish.

import { parseIngredient, type Ingredient } from "./ingredients.ts";

export interface RecipeDraft {
  title: string;
  description: string;
  servings: number;
  totalMinutes: number | null;
  image: string | null;
  sourceUrl: string | null;
  ingredients: Ingredient[];
  steps: string[];
  tags: string[];
  notes?: string;
}

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "nl-BE,nl;q=0.9,en;q=0.8",
};

/** Read a response body, refusing anything larger than `maxBytes`. */
export async function readLimited(res: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error(`Response too large (${declared} bytes)`);
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of res.body ?? []) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Response too large");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function fetchPage(url: string): Promise<string> {
  const res = await fetch(url, { headers: BROWSER_HEADERS, redirect: "follow", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Fetching ${url} failed: HTTP ${res.status}`);
  return (await readLimited(res, 10 * 1024 * 1024)).toString("utf8");
}

/** Make an image reference absolute (sites often use "/wp-content/…" or "//cdn…"); null if unusable. */
export function absoluteUrl(src: string | null, base: string | null): string | null {
  if (!src) return null;
  try {
    const url = new URL(decodeEntities(src.trim()), base ?? undefined);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** Turn an HTML fragment into plain text, keeping list items / paragraphs as separate lines. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<\s*(br|\/p|\/li|\/div|\/h\d)\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, ""),
  )
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

/** ISO 8601 duration (PT1H15M) → minutes. */
export function durationMinutes(d: unknown): number | null {
  if (typeof d !== "string") return null;
  const m = d.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/i);
  if (!m) return null;
  const minutes = Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0);
  return minutes > 0 ? minutes : null;
}

function firstInt(v: unknown): number | null {
  if (typeof v === "number" && v > 0) return Math.round(v);
  if (Array.isArray(v)) {
    for (const x of v) {
      const n = firstInt(x);
      if (n) return n;
    }
    return null;
  }
  if (typeof v === "string") {
    const m = v.match(/\d+/);
    return m ? Number(m[0]) : null;
  }
  return null;
}

function imageUrl(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.length ? imageUrl(v[v.length > 1 ? 1 : 0]) ?? imageUrl(v[0]) : null;
  if (v && typeof v === "object" && "url" in v) return imageUrl((v as { url: unknown }).url);
  return null;
}

function text(v: unknown): string {
  return typeof v === "string" ? htmlToText(v) : "";
}

function instructions(v: unknown): string[] {
  if (typeof v === "string") return htmlToText(v).split("\n").filter(Boolean);
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const step of v) {
    if (typeof step === "string") out.push(htmlToText(step));
    else if (step && typeof step === "object") {
      const s = step as Record<string, unknown>;
      if (Array.isArray(s.itemListElement)) out.push(...instructions(s.itemListElement));
      else if (typeof s.text === "string") out.push(htmlToText(s.text));
      else if (typeof s.name === "string") out.push(htmlToText(s.name));
    }
  }
  return out.filter(Boolean);
}

function tagList(...values: unknown[]): string[] {
  const tags = new Set<string>();
  for (const v of values) {
    const list = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
    for (const t of list) if (typeof t === "string" && t.trim()) tags.add(decodeEntities(t).trim().toLowerCase());
  }
  return [...tags].slice(0, 8);
}

function isRecipe(node: Record<string, unknown>): boolean {
  const type = node["@type"];
  return type === "Recipe" || (Array.isArray(type) && type.includes("Recipe"));
}

function findRecipeNode(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) {
    for (const d of data) {
      const r = findRecipeNode(d);
      if (r) return r;
    }
    return null;
  }
  if (data && typeof data === "object") {
    const node = data as Record<string, unknown>;
    if (isRecipe(node)) return node;
    if (node["@graph"]) return findRecipeNode(node["@graph"]);
    if (node.mainEntity) return findRecipeNode(node.mainEntity);
  }
  return null;
}

export function recipeFromJsonLd(html: string, url: string | null): RecipeDraft | null {
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const r = findRecipeNode(data);
    if (!r) continue;
    const ingredients = (Array.isArray(r.recipeIngredient) ? r.recipeIngredient : [])
      .filter((x): x is string => typeof x === "string")
      .map((line) => parseIngredient(decodeEntities(line)))
      .filter((i) => i.name);
    return {
      title: text(r.name) || "Untitled recipe",
      description: text(r.description),
      servings: firstInt(r.recipeYield) ?? 2,
      totalMinutes:
        durationMinutes(r.totalTime) ??
        ((durationMinutes(r.prepTime) ?? 0) + (durationMinutes(r.cookTime) ?? 0) || null),
      image: absoluteUrl(imageUrl(r.image), url),
      sourceUrl: url,
      ingredients,
      steps: instructions(r.recipeInstructions),
      tags: tagList(r.recipeCategory, r.recipeCuisine, r.keywords),
    };
  }
  return null;
}

interface HfIngredient { id: string; name: string; shipped?: boolean }
interface HfYield { yields: number; ingredients: { id: string; amount: number | null; unit: string | null }[] }
interface HfRecipe {
  name: string;
  headline?: string;
  description?: string;
  imagePath?: string;
  totalTime?: string;
  prepTime?: string;
  ingredients: HfIngredient[];
  yields: HfYield[];
  steps: { index?: number; instructionsHTML?: string; instructionsMarkdown?: string; instructions?: string }[];
  tags?: { name?: string }[];
  cuisines?: { name?: string }[];
  websiteUrl?: string;
}

export function recipeFromHelloFresh(html: string, url: string | null, preferredServings = 2): RecipeDraft | null {
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  let r: HfRecipe | undefined;
  try {
    r = JSON.parse(m[1])?.props?.pageProps?.ssrPayload?.recipe;
  } catch {
    return null;
  }
  if (!r || !Array.isArray(r.yields) || !Array.isArray(r.ingredients) || r.yields.length === 0) return null;

  const y = r.yields.find((x) => x.yields === preferredServings) ?? r.yields[0];
  const byId = new Map(r.ingredients.map((i) => [i.id, i]));
  const ingredients: Ingredient[] = [];
  for (const entry of y.ingredients) {
    const ing = byId.get(entry.id);
    if (!ing) continue;
    // Reuse the line parser so units and "[...]" notes are normalised the same way as everywhere else.
    // HelloFresh uses amount 0 / null with unit "naar smaak" for salt & pepper.
    const amount = entry.amount ? String(entry.amount) : "";
    const parsed = parseIngredient(`${amount} ${entry.unit ?? ""} ${ing.name}`.trim());
    if (!amount) parsed.quantity = null;
    if (ing.shipped === false) parsed.pantry = true;
    ingredients.push(parsed);
  }

  const steps = [...r.steps]
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((s) => htmlToText(s.instructionsHTML ?? s.instructionsMarkdown ?? s.instructions ?? ""))
    .filter(Boolean);

  const title = r.headline ? `${r.name} ${r.headline}` : r.name;
  return {
    title: decodeEntities(title.trim()),
    description: text(r.description),
    servings: y.yields,
    totalMinutes: durationMinutes(r.totalTime) ?? durationMinutes(r.prepTime),
    image: r.imagePath ? `https://img.hellofresh.com/f_auto,fl_lossy,q_auto,w_1200/hellofresh_s3${r.imagePath}` : null,
    sourceUrl: url ?? r.websiteUrl ?? null,
    ingredients,
    steps,
    tags: tagList(["hellofresh"], (r.cuisines ?? []).map((c) => c.name)),
  };
}

/** Some sites (Pure Pascale, Jamie Oliver) only publish ingredients and point to the cookbook page for the method. */
export function bookReference(text: string): string | null {
  const t = htmlToText(text);
  const nl = t.match(/Het volledige recept lees je op pagina\s+(\d+)\s+van\s+([^\n]+)/);
  if (nl) return `Volledig recept: p. ${nl[1]} van “${nl[2].trim()}”`;
  const en = t.match(/full recipe,? head to page\s+(\d+)\s+of\s+([^\n]+?)\.?\s*$/im);
  return en ? `Full recipe: p. ${en[1]} of “${en[2].trim()}”` : null;
}

/**
 * Dagelijkse Kost (Jeroen Meus) only puts the first steps in its JSON-LD; the full method is in the page,
 * one `data-testid="recipe-instruction"` block per step. Returns the steps in order (deduplicated, since
 * the page renders the method more than once).
 */
export function instructionBlocks(html: string): string[] {
  const steps: string[] = [];
  const parts = html.split('data-testid="recipe-instruction"').slice(1);
  for (const part of parts) {
    const p = part.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const text = p ? htmlToText(p[1]) : "";
    if (!text) continue;
    if (steps.includes(text)) break; // second rendering of the same method
    steps.push(text);
  }
  return steps;
}

/** Best-effort structured extraction; null when the page has no machine readable recipe. */
export function extractRecipe(html: string, url: string | null): RecipeDraft | null {
  const recipe = extractStructured(html, url);
  if (recipe) {
    const blocks = instructionBlocks(html);
    if (blocks.length > recipe.steps.length) recipe.steps = blocks;
  }
  // A lone "step" that only points to the cookbook is a note, not a method.
  if (recipe && recipe.steps.length === 1 && bookReference(recipe.steps[0])) {
    recipe.notes = bookReference(recipe.steps[0])!;
    recipe.steps = [];
  }
  if (recipe && recipe.steps.length === 0 && !recipe.notes) {
    const ref = bookReference(html);
    if (ref) recipe.notes = ref;
  }
  return recipe;
}

function extractStructured(html: string, url: string | null): RecipeDraft | null {
  const hf = recipeFromHelloFresh(html, url);
  const ld = recipeFromJsonLd(html, url);
  if (hf && ld) {
    // JSON-LD has the nicer (shorter) title and a properly sized image on HelloFresh.
    return {
      ...hf,
      title: ld.title || hf.title,
      image: ld.image ?? hf.image,
      description: hf.description || ld.description,
      totalMinutes: Math.max(ld.totalMinutes ?? 0, hf.totalMinutes ?? 0) || null,
    };
  }
  return hf ?? ld;
}

/** Visible page text, used as input for the AI fallback when a page has no structured data. */
export function pageText(html: string): string {
  return htmlToText(
    html
      .replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, "")
      .replace(/<head[\s\S]*?<\/head>/i, ""),
  ).slice(0, 60_000);
}
