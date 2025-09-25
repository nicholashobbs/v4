'use client';
import React, { useEffect, useMemo, useState } from 'react';
import type {
  Flux4BotsProps, Widget, TextWidget, SelectWidget, ListWidget,
  FieldPickerWidget, ActionWidget, Operation
} from '../types';
import { getAtPointer, setAtPointer, encodePointerSegment, joinPointer } from '../core/pointer';
import { resolveBindingPath } from '../core/binding';
import { compareDocsToPatch, applyPatch } from '../core/patch';
import { validateTemplate } from '../core/validate';
import { ChipSelect } from './ChipSelect';

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
  const { template, store, mode = 'diff', actions = {}, ui, runtime: runtimeProp } = props;
  const runtime = runtimeProp ?? noopRuntime;

  // collect template warnings once per template
  const templateWarnings = useMemo(() => validateTemplate(template), [template]);

  const uiCfg = { showPatchPreview: true, showApplyButton: true, showCurrentJson: true, ...(ui || {}) };

  const [original, setOriginal] = useState<any | null>(null);
  const [working, setWorking] = useState<any | null>(null);
  const [explicitOps, setExplicitOps] = useState<Operation[]>([]);
  const [vars, setVars] = useState<Record<string, any>>({}); // captures unbound widget values

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

  async function onApply() {
    if (!patch.length) return;
    const updated = await store.applyPatch(patch);
    setOriginal(updated);
    setWorking(JSON.parse(JSON.stringify(updated)));
    setExplicitOps([]);
  }

  function setVar(id: string, value: any) {
    setVars(prev => ({ ...prev, [id]: value }));
  }

  /* ------------------- renderers ------------------- */

  function renderText(w: TextWidget) {
    const boundPath = working ? resolveBindingPath(w.binding, working) : null;
    const value = boundPath && working ? getAtPointer(working, boundPath) : (vars[w.id] ?? '');

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
            if (boundPath && working) {
              const next = JSON.parse(JSON.stringify(working));
              setAtPointer(next, boundPath, e.target.value);
              setWorking(next);
            } else {
              setVar(w.id, e.target.value);
            }
          }}
          style={{ padding: 8, width: 360 }}
          disabled={!!w.options?.readOnly && !boundPath}
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

    const writeValue = (nextValue: any) => {
      if (boundPath && working) {
        const next = JSON.parse(JSON.stringify(working));
        setAtPointer(next, boundPath, nextValue);
        setWorking(next);
      } else {
        setVar(w.id, nextValue);
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
          <ChipSelect options={options} selected={selected} multiple={allowMultiple} onChange={handleChange} />
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
    const keys = (obj && typeof obj === 'object') ? Object.keys(obj) : [];

    const boundPath = resolveBindingPath(w.binding, working);
    const isMulti = w.options.selection === 'multiple';

    // Read current selection: from doc if bound, else from vars[w.id]
    const currentSel = boundPath
        ? getAtPointer(working, boundPath)
        : (vars[w.id] ?? (isMulti ? [] : null));

    // Helper to write selection either to doc (bound) or to vars (unbound)
    function writeSelection(nextValue: string | string[] | null) {
        if (boundPath) {
        const next = JSON.parse(JSON.stringify(working));
        setAtPointer(next, boundPath, nextValue);
        setWorking(next);
        } else {
        setVar(w.id, nextValue);
        }
    }

    function pointerForKey(k: string) {
        return `${basePath}/${encodePointerSegment(k)}`;
    }

    function isCheckedFor(picked: any) {
        if (isMulti) {
        const arr: string[] = Array.isArray(picked) ? picked : [];
        const set = new Set(arr);
        return (k: string) => set.has(pointerForKey(k));
        }
        return (k: string) => picked === pointerForKey(k);
    }

    const checked = isCheckedFor(currentSel);

    function toggle(key: string, checkedNow: boolean) {
        const ptr = pointerForKey(key);
        if (isMulti) {
        const cur: string[] = Array.isArray(currentSel) ? currentSel : [];
        const next = checkedNow
            ? Array.from(new Set([...cur, ptr]))
            : cur.filter(p => p !== ptr);
        writeSelection(next);
        } else {
        writeSelection(checkedNow ? ptr : null);
        }
    }

    return (
        <div style={{ marginBottom: 12 }}>
        {w.label ? <label style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>{w.label}</label> : null}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {keys.map(k => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                type={isMulti ? 'checkbox' : 'radio'}
                name={w.id}
                checked={!!checked(k)}
                onChange={e => toggle(k, e.target.checked)}
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
            const handler = name ? actions?.[name] : undefined;
            if (!original || !name || !handler) return;
            const ops = handler({
              doc: original,
              working,
              vars,
              helpers: { encode: encodePointerSegment, get: getAtPointer },
              runtime,
            });
            setExplicitOps(ops);
            if (original) {
              const preview = applyPatch(original, ops);
              setWorking(preview);
            }
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

  return (
    <div>
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
          >
            <h3 style={{ marginTop: 0 }}>{template.name}</h3>
            {template.layout.type !== 'vertical'
              ? <div style={{ color: palette.warning }}>Unsupported layout</div>
              : template.layout.children.map(cid => {
                  const w = template.widgets.find(x => x.id === cid);
                  return w ? <React.Fragment key={cid}>{renderWidget(w)}</React.Fragment>
                           : <div key={cid} style={{ color: palette.warning }}>Missing widget: {cid}</div>;
                })
            }
          </section>

          {(uiCfg.showPatchPreview || uiCfg.showCurrentJson) && (
            <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {uiCfg.showPatchPreview && (
                <div>
                  <h4 style={{ margin: '8px 0' }}>Patch Preview ({mode})</h4>

                  {/* Scrollable preview container */}
                  <div style={{ maxHeight: 300, overflow: 'auto', position: 'relative', paddingBottom: 8 }}>
                    <pre style={{ background: palette.codeBg, padding: 12, borderRadius: 8 }}>
                      {JSON.stringify(patch, null, 2)}
                    </pre>

                    {/* Sticky apply footer inside this scroll container */}
                    {uiCfg.showApplyButton && (
                      <div
                        style={{
                          position: 'sticky',
                          bottom: 0,
                          background: 'color-mix(in srgb, var(--f4b-surface) 88%, transparent)',
                          backdropFilter: 'saturate(180%) blur(6px)',
                          paddingTop: 8,
                          paddingBottom: 8,
                        }}
                      >
                        <button
                          onClick={onApply}
                          disabled={patch.length === 0}
                          style={{
                            padding: '8px 12px',
                            background: 'var(--f4b-accent)',
                            color: '#0f1422',
                            border: 'none',
                            fontWeight: 600,
                          }}
                        >
                          Apply Patch
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {uiCfg.showCurrentJson && (
                <div>
                  <h4 style={{ margin: '8px 0' }}>Current JSON</h4>
                  <pre style={{ background: palette.codeBg, padding: 12, borderRadius: 8, maxHeight: 300, overflow: 'auto' }}>
                    {JSON.stringify(working, null, 2)}
                  </pre>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
