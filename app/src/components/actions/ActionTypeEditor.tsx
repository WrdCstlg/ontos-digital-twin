import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, CircleCheck, History, Loader2, RotateCcw, Save, ScanSearch, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { ACTION_ROLES, ACTION_STATUSES, actionKeySchema, type ActionRole, type ActionStatus } from '@contracts/actions';
import { trpc } from '@/providers/trpc';
import { cn } from '@/lib/utils';
import { stamp } from '@/components/operations/utils';
import { ActionStatusBadge, MetaChip } from './Badges';
import { errorCode } from './links';
import type { ActionTypeDetail, ActionTypeVersionRow } from './types';

const LABEL = 'mb-1 block text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-muted';
const INPUT =
  'w-full min-w-0 rounded-md border border-border-hairline bg-bg-inset px-2.5 py-1.5 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-muted/60 focus:border-border-glow disabled:opacity-60';

const STARTER_DEFINITION = {
  parameters: [{ name: 'subject', label: 'Subject', type: 'object', classIri: 'hr:Person', required: true }],
  criteria: [],
  rules: [{ kind: 'modify_object', object: 'subject', properties: { reviewedOn: '{today}', reviewedBy: '{actor}' } }],
  validation: { shacl: false },
  sideEffects: [],
};

type Problem = { path: string; message: string };
type SaveError = { kind: 'conflict' | 'invalid' | 'forbidden' | 'other'; message: string; problems: Problem[] };

const pretty = (v: unknown) => JSON.stringify(v, null, 2);

/** "rules.0.to: … ; parameters.1.name: …" (a DefinitionInvalid message) as problems. */
function problemsFromMessage(message: string): Problem[] {
  return message
    .split('; ')
    .map((part) => {
      const i = part.indexOf(': ');
      return i > 0 ? { path: part.slice(0, i), message: part.slice(i + 2) } : { path: '', message: part };
    })
    .filter((p) => p.message);
}

function Labelled({ label, htmlFor, children, hint }: { label: string; htmlFor: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className={LABEL}>
        {label}
      </label>
      {children}
      {hint}
    </div>
  );
}

function ProblemsByPath({ problems }: { problems: Problem[] }) {
  return (
    <ul className="space-y-1" aria-label="Definition problems">
      {problems.map((p, i) => (
        <li key={`${p.path}-${i}`} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
          <span className="font-mono text-[11px] text-text-accent">{p.path || '(definition)'}</span>
          <span className="min-w-0 break-words text-risk">{p.message}</span>
        </li>
      ))}
    </ul>
  );
}

