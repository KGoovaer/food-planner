// Food planner PWA – plain ES modules, no build step.

const $ = (sel, root = document) => root.querySelector(sel);
const view = $("#view");

const state = {
  status: { ai: false, bring: false },
  recipes: null, // cached list for pickers
  draft: null, // recipe draft coming from an import, consumed by the editor
  draftImage: null, // { data, mediaType, dataUrl } to upload after saving the draft
  photos: [], // pending cookbook photos in the importer
  importTab: "link",
  actions: {}, // data-action handlers of the current view
  sheetActions: {},
  cleanup: [],
  sheetGen: 0, // bumped on every open/close so async pickers don't reopen a dismissed sheet
};

// ---------- utilities ----------

const ICONS = {
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  chevronLeft: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  chevronRight: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5.5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18.5" cy="12" r="1.2"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  people: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.5a3.2 3.2 0 0 1 0 6.2M17.5 14.2A5.5 5.5 0 0 1 20.5 19"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 3.8l2.5 5.2 5.7.7-4.2 4 1.1 5.6L12 16.6l-5.1 2.7L8 13.7l-4.2-4 5.7-.7z"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13"/></svg>',
  link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7H8l1.5-2.5h5L16 7h2.5A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  images: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20.5 15.5l-5-5L6 19"/></svg>',
  text: '<svg viewBox="0 0 24 24"><path d="M5 6h14M5 10h14M5 14h9M5 18h6"/></svg>',
  pen: '<svg viewBox="0 0 24 24"><path d="M4 20l4.5-1L19 8.5 15.5 5 5 15.5z"/></svg>',
  dish: '<svg viewBox="0 0 24 24"><path d="M3.5 16h17M5 16a7 7 0 0 1 14 0M12 9V7.5M10.5 7.5h3M4 19h16"/></svg>',
  calendar: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  cart: '<svg viewBox="0 0 24 24"><path d="M3 4h2.5l2.2 10.5h10.6L20.5 7H6.6"/><circle cx="9.5" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13"/></svg>',
  settings: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M6 3.5h9l3.5 3.5v13.5H6z"/><path d="M14.5 3.5V7.5h4M9 12h6M9 15.5h4"/></svg>',
  move: '<svg viewBox="0 0 24 24"><path d="M4 12h16M14 6l6 6-6 6"/></svg>',
  filter: '<svg viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></svg>',
  external: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
};

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

let toastTimer;
function toast(message, isError = false) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.toggle("error", isError);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), isError ? 5000 : 2600);
}

// Dates are plain YYYY-MM-DD strings; build them in local time.
const pad = (n) => String(n).padStart(2, "0");
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromISO = (s) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (s, n) => {
  const d = fromISO(s);
  d.setDate(d.getDate() + n);
  return toISO(d);
};
const todayISO = () => toISO(new Date());
const weekStart = (s) => {
  const d = fromISO(s);
  return addDays(s, -((d.getDay() + 6) % 7));
};
const fmt = (s, opts) => fromISO(s).toLocaleDateString("en-GB", opts);
const weekLabel = (from) => {
  const to = addDays(from, 6);
  const a = fromISO(from);
  const b = fromISO(to);
  return a.getMonth() === b.getMonth()
    ? `${a.getDate()}–${b.getDate()} ${fmt(to, { month: "long" })}`
    : `${fmt(from, { day: "numeric", month: "short" })} – ${fmt(to, { day: "numeric", month: "short" })}`;
};
const relativeWeek = (from) => {
  const diff = Math.round((fromISO(from) - fromISO(weekStart(todayISO()))) / (7 * 864e5));
  if (diff === 0) return "This week";
  if (diff === 1) return "Next week";
  if (diff === -1) return "Last week";
  return diff > 0 ? `In ${diff} weeks` : `${-diff} weeks ago`;
};
function ago(dateStr) {
  const days = Math.round((fromISO(todayISO()) - fromISO(dateStr)) / 864e5);
  if (days === 0) return "today";
  if (days < 7) return `${days}d ago`;
  if (days < 60) return `${Math.round(days / 7)}w ago`;
  return `${Math.round(days / 30)} months ago`;
}

const FRACTIONS = [[0.25, "¼"], [1 / 3, "⅓"], [0.5, "½"], [2 / 3, "⅔"], [0.75, "¾"]];
/** "planned Wed 14 Oct" / "cooked 3w ago" / "" from the server's plan history. */
function historyLabel(planned) {
  if (!planned) return "";
  if (planned.next) return `planned ${fmt(planned.next, { weekday: "short", day: "numeric", month: "short" })}`;
  return planned.last ? `cooked ${ago(planned.last)}` : "";
}

function formatQuantity(q) {
  if (q >= 100) return String(Math.round(q / 5) * 5);
  if (q >= 10) return String(Math.round(q));
  const whole = Math.floor(q);
  const frac = q - whole;
  if (frac < 0.05) return String(whole);
  if (frac > 0.95) return String(whole + 1);
  for (const [v, g] of FRACTIONS) if (Math.abs(frac - v) < 0.04) return whole ? `${whole}${g}` : g;
  return String(Math.round(q * 10) / 10);
}
const PLURALS = { cup: "cups", clove: "cloves", slice: "slices", can: "cans", pack: "packs", pinch: "pinches", bunch: "bunches", sprig: "sprigs", handful: "handfuls", jar: "jars" };
function formatAmount(ing, factor) {
  if (ing.quantity === null || ing.quantity === undefined) return "";
  let q = ing.quantity * factor;
  let unit = ing.unit;
  if (unit === "g" && q >= 1000) [q, unit] = [q / 1000, "kg"];
  if (unit === "ml" && q >= 1000) [q, unit] = [q / 1000, "l"];
  if (q > 1 && PLURALS[unit]) unit = PLURALS[unit];
  return unit ? `${formatQuantity(q)} ${unit}` : formatQuantity(q);
}

function thumb(src, cls = "thumb") {
  return src
    ? `<img class="${cls}" src="${esc(src)}" alt="" loading="lazy">`
    : `<div class="${cls} placeholder">${ICONS.dish}</div>`;
}

function stepper(value, action, label = "") {
  return `<div class="stepper">
    <button type="button" data-action="${action}" data-delta="-1" aria-label="Fewer">−</button>
    <output>${esc(value)}${label}</output>
    <button type="button" data-action="${action}" data-delta="1" aria-label="More">+</button>
  </div>`;
}

/** Downscale a photo to keep uploads small; also converts HEIC on browsers that can decode it. */
async function resizeImage(file, maxDim = 1600, quality = 0.85) {
  let source;
  try {
    source = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    source = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Can't read ${file.name || "image"}`));
      img.src = URL.createObjectURL(file);
    });
  }
  const w = source.width || source.naturalWidth;
  const h = source.height || source.naturalHeight;
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height);
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  return { dataUrl, data: dataUrl.split(",")[1], mediaType: "image/jpeg" };
}

async function loadRecipes(force = false) {
  if (!state.recipes || force) state.recipes = await api("GET", "/api/recipes");
  return state.recipes;
}

// ---------- chrome: title bar, sheet ----------

function setChrome({ title, back = null, actions = "", tab = null }) {
  $("#title").textContent = title;
  document.title = title === "Food planner" ? title : `${title} · Food planner`;
  const backBtn = $(".topbar .back");
  backBtn.hidden = !back;
  backBtn.dataset.fallback = back || "";
  $("#topbar-actions").innerHTML = actions;
  for (const a of document.querySelectorAll(".tabbar a")) a.classList.toggle("active", a.dataset.tab === tab);
}

function openSheet(html, actions = {}) {
  state.sheetGen++;
  const sheet = $("#sheet");
  sheet.innerHTML = html;
  state.sheetActions = actions;
  sheet.hidden = false;
  $("#sheet-backdrop").hidden = false;
  document.body.style.overflow = "hidden";
}

function closeSheet() {
  state.sheetGen++;
  $("#sheet").hidden = true;
  $("#sheet-backdrop").hidden = true;
  $("#sheet").innerHTML = "";
  state.sheetActions = {};
  document.body.style.overflow = "";
}

