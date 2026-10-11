// Ingredient parsing, unit normalisation, scaling and aggregation into a shopping list.
// Recipes come in Dutch (HelloFresh BE, Flemish cookbooks) and English, so units cover both.

export interface Ingredient {
  quantity: number | null;
  unit: string; // canonical unit key (see UNITS) or "" for countable items
  name: string;
  note?: string;
  pantry?: boolean; // basics you probably have at home (oil, salt, ...)
}

interface UnitDef {
  base: string; // unit used for aggregation
  factor: number; // multiply quantity by this to get `base`
}

const UNIT_ALIASES: Record<string, string[]> = {
  g: ["g", "gr", "gram", "grams", "gramme", "grammes"],
  kg: ["kg", "kilo", "kilos", "kilogram", "kilograms"],
  ml: ["ml", "milliliter", "milliliters", "millilitre", "millilitres"],
  cl: ["cl", "centiliter"],
  dl: ["dl", "deciliter"],
  l: ["l", "liter", "liters", "litre", "litres"],
  tbsp: ["el", "eetlepel", "eetlepels", "tbsp", "tbs", "tablespoon", "tablespoons", "tbl"],
  tsp: ["tl", "kl", "theelepel", "theelepels", "koffielepel", "koffielepels", "tsp", "teaspoon", "teaspoons"],
  cup: ["cup", "cups", "kop", "kopje", "kopjes"],
  clove: ["teen", "teentje", "teentjes", "tenen", "clove", "cloves"],
  slice: ["plak", "plakken", "plakje", "plakjes", "sneetje", "sneetjes", "slice", "slices"],
  can: ["blik", "blikken", "blikje", "blikjes", "can", "cans", "tin", "tins"],
  pack: ["zak", "zakken", "zakje", "zakjes", "pak", "pakken", "pakje", "pakjes", "pack", "packs", "packet", "packets", "bag", "bags"],
  pinch: ["snuf", "snufje", "snufjes", "mespunt", "mespuntje", "pinch", "pinches"],
  bunch: ["bos", "bosje", "bosjes", "bunch", "bunches"],
  sprig: ["takje", "takjes", "tak", "takken", "sprig", "sprigs"],
  handful: ["handje", "handjes", "handvol", "handful", "handfuls"],
  jar: ["pot", "potje", "potjes", "jar", "jars"],
  piece: ["stuk", "stuks", "stukken", "st", "piece", "pieces", "pc", "pcs"],
  stalk: ["stengel", "stengels", "stengeltje", "stengeltjes", "stalk", "stalks"],
  cm: ["cm", "centimeter", "centimeters"],
  tray: ["bakje", "bakjes", "schaaltje", "schaaltjes", "punnet", "punnets", "tray", "trays"],
  bunch2: [],
  vine: ["tros", "trossen", "trosje", "trosjes"],
  slice2: [],
  leaf: ["blad", "blaadje", "blaadjes", "bladeren", "leaf", "leaves"],
  dash: ["scheut", "scheutje", "scheutjes", "dash", "splash", "drupje", "druppel", "druppels"],
  wedge: ["partje", "partjes", "schijf", "schijven", "schijfje", "schijfjes", "wedge", "wedges"],
  head: ["krop", "kropje", "kroppen", "head", "heads"],
  inch: ["inch", "inches"],
};
delete UNIT_ALIASES.bunch2;
delete UNIT_ALIASES.slice2;

const UNITS: Record<string, UnitDef> = {
  g: { base: "g", factor: 1 },
  kg: { base: "g", factor: 1000 },
  ml: { base: "ml", factor: 1 },
  cl: { base: "ml", factor: 10 },
  dl: { base: "ml", factor: 100 },
  l: { base: "ml", factor: 1000 },
};

const ALIAS_TO_UNIT = new Map<string, string>();
for (const [unit, aliases] of Object.entries(UNIT_ALIASES)) {
  for (const alias of aliases) ALIAS_TO_UNIT.set(alias, unit);
}

