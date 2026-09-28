/**
 * Where to get this program's source. Ontos is licensed under the GNU AGPL
 * v3.0 only, whose section 13 requires that everyone who uses a modified
 * version over a network be offered that version's Corresponding Source.
 *
 * Both values are read when the client is built (Vite), not when it runs:
 * - VITE_SOURCE_URL: where a deployment that changes the code publishes its
 *   own source. It is used as given.
 * - VITE_SOURCE_COMMIT: the commit this build is made from. Without a
 *   VITE_SOURCE_URL, the link then points at that commit of the upstream
 *   repository rather than at whatever it holds today.
 */
export const UPSTREAM_SOURCE = "https://github.com/WrdCstlg/ontos-digital-twin";

export function sourceUrl(env: { VITE_SOURCE_URL?: string; VITE_SOURCE_COMMIT?: string }): string {
  if (env.VITE_SOURCE_URL) return env.VITE_SOURCE_URL;
  const commit = env.VITE_SOURCE_COMMIT?.trim();
  return commit && /^[0-9a-f]{7,40}$/i.test(commit) ? `${UPSTREAM_SOURCE}/tree/${commit}` : UPSTREAM_SOURCE;
}

export const SOURCE_URL: string = sourceUrl({
  VITE_SOURCE_URL: import.meta.env.VITE_SOURCE_URL,
  VITE_SOURCE_COMMIT: import.meta.env.VITE_SOURCE_COMMIT,
});

export const LICENSE_NAME = "AGPL-3.0";