$("#sheet-backdrop").addEventListener("click", closeSheet);

document.addEventListener("click", (event) => {
  const el = event.target.closest("[data-action]");
  if (!el) return;
  const name = el.dataset.action;
  if (name === "back") {
    // Only go back in history when the previous entry is ours (not when deep-linked, e.g. via share).
    if ((history.state?.depth ?? 0) > 0) history.back();
    else go(el.dataset.fallback || "#/plan", { replace: true });
    return;
  }
  if (name === "close-sheet") return closeSheet();
  const inSheet = el.closest("#sheet");
  const handler = inSheet ? state.sheetActions[name] : state.actions[name];
  if (handler) {
    event.preventDefault();
    Promise.resolve(handler(el, event)).catch((err) => toast(err.message, true));
  }
});

window.addEventListener("scroll", () => $(".topbar").classList.toggle("scrolled", window.scrollY > 4), { passive: true });

// ---------- router ----------

const routes = [
  [/^\/plan$/, viewPlan],
  [/^\/recipes$/, viewRecipes],
  [/^\/recipe\/(\d+)$/, viewRecipe],
  [/^\/edit\/(new|\d+)$/, viewEditor],
  [/^\/import$/, viewImport],
  [/^\/shopping$/, viewShopping],
  [/^\/settings$/, viewSettings],
];

function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/plan";
  const [path, qs = ""] = raw.split("?");
  return { path, query: Object.fromEntries(new URLSearchParams(qs)) };
}

let renderId = 0;
async function render({ keepScroll = false } = {}) {
  const { path, query } = parseHash();
  const match = routes.find(([re]) => re.test(path));
  if (!match) {
    go("#/plan", { replace: true });
    return;
  }
  const id = ++renderId;
  for (const fn of state.cleanup.splice(0)) fn();
  state.actions = {};
  closeSheet();
  const scrollY = window.scrollY;
  // Show a spinner when loading takes a moment (slow network), but avoid flicker on fast loads.
  const spinner = keepScroll ? null : setTimeout(() => id === renderId && (view.innerHTML = '<div class="working"><div class="spinner"></div></div>'), 200);
  try {
    await match[1]({ params: path.match(match[0]).slice(1), query, isCurrent: () => id === renderId });
    clearTimeout(spinner);
    if (keepScroll) window.scrollTo(0, scrollY);
    else window.scrollTo(0, 0);
  } catch (err) {
    clearTimeout(spinner);
    if (id !== renderId) return;
    view.innerHTML = `<div class="empty"><h3>Something went wrong</h3><p>${esc(err.message)}</p>
      <button class="btn secondary" data-action="retry">Try again</button></div>`;
    state.actions.retry = () => render();
  }
}

// Every history entry of the app carries its depth, so the in-app back button knows whether
// going back stays inside the app (also after hardware/browser back and forward).
let currentDepth = history.state?.depth ?? 0;
if (history.state?.depth === undefined) history.replaceState({ depth: 0 }, "");
let replacing = false;

function go(hash, { replace = false } = {}) {
  if (replace) {
    replacing = true;
    location.replace(hash);
  } else location.hash = hash;
}

window.addEventListener("hashchange", () => {
  if (history.state?.depth !== undefined) {
    currentDepth = history.state.depth; // back/forward to an existing entry
  } else {
    if (!replacing) currentDepth++;
    history.replaceState({ depth: currentDepth }, "");
  }
  replacing = false;
  render();
});

// Refresh lists when coming back to the app (another household member may have changed things).
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  api("GET", "/api/status").then((s) => (state.status = s)).catch(() => {});
  const { path } = parseHash();
  if (["/plan", "/shopping", "/recipes"].includes(path) && $("#sheet").hidden) {
    state.recipes = null;
    render({ keepScroll: true });
  }
});

// ---------- plan ----------

async function viewPlan({ query, isCurrent }) {
  const start = weekStart(query.week || todayISO());
  setChrome({
    title: "Meal plan",
    tab: "plan",
    actions: `<button class="icon-btn" data-action="settings" aria-label="Settings">${ICONS.settings}</button>`,
  });
  state.actions.settings = () => go("#/settings");
  const data = await api("GET", `/api/plan?start=${start}`);
  if (!isCurrent()) return;
  const today = data.today;

  const days = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(data.from, i);
    const entries = data.entries.filter((e) => e.date === date);
    const meals = entries
      .map((e) => {
        if (!e.recipe) {
          return `<div class="meal" data-entry="${e.id}">
            <div class="thumb placeholder">${ICONS.note}</div>
            <div class="info"><span class="note">${esc(e.note)}</span></div>
            <button class="icon-btn" data-action="entry-menu" data-id="${e.id}" aria-label="Options">${ICONS.more}</button>
          </div>`;
        }
        return `<div class="meal" data-entry="${e.id}">
          <a href="#/recipe/${e.recipe.id}?servings=${e.servings}">${thumb(e.recipe.image)}</a>
          <div class="info">
            <a href="#/recipe/${e.recipe.id}?servings=${e.servings}">${esc(e.recipe.title)}</a>
            <div class="meta">
              ${stepper(e.servings, "entry-servings", "p")}
              ${e.recipe.totalMinutes ? `<span>${e.recipe.totalMinutes} min</span>` : ""}
            </div>
          </div>
          <button class="icon-btn" data-action="entry-menu" data-id="${e.id}" aria-label="Options">${ICONS.more}</button>
        </div>`;
      })
      .join("");
    days.push(`<section class="card day ${date === today ? "today" : ""} ${date < today ? "past" : ""}">
      <div class="day-head">
        <strong>${fmt(date, { weekday: "long" })}</strong>
        <span class="muted small">${fmt(date, { day: "numeric", month: "short" })}</span>
        ${date === today ? '<span class="badge">Today</span>' : ""}
      </div>
      ${meals}
      <button class="add-meal" data-action="add-meal" data-date="${date}">${ICONS.plus} Add meal</button>
    </section>`);
  }

  const planned = data.entries.filter((e) => e.recipe).length;
  view.innerHTML = `
    ${weekNav(data.from)}
    ${days.join("")}
    ${planned ? `<a class="btn secondary block" href="#/shopping?week=${data.from}">${ICONS.cart} Shopping list for ${planned} meal${planned > 1 ? "s" : ""}</a>` : ""}
  `;

  bindWeekNav((week) => go(`#/plan?week=${week}`, { replace: true }), data.from);

  state.actions["add-meal"] = (el) => openMealPicker(el.dataset.date);

  state.actions["entry-servings"] = async (el) => {
    const id = Number(el.closest("[data-entry]").dataset.entry);
    const entry = data.entries.find((e) => e.id === id);
    const servings = Math.max(1, entry.servings + Number(el.dataset.delta));
    if (servings === entry.servings) return;
    entry.servings = servings;
    el.parentElement.querySelector("output").textContent = `${servings}p`;
    await api("PUT", `/api/plan/${id}`, { servings });
  };

  state.actions["entry-menu"] = (el) => {
    const entry = data.entries.find((e) => e.id === Number(el.dataset.id));
    const dayOptions = [];
    for (let i = -7; i < 14; i++) {
      const date = addDays(data.from, i);
      if (date === entry.date || date < addDays(today, -1)) continue;
      dayOptions.push(`<button class="option" data-action="move" data-date="${date}">
        <span class="ico">${ICONS.calendar}</span>
        <span class="text"><strong>${fmt(date, { weekday: "long", day: "numeric", month: "short" })}</strong></span>
      </button>`);
    }
    openSheet(
      `<h3>${esc(entry.recipe?.title || entry.note)}</h3>
      <div class="sheet-body"><div class="option-list">
        ${entry.recipe ? `<a class="option" href="#/recipe/${entry.recipe.id}?servings=${entry.servings}"><span class="ico">${ICONS.dish}</span><span class="text"><strong>Open recipe</strong></span></a>` : ""}
        <button class="option" data-action="remove"><span class="ico">${ICONS.trash}</span><span class="text"><strong>Remove from plan</strong></span></button>
        <h2 class="section">Move to</h2>
        ${dayOptions.join("")}
      </div></div>`,
      {
        remove: async () => {
          await api("DELETE", `/api/plan/${entry.id}`);
          closeSheet();
          render({ keepScroll: true });
        },
        move: async (b) => {
          await api("PUT", `/api/plan/${entry.id}`, { date: b.dataset.date });
          closeSheet();
          toast(`Moved to ${fmt(b.dataset.date, { weekday: "long" })}`);
          render({ keepScroll: true });
        },
      },
    );
  };
}

