import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { durationMinutes, extractRecipe, htmlToText, recipeFromJsonLd } from "../src/scrape.ts";

const hellofresh = readFileSync(new URL("./fixtures/hellofresh.html", import.meta.url), "utf8");

test("extracts a HelloFresh recipe with pantry items", () => {
  const r = extractRecipe(hellofresh, "https://www.hellofresh.be/recipes/x")!;
  assert.equal(r.title, "Hamburger deluxe met ontbijtspek en spiegelei op briochebroodje met truffelmayo en kerstomatensalade");
  assert.equal(r.servings, 2);
  assert.equal(r.totalMinutes, 40);
  assert.match(r.image!, /^https:\/\/img\.hellofresh\.com\//);
  assert.equal(r.ingredients.length, 17);
  assert.deepEqual(r.ingredients[0], { quantity: 50, unit: "g", name: "Mayonaise met truffelaroma" });
  const pepper = r.ingredients.find((i) => i.name === "Peper en zout")!;
  assert.equal(pepper.quantity, null);
  assert.equal(pepper.pantry, true);
  assert.equal(r.ingredients.filter((i) => i.pantry).length, 7);
  assert.equal(r.steps.length, 4);
  assert.match(r.steps[0], /^Verwarm de oven voor op 200 graden\.\n/);
});

test("extracts a generic schema.org recipe from @graph", () => {
  const html = `<html><head><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", name: "x" },
      {
        "@type": ["Recipe"],
        name: "Spaghetti &amp; meatballs",
        recipeYield: ["4", "4 servings"],
        prepTime: "PT15M",
        cookTime: "PT1H",
        image: [{ "@type": "ImageObject", url: "https://example.com/a.jpg" }],
        recipeIngredient: ["400 g spaghetti", "1 tbsp olive oil"],
        recipeInstructions: [
          { "@type": "HowToSection", name: "Sauce", itemListElement: [{ "@type": "HowToStep", text: "Make sauce." }] },
          { "@type": "HowToStep", text: "<p>Cook pasta.</p>" },
        ],
        keywords: "Italian, pasta",
      },
    ],
  })}</script></head><body></body></html>`;
  const r = recipeFromJsonLd(html, "https://example.com/r")!;
  assert.equal(r.title, "Spaghetti & meatballs");
  assert.equal(r.servings, 4);
  assert.equal(r.totalMinutes, 75);
  assert.equal(r.image, "https://example.com/a.jpg");
  assert.deepEqual(r.steps, ["Make sauce.", "Cook pasta."]);
  assert.deepEqual(r.tags, ["italian", "pasta"]);
  assert.deepEqual(r.ingredients[1], { quantity: 1, unit: "tbsp", name: "olive oil" });
});

test("returns null when there is no recipe", () => {
  assert.equal(extractRecipe("<html><body>hi</body></html>", null), null);
});

test("helpers", () => {
  assert.equal(durationMinutes("PT1H30M"), 90);
  assert.equal(durationMinutes("bogus"), null);
  assert.equal(htmlToText("<ul><li>A &amp; B</li><li>C&#39;s</li></ul>"), "A & B\nC's");
});

test("relative image urls are made absolute", async () => {
  const { absoluteUrl } = await import("../src/scrape.ts");
  assert.equal(absoluteUrl("/wp-content/x.jpg", "https://site.be/recepten/a"), "https://site.be/wp-content/x.jpg");
  assert.equal(absoluteUrl("//cdn.site.be/x.jpg?a=1&amp;b=2", "https://site.be/"), "https://cdn.site.be/x.jpg?a=1&b=2");
  assert.equal(absoluteUrl("javascript:alert(1)", "https://site.be/"), null);
});

test("Pure Pascale: ingredients from JSON-LD and the cookbook page as note", () => {
  const html = readFileSync(new URL("./fixtures/purepascale.html", import.meta.url), "utf8");
  const r = extractRecipe(html, "https://purepascale.com/recepten/x")!;
  assert.equal(r.servings, 4);
  assert.equal(r.ingredients.length, 12);
  assert.equal(r.steps.length, 0);
  assert.equal(r.notes, "Volledig recept: p. 204 van “De slimste keuken”");
});

test("full method from recipe-instruction blocks (Dagelijkse Kost)", async () => {
  const { instructionBlocks } = await import("../src/scrape.ts");
  const block = (n: number, text: string) =>
    `<div data-testid="recipe-instruction"><span>${n}</span><p class="body">${text}</p><span>3 stronken prei</span></div>`;
  const method = block(1, "Smelt de boter.") + block(2, "Spoel de prei &amp; snijd ze.") + block(3, "Kook de pasta.");
  assert.deepEqual(instructionBlocks(`<main>${method}</main><aside>${method}</aside>`), ["Smelt de boter.", "Spoel de prei & snijd ze.", "Kook de pasta."]);
  assert.deepEqual(instructionBlocks("<p>no steps</p>"), []);
});