function VersionHistory({
  versions,
  current,
  onLoad,
}: {
  versions: ActionTypeVersionRow[];
  current: number;
  onLoad: (v: ActionTypeVersionRow) => void;
}) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section aria-label="Version history">
      <h4 className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-muted">
        <History className="size-3" /> Version history
        <span className="font-mono normal-case tracking-normal">{versions.length}</span>
      </h4>
      <ul className="divide-y divide-border-hairline rounded-lg border border-border-hairline">
        {versions.map((v) => {
          const isOpen = open === v.version;
          return (
            <li key={v.version} className="px-3 py-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <button
                  type="button"
                  onClick={() => setOpen(isOpen ? null : v.version)}
                  aria-expanded={isOpen}
                  className="inline-flex items-center gap-1 font-mono text-[12px] text-text-accent hover:underline"
                >
                  <ChevronDown className={cn('size-3 transition-transform', isOpen && 'rotate-180')} />v{v.version}
                </button>
                {v.version === current && <MetaChip className="text-ok">current</MetaChip>}
                <span className="min-w-0 truncate text-[12.5px] text-text-secondary">{v.displayName}</span>
                <span className="font-mono text-[10.5px] text-text-muted">min {v.minRole}</span>
                <span className="ml-auto font-mono text-[10.5px] text-text-muted">
                  {stamp(v.createdAt)}
                  {v.changedBy && ` · ${v.changedBy}`}
                </span>
              </div>
              {isOpen && (
                <div className="mt-2 space-y-2">
                  <pre className="max-h-64 overflow-auto rounded-md border border-border-hairline bg-bg-inset p-2.5 font-mono text-[10.5px] leading-[1.5] text-text-secondary">
                    {pretty(v.definitionJson)}
                  </pre>
                  {v.version !== current && (
                    <button
                      type="button"
                      onClick={() => onLoad(v)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-border-hairline px-2.5 py-1 text-[12px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary"
                    >
                      <RotateCcw className="size-3" /> Load v{v.version} into the editor
                    </button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export interface ActionTypeEditorProps {
  /** The action type to edit; without one, the editor creates a new type. */
  type?: ActionTypeDetail;
  onSaved: (key: string) => void;
  onCancel?: () => void;
}

/**
 * Authoring for workspace admins and ontologists: create an action type or
 * change one, with the definition edited as JSON and checked by the API.
 * Every saved change is a new version, saved against the version it was made
 * from, so two authors cannot overwrite each other. Status is operational and
 * changes at once, without a new version.
 */
export function ActionTypeEditor({ type, onSaved, onCancel }: ActionTypeEditorProps) {
  const creating = !type;
  const utils = trpc.useUtils();
  const modulesQ = trpc.ontology.listModules.useQuery(undefined, { enabled: creating, staleTime: 60_000 });

  const [key, setKey] = useState('');
  const [displayName, setDisplayName] = useState(type?.displayName ?? '');
  const [description, setDescription] = useState(type?.description ?? '');
  const [moduleKey, setModuleKey] = useState('');
  const [minRole, setMinRole] = useState<ActionRole>((type?.minRole as ActionRole | undefined) ?? 'editor');
  const [status, setStatus] = useState<ActionStatus>('draft');
  const [defText, setDefText] = useState(() => pretty(type?.definition ?? STARTER_DEFINITION));
  // The version these edits were made against; a save is refused if the type has moved on.
  const [baseVersion, setBaseVersion] = useState(type?.version ?? 0);
  const [check, setCheck] = useState<{ ok: boolean; problems: Problem[]; forText: string } | null>(null);
  const [saveError, setSaveError] = useState<SaveError | null>(null);

  const moduleChoice = moduleKey || modulesQ.data?.[0]?.key || '';
  const parsed = useMemo((): { ok: true; value: unknown } | { ok: false; error: string } => {
    try {
      return { ok: true, value: JSON.parse(defText) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'not valid JSON' };
    }
  }, [defText]);
  const keyProblem = creating && key ? actionKeySchema.safeParse(key).error?.issues[0]?.message : undefined;

  const baseline = type
    ? { displayName: type.displayName, description: type.description ?? '', minRole: type.minRole, def: pretty(type.definition) }
    : null;
  const dirty =
    !baseline ||
    displayName !== baseline.displayName ||
    description !== baseline.description ||
    minRole !== baseline.minRole ||
    (parsed.ok ? pretty(parsed.value) !== baseline.def : true);
  const newer = type && type.version > baseVersion ? type.version : null;

  const loadFrom = (t: { displayName: string; description?: string | null; minRole: string; definition: unknown }, version?: number) => {
    setDisplayName(t.displayName);
    setDescription(t.description ?? '');
    setMinRole(t.minRole as ActionRole);
    setDefText(pretty(t.definition));
    if (version !== undefined) setBaseVersion(version);
    setCheck(null);
    setSaveError(null);
  };

  const failSave = (err: { message: string; data?: { code?: string } | null }) => {
    const code = errorCode(err);
    if (code === 'CONFLICT') setSaveError({ kind: 'conflict', message: err.message, problems: [] });
    else if (code === 'BAD_REQUEST') setSaveError({ kind: 'invalid', message: err.message, problems: problemsFromMessage(err.message) });
    else if (code === 'FORBIDDEN' || code === 'UNAUTHORIZED')
      setSaveError({ kind: 'forbidden', message: 'Only workspace admins and ontologists can define action types.', problems: [] });
    else setSaveError({ kind: 'other', message: err.message, problems: [] });
  };

  const validateM = trpc.actions.validateDefinition.useMutation({
    onSuccess: (res, vars) => setCheck({ ok: res.ok, problems: res.problems, forText: pretty(vars.definition) }),
    onError: (err) => failSave(err),
  });

  const afterSave = async (savedKey: string) => {
    await Promise.all([utils.actions.listTypes.invalidate(), utils.actions.getType.invalidate({ key: savedKey }), utils.actions.forObject.invalidate()]);
  };

  const createM = trpc.actions.createType.useMutation({
    onSuccess: (row) => {
      toast.success(`Created “${row.displayName}”`, { description: `${row.key} v${row.version} · ${row.status}` });
      void afterSave(row.key);
      onSaved(row.key);
    },
    onError: failSave,
  });
  const updateM = trpc.actions.updateType.useMutation({
    onSuccess: (row) => {
      setBaseVersion(row.version);
      setSaveError(null);
      toast.success(`Saved “${row.displayName}” as v${row.version}`);
      void afterSave(row.key);
      onSaved(row.key);
    },
    onError: failSave,
  });
  const statusM = trpc.actions.setStatus.useMutation({
    onSuccess: (row) => {
      toast.success(`“${row.displayName}” is ${row.status}`, {
        description: row.status === 'active' ? 'Members with the role can run it now.' : 'It cannot be submitted until it is active again.',
      });
      void afterSave(row.key);
    },
    onError: (err) =>
      toast.error('Could not change the status', {
        description: errorCode(err) === 'FORBIDDEN' ? 'Only workspace admins and ontologists can.' : err.message,
      }),
  });

  const loadLatest = async () => {
    if (!type) return;
    try {
      const latest = await utils.actions.getType.fetch({ key: type.key });
      loadFrom(latest, latest.version);
      toast.info(`Loaded v${latest.version}`, { description: 'Your edits were replaced by the latest saved version.' });
    } catch (err) {
      toast.error('Could not load the latest version', { description: err instanceof Error ? err.message : undefined });
    }
  };

  const runCheck = () => {
    setSaveError(null);
    if (!parsed.ok) return;
    validateM.mutate({ definition: parsed.value });
  };

  const save = () => {
    setSaveError(null);
    if (!parsed.ok) return;
    if (creating) {
      createM.mutate({
        key,
        displayName: displayName.trim(),
        description: description.trim() || null,
        moduleKey: moduleChoice,
        minRole,
        status,
        definition: parsed.value,
      });
    } else {
      updateM.mutate({
        key: type.key,
        expectedVersion: baseVersion,
        displayName: displayName.trim(),
        description: description.trim() || null,
        minRole,
        definition: parsed.value,
      });
    }
  };

  const saving = createM.isPending || updateM.isPending;
  const canSave =
    parsed.ok &&
    displayName.trim() !== '' &&
    dirty &&
    (!creating || (key !== '' && !keyProblem && moduleChoice !== ''));
  const checkStale = check && parsed.ok && check.forText !== pretty(parsed.value);

  return (
    <div className="grid gap-4">
      {newer && !saveError && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-[12.5px] text-warn">
          <TriangleAlert className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">
            v{newer} was saved while you were editing v{baseVersion}. Saving now would be refused.
          </span>
          <button type="button" onClick={() => void loadLatest()} className="rounded-md border border-warn/40 px-2 py-0.5 text-[12px] hover:bg-warn/15">
            Load v{newer}
          </button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        {creating && (
          <Labelled
            label="Key"
            htmlFor="action-key"
            hint={
              keyProblem ? (
                <p className="mt-1 text-[11.5px] text-risk">{keyProblem}</p>
              ) : (
                <p className="mt-1 text-[11.5px] text-text-muted">Names it in links and the API; cannot change later.</p>
              )
            }
          >
            <input
              id="action-key"
              value={key}
              onChange={(e) => setKey(e.target.value.trim())}
              placeholder="renew-contract"
              autoComplete="off"
              spellCheck={false}
              className={cn(INPUT, 'font-mono', keyProblem && 'border-risk/60')}
            />
          </Labelled>
        )}
        <Labelled label="Display name" htmlFor="action-name">
          <input
            id="action-name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Renew contract"
            maxLength={255}
            className={INPUT}
          />
        </Labelled>
        {creating ? (
          <Labelled label="Module" htmlFor="action-module">
            <select
              id="action-module"
              value={moduleChoice}
              onChange={(e) => setModuleKey(e.target.value)}
              disabled={modulesQ.isLoading}
              className={INPUT}
            >
              {modulesQ.isLoading && <option value="">loading modules…</option>}
              {(modulesQ.data ?? []).map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name} ({m.key})
                </option>
              ))}
            </select>
          </Labelled>
        ) : (
          <div className="min-w-0">
            <span className={LABEL}>Module</span>
            <p className="py-1.5 text-[13px] text-text-secondary">
              {type.module.name} <span className="font-mono text-[11px] text-text-muted">({type.module.key}, fixed)</span>
            </p>
          </div>
        )}
        <Labelled label="Minimum role to submit" htmlFor="action-role">
          <select id="action-role" value={minRole} onChange={(e) => setMinRole(e.target.value as ActionRole)} className={INPUT}>
            {ACTION_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </Labelled>
        {creating ? (
          <Labelled label="Status" htmlFor="action-status">
            <select id="action-status" value={status} onChange={(e) => setStatus(e.target.value as ActionStatus)} className={INPUT}>
              {ACTION_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </Labelled>
        ) : (
          <div className="min-w-0">
            <span className={LABEL} id="action-status-label">
              Status <span className="normal-case tracking-normal">(changes at once, no new version)</span>
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 rounded-lg border border-border-hairline bg-bg-inset p-1" role="group" aria-labelledby="action-status-label">
                {ACTION_STATUSES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={type.status === s}
                    disabled={statusM.isPending}
                    onClick={() => type.status !== s && statusM.mutate({ key: type.key, status: s })}
                    className={cn(
                      'rounded-md px-2.5 py-1 text-[12px] transition-colors disabled:opacity-60',
                      type.status === s ? 'bg-bg-panel-raised text-text-primary' : 'text-text-muted hover:text-text-secondary',
                    )}
                  >
                    {s}
                  </button>
                ))}
              </div>
              {statusM.isPending ? <Loader2 className="size-3.5 animate-spin text-iris-bright" /> : <ActionStatusBadge status={type.status} />}
            </div>
          </div>
        )}
      </div>

      <Labelled label="Description" htmlFor="action-description">
        <textarea
          id="action-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          maxLength={5000}
          placeholder="What it does and when to use it."
          className={cn(INPUT, 'resize-y')}
        />
      </Labelled>

      <div className="min-w-0">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <label htmlFor="action-definition" className={cn(LABEL, 'mb-0')}>
            Definition (JSON)
          </label>
          <span className={cn('font-mono text-[10.5px]', parsed.ok ? 'text-text-muted' : 'text-risk')}>
            {parsed.ok ? 'parameters · criteria · rules · validation · sideEffects' : `not JSON: ${parsed.error}`}
          </span>
        </div>
        <textarea
          id="action-definition"
          value={defText}
          onChange={(e) => setDefText(e.target.value)}
          rows={18}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-invalid={!parsed.ok || undefined}
          className={cn(INPUT, 'resize-y whitespace-pre font-mono text-[11.5px] leading-[1.55]', !parsed.ok && 'border-risk/60')}
        />
      </div>

      {check && (
        <div
          role="status"
          className={cn(
            'rounded-lg border px-3 py-2.5',
            check.ok ? 'border-ok/30 bg-ok/5' : 'border-risk/30 bg-risk/5',
          )}
        >
          <p className={cn('mb-1 flex items-center gap-1.5 text-[12.5px]', check.ok ? 'text-ok' : 'text-risk')}>
            {check.ok ? <CircleCheck className="size-3.5" /> : <TriangleAlert className="size-3.5" />}
            {check.ok ? 'The definition is valid.' : `${check.problems.length} problem${check.problems.length === 1 ? '' : 's'} in the definition`}
            {checkStale && <span className="text-[11.5px] text-text-muted">(checked before your last edit)</span>}
          </p>
          {!check.ok && <ProblemsByPath problems={check.problems} />}
        </div>
      )}

      {saveError && (
        <div role="alert" className="rounded-lg border border-risk/30 bg-risk/5 px-3 py-2.5 text-[12.5px]">
          {saveError.kind === 'conflict' ? (
            creating ? (
              <p className="text-risk">{saveError.message}. Choose another key.</p>
            ) : (
              <>
                <p className="font-medium text-risk">Not saved: someone saved a newer version first.</p>
                <p className="mt-1 text-text-secondary">
                  {saveError.message}. Your edits are still here. Load the latest version to see what changed, then make
                  your change again.
                </p>
                <button
                  type="button"
                  onClick={() => void loadLatest()}
                  className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border-hairline px-2.5 py-1 text-[12px] text-text-secondary hover:border-border-glow hover:text-text-primary"
                >
                  <RotateCcw className="size-3" /> Load the latest version (replaces my edits)
                </button>
              </>
            )
          ) : saveError.kind === 'invalid' ? (
            <>
              <p className="mb-1 font-medium text-risk">Not saved: the definition has problems.</p>
              <ProblemsByPath problems={saveError.problems} />
            </>
          ) : (
            <p className="text-risk">{saveError.message}</p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={runCheck}
          disabled={!parsed.ok || validateM.isPending}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border-hairline px-3 py-1.5 text-[13px] text-text-secondary transition-colors hover:border-border-glow hover:text-text-primary disabled:opacity-50"
        >
          {validateM.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <ScanSearch className="size-3.5" />} Check
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!canSave || saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-iris px-3.5 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-iris-bright disabled:opacity-50"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
          {creating ? 'Create action type' : `Save as v${baseVersion + 1}`}
        </button>
        {!creating && dirty && (
          <button
            type="button"
            onClick={() => loadFrom(type)}
            className="rounded-lg px-3 py-1.5 text-[13px] text-text-muted transition-colors hover:text-text-primary"
          >
            Discard changes
          </button>
        )}
        {creating && onCancel && (
          <button type="button" onClick={onCancel} className="rounded-lg px-3 py-1.5 text-[13px] text-text-muted transition-colors hover:text-text-primary">
            Cancel
          </button>
        )}
        <span className="ml-auto font-mono text-[10.5px] text-text-muted">
          {creating ? 'starts at v1' : dirty ? 'unsaved changes' : `v${baseVersion} · no changes`}
        </span>
      </div>

      {!creating && (
        <VersionHistory
          versions={type.versions}
          current={type.version}
          onLoad={(v) => {
            loadFrom({ displayName: v.displayName, description: v.description, minRole: v.minRole, definition: v.definitionJson });
            toast.info(`v${v.version} is in the editor`, { description: `Save to make it v${baseVersion + 1}.` });
          }}
        />
      )}
    </div>
  );
}