function weekNav(from) {
  const isThisWeek = from === weekStart(todayISO());
  return `<div class="weeknav">
    <button class="icon-btn" data-action="week" data-delta="-7" aria-label="Previous week">${ICONS.chevronLeft}</button>
    <div class="label">
      <strong>${relativeWeek(from)}</strong>
      <span class="muted small">${weekLabel(from)}</span>
      ${isThisWeek ? "" : `<br><button data-action="week" data-delta="0">Back to this week</button>`}
    </div>
    <button class="icon-btn" data-action="week" data-delta="7" aria-label="Next week">${ICONS.chevronRight}</button>
  </div>`;
}

function bindWeekNav(navigate, from) {
  state.actions.week = (el) => {
    const delta = Number(el.dataset.delta);
    navigate(delta === 0 ? weekStart(todayISO()) : addDays(from, delta));
  };
}

// ---------- recipe filters (shared by the recipe list and the meal picker) ----------

const PROTEINS = [
  ["vegetarian", "🥦", "Vegetarian"],
  ["poultry", "🐔", "Poultry"],
  ["beef", "🐄", "Beef & red meat"],
  ["pork", "🐖", "Pork"],
  ["lamb", "🐑", "Lamb"],
  ["fish", "🐟", "Fish"],
  ["seafood", "🦐", "Seafood"],
];
const PROTEIN_INFO = Object.fromEntries(PROTEINS.map(([k, icon, label]) => [k, { icon, label }]));
const TIMES = [20, 30, 45, 60];
const CHEF_TAGS = ["jeroen meus", "pascale naessens", "jamie oliver", "ottolenghi", "bbq experience center", "hellofresh"];

const emptyFilter = (course = "all") => ({ q: "", course, proteins: [], maxTime: 0, healthy: false, easy: false, kids: false, favorite: false, tags: [], sort: "az" });

function loadFilter() {
  try {
    return { ...emptyFilter(), ...JSON.parse(localStorage.getItem("recipeFilter") || "{}"), q: "" };
  } catch {
    return emptyFilter();
  }
}
let recipeFilter = loadFilter();
function saveFilter() {
  try {
    localStorage.setItem("recipeFilter", JSON.stringify({ ...recipeFilter, q: "" }));
  } catch {
    /* private mode */
  }
}

function matchesFilter(r, f) {
  if (f.course !== "all" && r.course !== f.course) return false;
  if (f.proteins.length && !f.proteins.some((p) => r.proteins.includes(p))) return false;
  if (f.maxTime && !(r.totalMinutes && r.totalMinutes <= f.maxTime)) return false;
  if (f.healthy && !r.healthy) return false;
  if (f.easy && !r.easy) return false;
  if (f.kids && !r.childFriendly) return false;
  if (f.favorite && !r.favorite) return false;
  if (f.tags.length && !f.tags.some((t) => r.tags.includes(t))) return false;
  const q = f.q.trim().toLowerCase();
  return !q || r.title.toLowerCase().includes(q) || r.ingredientNames.toLowerCase().includes(q) || r.tags.some((t) => t.includes(q));
}

function sortRecipes(list, sort) {
  const byTitle = (a, b) => a.title.localeCompare(b.title, "nl");
  if (sort === "time") return [...list].sort((a, b) => (a.totalMinutes ?? 9999) - (b.totalMinutes ?? 9999) || byTitle(a, b));
  if (sort === "forgotten") {
    // Never cooked first, then longest ago.
    const key = (r) => (r.planned?.next ? "9" : r.planned?.last ?? "0");
    return [...list].sort((a, b) => key(a).localeCompare(key(b)) || byTitle(a, b));
  }
  return [...list].sort((a, b) => Number(b.favorite) - Number(a.favorite) || byTitle(a, b));
}

/** Number of active filters, not counting the search text. */
const activeCount = (f) =>
  (f.course !== "all" ? 1 : 0) + f.proteins.length + (f.maxTime ? 1 : 0) + (f.healthy ? 1 : 0) + (f.easy ? 1 : 0) + (f.kids ? 1 : 0) + (f.favorite ? 1 : 0) + f.tags.length;

/** Quick toggle chips; `data-action="quick"` with a data-key the handler understands. */
function quickChips(f, { withFilterButton = false } = {}) {
  const chip = (key, label, on) => `<button class="chip ${on ? "active" : ""}" data-action="quick" data-key="${key}">${label}</button>`;
  const n = activeCount(f);
  return [
    withFilterButton ? `<button class="chip ${n ? "active" : ""}" data-action="filters">${ICONS.filter} Filters${n ? ` · ${n}` : ""}</button>` : "",
    chip("course:main", "Mains", f.course === "main"),
    chip("course:dessert", "🍰 Desserts", f.course === "dessert"),
    chip("course:kamado", "🔥 Kamado", f.course === "kamado"),
    chip("tag:classic", "🏠 Classics", f.tags.includes("classic")),
    chip("time:30", "⏱ ≤ 30 min", f.maxTime === 30),
    chip("healthy", "🥗 Healthy", f.healthy),
    chip("easy", "⚡ Easy", f.easy),
    chip("kids", "🧒 Kids", f.kids),
    ...PROTEINS.map(([k, icon, label]) => chip(`protein:${k}`, `${icon} ${label}`, f.proteins.includes(k))),
    withFilterButton ? chip("favorite", "★ Favorites", f.favorite) : "",
  ].join("");
}

function toggleQuick(f, key) {
  const [kind, value] = key.split(":");
  if (kind === "course") f.course = f.course === value ? "all" : value;
  else if (kind === "time") f.maxTime = f.maxTime === Number(value) ? 0 : Number(value);
  else if (kind === "protein") f.proteins = f.proteins.includes(value) ? f.proteins.filter((p) => p !== value) : [...f.proteins, value];
  else if (kind === "tag") f.tags = f.tags.includes(value) ? f.tags.filter((t) => t !== value) : [...f.tags, value];
  else if (kind === "healthy" || kind === "easy" || kind === "kids" || kind === "favorite") f[kind] = !f[kind];
}

function badges(r, { long = false } = {}) {
  const out = r.proteins.map((p) => `<span class="badge-chip">${PROTEIN_INFO[p].icon}${long ? ` ${PROTEIN_INFO[p].label}` : ""}</span>`);
  if (r.healthy) out.push(`<span class="badge-chip">🥗${long ? " Healthy" : ""}</span>`);
  if (r.easy) out.push(`<span class="badge-chip">⚡${long ? " Easy" : ""}</span>`);
  if (r.childFriendly) out.push(`<span class="badge-chip">🧒${long ? " Kids" : ""}</span>`);
  if (r.course === "dessert") out.push(`<span class="badge-chip">🍰${long ? " Dessert" : ""}</span>`);
  if (r.course === "kamado") out.push(`<span class="badge-chip">🔥${long ? " Kamado" : ""}</span>`);
  return out.join("");
}

