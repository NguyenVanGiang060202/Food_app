import assert from "node:assert/strict";
import test from "node:test";
import { getCurrentUser, isRestaurantSaved, listSavedRestaurantsPage, signIn, signOut } from "../src/lib/api.ts";

type StoredValues = Record<string, string>;

function installBrowserMocks() {
  const values: StoredValues = {};
  const events: string[] = [];
  const localStorage = {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => { values[key] = value; },
    removeItem: (key: string) => { delete values[key]; },
  };
  const previousWindow = globalThis.window;
  globalThis.window = {
    localStorage,
    dispatchEvent: (event: Event) => { events.push(event.type); return true; },
  } as unknown as Window & typeof globalThis;
  return {
    values,
    events,
    restore: () => { globalThis.window = previousWindow; },
  };
}

function response(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

test("signIn uses the cookie session and stores only the returned profile", async () => {
  const browser = installBrowserMocks();
  const previousFetch = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return response({ token: "legacy-token", user: { id: "user-1", email: "user@example.com", displayName: "User" } });
  };

  try {
    const user = await signIn({ email: "user@example.com", password: "password" });
    assert.deepEqual(user, { id: "user-1", email: "user@example.com", displayName: "User" });
    assert.equal(calls[0]?.init?.credentials, "include");
    assert.equal((calls[0]?.init?.headers as Record<string, string>).Authorization, undefined);
    assert.deepEqual(JSON.parse(browser.values["food-discovery:auth-user"]), user);
    assert.deepEqual(browser.events, ["bep:auth-change"]);
  } finally {
    globalThis.fetch = previousFetch;
    browser.restore();
  }
});

test("getCurrentUser restores the profile from the cookie session", async () => {
  const browser = installBrowserMocks();
  const previousFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return response({ user: { id: "user-2", email: "two@example.com", displayName: null } });
  };

  try {
    const user = await getCurrentUser();
    assert.equal(requestedUrl, "/api/v1/auth/me");
    assert.equal(user.id, "user-2");
    assert.deepEqual(JSON.parse(browser.values["food-discovery:auth-user"]), user);
  } finally {
    globalThis.fetch = previousFetch;
    browser.restore();
  }
});

test("signOut clears the cached profile after the server confirms logout", async () => {
  const browser = installBrowserMocks();
  browser.values["food-discovery:auth-user"] = JSON.stringify({ id: "user-3", email: "three@example.com" });
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => response({ loggedOut: true });

  try {
    await signOut();
    assert.equal(browser.values["food-discovery:auth-user"], undefined);
    assert.deepEqual(browser.events, ["bep:auth-change"]);
  } finally {
    globalThis.fetch = previousFetch;
    browser.restore();
  }
});

test("saved page sends limit and cursor and never exposes more than the requested page", async () => {
  const previousFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return response({
      data: Array.from({ length: 16 }, (_, index) => ({
        id: `restaurant-${index}`,
        name: `Restaurant ${index}`,
        location: { formattedAddress: "Hà Nội", latitude: 21, longitude: 105 },
        categories: [],
        rating: null,
        reviewCount: null,
        coverImageUrl: null,
        sourceUrl: null,
      })),
      meta: { nextCursor: "next", limit: 15, totalCount: 16, totalPages: 2 },
    });
  };

  try {
    const page = await listSavedRestaurantsPage({ limit: 15, cursor: "previous" });
    assert.equal(requestedUrl, "/api/v1/saved?limit=15&cursor=previous");
    assert.equal(page.data.length, 15);
    assert.equal(page.meta.nextCursor, "next");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("saved status uses the single-restaurant endpoint instead of loading every saved restaurant", async () => {
  const previousFetch = globalThis.fetch;
  let requestedUrl = "";
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return response({ saved: true });
  };

  try {
    assert.equal(await isRestaurantSaved("restaurant-1"), true);
    assert.equal(requestedUrl, "/api/v1/saved/restaurant-1");
  } finally {
    globalThis.fetch = previousFetch;
  }
});