import type { ActionParameter } from '@contracts/actions';

/**
 * Submission forms: the values a form holds for an action's parameters, how
 * a deep link prefills them, and what is sent to the API.
 */

export type FormValue = string | boolean;
export type FormValues = Record<string, FormValue>;
export type SubmitParams = Record<string, string | number | boolean | null>;

/** Search parameters that steer the page rather than name a parameter. */
export const RESERVED_SEARCH_KEYS = ['run', 'submission', 'tab'] as const;

export function emptyValues(params: ActionParameter[]): FormValues {
  return Object.fromEntries(params.map((p) => [p.name, p.type === 'boolean' ? false : '']));
}

/** Values from a deep link, `?run=<key>&<param>=<value>`; unknown names are ignored. */
export function valuesFromSearch(params: ActionParameter[], search: URLSearchParams): FormValues {
  const values = emptyValues(params);
  for (const p of params) {
    const raw = search.get(p.name);
    if (raw === null) continue;
    values[p.name] = p.type === 'boolean' ? raw === 'true' || raw === '1' || raw === 'yes' : raw;
  }
  return values;
}

/** The deep-link part of a search string, stable across unrelated params (e.g. an open submission). */
export function prefillSignature(search: URLSearchParams): string {
  return [...search.entries()]
    .filter(([k]) => !(RESERVED_SEARCH_KEYS as readonly string[]).includes(k))
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join('&');
}

/**
 * What the API receives. Empty fields are sent as null, which the API treats
 * as "not given". A number that does not parse is sent as typed so the API
 * explains what is wrong with it.
 */
export function toSubmitParams(params: ActionParameter[], values: FormValues): SubmitParams {
  const out: SubmitParams = {};
  for (const p of params) {
    const v = values[p.name];
    if (p.type === 'boolean') {
      out[p.name] = v === true;
      continue;
    }
    const s = typeof v === 'string' ? v : '';
    if (s.trim() === '') {
      out[p.name] = null;
      continue;
    }
    if (p.type === 'number') {
      const n = Number(s);
      out[p.name] = Number.isFinite(n) ? n : s;
    } else if (p.type === 'object') {
      out[p.name] = s.trim();
    } else {
      out[p.name] = s;
    }
  }
  return out;
}

/** Required parameters still empty, by label. */
export function missingRequired(params: ActionParameter[], values: FormValues): string[] {
  return params
    .filter((p) => p.required && p.type !== 'boolean')
    .filter((p) => {
      const v = values[p.name];
      return typeof v !== 'string' || v.trim() === '';
    })
    .map((p) => p.label);
}

/** Problems about one parameter, keyed by name, from API paths like "params.employee". */
export function problemsByParam(problems: { message: string; path?: string }[]): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const p of problems) {
    const m = /^params\.([A-Za-z]\w*)$/.exec(p.path ?? '');
    if (!m) continue;
    (out[m[1]] ??= []).push(p.message);
  }
  return out;
}