/** Map a free-form unit ("stuk(s)", "EL.", "Teaspoons") to a canonical key, or null when unknown. */
export function canonicalUnit(raw: string): string | null {
  const lower = raw.toLowerCase().trim();
  const cleaned = lower
    .replace(/\((s|en|ken|jes|es|n)\)$/, "") // HelloFresh style: stuk(s), plak(ken)
    .replace(/\.$/, "")
    .trim();
  if (cleaned === "") return "";
  const known = ALIAS_TO_UNIT.get(cleaned);
  if (known) return known;
  // An unknown word written HelloFresh-style ("zakje(s)", "potje(s)") is still clearly a unit.
  if (/^[a-z]+\((s|en|ken|jes|es|n)\)$/.test(lower)) return cleaned;
  return null;
}

const UNICODE_FRACTIONS: Record<string, number> = {
  "½": 0.5, "⅓": 1 / 3, "⅔": 2 / 3, "¼": 0.25, "¾": 0.75, "⅕": 0.2, "⅛": 0.125,
};

const NUMBER = String.raw`(?:\d+\s+\d+/\d+|\d+/\d+|\d+(?:[.,]\d+)?(?:\s*[½⅓⅔¼¾⅕⅛])?|[½⅓⅔¼¾⅕⅛])`;
const QUANTITY_RE = new RegExp(String.raw`^(${NUMBER})(?:\s*(?:-|–|tot|à|to)\s*(${NUMBER}))?\s*`);

function parseNumber(text: string): number {
  const t = text.trim().replace(",", ".");
  const mixed = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const frac = t.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const uni = t.match(/^(\d+(?:\.\d+)?)?\s*([½⅓⅔¼¾⅕⅛])$/);
  if (uni) return Number(uni[1] ?? 0) + UNICODE_FRACTIONS[uni[2]];
  return Number(t);
}

const TO_TASTE_RE = /^(naar smaak|to taste|optioneel|optional|snufje|a pinch of)\s+/i;

/** Split "Honing [of plantaardig alternatief]" / "ui, fijngesneden" into name and note. */
function splitNote(text: string): { name: string; note?: string } {
  let name = text.trim();
  let note: string | undefined;
  const trailing = name.match(/^(.*?)\s*[[(]([^\])]*)[\])]\s*$/);
  if (trailing && trailing[1]) {
    name = trailing[1];
    note = trailing[2].trim();
  }
  const comma = name.indexOf(",");
  if (comma > 0) {
    const rest = name.slice(comma + 1).trim();
    name = name.slice(0, comma);
    note = [rest, note].filter(Boolean).join(", ");
  }
  name = name.replace(/[[\]()]/g, "").replace(/\s+/g, " ").trim();
  return note ? { name, note } : { name };
}

