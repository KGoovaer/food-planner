import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";

// A fake Messages API: records requests and answers with a canned structured recipe.
let server: Server;
const requests: { url: string; headers: Record<string, unknown>; body: any }[] = [];
let reply: Record<string, unknown> = {};

before(async () => {
  server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    requests.push({ url: req.url!, headers: req.headers, body: JSON.parse(raw) });
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5",
      content: [{ type: "text", text: JSON.stringify(reply) }],
      stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 },
    }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const { port } = server.address() as { port: number };
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${port}`;
});

after(() => server.close());

test("photo import sends images with structured output and maps the result", async () => {
  const { recipeFromImages } = await import("../src/ai.ts");
  reply = {
    found: true, title: "Stoofvlees", description: "Vlaams klassiek", servings: 4, totalMinutes: 180,
    ingredients: [
      { quantity: 1.2, unit: "kg", name: "runderstoofvlees", note: "in blokjes", pantry: false },
      { quantity: 2, unit: "Stuks", name: "uien", note: null, pantry: false },
      { quantity: null, unit: "", name: "peper en zout", note: null, pantry: true },
    ],
    steps: ["Bak het vlees aan.", "Voeg bier toe."], tags: ["Belgisch", "stoofpot"],
  };
  const draft = await recipeFromImages([{ data: "aGVsbG8=", mediaType: "image/jpeg" }, { data: "d29ybGQ=", mediaType: "image/jpeg" }]);

  const req = requests.at(-1)!;
  assert.equal(req.url, "/v1/messages?beta=true");
  assert.match(String(req.headers["anthropic-beta"]), /server-side-fallback-2026-07-01/);
  assert.equal(req.body.model, "claude-opus-5-5");
  assert.equal(req.body.fallbacks, "default");
  assert.deepEqual(req.body.thinking, { type: "adaptive" });
  assert.equal(req.body.output_config.format.type, "json_schema");
  const content = req.body.messages[0].content;
  assert.equal(content.filter((c: any) => c.type === "image").length, 2);
  assert.match(content.at(-1).text, /2 photos/);

  assert.equal(draft.title, "Stoofvlees");
  assert.equal(draft.servings, 4);
  assert.deepEqual(draft.ingredients[0], { quantity: 1.2, unit: "kg", name: "runderstoofvlees", note: "in blokjes" });
  assert.deepEqual(draft.ingredients[1], { quantity: 2, unit: "", name: "uien" });
  assert.equal(draft.ingredients[2].pantry, true);
  assert.deepEqual(draft.tags, ["belgisch", "stoofpot"]);
});

test("url fallback asks Claude to fetch the page with the web fetch tool", async () => {
  const { recipeFromUrl } = await import("../src/ai.ts");
  reply = { found: true, title: "Bolognese", description: "", servings: 4, totalMinutes: null, ingredients: [], steps: [], tags: [] };
  const draft = await recipeFromUrl("https://www.ah.nl/allerhande/recept/x");
  const req = requests.at(-1)!;
  assert.equal(req.body.tools[0].type, "web_fetch_20260209");
  assert.equal(draft.sourceUrl, "https://www.ah.nl/allerhande/recept/x");
});

test("input without a recipe is reported as such", async () => {
  const { recipeFromText, AiError } = await import("../src/ai.ts");
  reply = { found: false, title: "", description: "", servings: 0, totalMinutes: null, ingredients: [], steps: [], tags: [] };
  await assert.rejects(recipeFromText("just a shopping receipt"), (err) => err instanceof AiError && err.status === 422);
});
