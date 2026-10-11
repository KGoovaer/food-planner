// Minimal client for the (unofficial) Bring! shopping list API, modelled on https://github.com/miaucl/bring-api.
// Bring! stores catalog items under German keys ("Milch") and translates them per list language, so item
// names are mapped back to their catalog key when they match; anything else is added as a custom item.

const API = "https://api.getbring.com/rest";
const LOCALES = "https://web.getbring.com/locale";
const SUPPORTED_LOCALES = ["de-AT", "de-CH", "de-DE", "en-AU", "en-CA", "en-GB", "en-US", "es-ES", "fr-CH", "fr-FR", "hu-HU", "it-CH", "it-IT", "nb-NO", "nl-NL", "pl-PL", "pt-BR", "ru-RU", "sv-SE", "tr-TR"];
const LANG_TO_LOCALE: Record<string, string> = {
  de: "de-DE", en: "en-US", es: "es-ES", fr: "fr-FR", hu: "hu-HU", it: "it-IT", nb: "nb-NO", nl: "nl-NL", pl: "pl-PL", pt: "pt-BR", ru: "ru-RU", sv: "sv-SE", tr: "tr-TR",
};

export interface BringList {
  listUuid: string;
  name: string;
}

export interface BringItem {
  name: string;
  spec: string;
}

export class BringError extends Error {
  status: number;
  constructor(message: string, status = 502) {
    super(message);
    this.status = status;
  }
}

interface Session {
  uuid: string;
  token: string;
  expiresAt: number;
  country: string;
  userLocale: string;
  listLocales: Map<string, string>;
}

export class BringClient {
  private session: Session | null = null;
  private catalogs = new Map<string, Map<string, string>>();
  private email: string;
  private password: string;

  constructor(email: string, password: string) {
    this.email = email;
    this.password = password;
  }

  private headers(s: Session | null): Record<string, string> {
    const h: Record<string, string> = {
      "X-BRING-API-KEY": "cof4Nc6D8saplXjE3h3HXqHH8m7VU2i1Gs0g85Sp",
      "X-BRING-CLIENT": "android",
      "X-BRING-APPLICATION": "bring",
      "X-BRING-COUNTRY": s?.country ?? "DE",
    };
    if (s) {
      h["X-BRING-USER-UUID"] = s.uuid;
      h.Authorization = `Bearer ${s.token}`;
    }
    return h;
  }

  private async request<T>(method: string, path: string, body?: unknown, retried = false): Promise<T> {
    const s = await this.login();
    const headers = this.headers(s);
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const res = await fetch(`${API}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401) {
      this.session = null;
      if (!retried) return this.request(method, path, body, true);
      throw new BringError("Bring! rejected the session.", 502);
    }
    if (!res.ok) throw new BringError(`Bring! API ${method} ${path} failed: HTTP ${res.status}`);
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async login(): Promise<Session> {
    if (this.session && this.session.expiresAt > Date.now() + 60_000) return this.session;
    const res = await fetch(`${API}/v2/bringauth`, {
      method: "POST",
      headers: { ...this.headers(null), "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: this.email, password: this.password }),
      signal: AbortSignal.timeout(15_000),
    });
    if (res.status === 401 || res.status === 400) throw new BringError("Bring! login failed: check BRING_EMAIL / BRING_PASSWORD.", 503);
    if (!res.ok) throw new BringError(`Bring! login failed: HTTP ${res.status}`);
    const auth = (await res.json()) as { uuid?: string; access_token?: string; expires_in?: number };
    if (!auth.uuid || !auth.access_token) throw new BringError("Unexpected Bring! login response.");
    const session: Session = {
      uuid: auth.uuid,
      token: auth.access_token,
      expiresAt: Date.now() + (Number(auth.expires_in) > 0 ? Number(auth.expires_in) : 3600) * 1000,
      country: "DE",
      userLocale: "de-DE",
      listLocales: new Map(),
    };
    this.session = session;

    // Locale info is only needed for catalog translations; failures here are not fatal.
    try {
      const account = await this.request<{ userLocale?: { language?: string; country?: string } }>("GET", `/v2/bringusers/${session.uuid}`);
      session.country = account.userLocale?.country ?? "DE";
      session.userLocale = LANG_TO_LOCALE[account.userLocale?.language ?? ""] ?? "de-DE";
      const settings = await this.request<{ userlistsettings?: { listUuid: string; usersettings: { key: string; value: string }[] }[] }>(
        "GET",
        `/bringusersettings/${session.uuid}`,
      );
      for (const list of settings.userlistsettings ?? []) {
        const lang = list.usersettings.find((u) => u.key === "listArticleLanguage")?.value;
        if (lang) session.listLocales.set(list.listUuid, lang);
      }
    } catch (err) {
      console.warn("bring: could not load locale settings:", (err as Error).message);
    }
    return session;
  }

  async lists(): Promise<BringList[]> {
    const s = await this.login();
    const res = await this.request<{ lists?: BringList[] }>("GET", `/bringusers/${s.uuid}/lists`);
    if (!Array.isArray(res?.lists)) throw new BringError("Unexpected response from Bring! when loading lists.");
    return res.lists.map((l) => ({ listUuid: l.listUuid, name: l.name }));
  }

  /** Reverse catalog for a locale: lowercase translated name → catalog key. */
  private async catalog(locale: string): Promise<Map<string, string>> {
    if (!SUPPORTED_LOCALES.includes(locale) || locale === "de-CH") return new Map();
    let map = this.catalogs.get(locale);
    if (map) return map;
    map = new Map();
    try {
      const res = await fetch(`${LOCALES}/articles.${locale}.json`, { signal: AbortSignal.timeout(15_000) });
      if (res.ok) {
        const translations = (await res.json()) as Record<string, unknown>;
        for (const [key, value] of Object.entries(translations)) {
          if (typeof value === "string") map.set(value.toLowerCase(), key);
        }
      }
    } catch (err) {
      console.warn(`bring: could not load catalog ${locale}:`, (err as Error).message);
    }
    this.catalogs.set(locale, map);
    return map;
  }

  async addItems(listUuid: string, items: BringItem[]): Promise<void> {
    if (items.length === 0) return;
    const s = await this.login();
    const catalog = await this.catalog(s.listLocales.get(listUuid) ?? s.userLocale);
    const changes = items.map((item) => ({
      accuracy: "0.0",
      altitude: "0.0",
      latitude: "0.0",
      longitude: "0.0",
      itemId: catalog.get(item.name.toLowerCase()) ?? item.name,
      spec: item.spec,
      uuid: crypto.randomUUID(),
      operation: "TO_PURCHASE",
    }));
    // One request so a failure never leaves half the list sent (a retry would otherwise duplicate items).
    await this.request("PUT", `/v2/bringlists/${listUuid}/items`, { changes, sender: "" });
  }
}

let shared: BringClient | null = null;

export function bringEnabled(): boolean {
  return Boolean(process.env.BRING_EMAIL && process.env.BRING_PASSWORD);
}

export function bring(): BringClient {
  if (!bringEnabled()) throw new BringError("Bring! is not configured (set BRING_EMAIL and BRING_PASSWORD).", 503);
  shared ??= new BringClient(process.env.BRING_EMAIL!, process.env.BRING_PASSWORD!);
  return shared;
}