async function openMealPicker(date) {
  const title = fmt(date, { weekday: "long", day: "numeric", month: "long" });
  openSheet(`<h3>${title}</h3><div class="spinner"></div>`);
  const gen = state.sheetGen;
  const [recipes, settings] = await Promise.all([loadRecipes(), api("GET", "/api/settings")]);
  if (gen !== state.sheetGen) return; // dismissed while loading
  // The picker starts from "mains" but keeps the user's other filters (protein, time, …).
  const f = { ...recipeFilter, q: "", course: "main", tags: [], favorite: false };
  const LIMIT = 80;
  const renderOptions = () => {
    const list = sortRecipes(recipes.filter((r) => matchesFilter(r, f)), f.sort === "az" ? "forgotten" : f.sort);
    if (!list.length) return `<p class="muted center">No recipes match.</p>`;
    return (
      list
        .slice(0, LIMIT)
        .map(
          (r) => `<button class="option" data-action="pick" data-id="${r.id}">
        ${thumb(r.image)}
        <span class="text"><strong>${esc(r.title)}</strong>
          <small>${[r.totalMinutes ? `${r.totalMinutes} min` : "", historyLabel(r.planned) || "never cooked", r.favorite ? "★" : ""].filter(Boolean).join(" · ")}</small>
        </span><span class="badges">${badges(r)}</span></button>`,
        )
        .join("") + (list.length > LIMIT ? `<p class="muted center small">${list.length - LIMIT} more – narrow it down with search or filters</p>` : "")
    );
  };
  const refresh = () => {
    $("#picker-chips").innerHTML = quickChips(f);
    $("#picker-list").innerHTML = renderOptions();
  };
  openSheet(
    `<h3>${title}</h3>
    <input class="input" id="picker-search" type="search" placeholder="Search recipes or ingredients" autocomplete="off">
    <div class="chips" id="picker-chips" style="margin-top:8px">${quickChips(f)}</div>
    <div class="sheet-body">
      <div class="option-list" id="picker-list">${renderOptions()}</div>
      <h2 class="section">Or add a note</h2>
      <form class="add-item" id="note-form">
        <input class="input" name="note" placeholder="Leftovers, eating out, …" autocomplete="off">
        <button class="btn" type="submit">Add</button>
      </form>
      ${recipes.length ? "" : `<a class="btn secondary block" href="#/import">${ICONS.plus} Import your first recipe</a>`}
    </div>`,
    {
      pick: async (el) => {
        await api("POST", "/api/plan", { date, recipeId: Number(el.dataset.id), servings: settings.defaultServings });
        closeSheet();
        render({ keepScroll: true });
      },
      quick: (el) => {
        toggleQuick(f, el.dataset.key);
        refresh();
      },
    },
  );
  $("#picker-search").addEventListener("input", (e) => {
    f.q = e.target.value;
    $("#picker-list").innerHTML = renderOptions();
  });
  $("#note-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const note = e.target.note.value.trim();
    if (!note) return;
    try {
      await api("POST", "/api/plan", { date, note, servings: settings.defaultServings });
      closeSheet();
      render({ keepScroll: true });
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ---------- recipes ----------

async function viewRecipes({ isCurrent }) {
  setChrome({ title: "Recipes", tab: "recipes" });
  const recipes = await loadRecipes(true);
  if (!isCurrent()) return;
  const PAGE = 60;
  let shownCount = PAGE;

  view.innerHTML = recipes.length
    ? `<div class="search"><input class="input" id="recipe-search" type="search" placeholder="Search ${recipes.length} recipes or ingredients" value="${esc(recipeFilter.q)}" autocomplete="off"></div>
       <div class="chips" id="quick-chips"></div>
       <div class="result-line"><span id="result-count" class="muted small"></span><button class="btn ghost small" data-action="reset" id="reset-btn">Clear filters</button></div>
       <div class="recipe-list" id="recipe-list"></div>`
    : `<div class="empty">${ICONS.dish}<h3>No recipes yet</h3>
         <p>Import a HelloFresh recipe, snap a cookbook page or type one in.</p>
         <a class="btn" href="#/import">${ICONS.plus} Add a recipe</a></div>`;
  view.insertAdjacentHTML("beforeend", `<button class="fab" data-action="new" aria-label="Add recipe">${ICONS.plus}</button>`);
  if (!recipes.length) {
    state.actions.new = () => openImportChooser();
    return;
  }

  const renderList = () => {
    const shown = sortRecipes(recipes.filter((r) => matchesFilter(r, recipeFilter)), recipeFilter.sort);
    $("#quick-chips").innerHTML = quickChips(recipeFilter, { withFilterButton: true });
    $("#result-count").textContent = `${shown.length} recipe${shown.length === 1 ? "" : "s"}`;
    $("#reset-btn").hidden = !activeCount(recipeFilter) && !recipeFilter.q;
    $("#recipe-list").innerHTML = shown.length
      ? shown
          .slice(0, shownCount)
          .map(
            (r) => `<a class="card recipe-item" href="#/recipe/${r.id}">
          ${thumb(r.image)}
          <div class="info">
            <div class="title">${r.favorite ? `<span class="fav">${ICONS.star}</span> ` : ""}${esc(r.title)}</div>
            <div class="meta">${[r.totalMinutes ? `${r.totalMinutes} min` : "", `${r.servings} servings`, historyLabel(r.planned)].filter(Boolean).join(" · ")}</div>
            <div class="badges">${badges(r)}</div>
          </div></a>`,
          )
          .join("") +
        (shown.length > shownCount ? `<button class="btn secondary block" data-action="more">Show more (${shown.length - shownCount})</button>` : "")
      : `<p class="muted center">Nothing found. ${activeCount(recipeFilter) ? "Try clearing some filters." : ""}</p>`;
    saveFilter();
  };
  renderList();

  $("#recipe-search").addEventListener("input", (e) => {
    recipeFilter.q = e.target.value;
    shownCount = PAGE;
    renderList();
  });
  state.actions.quick = (el) => {
    toggleQuick(recipeFilter, el.dataset.key);
    shownCount = PAGE;
    renderList();
  };
  state.actions.more = () => {
    shownCount += PAGE;
    renderList();
  };
  state.actions.reset = () => {
    recipeFilter = emptyFilter();
    $("#recipe-search").value = "";
    shownCount = PAGE;
    renderList();
  };
  state.actions.filters = () => openFilterSheet(recipes, () => {
    shownCount = PAGE;
    renderList();
  });
  state.actions.new = () => openImportChooser();
}

/** Full filter sheet: course, protein, time, healthy/easy, chef/source and sorting. */
function openFilterSheet(recipes, onChange) {
  const tagCounts = new Map();
  for (const r of recipes) for (const t of r.tags) tagCounts.set(t, (tagCounts.get(t) || 0) + 1);
  const chefs = CHEF_TAGS.filter((t) => tagCounts.has(t));
  const otherTags = [...tagCounts.entries()].filter(([t]) => !CHEF_TAGS.includes(t)).sort((a, b) => b[1] - a[1]).slice(0, 16).map(([t]) => t);
  const f = recipeFilter;
  const chip = (key, label, on) => `<button class="chip ${on ? "active" : ""}" data-action="quick" data-key="${esc(key)}">${label}</button>`;
  const body = () => {
    const count = recipes.filter((r) => matchesFilter(r, f)).length;
    return `<h3>Filters</h3>
    <div class="sheet-body filter-sheet">
      <h2 class="section">Course</h2>
      <div class="chip-wrap">${chip("course:main", "Mains", f.course === "main")}${chip("course:dessert", "🍰 Desserts", f.course === "dessert")}${chip("course:kamado", "🔥 Kamado", f.course === "kamado")}</div>
      <h2 class="section">Protein</h2>
      <div class="chip-wrap">${PROTEINS.map(([k, icon, label]) => chip(`protein:${k}`, `${icon} ${label}`, f.proteins.includes(k))).join("")}</div>
      <h2 class="section">Ready in</h2>
      <div class="chip-wrap">${TIMES.map((t) => chip(`time:${t}`, `≤ ${t} min`, f.maxTime === t)).join("")}</div>
      <h2 class="section">Type</h2>
      <div class="chip-wrap">${chip("healthy", "🥗 Healthy", f.healthy)}${chip("easy", "⚡ Easy (few ingredients)", f.easy)}${chip("kids", "🧒 Child-friendly", f.kids)}${chip("favorite", "★ Favorites", f.favorite)}</div>
      ${chefs.length ? `<h2 class="section">Chef</h2><div class="chip-wrap">${chefs.map((t) => chip(`tag:${t}`, esc(t), f.tags.includes(t))).join("")}</div>` : ""}
      ${otherTags.length ? `<h2 class="section">Tags</h2><div class="chip-wrap">${otherTags.map((t) => chip(`tag:${t}`, esc(t), f.tags.includes(t))).join("")}</div>` : ""}
      <h2 class="section">Sort</h2>
      <div class="segmented">${[["az", "A–Z"], ["time", "Quickest"], ["forgotten", "Not cooked lately"]]
        .map(([k, l]) => `<button data-action="sort" data-sort="${k}" class="${f.sort === k ? "active" : ""}">${l}</button>`)
        .join("")}</div>
    </div>
    <div class="row" style="margin-top:12px">
      <button class="btn secondary" data-action="clear">Clear</button>
      <button class="btn" style="flex:1" data-action="close-sheet">Show ${count} recipe${count === 1 ? "" : "s"}</button>
    </div>`;
  };
  const rerender = () => {
    const scroll = $("#sheet .sheet-body")?.scrollTop ?? 0;
    $("#sheet").innerHTML = body();
    $("#sheet .sheet-body").scrollTop = scroll;
    onChange();
  };
  openSheet(body(), {
    quick: (el) => {
      toggleQuick(f, el.dataset.key);
      rerender();
    },
    sort: (el) => {
      f.sort = el.dataset.sort;
      rerender();
    },
    clear: () => {
      Object.assign(f, emptyFilter(), { q: f.q });
      rerender();
    },
  });
}

function openImportChooser() {
  openSheet(
    `<h3>Add a recipe</h3>
    <div class="sheet-body"><div class="option-list">
      <a class="option" href="#/import?tab=photos"><span class="ico">${ICONS.camera}</span><span class="text"><strong>Cookbook photos</strong><small>Snap one or more pages${state.status.ai ? "" : " · needs AI key"}</small></span></a>
      <a class="option" href="#/import?tab=link"><span class="ico">${ICONS.link}</span><span class="text"><strong>Web link</strong><small>HelloFresh or any recipe website</small></span></a>
      <a class="option" href="#/import?tab=text"><span class="ico">${ICONS.text}</span><span class="text"><strong>Paste text</strong><small>From a message, note or e-mail${state.status.ai ? "" : " · needs AI key"}</small></span></a>
      <a class="option" href="#/edit/new"><span class="ico">${ICONS.pen}</span><span class="text"><strong>Write it yourself</strong><small>Start from an empty recipe</small></span></a>
    </div></div>`,
  );
}

// ---------- recipe detail ----------

let wakeLock = null;
async function setWakeLock(on) {
  try {
    if (on && "wakeLock" in navigator) {
      wakeLock = await navigator.wakeLock.request("screen");
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    /* not supported / not allowed */
  }
}

async function viewRecipe({ params, query, isCurrent }) {
  const recipe = await api("GET", `/api/recipes/${params[0]}`);
  if (!isCurrent()) return;
  let servings = Number(query.servings) || recipe.servings;
  const doneIngredients = new Set();
  const doneSteps = new Set();

  setChrome({
    title: recipe.title,
    back: "#/recipes",
    actions: `<button class="icon-btn ${recipe.favorite ? "on" : ""}" data-action="favorite" aria-label="Favorite">${ICONS.star}</button>
              <button class="icon-btn" data-action="menu" aria-label="More">${ICONS.more}</button>`,
  });

  const ingredientRows = (list, factor) =>
    list
      .map(
        (ing, i) => `<li data-action="toggle-ing" data-i="${ing.__i}" class="${doneIngredients.has(ing.__i) ? "done" : ""}">
        <span class="qty">${esc(formatAmount(ing, factor))}</span>
        <span>${esc(ing.name)}${ing.note ? ` <span class="note">${esc(ing.note)}</span>` : ""}</span></li>`,
      )
      .join("");

  const renderIngredients = () => {
    const factor = servings / recipe.servings;
    const all = recipe.ingredients.map((ing, i) => ({ ...ing, __i: i }));
    const main = all.filter((i) => !i.pantry);
    const pantry = all.filter((i) => i.pantry);
    $("#ingredients").innerHTML = `
      ${main.length ? `<ul class="card ingredients">${ingredientRows(main, factor)}</ul>` : ""}
      ${pantry.length ? `<h2 class="section">From the pantry</h2><ul class="card ingredients">${ingredientRows(pantry, factor)}</ul>` : ""}
      ${recipe.ingredients.length ? "" : `<p class="muted">No ingredients yet.</p>`}`;
    $("#servings-stepper output").textContent = `${servings}`;
  };

  let source = "";
  if (recipe.sourceUrl) {
    try {
      source = `<a href="${esc(recipe.sourceUrl)}" target="_blank" rel="noopener">${esc(new URL(recipe.sourceUrl).hostname.replace(/^www\./, ""))}</a>`;
    } catch {
      /* invalid url */
    }
  }

  view.innerHTML = `
    ${recipe.image ? `<img class="hero" src="${esc(recipe.image)}" alt="">` : ""}
    <h1 class="recipe-title">${esc(recipe.title)}</h1>
    <div class="recipe-meta">
      ${recipe.totalMinutes ? `<span>${ICONS.clock}${recipe.totalMinutes} min</span>` : ""}
      ${source ? `<span>${ICONS.link}${source}</span>` : ""}
      ${historyLabel(recipe.planned) ? `<span>${ICONS.calendar}${recipe.planned.count ? `${recipe.planned.count}× · ` : ""}${historyLabel(recipe.planned)}</span>` : ""}
    </div>
    <div class="badges long">${badges(recipe, { long: true })}</div>
    ${recipe.tags.length ? `<div class="chips" style="margin-top:10px">${recipe.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</div>` : ""}
    ${recipe.description ? `<p class="description">${esc(recipe.description)}</p>` : ""}

    <div class="recipe-actions">
      <button class="btn" data-action="plan">${ICONS.calendar} Add to plan</button>
      <span id="servings-stepper">${stepper(servings, "servings")}</span>
    </div>

    <h2 class="section">Ingredients · for <span id="servings-label">${servings}</span></h2>
    <div id="ingredients"></div>

    ${recipe.steps.length ? `<h2 class="section">Method</h2><ol class="steps">${recipe.steps.map((s, i) => `<li class="card" data-action="toggle-step" data-i="${i}">${esc(s)}</li>`).join("")}</ol>` : ""}
    ${recipe.notes ? `<h2 class="section">Notes</h2><div class="card" style="padding:14px;white-space:pre-line">${esc(recipe.notes)}</div>` : ""}

    <label class="card cook-toggle">
      <span><strong>Cook mode</strong><br><span class="muted small">Keep the screen on while cooking</span></span>
      <span class="switch"><input type="checkbox" id="cook-mode" ${wakeLock ? "checked" : ""}><span></span></span>
    </label>
  `;
  renderIngredients();

  const cook = $("#cook-mode");
  cook.addEventListener("change", () => setWakeLock(cook.checked));
  const reacquire = () => document.visibilityState === "visible" && cook.checked && setWakeLock(true);
  document.addEventListener("visibilitychange", reacquire);
  state.cleanup.push(() => {
    document.removeEventListener("visibilitychange", reacquire);
    setWakeLock(false);
  });

  state.actions.servings = (el) => {
    servings = Math.max(1, servings + Number(el.dataset.delta));
    $("#servings-label").textContent = servings;
    renderIngredients();
  };
  state.actions["toggle-ing"] = (el) => {
    const i = Number(el.dataset.i);
    doneIngredients.has(i) ? doneIngredients.delete(i) : doneIngredients.add(i);
    el.classList.toggle("done");
  };
  state.actions["toggle-step"] = (el) => {
    const i = Number(el.dataset.i);
    doneSteps.has(i) ? doneSteps.delete(i) : doneSteps.add(i);
    el.classList.toggle("done");
  };
  state.actions.favorite = async (el) => {
    recipe.favorite = !recipe.favorite;
    el.classList.toggle("on", recipe.favorite);
    await api("PATCH", `/api/recipes/${recipe.id}`, { favorite: recipe.favorite });
    state.recipes = null;
  };
  state.actions.plan = () => openPlanPicker(recipe, () => servings);
  state.actions.menu = () =>
    openSheet(
      `<h3>${esc(recipe.title)}</h3>
      <div class="sheet-body"><div class="option-list">
        <a class="option" href="#/edit/${recipe.id}"><span class="ico">${ICONS.edit}</span><span class="text"><strong>Edit recipe</strong></span></a>
        ${recipe.sourceUrl ? `<a class="option" href="${esc(recipe.sourceUrl)}" target="_blank" rel="noopener"><span class="ico">${ICONS.external}</span><span class="text"><strong>Open original</strong></span></a>` : ""}
        <button class="option" data-action="delete"><span class="ico">${ICONS.trash}</span><span class="text"><strong>Delete recipe</strong><small>Also removes it from the plan</small></span></button>
      </div></div>`,
      {
        delete: (el) => {
          if (el.dataset.confirm) {
            return api("DELETE", `/api/recipes/${recipe.id}`).then(() => {
              state.recipes = null;
              closeSheet();
              toast("Recipe deleted");
              go("#/recipes", { replace: true });
            });
          }
          el.dataset.confirm = "1";
          el.querySelector("strong").textContent = "Tap again to delete";
          el.style.boxShadow = "0 0 0 2px var(--danger)";
        },
      },
    );
}

async function openPlanPicker(recipe, getServings) {
  openSheet(`<h3>Plan “${esc(recipe.title)}”</h3><div class="spinner"></div>`);
  const gen = state.sheetGen;
  const today = todayISO();
  const data = await api("GET", `/api/plan?start=${today}&days=21`);
  if (gen !== state.sheetGen) return;
  const options = [];
  for (let i = 0; i < 14; i++) {
    const date = addDays(today, i);
    const planned = data.entries.filter((e) => e.date === date);
    const label = i === 0 ? "Today" : i === 1 ? "Tomorrow" : fmt(date, { weekday: "long" });
    options.push(`<button class="option" data-action="plan-day" data-date="${date}">
      <span class="ico">${ICONS.calendar}</span>
      <span class="text"><strong>${label} <span class="muted small">${fmt(date, { day: "numeric", month: "short" })}</span></strong>
      <small>${planned.length ? esc(planned.map((e) => e.recipe?.title || e.note).join(", ")) : "Nothing planned"}</small></span>
    </button>`);
  }
  openSheet(
    `<h3>Plan “${esc(recipe.title)}” for ${getServings()}</h3><div class="sheet-body"><div class="option-list">${options.join("")}</div></div>`,
    {
      "plan-day": async (el) => {
        await api("POST", "/api/plan", { date: el.dataset.date, recipeId: recipe.id, servings: getServings() });
        closeSheet();
        toast(`Planned for ${fmt(el.dataset.date, { weekday: "long", day: "numeric", month: "short" })}`);
      },
    },
  );
}

// ---------- import ----------

async function viewImport({ query, isCurrent }) {
  if (query.tab) state.importTab = query.tab;
  if (query.url) state.importTab = "link";
  setChrome({ title: "Add recipe", back: "#/recipes", tab: "recipes" });

  const aiNote = state.status.ai
    ? ""
    : `<p class="hint">AI reading is not configured on the server (ANTHROPIC_API_KEY), so this option is unavailable.</p>`;

  const tabs = `<div class="segmented">
    ${[["link", "Link"], ["photos", "Photos"], ["text", "Text"]]
      .map(([k, l]) => `<button data-action="tab" data-tab="${k}" class="${state.importTab === k ? "active" : ""}">${l}</button>`)
      .join("")}
  </div>`;

  const panels = {
    link: `<form id="import-form">
      <label class="field"><span>Recipe URL</span>
        <input class="input" name="url" type="url" inputmode="url" placeholder="https://www.hellofresh.be/recipes/…" value="${esc(query.url || state.lastImportUrl || "")}" autocomplete="off">
      </label>
      <div class="row">
        ${navigator.clipboard?.readText ? `<button class="btn secondary" type="button" data-action="paste">Paste</button>` : ""}
        <button class="btn" type="submit" style="flex:1">Import</button>
      </div>
      <p class="hint">Works with HelloFresh and most recipe websites. Tip: install this app on your home screen, then use <em>Share → Food</em> from the HelloFresh app or your browser.</p>
    </form>`,
    photos: `<div class="capture-buttons">
        <label class="big-option">${ICONS.camera}Take photo<input type="file" accept="image/*" capture="environment" id="photo-camera"></label>
        <label class="big-option">${ICONS.images}Choose photos<input type="file" accept="image/*" multiple id="photo-library"></label>
      </div>
      <div class="photo-grid" id="photo-grid"></div>
      <label class="card cook-toggle" id="use-photo-row" hidden>
        <span><strong>Use first photo as picture</strong><br><span class="muted small">Handy when the page shows the dish</span></span>
        <span class="switch"><input type="checkbox" id="use-photo" checked><span></span></span>
      </label>
      <button class="btn block" data-action="read-photos" id="read-photos" style="margin-top:16px" ${state.photos.length && state.status.ai ? "" : "disabled"}>Read recipe</button>
      <p class="hint">Add every page of the recipe – ingredients and method may be on different pages.</p>
      ${aiNote}`,
    text: `<form id="text-form">
      <label class="field"><span>Recipe text</span>
        <textarea class="input" name="text" rows="12" placeholder="Paste the full recipe: ingredients and method"></textarea>
      </label>
      <button class="btn block" type="submit" ${state.status.ai ? "" : "disabled"}>Read recipe</button>
      ${aiNote}
    </form>`,
  };

  view.innerHTML = `${tabs}<div id="import-panel">${panels[state.importTab]}</div>`;

  const working = (message) => {
    $("#import-panel").innerHTML = `<div class="working"><div class="spinner"></div><p>${esc(message)}</p></div>`;
    for (const b of document.querySelectorAll(".segmented button")) b.disabled = true;
  };

  const finish = (draft, image = null) => {
    if (!isCurrent()) return; // user navigated away while importing
    state.draft = draft;
    state.draftImage = image;
    state.photos = [];
    state.lastImportUrl = "";
    go("#/edit/new", { replace: true });
  };

  const fail = (err) => {
    if (!isCurrent()) return;
    toast(err.message, true);
    // Drop ?url= so a shared link that fails is not imported again (and again) on re-render.
    if (location.hash === "#/import") render();
    else go("#/import", { replace: true });
  };

  state.actions.tab = (el) => {
    state.importTab = el.dataset.tab;
    if (location.hash === "#/import") render();
    else go("#/import", { replace: true });
  };

  const runUrlImport = async (url) => {
    state.lastImportUrl = url;
    working("Fetching the recipe…");
    try {
      finish(await api("POST", "/api/import/url", { url }));
    } catch (err) {
      fail(err);
    }
  };

  if (state.importTab === "link") {
    const form = $("#import-form");
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const url = form.url.value.trim();
      if (url) runUrlImport(url);
    });
    state.actions.paste = async () => {
      const text = await navigator.clipboard.readText();
      const m = text.match(/https?:\/\/\S+/);
      form.url.value = m ? m[0] : text.trim();
    };
    // Coming from the share target: start right away.
    if (query.url && isCurrent()) runUrlImport(query.url);
  }

  if (state.importTab === "photos") {
    const renderGrid = () => {
      $("#photo-grid").innerHTML = state.photos
        .map(
          (p, i) => `<figure><img src="${p.dataUrl}" alt="Page ${i + 1}"><span class="page">${i + 1}</span>
          <button data-action="remove-photo" data-i="${i}" aria-label="Remove">${ICONS.close}</button></figure>`,
        )
        .join("");
      $("#read-photos").disabled = !state.photos.length || !state.status.ai;
      $("#use-photo-row").hidden = !state.photos.length;
    };
    const addFiles = async (input) => {
      const files = [...input.files];
      input.value = "";
      for (const file of files) {
        try {
          state.photos.push(await resizeImage(file));
        } catch (err) {
          toast(err.message, true);
        }
      }
      renderGrid();
    };
    $("#photo-camera").addEventListener("change", (e) => addFiles(e.target));
    $("#photo-library").addEventListener("change", (e) => addFiles(e.target));
    renderGrid();
    state.actions["remove-photo"] = (el) => {
      state.photos.splice(Number(el.dataset.i), 1);
      renderGrid();
    };
    state.actions["read-photos"] = async () => {
      const usePhoto = $("#use-photo").checked;
      const photos = state.photos;
      working(`Reading ${photos.length > 1 ? `${photos.length} pages` : "the page"}… this can take up to a minute.`);
      try {
        const draft = await api("POST", "/api/import/photos", { images: photos.map(({ data, mediaType }) => ({ data, mediaType })) });
        finish(draft, usePhoto ? photos[0] : null);
      } catch (err) {
        state.photos = photos;
        fail(err);
      }
    };
  }

  if (state.importTab === "text") {
    const form = $("#text-form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = form.text.value.trim();
      if (!text) return;
      working("Reading the recipe…");
      try {
        finish(await api("POST", "/api/import/text", { text }));
      } catch (err) {
        fail(err);
      }
    });
  }
}

// ---------- editor ----------

async function viewEditor({ params, isCurrent }) {
  const isNew = params[0] === "new";
  let recipe;
  if (isNew) {
    recipe = state.draft || { title: "", description: "", servings: 2, totalMinutes: null, image: null, sourceUrl: null, tags: [], ingredientsText: "", stepsText: "", notes: "", sourceType: "manual" };
  } else {
    recipe = await api("GET", `/api/recipes/${params[0]}`);
    if (!isCurrent()) return;
  }
  let pendingImage = isNew ? state.draftImage : null;
  let imageUrl = recipe.image || null;
  // A draft belongs to this one visit of the editor; don't let it resurface on a later "new recipe".
  state.cleanup.push(() => {
    state.draft = null;
    state.draftImage = null;
  });

  setChrome({ title: isNew ? (state.draft ? "Check recipe" : "New recipe") : "Edit recipe", back: isNew ? "#/recipes" : `#/recipe/${recipe.id}` });

  const imageBlock = () => {
    const src = pendingImage?.dataUrl || imageUrl;
    return `<div class="editor-image ${src ? "" : "empty-img"}" id="editor-image">
      ${src ? `<img src="${esc(src)}" alt="">` : `<span class="muted">${ICONS.images}</span>`}
      <div class="overlay">
        ${src ? `<button type="button" class="btn small" data-action="remove-image">Remove</button>` : ""}
        <label class="btn small">${src ? "Change" : "Add photo"}<input type="file" accept="image/*" id="image-input"></label>
      </div>
    </div>`;
  };

  view.innerHTML = `
    ${isNew && state.draft ? `<p class="hint" style="margin:0 0 12px">Imported – check the details and save. Ingredient lines below “Pantry:” are kept off the shopping list.</p>` : ""}
    <form id="editor">
      <div id="image-slot">${imageBlock()}</div>
      <label class="field"><span>Title</span><input class="input" name="title" required value="${esc(recipe.title)}"></label>
      <div class="field-row">
        <label class="field"><span>Servings</span><input class="input" name="servings" type="number" inputmode="numeric" min="1" max="50" value="${esc(recipe.servings)}"></label>
        <label class="field"><span>Time (min)</span><input class="input" name="totalMinutes" type="number" inputmode="numeric" min="0" value="${esc(recipe.totalMinutes ?? "")}"></label>
      </div>
      <label class="field"><span>Ingredients</span>
        <textarea class="input" name="ingredientsText" rows="10" placeholder="200 g kipfilet&#10;1 rode ui&#10;&#10;Pantry:&#10;2 el olijfolie">${esc(recipe.ingredientsText)}</textarea>
        <p class="hint">One per line, e.g. “200 g kipfilet”. Lines below “Pantry:” are basics you usually have.</p>
      </label>
      <label class="field"><span>Method</span>
        <textarea class="input" name="stepsText" rows="10" placeholder="Leave an empty line between steps">${esc(recipe.stepsText)}</textarea>
      </label>
      <label class="field"><span>Short description</span><textarea class="input" name="description" rows="2">${esc(recipe.description)}</textarea></label>
      <label class="field"><span>Tags</span><input class="input" name="tags" value="${esc(recipe.tags.join(", "))}" placeholder="pasta, vegetarian, quick"></label>
      <label class="field"><span>Notes</span><textarea class="input" name="notes" rows="3" placeholder="Your tweaks, wine pairing, …">${esc(recipe.notes)}</textarea></label>
      <label class="field"><span>Source link</span><input class="input" name="sourceUrl" type="url" inputmode="url" value="${esc(recipe.sourceUrl ?? "")}"></label>
      <div class="save-bar">
        <button class="btn" type="submit">${ICONS.check} Save recipe</button>
      </div>
    </form>`;

  const rebindImage = () => {
    $("#image-slot").innerHTML = imageBlock();
    $("#image-input").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        pendingImage = await resizeImage(file, 1400, 0.82);
        rebindImage();
      } catch (err) {
        toast(err.message, true);
      }
    });
  };
  rebindImage();
  state.actions["remove-image"] = () => {
    pendingImage = null;
    imageUrl = null;
    rebindImage();
  };

  const form = $("#editor");
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    const body = {
      title: form.title.value,
      servings: form.servings.value,
      totalMinutes: form.totalMinutes.value,
      ingredientsText: form.ingredientsText.value,
      stepsText: form.stepsText.value,
      description: form.description.value,
      tags: form.tags.value,
      notes: form.notes.value,
      sourceUrl: form.sourceUrl.value,
      sourceType: recipe.sourceType,
      // With a new photo pending, keep the current image until the upload replaces it.
      image: pendingImage ? undefined : imageUrl,
    };
    try {
      const saved = isNew ? await api("POST", "/api/recipes", body) : await api("PUT", `/api/recipes/${recipe.id}`, body);
      if (pendingImage) {
        await api("POST", `/api/recipes/${saved.id}/image`, { data: pendingImage.data, mediaType: pendingImage.mediaType }).catch((err) =>
          toast(`Saved, but the photo failed: ${err.message}`, true),
        );
      }
      state.draft = null;
      state.draftImage = null;
      state.recipes = null;
      toast("Recipe saved");
      go(`#/recipe/${saved.id}`, { replace: true });
    } catch (err) {
      button.disabled = false;
      toast(err.message, true);
    }
  });
}

