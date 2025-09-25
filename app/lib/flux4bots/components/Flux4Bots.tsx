'use client';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Flux4BotsProps, Widget, TextWidget, SelectWidget, ListWidget,
  FieldPickerWidget, ActionWidget, Operation, CardCollectionOptions
} from '../types';
import { getAtPointer, setAtPointer, encodePointerSegment, joinPointer } from '../core/pointer';
import { resolveBindingPath } from '../core/binding';
import { compareDocsToPatch, applyPatch } from '../core/patch';
import { validateTemplate } from '../core/validate';
import { ChipSelect } from './ChipSelect';
import CollectionCardEditor from './CollectionCardEditor';

type NormalizedOption = { value: string; label: string };

const noopRuntime = {
  enqueueSteps: () => {},
  getState: () => undefined,
  setState: () => {},
  completeStep: () => {},
};

const palette = {
  border: '1px solid var(--f4b-border)',
  borderMuted: '1px solid var(--f4b-border-muted)',
  surfaceSoft: 'var(--f4b-surface-soft)',
  surfaceMuted: 'var(--f4b-surface-muted)',
  warning: 'var(--f4b-warning)',
  warningBorder: '1px solid color-mix(in srgb, var(--f4b-warning) 45%, transparent)',
  warningBg: 'color-mix(in srgb, var(--f4b-warning) 18%, transparent)',
  codeBg: 'var(--f4b-code-bg)',
};

function isTextEntryElement(element: HTMLElement | null): boolean {
  if (!element) return false;
  const tagName = element.tagName;
  if (tagName === 'TEXTAREA') {
    const textarea = element as HTMLTextAreaElement;
    return !textarea.readOnly && !textarea.disabled;
  }
  if (tagName === 'INPUT') {
    const input = element as HTMLInputElement;
    if (input.readOnly || input.disabled) return false;
    const normalizedType = (input.type || 'text').toLowerCase();
    return normalizedType === 'text'
      || normalizedType === 'search'
      || normalizedType === 'email'
      || normalizedType === 'password'
      || normalizedType === 'url'
      || normalizedType === 'tel'
      || normalizedType === 'number';
  }
  if (tagName === 'SELECT') {
    const select = element as HTMLSelectElement;
    return !select.disabled;
  }
  return element.isContentEditable;
}

function normalizeSelectValues(
  values?: (string | { value: string; label?: string })[] 
): NormalizedOption[]{
  if (!values) return [];
  const out: NormalizedOption[] = [];
  for (const raw of values) {
    if (typeof raw === 'string') {
      out.push({ value: raw, label: raw });
    } else if (raw && typeof raw.value === 'string') {
      out.push({ value: raw.value, label: raw.label ?? raw.value });
    }
  }
  return out;
}