/** Parse a free-text ingredient line such as "200 gram Kipfilet", "1½ el olijfolie" or "2 cloves garlic, minced". */
export function parseIngredient(line: string): Ingredient {
  let rest = line.replace(/\s+/g, " ").trim().replace(/^[-•*·]\s*/, "");
  let quantity: number | null = null;
  let unit = "";

  const toTaste = rest.match(TO_TASTE_RE);
  if (toTaste) {
    rest = rest.slice(toTaste[0].length);
    const { name, note } = splitNote(rest);
    return { quantity: null, unit: "", name, note: [toTaste[1].toLowerCase(), note].filter(Boolean).join(", ") };
  }

  const q = rest.match(QUANTITY_RE);
  // "5-kruidenpoeder" is a name, not 5 × "-kruidenpoeder".
  if (q && !/^[-–]/.test(rest.slice(q[0].length))) {
    // For ranges ("2-3 tomaten") buy the upper bound.
    let raw = q[2] ?? q[1];
    rest = rest.slice(q[0].length);
    // "2 x 400 g tomaten" → 800 g
    let multiplier = 1;
    const times = rest.match(/^[x×]\s*/i);
    const inner = times ? rest.slice(times[0].length).match(QUANTITY_RE) : null;
    if (times && inner) {
      multiplier = parseNumber(raw);
      raw = inner[2] ?? inner[1];
      rest = rest.slice(times[0].length + inner[0].length);
    }
    // Belgian/Dutch thousands separator: "1.000 g bloem".
    const thousands = /^\d{1,3}\.\d{3}$/.test(raw.trim()) && /^(g|gr|gram|ml)\b/i.test(rest);
    quantity = (thousands ? Number(raw.replace(".", "")) : parseNumber(raw)) * multiplier;
    if (!Number.isFinite(quantity) || quantity <= 0) quantity = null;
    // "1 (400 g) can tomatoes": the parenthesised size is a note.
    const size = rest.match(/^\(([^)]*)\)\s*/);
    if (size) rest = rest.slice(size[0].length) + ` (${size[1]})`;
  }

  // Unit is either glued to the number ("200g") – handled because QUANTITY_RE allows no space –
  // or the next word ("200 gram", "2 stuk(s)"), possibly after a size ("1 small bunch of …").
  const notes: string[] = [];
  if (quantity !== null) {
    const sized = rest.match(/^(small|medium|large|big|klein|kleine|groot|grote|flinke)\s+(\S+)\s*/i);
    if (sized && canonicalUnit(sized[2])) {
      notes.push(sized[1].toLowerCase());
      rest = rest.slice(sized[1].length).trimStart();
    }
    const word = rest.match(/^(\S+)\s*/);
    const canon = word ? canonicalUnit(word[1]) : null;
    if (word && canon) {
      unit = canon === "piece" ? "" : canon;
      rest = rest.slice(word[0].length);
      // "400 g can chopped tomatoes" / "200 g blik tomaten": the container is just a note.
      const container = rest.match(/^(\S+)\s+/);
      if (container && ["can", "jar", "pack"].includes(canonicalUnit(container[1]) ?? "") && UNITS[unit]) {
        notes.push(container[1].toLowerCase());
        rest = rest.slice(container[0].length);
      }
      // "1 el. van de olie" → drop filler words
      rest = rest.replace(/^(of the|of|van de|van)\s+/i, "");
    }
  }

  const { name, note } = splitNote(rest);
  if (note) notes.push(note);
  const ing: Ingredient = { quantity, unit, name };
  if (notes.length) ing.note = notes.join(", ");
  return ing;
}

/** Ingredients editor format: one ingredient per line, pantry items below a "Pantry:" line. */
export function parseIngredientsText(text: string): Ingredient[] {
  const out: Ingredient[] = [];
  let pantry = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (/^(pantry|voorraad|basis|basics)\s*:?$/i.test(line)) {
      pantry = true;
      continue;
    }
    const ing = parseIngredient(line);
    if (!ing.name) continue;
    if (pantry) ing.pantry = true;
    out.push(ing);
  }
  return out;
}

const PLURALS: Record<string, string> = {
  cup: "cups", clove: "cloves", slice: "slices", can: "cans", pack: "packs", pinch: "pinches",
  bunch: "bunches", sprig: "sprigs", handful: "handfuls", jar: "jars",
};

/** Display label for a canonical unit: "slice" → "slices" when there is more than one. */
export function unitLabel(unit: string, quantity: number | null): string {
  return quantity !== null && quantity > 1 && PLURALS[unit] ? PLURALS[unit] : unit;
}

/** Quantity for the editor: exact (no display rounding) so saving a recipe never changes its amounts. */
function exactQuantity(q: number): string {
  const whole = Math.floor(q);
  const frac = q - whole;
  if (q < 10) {
    for (const [value, glyph] of NICE_FRACTIONS) {
      if (Math.abs(frac - value) < 1e-6) return whole ? `${whole}${glyph}` : glyph;
    }
  }
  return String(Math.round(q * 1000) / 1000);
}

export function formatIngredient(ing: Ingredient): string {
  const parts: string[] = [];
  if (ing.quantity !== null) parts.push(exactQuantity(ing.quantity));
  if (ing.unit && ing.quantity !== null) parts.push(unitLabel(ing.unit, ing.quantity));
  parts.push(ing.name);
  let s = parts.join(" ");
  if (ing.note) s += ing.quantity === null && /naar smaak|to taste/.test(ing.note) ? ` (${ing.note})` : `, ${ing.note}`;
  return s;
}