// ---------- shopping ----------

async function viewShopping({ query, isCurrent }) {
  const week = weekStart(query.week || todayISO());
  setChrome({ title: "Shopping list", tab: "shopping" });
  const [data, settings] = await Promise.all([api("GET", `/api/shopping?week=${week}`), api("GET", "/api/settings")]);
  if (!isCurrent()) return;

  const itemRow = (i) => `<div class="item ${i.checked ? "checked" : ""}" data-key="${esc(i.key)}">
      <button class="check" data-action="check" aria-label="Got it">${ICONS.check}</button>
      <div class="body" data-action="check">
        <div class="name">${esc(i.name)}</div>
        <div class="from">${i.needed ? "pantry · " : ""}${esc(i.recipes.join(", "))}</div>
      </div>
      <span class="amount">${esc(i.amountText)}</span>
      ${i.needed && !i.checked ? `<button class="icon-btn remove" data-action="unneed" aria-label="Don't need">${ICONS.close}</button>` : ""}
    </div>`;
  const extraRow = (x) => `<div class="item ${x.checked ? "checked" : ""}" data-extra="${x.id}">
      <button class="check" data-action="check-extra" aria-label="Got it">${ICONS.check}</button>
      <div class="body" data-action="check-extra"><div class="name">${esc(x.text)}</div></div>
      <button class="icon-btn remove" data-action="delete-extra" aria-label="Delete">${ICONS.close}</button>
    </div>`;

  const todo = [...data.items.filter((i) => !i.checked).map(itemRow), ...data.extras.filter((x) => !x.checked).map(extraRow)];
  const done = [...data.items.filter((i) => i.checked).map(itemRow), ...data.extras.filter((x) => x.checked).map(extraRow)];
  const nothingPlanned = data.meals === 0 && data.extras.length === 0;

  view.innerHTML = `
    ${weekNav(data.week)}
    <form class="add-item" id="extra-form">
      <input class="input" name="text" placeholder="Add something else…" autocomplete="off" enterkeyhint="done">
      <button class="btn" type="submit" aria-label="Add">${ICONS.plus}</button>
    </form>
    ${
      nothingPlanned
        ? `<div class="empty">${ICONS.cart}<h3>Nothing planned</h3><p>Plan some meals for this week and the ingredients show up here.</p>
           <a class="btn secondary" href="#/plan?week=${data.week}">Go to the plan</a></div>`
        : `
      <h2 class="section">To buy · ${todo.length}</h2>
      ${todo.length ? `<div class="card list">${todo.join("")}</div>` : `<p class="muted center">All done 🎉</p>`}
      ${
        data.pantry.length
          ? `<details class="collapsible"><summary><h2 class="section">Check your pantry · ${data.pantry.length}</h2></summary>
             <div class="card list">${data.pantry
               .map(
                 (i) => `<div class="item" data-key="${esc(i.key)}">
                   <div class="body"><div class="name">${esc(i.name)}</div><div class="from">${esc(i.recipes.join(", "))}</div></div>
                   <span class="amount">${esc(i.amountText)}</span>
                   <button class="btn small secondary need" data-action="need">Need</button>
                 </div>`,
               )
               .join("")}</div></details>`
          : ""
      }
      ${done.length ? `<details class="collapsible" open><summary><h2 class="section">In the basket · ${done.length}</h2></summary><div class="card list">${done.join("")}</div></details>` : ""}
      `
    }
    <div class="bring-bar">
      ${
        state.status.bring
          ? `<button class="btn" data-action="bring" ${todo.length ? "" : "disabled"}>${ICONS.cart} ${settings.bringListUuid ? `Send ${todo.length} to Bring!` : "Set up Bring!"}</button>`
          : ""
      }
      <button class="btn secondary ${state.status.bring ? "share" : ""}" data-action="share" aria-label="Share list" ${todo.length ? "" : "disabled"}>${ICONS.share}${state.status.bring ? "" : " Share list"}</button>
    </div>`;

  bindWeekNav((w) => go(`#/shopping?week=${w}`, { replace: true }), data.week);
  const refresh = () => render({ keepScroll: true });

  $("#extra-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = e.target.text.value.trim();
    if (!text) return;
    try {
      await api("POST", "/api/shopping/extras", { week: data.week, text });
      await refresh();
      $("#extra-form input")?.focus();
    } catch (err) {
      toast(err.message, true);
    }
  });

  state.actions.check = async (el) => {
    const row = el.closest("[data-key]");
    const item = data.items.find((i) => i.key === row.dataset.key);
    row.classList.toggle("checked");
    await api("PUT", "/api/shopping/check", { week: data.week, key: item.key, checked: !item.checked });
    setTimeout(refresh, 250);
  };
  state.actions.need = async (el) => {
    await api("PUT", "/api/shopping/check", { week: data.week, key: `need:${el.closest("[data-key]").dataset.key}`, checked: true });
    refresh();
  };
  state.actions.unneed = async (el) => {
    await api("PUT", "/api/shopping/check", { week: data.week, key: `need:${el.closest("[data-key]").dataset.key}`, checked: false });
    refresh();
  };
  state.actions["check-extra"] = async (el) => {
    const row = el.closest("[data-extra]");
    const extra = data.extras.find((x) => x.id === Number(row.dataset.extra));
    row.classList.toggle("checked");
    await api("PUT", `/api/shopping/extras/${extra.id}`, { checked: !extra.checked });
    setTimeout(refresh, 250);
  };
  state.actions["delete-extra"] = async (el) => {
    await api("DELETE", `/api/shopping/extras/${el.closest("[data-extra]").dataset.extra}`);
    refresh();
  };
  state.actions.bring = async (el) => {
    if (!settings.bringListUuid) return go("#/settings");
    el.disabled = true;
    try {
      const res = await api("POST", "/api/shopping/bring", { week: data.week });
      toast(`Sent ${res.sent} item${res.sent === 1 ? "" : "s"} to ${res.list || "Bring!"}`);
    } finally {
      el.disabled = false;
    }
  };
  state.actions.share = async () => {
    const lines = [
      ...data.items.filter((i) => !i.checked).map((i) => `• ${i.name}${i.amountText ? ` – ${i.amountText}` : ""}`),
      ...data.extras.filter((x) => !x.checked).map((x) => `• ${x.text}`),
    ];
    const text = `Shopping list (${weekLabel(data.week)})\n${lines.join("\n")}`;
    if (navigator.share) {
      try {
        await navigator.share({ text });
      } catch {
        /* cancelled */
      }
    } else {
      await navigator.clipboard.writeText(text);
      toast("Copied to clipboard");
    }
  };
}