export function Flux4Bots(props: Flux4BotsProps) {
  const { template, store, mode = 'diff', actions = {}, runtime: runtimeProp } = props;
  const runtime = runtimeProp ?? noopRuntime;

  // collect template warnings once per template
  const templateWarnings = useMemo(() => validateTemplate(template), [template]);

  const [original, setOriginal] = useState<any | null>(null);
  const [working, setWorking] = useState<any | null>(null);
  const [explicitOps, setExplicitOps] = useState<Operation[]>([]);
  const [vars, setVars] = useState<Record<string, any>>({}); // captures unbound widget values
  const [showJsonDev, setShowJsonDev] = useState(false);
  const commitButtonRef = useRef<HTMLButtonElement | null>(null);
  const contentSectionRef = useRef<HTMLElement | null>(null);
  const focusHistoryRef = useRef<string | null>(null);
  const focusCommitButton = useCallback(() => {
    commitButtonRef.current?.focus();
  }, []);

  // Load doc
  useEffect(() => {
    let mounted = true;
    (async () => {
      const doc = await store.getDoc();
      if (!mounted) return;
      setOriginal(doc);
      setWorking(JSON.parse(JSON.stringify(doc)));
      setExplicitOps([]);
      setVars({});
    })();
    return () => { mounted = false; };
  }, [store]);

  const patch = useMemo<Operation[]>(() => {
    if (!original || !working) return [];
    return mode === 'diff' ? compareDocsToPatch(original, working) : explicitOps;
  }, [original, working, explicitOps, mode]);

  const commitMeta = template.meta ?? {};
  const autoCommit = Boolean(commitMeta.autoCommit);
  const commitActionName = autoCommit ? undefined : commitMeta.commitAction;
  const commitRequires = commitActionName
    ? Array.isArray(commitMeta.commitRequiresVar)
      ? commitMeta.commitRequiresVar
      : commitMeta.commitRequiresVar
        ? [commitMeta.commitRequiresVar]
        : []
    : [];

  const hasChanges = patch.length > 0;
  const commitReady = !commitActionName
    ? false
    : (commitRequires.length === 0
        ? true
        : commitRequires.every((id) => {
            const val = vars[id];
            if (Array.isArray(val)) return val.length > 0;
            if (typeof val === 'string') return val.trim().length > 0;
            return Boolean(val);
          }));

  const canCommit = autoCommit
    ? false
    : commitActionName
      ? (hasChanges ? true : commitReady)
      : hasChanges;

  async function onCommit() {
    if (autoCommit || !working || !canCommit) return;

    const baseOps = patch.slice();

    let commitOps: Operation[] = [];
    if (commitActionName && actions?.[commitActionName]) {
      try {
        commitOps = actions[commitActionName]({
          doc: original,
          working,
          vars,
          helpers: { encode: encodePointerSegment, get: getAtPointer },
          runtime,
        }) ?? [];
      } catch (err) {
        console.error(`commit action "${commitActionName}" failed`, err);
        commitOps = [];
      }
    }

    const combinedOps = [...baseOps, ...commitOps];
    if (combinedOps.length === 0) {
      setExplicitOps([]);
      return;
    }

    const updated = await store.applyPatch(combinedOps);
    const cloned = JSON.parse(JSON.stringify(updated));
    setOriginal(cloned);
    setWorking(JSON.parse(JSON.stringify(cloned)));
    setExplicitOps([]);
  }

  const persistCollection = useCallback(async (
    path: string,
    updater: (current: any[]) => any[]
  ) => {
    const source = working ?? original;
    if (!source) throw new Error('Document not ready');
    const currentValue = getAtPointer(source, path);
    const baseArray: any[] = Array.isArray(currentValue) ? currentValue : [];
    const draft = JSON.parse(JSON.stringify(baseArray));
    const updatedArray = updater(draft) ?? draft;
    const normalized = Array.isArray(updatedArray) ? updatedArray : [];
    const value = JSON.parse(JSON.stringify(normalized));
    const exists = currentValue !== undefined;
    const op: Operation = { op: exists ? 'replace' : 'add', path, value };
    try {
      const updated = await store.applyPatch([op]);
      const cloned = JSON.parse(JSON.stringify(updated));
      setOriginal(cloned);
      setWorking(JSON.parse(JSON.stringify(cloned)));
      setExplicitOps([]);
    } catch (err) {
      console.error('Failed to persist collection changes', err);
      throw err;
    }
  }, [store, working, original]);

  function setVar(id: string, value: any) {
    setVars(prev => ({ ...prev, [id]: value }));
  }

  function applyAction(
    name: string | undefined,
    opts?: { doc?: any; working?: any; varsOverride?: Record<string, any>; force?: boolean },
  ) {
    if (!name) return opts?.working ?? working ?? null;
    const handler = actions?.[name];
    if (!handler) return opts?.working ?? working ?? null;
    const currentWorking = opts?.working ?? working;
    const currentDoc = opts?.doc ?? currentWorking ?? original;
    if (!currentWorking || !currentDoc) return currentWorking ?? null;
    const ctxVars = opts?.varsOverride ?? vars;

    const ops = handler({
      doc: currentDoc,
      working: currentWorking,
      vars: ctxVars,
      helpers: { encode: encodePointerSegment, get: getAtPointer },
      runtime,
    }) ?? [];

    if (mode === 'explicit') {
      setExplicitOps(ops);
    }

    const nextWorking = ops.length > 0 ? applyPatch(currentWorking, ops) : currentWorking;
    if (ops.length > 0 || opts?.force) {
      setWorking(nextWorking);
    }

    return nextWorking;
  }

  /* ------------------- renderers ------------------- */

  function renderText(w: TextWidget) {
    const boundPath = working ? resolveBindingPath(w.binding, working) : null;
    const value = boundPath && working ? getAtPointer(working, boundPath) : (vars[w.id] ?? '');
    const autoAction = w.options?.autoAction;
    const isDisabled = !!w.options?.readOnly && !boundPath;

    if (w.options?.readOnly && boundPath) {
      return (
        <div style={{ marginBottom: 10 }}>
          {w.label ? <div style={{ fontWeight: 600 }}>{w.label}</div> : null}
          <div>{String(value ?? '')}</div>
        </div>
      );
    }

    return (
      <div style={{ marginBottom: 10 }}>
        {w.label ? <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>{w.label}</label> : null}
        <input
          value={String(value ?? '')}
          onChange={e => {
            const nextValue = e.target.value;
            if (boundPath && working) {
              const nextDoc = JSON.parse(JSON.stringify(working));
              setAtPointer(nextDoc, boundPath, nextValue);
              setWorking(nextDoc);
              if (autoAction) {
                applyAction(autoAction, { doc: nextDoc, working: nextDoc, varsOverride: vars });
              }
            } else {
              const nextVars = { ...vars, [w.id]: nextValue };
              setVars(nextVars);
              if (autoAction && (working || original)) {
                const docForAction = working ?? original;
                applyAction(autoAction, { doc: docForAction, working: docForAction, varsOverride: nextVars });
              }
            }
          }}
          style={{ padding: 8, width: 360 }}
          disabled={isDisabled}
          data-f4b-focusable={isDisabled ? undefined : 'true'}
        />
        {w.binding && !boundPath && (
          <div style={{ fontSize: 12, color: palette.warning, marginTop: 4 }}>
            Binding path could not resolve at runtime.
          </div>
        )}
        {boundPath && (
          <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>{boundPath}</div>
        )}
      </div>
    );
  }

  function renderSelect(w: SelectWidget) {
    const variant = w.options?.variant ?? 'dropdown';
    const allowMultiple = w.options?.multiple ?? (variant === 'chips');
    const options = normalizeSelectValues(w.options?.values);
    const boundPath = working ? resolveBindingPath(w.binding, working) : null;
    const rawValue = boundPath && working ? getAtPointer(working, boundPath) : vars[w.id];
    const autoAction = w.options?.autoAction;

    const runAuto = (nextVars: Record<string, any>) => {
      if (!autoAction) return;
      const docForAction = working ?? original;
      if (!docForAction) return;
      applyAction(autoAction, { doc: docForAction, working: docForAction, varsOverride: nextVars });
    };

    const writeValue = (nextValue: any) => {
      if (boundPath && working) {
        const nextDoc = JSON.parse(JSON.stringify(working));
        setAtPointer(nextDoc, boundPath, nextValue);
        setWorking(nextDoc);
        if (autoAction) {
          applyAction(autoAction, { doc: nextDoc, working: nextDoc, varsOverride: vars });
        }
      } else {
        const normalized = allowMultiple ? nextValue : (nextValue ?? '');
        const nextVars = { ...vars, [w.id]: normalized };
        setVars(nextVars);
        runAuto(nextVars);
      }
    };

    if (variant === 'chips') {
      const selected: string[] = Array.isArray(rawValue)
        ? rawValue.map((v: any) => String(v))
        : rawValue != null && rawValue !== ''
          ? [String(rawValue)]
          : [];

      const handleChange = (next: string[]) => {
        if (allowMultiple) {
          writeValue(next);
        } else {
          writeValue(next[0] ?? '');
        }
      };

      return (
        <div style={{ marginBottom: 12 }}>
          {w.label ? <div style={{ fontWeight: 600, marginBottom: 6 }}>{w.label}</div> : null}
          <ChipSelect
            options={options}
            selected={selected}
            multiple={allowMultiple}
            onChange={handleChange}
            onCommitRequest={!allowMultiple ? () => {
              if (autoCommit || !canCommit) return;
              void onCommit();
            } : undefined}
            focusCommitOnTabExit={allowMultiple && !autoCommit ? focusCommitButton : undefined}
            markFirstFocusable
          />
          {w.binding && !boundPath && (
            <div style={{ fontSize: 12, color: palette.warning, marginTop: 4 }}>
              Binding path could not resolve at runtime.
            </div>
          )}
          {boundPath && (
            <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>{boundPath}</div>
          )}
        </div>
      );
    }

    const value = rawValue == null ? '' : String(rawValue);

    return (
      <div style={{ marginBottom: 10 }}>
        {w.label ? <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>{w.label}</label> : null}
        <select
          value={value}
          onChange={e => writeValue(e.target.value)}
          style={{ padding: 8, width: 360 }}
          data-f4b-focusable="true"
        >
          {value === '' && <option value="" disabled>— select —</option>}
          {options.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
        {w.binding && !boundPath && (
          <div style={{ fontSize: 12, color: palette.warning, marginTop: 4 }}>
            Binding path could not resolve at runtime.
          </div>
        )}
        {boundPath && (
          <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>{boundPath}</div>
        )}
      </div>
    );
  }

  function renderList(w: ListWidget) {
    if (!working) return null;

    // Use an alias to avoid TS narrowing to `never` for the keys-driven variant.
    const anyW = w as any;

    // ---- Case 1: existing behavior (array-driven via binding) ----
    if (anyW.binding) {
      const arrPath = resolveBindingPath(anyW.binding, working);
      if (!arrPath) return <div style={{ color: palette.warning }}>List binding missing</div>;

      const arr = getAtPointer(working, arrPath);
      const items = Array.isArray(arr) ? arr : [];
      const expandable = !!w.item.expandable;

      const listOptions = anyW.options as CardCollectionOptions | undefined;
      if (listOptions?.layout === 'card-collection') {
        return (
          <CollectionCardEditor
            label={w.label}
            entries={items}
            itemSpec={w.item}
            options={listOptions}
            persist={(updater) => persistCollection(arrPath, updater)}
          />
        );
      }

      return (
        <div style={{ marginBottom: 12 }}>
          {w.label ? <h4 style={{ margin: '8px 0' }}>{w.label}</h4> : null}
          {items.length === 0 && <div style={{ opacity: 0.7 }}>No items.</div>}

          {items.map((_it: any, idx: number) => {
            const base = `${arrPath}/${idx}`;
            return (
              <div
                key={base}
                style={{
                  border: palette.borderMuted,
                  background: palette.surfaceSoft,
                  borderRadius: 8,
                  padding: 10,
                  marginBottom: 8,
                }}
              >
                {!expandable ? null : (
                  <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 6 }}>
                    base: {base}
                  </div>
                )}
                {w.item.fields.map((f) => {
                  const fAny = f as any;
                  const rel = fAny.binding?.path ?? '';
                  const fieldPath = rel === '' ? base : joinPointer(base, rel);
                  const asText = fAny.type === 'text';
                  const asSelect = fAny.type === 'select';
                  const label = fAny.label;

                  const value = getAtPointer(working, fieldPath);
                  if (asText) {
                    if (fAny.options?.readOnly) {
                      return (
                        <div key={fieldPath} style={{ marginBottom: 8 }}>
                          {label ? <div style={{ fontWeight: 600 }}>{label}</div> : null}
                          <div>{String(value ?? '')}</div>
                          <div style={{ fontSize: 12, opacity: 0.6 }}>{fieldPath} (read-only)</div>
                        </div>
                      );
                    }
                    return (
                      <div key={fieldPath} style={{ marginBottom: 8 }}>
                        {label ? <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>{label}</label> : null}
                        <input
                          value={String(value ?? '')}
                          onChange={e => {
                            const next = JSON.parse(JSON.stringify(working));
                            setAtPointer(next, fieldPath, e.target.value);
                            setWorking(next);
                          }}
                          style={{ padding: 8, width: 360 }}
                          data-f4b-focusable="true"
                        />
                        <div style={{ fontSize: 12, opacity: 0.6 }}>{fieldPath}</div>
                      </div>
                    );
                  }
                 if (asSelect) {
                    const selectOpts = normalizeSelectValues(fAny.options?.values);
                    return (
                      <div key={fieldPath} style={{ marginBottom: 8 }}>
                        {label ? <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>{label}</label> : null}
                        <select
                          value={String(value ?? '')}
                          onChange={e => {
                            const next = JSON.parse(JSON.stringify(working));
                            setAtPointer(next, fieldPath, e.target.value);
                            setWorking(next);
                          }}
                          style={{ padding: 8, width: 360 }}
                          data-f4b-focusable="true"
                        >
                          {selectOpts.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                        </select>
                        <div style={{ fontSize: 12, opacity: 0.6 }}>{fieldPath}</div>
                      </div>
                    );
                  }
                  return <div key={fieldPath} style={{ color: palette.warning }}>Unsupported item field</div>;
                })}
              </div>
            );
          })}
        </div>
      );
    }

    // ---- Case 2: NEW behavior (keys-driven via source) ----
    if (anyW.source?.type === 'keys') {
      const basePath: string = anyW.source.basePath; // literal JSON Pointer
      const obj = getAtPointer(working, basePath);
      const keys = (obj && typeof obj === 'object') ? Object.keys(obj) : [];
      const exclude = new Set<string>(anyW.source.exclude ?? []);
      const showKeys = keys.filter(k => !exclude.has(k));
      const expandable = !!w.item.expandable;

      return (
        <div style={{ marginBottom: 12 }}>
          {w.label ? <h4 style={{ margin: '8px 0' }}>{w.label}</h4> : null}
          {showKeys.length === 0 && <div style={{ opacity: 0.7 }}>No items.</div>}

          {showKeys.map((k) => {
            const base = `${basePath}/${encodePointerSegment(k)}`;
            return (
              <div
                key={base}
                style={{
                  border: palette.borderMuted,
                  background: palette.surfaceSoft,
                  borderRadius: 8,
                  padding: 10,
                  marginBottom: 8,
                }}
              >
                {!expandable ? null : (
                  <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 6 }}>
                    key: {k} • base: {base}
                  </div>
                )}
                {w.item.fields.map((f) => {
                  const fAny = f as any;
                  const rel = fAny.binding?.path ?? '';
                  const fieldPath = rel === '' ? base : joinPointer(base, rel);
                  const asText = fAny.type === 'text';
                  const asSelect = fAny.type === 'select';
                  const label = fAny.label;

                  const value = getAtPointer(working, fieldPath);
                  if (asText) {
                    if (fAny.options?.readOnly) {
                      return (
                        <div key={fieldPath} style={{ marginBottom: 8 }}>
                          {label ? <div style={{ fontWeight: 600 }}>{label}</div> : null}
                          <div>{String(value ?? '')}</div>
                          <div style={{ fontSize: 12, opacity: 0.6 }}>{fieldPath} (read-only)</div>
                        </div>
                      );
                    }
                    return (
                      <div key={fieldPath} style={{ marginBottom: 8 }}>
                        {label ? <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>{label}</label> : null}
                        <input
                          value={String(value ?? '')}
                          onChange={e => {
                            const next = JSON.parse(JSON.stringify(working));
                            setAtPointer(next, fieldPath, e.target.value);
                            setWorking(next);
                          }}
                          style={{ padding: 8, width: 360 }}
                          data-f4b-focusable="true"
                        />
                        <div style={{ fontSize: 12, opacity: 0.6 }}>{fieldPath}</div>
                      </div>
                    );
                  }
                 if (asSelect) {
                    const selectOpts = normalizeSelectValues(fAny.options?.values);
                    return (
                      <div key={fieldPath} style={{ marginBottom: 8 }}>
                        {label ? <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>{label}</label> : null}
                        <select
                          value={String(value ?? '')}
                          onChange={e => {
                            const next = JSON.parse(JSON.stringify(working));
                            setAtPointer(next, fieldPath, e.target.value);
                            setWorking(next);
                          }}
                          style={{ padding: 8, width: 360 }}
                          data-f4b-focusable="true"
                        >
                          {selectOpts.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                        </select>
                        <div style={{ fontSize: 12, opacity: 0.6 }}>{fieldPath}</div>
                      </div>
                    );
                  }
                  return <div key={fieldPath} style={{ color: palette.warning }}>Unsupported item field</div>;
                })}
              </div>
            );
          })}
        </div>
      );
    }

    // Fallback (shouldn't happen if schema is correct)
    return <div style={{ color: palette.warning }}>List misconfigured</div>;
  }

  function renderFieldPicker(w: FieldPickerWidget) {
    if (!working) return null;
    const basePath = w.options.basePath;
    const obj = getAtPointer(working, basePath);
    const keys = obj && typeof obj === 'object' ? Object.keys(obj) : [];

    const boundPath = resolveBindingPath(w.binding, working);
    const isMulti = w.options.selection === 'multiple';

    const currentSel = boundPath
      ? getAtPointer(working, boundPath)
      : (vars[w.id] ?? (isMulti ? [] : null));

    function writeSelection(nextValue: string | string[] | null) {
      if (boundPath) {
        const next = JSON.parse(JSON.stringify(working));
        setAtPointer(next, boundPath, nextValue);
        setWorking(next);
      } else {
        setVar(w.id, nextValue);
      }
    }

    const pointerForKey = (k: string) => `${basePath}/${encodePointerSegment(k)}`;

    if (!isMulti) {
      const value = typeof currentSel === 'string' ? currentSel : '';
      return (
        <div style={{ marginBottom: 12 }}>
          {w.label ? <label style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>{w.label}</label> : null}
          <select
            value={value}
            onChange={e => {
              const nextPtr = e.target.value || null;
              writeSelection(nextPtr);
            }}
            style={{ padding: 8, width: 360 }}
            disabled={keys.length === 0}
            data-f4b-focusable={keys.length === 0 ? undefined : 'true'}
          >
            <option value="" disabled>— select —</option>
            {keys.map(k => {
              const ptr = pointerForKey(k);
              return (
                <option key={k} value={ptr}>
                  {k}
                </option>
              );
            })}
          </select>
          <div style={{ fontSize: 12, opacity: 0.6, marginTop: 4 }}>{basePath}</div>
          {keys.length === 0 && <div style={{ opacity: 0.7, marginTop: 6 }}>No keys under {basePath}</div>}
        </div>
      );
    }

    const checked = (key: string) => {
      const arr: string[] = Array.isArray(currentSel) ? currentSel : [];
      const set = new Set(arr);
      return set.has(pointerForKey(key));
    };

    function toggle(key: string, checkedNow: boolean) {
      const ptr = pointerForKey(key);
      const cur: string[] = Array.isArray(currentSel) ? currentSel : [];
      const next = checkedNow
        ? Array.from(new Set([...cur, ptr]))
        : cur.filter(p => p !== ptr);
      writeSelection(next);
    }

    return (
      <div style={{ marginBottom: 12 }}>
        {w.label ? <label style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>{w.label}</label> : null}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {keys.map(k => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                name={w.id}
                checked={checked(k)}
                onChange={e => toggle(k, e.target.checked)}
                data-f4b-focusable="true"
              />
              {k} <span style={{ opacity: 0.6, fontSize: 12 }}>({basePath}/{encodePointerSegment(k)})</span>
            </label>
          ))}
          {keys.length === 0 && <span style={{ opacity: 0.7 }}>No keys under {basePath}</span>}
        </div>
      </div>
    );
  }

  function renderAction(w: ActionWidget) {
    const name = w.options?.action;
    return (
      <div style={{ marginBottom: 12 }}>
        <button
          onClick={() => {
            if (!name) return;
            applyAction(name, { doc: original, working, varsOverride: vars, force: true });
          }}
          style={{ padding: '8px 12px' }}
          disabled={!name || !actions[name]}
        >
          {w.label}
        </button>
        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>
          Action: {name ?? '—'}
        </div>
      </div>
    );
  }

  function renderWidget(w: Widget) {
    if (w.type === 'text') return <div>{renderText(w)}</div>;
    if (w.type === 'select') return <div>{renderSelect(w)}</div>;
    if (w.type === 'list') return <div>{renderList(w)}</div>;
    if (w.type === 'field-picker') return <div>{renderFieldPicker(w)}</div>;
    if (w.type === 'action') return <div>{renderAction(w)}</div>;
    return <div style={{ color: palette.warning }}>Unsupported widget</div>;
  }

  const canRender = Boolean(template && original && working);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key !== 'Enter') return;
    if (event.shiftKey) return; // allow newline with shift+Enter
    const target = event.target as HTMLElement | null;
    if (!isTextEntryElement(target)) return;
    if (autoCommit || !canCommit) return;
    event.preventDefault();
    onCommit();
  }, [autoCommit, canCommit, onCommit]);

  const templateFocusKey = useMemo(() => {
    const childrenKey = Array.isArray(template?.layout?.children)
      ? template.layout.children.join('|')
      : '';
    return `${template?.name ?? 'template'}::${childrenKey}`;
  }, [template]);

  useEffect(() => {
    if (!canRender) return;
    if (!templateFocusKey) return;
    if (focusHistoryRef.current === templateFocusKey) return;
    focusHistoryRef.current = templateFocusKey;
    const container = contentSectionRef.current;
    if (!container) return;
    const selector = '[data-f4b-focusable="true"]';
    requestAnimationFrame(() => {
      const first = container.querySelector<HTMLElement>(selector);
      if (first) first.focus();
    });
  }, [canRender, templateFocusKey]);

  return (
    <div onKeyDown={handleKeyDown}>
      {!canRender ? (
        <p style={{ opacity: 0.8 }}>Loading document…</p>
      ) : (
        <>
          {templateWarnings.length > 0 && (
          <div
            style={{
              marginBottom: 12,
              padding: 10,
              border: palette.warningBorder,
              background: palette.warningBg,
              borderRadius: 8,
            }}
          >
          <div style={{ fontWeight: 600, color: palette.warning, marginBottom: 6 }}>Template Warnings</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {templateWarnings.map((msg, i) => <li key={i} style={{ marginBottom: 4 }}>{msg}</li>)}
              </ul>
            </div>
          )}

          <section
            style={{
              padding: 12,
              border: palette.border,
              background: palette.surfaceMuted,
              borderRadius: 8,
              marginBottom: 16,
            }}
            ref={contentSectionRef}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                marginBottom: 12,
              }}
            >
              <h3 style={{ margin: 0 }}>{template.name}</h3>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setShowJsonDev(prev => !prev)}
                  style={{
                    padding: '6px 10px',
                    border: palette.border,
                    borderRadius: 6,
                    background: showJsonDev ? 'var(--f4b-surface-soft)' : 'transparent',
                    color: 'var(--f4b-text-secondary)',
                    fontSize: 12,
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                  }}
                >
                  json
                </button>
                {!autoCommit && (
                  <button
                    type="button"
                    onClick={onCommit}
                    disabled={!canCommit}
                    ref={commitButtonRef}
                    style={{
                      padding: '8px 12px',
                      borderRadius: 6,
                      border: 'none',
                      background: canCommit ? 'var(--f4b-accent)' : 'var(--f4b-border-muted)',
                      color: canCommit ? '#0f1422' : 'var(--f4b-text-muted)',
                      fontWeight: 600,
                      fontSize: 14,
                      cursor: canCommit ? 'pointer' : 'not-allowed',
                    }}
                  >
                    ↑
                  </button>
                )}
              </div>
            </div>
            {template.layout.type !== 'vertical'
              ? <div style={{ color: palette.warning }}>Unsupported layout</div>
              : (
                <>
                  {template.layout.children.map(cid => {
                    const w = template.widgets.find(x => x.id === cid);
                    return w
                      ? <React.Fragment key={cid}>{renderWidget(w)}</React.Fragment>
                      : <div key={cid} style={{ color: palette.warning }}>Missing widget: {cid}</div>;
                  })}
                  {!autoCommit && (
                    <div
                      tabIndex={0}
                      onFocus={focusCommitButton}
                      style={{ width: 0, height: 0, padding: 0, margin: 0, border: 'none', outline: 'none' }}
                    />
                  )}
                </>
              )
            }
          </section>

          {showJsonDev && working && (
            <div
              style={{
                position: 'fixed',
                bottom: 24,
                right: 24,
                width: 340,
                maxHeight: '45vh',
                border: palette.border,
                background: 'color-mix(in srgb, var(--f4b-surface) 92%, transparent)',
                borderRadius: 8,
                boxShadow: '0 12px 24px rgba(15, 20, 34, 0.25)',
                overflow: 'hidden',
                zIndex: 20,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  borderBottom: palette.borderMuted,
                  background: 'var(--f4b-surface)',
                  fontSize: 12,
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                Pending Patch
                <span style={{ fontWeight: 400, opacity: 0.7 }}>{mode}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 'calc(45vh - 44px)' }}>
                <div style={{ padding: '12px 12px 0', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, opacity: 0.7 }}>
                  Working document
                </div>
                <pre
                  style={{
                    margin: 0,
                    padding: '8px 12px 12px',
                    background: palette.codeBg,
                    color: 'var(--f4b-text-secondary)',
                    fontSize: 12,
                    flex: 1,
                    overflow: 'auto',
                  }}
                >
                  {JSON.stringify(working, null, 2)}
                </pre>
                {patch.length > 0 && (
                  <>
                    <div style={{ padding: '12px 12px 0', fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, opacity: 0.7 }}>
                      Pending patch ({patch.length})
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        padding: '8px 12px 12px',
                        background: palette.codeBg,
                        color: 'var(--f4b-text-secondary)',
                        fontSize: 12,
                        maxHeight: 160,
                        overflow: 'auto',
                      }}
                    >
                      {JSON.stringify(patch, null, 2)}
                    </pre>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