export function formatIngredientsText(ings: Ingredient[]): string {
  const main = ings.filter((i) => !i.pantry).map(formatIngredient);
  const pantry = ings.filter((i) => i.pantry).map(formatIngredient);
  return pantry.length ? [...main, "", "Pantry:", ...pantry].join("\n") : main.join("\n");
}

const NICE_FRACTIONS: [number, string][] = [
  [0.25, "¼"], [1 / 3, "⅓"], [0.5, "½"], [2 / 3, "⅔"], [0.75, "¾"],
];

/** Human friendly quantity: 0.5 → "½", 1.5 → "1½", 233.33 → "235", 2.4 → "2.4". */
export function formatQuantity(q: number): string {
  if (q >= 100) return String(Math.round(q / 5) * 5);
  if (q >= 10) return String(Math.round(q));
  const whole = Math.floor(q);
  const frac = q - whole;
  if (frac < 0.05) return String(whole);
  if (frac > 0.95) return String(whole + 1);
  for (const [value, glyph] of NICE_FRACTIONS) {
    if (Math.abs(frac - value) < 0.04) return whole ? `${whole}${glyph}` : glyph;
  }
  return String(Math.round(q * 10) / 10);
}

export function scaleIngredients(ings: Ingredient[], factor: number): Ingredient[] {
  if (factor === 1) return ings;
  return ings.map((i) => (i.quantity === null ? i : { ...i, quantity: i.quantity * factor }));
}

export interface ShoppingSource {
  ingredients: Ingredient[];
  recipe: string;
}

export interface ShoppingAmount {
  quantity: number;
  unit: string;
}

export interface ShoppingItem {
  key: string;
  name: string;
  amounts: ShoppingAmount[];
  amountText: string;
  recipes: string[];
  pantry: boolean;
}

/** Normalised key so "Rode ui" and "rode  UI" end up on the same shopping line. */
export function ingredientKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function displayAmount(a: ShoppingAmount): string {
  if (a.unit === "g" && a.quantity >= 1000) return `${formatQuantity(a.quantity / 1000)} kg`;
  if (a.unit === "ml" && a.quantity >= 1000) return `${formatQuantity(a.quantity / 1000)} l`;
  return a.unit ? `${formatQuantity(a.quantity)} ${unitLabel(a.unit, a.quantity)}` : formatQuantity(a.quantity);
}

/**
 * Merge ingredients of several (already scaled) recipes into one shopping list.
 * Same name + compatible unit are summed; incompatible units are listed side by side ("1 can + 200 g").
 * `staples` are names treated as pantry items regardless of the recipe flag.
 */
export function buildShoppingList(sources: ShoppingSource[], staples: string[] = []): ShoppingItem[] {
  const stapleKeys = new Set(staples.map(ingredientKey).filter(Boolean));
  const items = new Map<string, ShoppingItem & { allPantry: boolean }>();

  for (const source of sources) {
    for (const ing of source.ingredients) {
      const key = ingredientKey(ing.name);
      if (!key) continue;
      let item = items.get(key);
      if (!item) {
        item = { key, name: ing.name, amounts: [], amountText: "", recipes: [], pantry: false, allPantry: true };
        items.set(key, item);
      }
      if (!item.recipes.includes(source.recipe)) item.recipes.push(source.recipe);
      if (!ing.pantry) item.allPantry = false;
      if (ing.quantity === null) continue;
      const def = UNITS[ing.unit] ?? { base: ing.unit, factor: 1 };
      const quantity = ing.quantity * def.factor;
      const existing = item.amounts.find((a) => a.unit === def.base);
      if (existing) existing.quantity += quantity;
      else item.amounts.push({ quantity, unit: def.base });
    }
  }

  return [...items.values()]
    .map(({ allPantry, ...item }) => ({
      ...item,
      pantry: allPantry || stapleKeys.has(item.key),
      amountText: item.amounts.map(displayAmount).join(" + "),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, "nl"));
}