// ---------- settings ----------

async function viewSettings({ isCurrent }) {
  setChrome({ title: "Settings", back: "#/plan" });
  const settings = await api("GET", "/api/settings");
  if (!isCurrent()) return;

  view.innerHTML = `
    <form id="settings-form">
      <div class="card settings-group">
        <label class="field"><span>Default servings when planning</span>
          <input class="input" name="defaultServings" type="number" inputmode="numeric" min="1" max="50" value="${settings.defaultServings}">
        </label>
        <label class="field" style="margin-bottom:0"><span>Pantry staples</span>
          <textarea class="input" name="pantryStaples" rows="5">${esc(settings.pantryStaples.join("\n"))}</textarea>
          <p class="hint">One per line. These never land on the shopping list unless you tap “Need”.</p>
        </label>
      </div>

      <div class="card settings-group">
        <h3 style="margin:0 0 4px">Bring!</h3>
        ${
          state.status.bring
            ? `<label class="field" style="margin:12px 0 0"><span>Shopping list</span>
                 <select class="input" name="bringList" id="bring-list"><option value="">Loading lists…</option></select></label>`
            : `<p class="muted small" style="margin:0">Not configured. Set <code>BRING_EMAIL</code> and <code>BRING_PASSWORD</code> on the server to send shopping lists to Bring!.</p>`
        }
      </div>

      <div class="card settings-group">
        <h3 style="margin:0 0 8px">AI recipe reading</h3>
        <p class="small" style="margin:0"><span class="status-dot ${state.status.ai ? "ok" : ""}"></span>${
          state.status.ai ? "Enabled – cookbook photos and pasted text can be imported." : "Disabled – set <code>ANTHROPIC_API_KEY</code> on the server to read cookbook photos."
        }</p>
      </div>

      <button class="btn block" type="submit">Save settings</button>
    </form>`;

  let lists = [];
  if (state.status.bring) {
    api("GET", "/api/bring/lists")
      .then((l) => {
        lists = l;
        const select = $("#bring-list");
        if (!select) return;
        select.innerHTML =
          `<option value="">— choose a list —</option>` +
          lists.map((x) => `<option value="${esc(x.listUuid)}" ${x.listUuid === settings.bringListUuid ? "selected" : ""}>${esc(x.name)}</option>`).join("");
      })
      .catch((err) => {
        const select = $("#bring-list");
        if (select) select.innerHTML = `<option value="">${esc(err.message)}</option>`;
      });
  }

  $("#settings-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const body = { defaultServings: form.defaultServings.value, pantryStaples: form.pantryStaples.value };
    if (form.bringList && lists.length) {
      body.bringListUuid = form.bringList.value;
      body.bringListName = lists.find((l) => l.listUuid === form.bringList.value)?.name || "";
    }
    try {
      await api("PUT", "/api/settings", body);
      toast("Settings saved");
    } catch (err) {
      toast(err.message, true);
    }
  });
}

// ---------- boot ----------

async function boot() {
  try {
    state.status = await api("GET", "/api/status");
  } catch {
    /* offline: keep defaults */
  }
  render();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
}

boot();
