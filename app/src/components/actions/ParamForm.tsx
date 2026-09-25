import { useId } from 'react';
import { TriangleAlert } from 'lucide-react';
import type { ActionParameter } from '@contracts/actions';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { ObjectPicker } from './ObjectPicker';
import { describeParameterType } from './words';
import type { FormValue, FormValues } from './form';

const INPUT =
  'h-9 w-full min-w-0 rounded-md border bg-bg-inset px-2.5 text-[13px] text-text-primary outline-none transition-colors placeholder:text-text-muted/70 focus:border-border-glow disabled:opacity-50';

export interface ParamFormProps {
  parameters: ActionParameter[];
  values: FormValues;
  onChange: (name: string, value: FormValue) => void;
  /** Messages about a parameter from the last preview or submission, by name. */
  errors?: Record<string, string[]>;
  disabled?: boolean;
}

function Field({
  param,
  value,
  onChange,
  errors,
  disabled,
  idBase,
}: {
  param: ActionParameter;
  value: FormValue;
  onChange: (v: FormValue) => void;
  errors: string[];
  disabled?: boolean;
  idBase: string;
}) {
  const id = `${idBase}-${param.name}`;
  const labelId = `${id}-label`;
  const descId = `${id}-desc`;
  const invalid = errors.length > 0;
  const text = typeof value === 'string' ? value : '';
  const described = param.description ? descId : undefined;
  const cls = cn(INPUT, invalid ? 'border-risk/60' : 'border-border-hairline');

  let control: React.ReactNode;
  switch (param.type) {
    case 'string':
      control =
        param.maxLength !== undefined && param.maxLength > 200 ? (
          <textarea
            id={id}
            value={text}
            onChange={(e) => onChange(e.target.value)}
            maxLength={param.maxLength}
            rows={3}
            disabled={disabled}
            aria-describedby={described}
            aria-invalid={invalid || undefined}
            className={cn(cls, 'h-auto resize-y py-2')}
          />
        ) : (
          <input
            id={id}
            type="text"
            value={text}
            onChange={(e) => onChange(e.target.value)}
            maxLength={param.maxLength}
            disabled={disabled}
            aria-describedby={described}
            aria-invalid={invalid || undefined}
            className={cls}
          />
        );
      break;
    case 'number':
      control = (
        <input
          id={id}
          type="number"
          inputMode={param.integer ? 'numeric' : 'decimal'}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          min={param.min}
          max={param.max}
          step={param.integer ? 1 : 'any'}
          disabled={disabled}
          aria-describedby={described}
          aria-invalid={invalid || undefined}
          className={cn(cls, 'font-mono')}
        />
      );
      break;
    case 'boolean':
      control = (
        <div className="flex h-9 items-center gap-2.5">
          <Switch
            id={id}
            checked={value === true}
            onCheckedChange={(c) => onChange(c)}
            disabled={disabled}
            aria-labelledby={labelId}
            aria-describedby={described}
            className="data-[state=checked]:bg-iris"
          />
          <span className="font-mono text-[11.5px] text-text-secondary">{value === true ? 'yes' : 'no'}</span>
        </div>
      );
      break;
    case 'date':
      control = (
        <input
          id={id}
          type="date"
          value={text}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-describedby={described}
          aria-invalid={invalid || undefined}
          className={cn(cls, 'font-mono [color-scheme:dark]')}
        />
      );
      break;
    case 'enum':
      control = (
        <select
          id={id}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          aria-describedby={described}
          aria-invalid={invalid || undefined}
          className={cls}
        >
          <option value="">{param.required ? 'Choose…' : '— none —'}</option>
          {param.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
      break;
    case 'object':
      control = (
        <ObjectPicker
          classIri={param.classIri}
          value={text}
          onChange={(iri) => onChange(iri)}
          labelledBy={labelId}
          invalid={invalid}
          disabled={disabled}
        />
      );
      break;
  }

  return (
    <div className="min-w-0" data-testid={`param-${param.name}`}>
      <div className="mb-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <label id={labelId} htmlFor={param.type === 'object' ? undefined : id} className="text-[13px] font-medium text-text-primary">
          {param.label}
          {param.required && (
            <span className="ml-0.5 text-risk" aria-hidden>
              *
            </span>
          )}
          {param.required && <span className="sr-only"> (required)</span>}
        </label>
        <span className="font-mono text-[10.5px] text-text-muted">
          {param.name} · {describeParameterType(param)}
          {!param.required && ' · optional'}
        </span>
      </div>
      {control}
      {param.description && (
        <p id={descId} className="mt-1 text-[12px] leading-[1.5] text-text-muted">
          {param.description}
        </p>
      )}
      {errors.map((e) => (
        <p key={e} className="mt-1 flex items-start gap-1 text-[12px] text-risk">
          <TriangleAlert className="mt-0.5 size-3 shrink-0" aria-hidden /> {e}
        </p>
      ))}
    </div>
  );
}

/**
 * A submission form generated from an action's parameters: text, number,
 * yes/no switch, date, a choice for enums, and a searchable object picker
 * for object parameters. Required parameters carry a red asterisk.
 */
export function ParamForm({ parameters, values, onChange, errors = {}, disabled }: ParamFormProps) {
  const idBase = useId();
  if (parameters.length === 0) {
    return <p className="text-[13px] text-text-muted">This action takes no parameters.</p>;
  }
  return (
    <div className="grid gap-4">
      {parameters.map((p) => (
        <Field
          key={p.name}
          param={p}
          value={values[p.name] ?? (p.type === 'boolean' ? false : '')}
          onChange={(v) => onChange(p.name, v)}
          errors={errors[p.name] ?? []}
          disabled={disabled}
          idBase={idBase}
        />
      ))}
    </div>
  );
}
