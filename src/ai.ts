// Claude-powered recipe extraction: cookbook photos, pasted text and web pages without structured data.

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { Ingredient } from "./ingredients.ts";
import { canonicalUnit } from "./ingredients.ts";
import type { RecipeDraft } from "./scrape.ts";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
const EFFORT = (process.env.ANTHROPIC_EFFORT || "medium") as "low" | "medium" | "high";

let client: Anthropic | null = null;

export function aiEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient(): Anthropic {
  if (!aiEnabled()) throw new AiError("AI import is not configured (set ANTHROPIC_API_KEY).", 503);
  client ??= new Anthropic();
  return client;
}

export class AiError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

const RecipeSchema = z.object({
  found: z.boolean().describe("false when the input does not contain a recipe"),
  title: z.string(),
  description: z.string().describe("One or two sentences, empty if none"),
  servings: z.number().int().describe("Number of servings the quantities are for; guess 2 if unknown"),
  totalMinutes: z.number().int().nullable().describe("Total time in minutes, null if unknown"),
  ingredients: z.array(
    z.object({
      quantity: z.number().nullable().describe("Numeric amount, fractions as decimals; null for 'to taste'"),
      unit: z.string().describe("g, kg, ml, l, tbsp, tsp, cup, clove, slice, can, pack, pinch, bunch, sprig, handful, jar, or empty for countable items"),
      name: z.string().describe("Ingredient name as written, without quantity/unit, in the recipe's language"),
      note: z.string().nullable().describe("Preparation note such as 'finely chopped', or null"),
      pantry: z.boolean().describe("true for basics most kitchens have: salt, pepper, oil, butter, sugar, flour, vinegar, stock cubes, dried herbs/spices"),
    }),
  ),
  steps: z.array(z.string()).describe("Method steps in order, one paragraph per step, in the recipe's language"),
  tags: z.array(z.string()).describe("Up to 5 short lowercase tags (cuisine, main ingredient, course)"),
});

type ExtractedRecipe = z.infer<typeof RecipeSchema>;

const SYSTEM = `You extract recipes into structured data for a household meal planner.
Keep the recipe's original language (often Dutch) for the title, ingredient names and steps; do not translate.
Copy quantities exactly as written for the stated number of servings. Merge ingredients that are split across pages or columns, and keep sub-recipe ingredients (e.g. "for the sauce") as normal ingredients.
If several recipes are visible, extract the one that is most complete or most prominent.
If the input contains no recipe, set found to false and leave the other fields empty.`;

function toDraft(r: ExtractedRecipe, sourceUrl: string | null): RecipeDraft {
  if (!r.found || !r.title) throw new AiError("No recipe found in the input.", 422);
  const ingredients: Ingredient[] = r.ingredients
    .filter((i) => i.name.trim())
    .map((i) => {
      const unit = canonicalUnit(i.unit) ?? i.unit.toLowerCase();
      const ing: Ingredient = { quantity: i.quantity, unit: unit === "piece" ? "" : unit, name: i.name.trim() };
      if (i.note) ing.note = i.note;
      if (i.pantry) ing.pantry = true;
      return ing;
    });
  return {
    title: r.title.trim(),
    description: r.description.trim(),
    servings: r.servings > 0 ? r.servings : 2,
    totalMinutes: r.totalMinutes && r.totalMinutes > 0 ? r.totalMinutes : null,
    image: null,
    sourceUrl,
    ingredients,
    steps: r.steps.map((s) => s.trim()).filter(Boolean),
    tags: r.tags.map((t) => t.toLowerCase().trim()).filter(Boolean).slice(0, 5),
  };
}

async function extract(
  content: Anthropic.Beta.Messages.BetaContentBlockParam[],
  tools?: Anthropic.Beta.Messages.BetaToolUnion[],
): Promise<ExtractedRecipe> {
  try {
    const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: "user", content }];
    let response;
    // Server tools (web fetch) can pause a long turn; resume by sending the paused turn back.
    for (let continuation = 0; ; continuation++) {
      response = await getClient().beta.messages.parse({
        model: MODEL,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        thinking: { type: "adaptive" },
        output_config: { effort: EFFORT, format: betaZodOutputFormat(RecipeSchema) },
        system: SYSTEM,
        tools,
        messages,
      });
      if (response.stop_reason !== "pause_turn" || continuation >= 3) break;
      messages.splice(1, messages.length - 1, { role: "assistant", content: response.content });
    }
    if (response.stop_reason === "pause_turn") throw new AiError("Fetching the page took too long.");
    if (response.stop_reason === "refusal") throw new AiError("The model declined to process this input.", 422);
    if (response.stop_reason === "max_tokens") throw new AiError("The recipe was too long to extract in one go.", 422);
    if (!response.parsed_output) throw new AiError("Could not read a recipe from the model output.");
    return response.parsed_output;
  } catch (err) {
    if (err instanceof AiError) throw err;
    if (err instanceof Anthropic.AuthenticationError) throw new AiError("Anthropic API key is invalid.", 503);
    if (err instanceof Anthropic.RateLimitError) throw new AiError("Rate limited by the Anthropic API, try again in a minute.", 429);
    if (err instanceof Anthropic.BadRequestError) throw new AiError(`Anthropic API rejected the request: ${err.message}`, 400);
    if (err instanceof Anthropic.APIError) throw new AiError(`Anthropic API error ${err.status ?? ""}: ${err.message}`);
    throw err;
  }
}

export interface ImageInput {
  data: string; // base64 without data: prefix
  mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif";
}

export async function recipeFromImages(images: ImageInput[]): Promise<RecipeDraft> {
  const content: Anthropic.Beta.Messages.BetaContentBlockParam[] = images.map((img) => ({
    type: "image",
    source: { type: "base64", media_type: img.mediaType, data: img.data },
  }));
  content.push({
    type: "text",
    text:
      images.length > 1
        ? `These ${images.length} photos show one recipe (e.g. from a cookbook, possibly spread over several pages). Extract it.`
        : "This photo shows a recipe (e.g. a cookbook page or recipe card). Extract it.",
  });
  return toDraft(await extract(content), null);
}

/** For sites that block our server (bot protection): let Claude fetch the page itself. */
export async function recipeFromUrl(url: string): Promise<RecipeDraft> {
  const draft = toDraft(
    await extract(
      [{ type: "text", text: `Use the web_fetch tool to fetch ${url} and extract the recipe on that page.` }],
      [{ type: "web_fetch_20260209", name: "web_fetch", max_uses: 3 }],
    ),
    url,
  );
  return draft;
}

export async function recipeFromText(text: string, sourceUrl: string | null = null): Promise<RecipeDraft> {
  const intro = sourceUrl ? `Text of the web page ${sourceUrl}:` : "Recipe text:";
  return toDraft(await extract([{ type: "text", text: `${intro}\n\n<document>\n${text}\n</document>\n\nExtract the recipe.` }]), sourceUrl);
}
