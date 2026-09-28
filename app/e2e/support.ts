/**
 * What the browser tests share: the demo personas, signing in as one, and
 * waiting for what the server says a role may do on a page.
 *
 * The tests run against a real stack with persona login on
 * (ALLOW_DEMO_LOGIN=true); see README.md, Testing.
 */
import {
  test as base,
  expect,
  type BrowserContext,
  type Page,
} from "@playwright/test";

export { expect };

export type Role = "admin" | "ontologist" | "editor" | "viewer";

/**
 * The one-click personas on the login page. Each signs in with its own role in
 * the demo workspace (api/auth/service.ts) and, from the login page, lands on
 * its own page: `home`, which the breadcrumb calls `page`. `chip` is the role
 * the sidebar shows under the persona's name.
 */
export const PERSONAS: Record<
  Role,
  { name: string; home: string; page: string; chip: string }
> = {
  admin: {
    name: "Elena Cortez",
    home: "/app",
    page: "Dashboard",
    chip: "Admin",
  },
  ontologist: {
    name: "Dr. James Wei",
    home: "/app/studio",
    page: "Ontology Studio",
    chip: "Ontologist",
  },
  editor: {
    name: "Priya Sharma",
    home: "/app/mapping",
    page: "Mapping & Sync",
    chip: "Editor",
  },
  viewer: {
    name: "Alex Morgan",
    home: "/app/explorer",
    page: "Graph Explorer",
    chip: "Viewer",
  },
};

/** Signs in as the persona for `role`, from the login page. */
export async function signInAs(page: Page, role: Role): Promise<void> {
  await page.getByRole("button", { name: PERSONAS[role].name }).click();
}

/**
 * Opens `path`, a page inside the workspace, as the persona for `role`. Signed
 * out, the app sends the visitor to the login page, and signing in there
 * brings them back to `path`.
 */
export async function openAs(
  page: Page,
  role: Role,
  path: string
): Promise<void> {
  await page.goto(path);
  await expect(page).toHaveURL("/login");
  await signInAs(page, role);
  await expect(page).toHaveURL(path);
}

/** The tRPC procedures one (batched) request asks for, from its URL. */
function proceduresIn(url: string): string[] {
  const { pathname } = new URL(url);
  const prefix = "/api/trpc/";
  return pathname.startsWith(prefix)
    ? decodeURIComponent(pathname.slice(prefix.length)).split(",")
    : [];
}

/**
 * What the server tells the page the signed-in role may do: the answer to the
 * page's own `procedure` query, such as `twin.capabilities`. Call it before the
 * page asks, and await it before checking that a control is withheld. Until the
 * answer is in, a page withholds every role-dependent control, so a check made
 * earlier would pass whatever the role.
 */
export function capabilities(
  page: Page,
  procedure: `${string}.capabilities`
): Promise<Record<string, boolean>> {
  const answer = page
    .waitForResponse(res => proceduresIn(res.url()).includes(procedure))
    .then(async res => {
      const body: unknown = await res.json();
      const answers = (Array.isArray(body) ? body : [body]) as {
        result?: { data: { json: Record<string, boolean> } };
        error?: unknown;
      }[];
      const mine = answers[proceduresIn(res.url()).indexOf(procedure)];
      expect(
        mine?.result,
        `${procedure} failed: ${JSON.stringify(mine?.error)}`
      ).toBeDefined();
      return mine.result!.data.json;
    });
  // The caller awaits it. This only keeps a test that has already failed from
  // also reporting the abandoned wait as an unhandled rejection.
  answer.catch(() => undefined);
  return answer;
}

export const test = base.extend<{
  /**
   * Opens `path` as `role` in a browser context of its own: another person at
   * another browser, for tests where two roles look at the same thing.
   */
  persona: (role: Role, path: string) => Promise<Page>;
}>({
  persona: async ({ browser, baseURL }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (role, path) => {
      const context = await browser.newContext({ baseURL });
      contexts.push(context);
      const page = await context.newPage();
      await openAs(page, role, path);
      return page;
    });
    await Promise.all(contexts.map(context => context.close()));
  },
});
