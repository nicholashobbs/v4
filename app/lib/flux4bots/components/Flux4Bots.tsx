'use client';
import React, { useEffect, useMemo, useState } from 'react';
import type {
  Flux4BotsProps, Template, Widget, TextWidget, SelectWidget, ListWidget,
  FieldPickerWidget, ActionWidget, Operation
} from '../types';
import { getAtPointer, setAtPointer, encodePointerSegment, joinPointer } from '../core/pointer';
import { resolveBindingPath } from '../core/binding';
import { compareDocsToPatch, applyPatch } from '../core/patch';
import { validateTemplate } from '../core/validate';

export function Flux4Bots(props: Flux4BotsProps) {
  const { template, store, mode = 'diff', actions = {}, ui } = props;

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
          <div style={{ fontSize: 12, color: '#b3261e', marginTop: 4 }}>
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
    const values = w.options?.values ?? [];
    const boundPath = working ? resolveBindingPath(w.binding, working) : null;
    const value = boundPath && working ? getAtPointer(working, boundPath) : (vars[w.id] ?? '');

    return (
      <div style={{ marginBottom: 10 }}>
        {w.label ? <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>{w.label}</label> : null}
        <select
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
        >
          {value === '' && <option value="" disabled>— select —</option>}
          {values.map(v => <option key={v} value={v}>{v}</option>)}
        </select>
        {w.binding && !boundPath && (
          <div style={{ fontSize: 12, color: '#b3261e', marginTop: 4 }}>
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
    const arrPath = resolveBindingPath(w.binding, working);
    if (!arrPath) return <div style={{ color: 'crimson' }}>List binding missing</div>;

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
            <div key={base} style={{ border: '1px solid #eee', borderRadius: 8, padding: 10, marginBottom: 8 }}>
              {!expandable ? null : (
                <div style={{ fontSize: 12, opacity: 0.6, marginBottom: 6 }}>
                  base: {base}
                </div>
              )}
              {w.item.fields.map((f) => {
                const fAny = f as any;
                const fieldPath = joinPointer(base, fAny.binding?.path ?? '');
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
                  const opts: string[] = fAny.options?.values ?? [];
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
                        {opts.map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                      <div style={{ fontSize: 12, opacity: 0.6 }}>{fieldPath}</div>
                    </div>
                  );
                }
                return <div key={fieldPath} style={{ color: 'crimson' }}>Unsupported item field</div>;
              })}
            </div>
          );
        })}
      </div>
    );
  }

  function renderFieldPicker(w: FieldPickerWidget) {
    if (!working) return null;
    const basePath = w.options.basePath;
    const obj = getAtPointer(working, basePath);
    const keys = (obj && typeof obj === 'object') ? Object.keys(obj) : [];

    const boundPath = resolveBindingPath(w.binding, working);
    const selected = boundPath ? getAtPointer(working, boundPath) : null;
    const isMulti = w.options.selection === 'multiple';

    function toggle(key: string, checked: boolean) {
      if (!boundPath) return; // unbound picker acts read-only
      const next = JSON.parse(JSON.stringify(working));
      if (isMulti) {
        const cur: string[] = Array.isArray(getAtPointer(next, boundPath)) ? getAtPointer(next, boundPath) : [];
        const newVal = checked ? Array.from(new Set([...cur, `${basePath}/${encodePointerSegment(key)}`]))
                               : cur.filter((p: string) => !p.endsWith(`/${encodePointerSegment(key)}`));
        setAtPointer(next, boundPath, newVal);
      } else {
        setAtPointer(next, boundPath, `${basePath}/${encodePointerSegment(key)}`);
      }
      setWorking(next);
    }

    const picked = (p: any) => {
      if (isMulti) {
        const arr: string[] = Array.isArray(p) ? p : [];
        const set = new Set(arr);
        return (k: string) => set.has(`${basePath}/${encodePointerSegment(k)}`);
      }
      return (k: string) => p === `${basePath}/${encodePointerSegment(k)}`;
    };

    const isChecked = picked(selected);

    return (
      <div style={{ marginBottom: 12 }}>
        {w.label ? <label style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>{w.label}</label> : null}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {keys.map(k => (
            <label key={k} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type={isMulti ? 'checkbox' : 'radio'}
                name={w.id}
                checked={!!isChecked(k)}
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
            if (!original || !name || !actions[name]) return;
            const ops = actions[name]({
              doc: original,
              working,
              vars,
              helpers: { encode: encodePointerSegment, get: getAtPointer }
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
    return <div style={{ color: 'crimson' }}>Unsupported widget</div>;
  }

  const canRender = Boolean(template && original && working);

  return (
    <div>
      {!canRender ? (
        <p style={{ opacity: 0.8 }}>Loading document…</p>
      ) : (
        <>
          {templateWarnings.length > 0 && (
            <div style={{ marginBottom: 12, padding: 10, border: '1px solid #f0c2bf', background: '#fff5f4', borderRadius: 8 }}>
              <div style={{ fontWeight: 600, color: '#b3261e', marginBottom: 6 }}>Template Warnings</div>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {templateWarnings.map((msg, i) => <li key={i} style={{ marginBottom: 4 }}>{msg}</li>)}
              </ul>
            </div>
          )}

          <section style={{ padding: 12, border: '1px solid #ddd', borderRadius: 8, marginBottom: 16 }}>
            <h3 style={{ marginTop: 0 }}>{template.name}</h3>
            {template.layout.type !== 'vertical'
              ? <div style={{ color: 'crimson' }}>Unsupported layout</div>
              : template.layout.children.map(cid => {
                  const w = template.widgets.find(x => x.id === cid);
                  return w ? <React.Fragment key={cid}>{renderWidget(w)}</React.Fragment>
                           : <div key={cid} style={{ color: 'crimson' }}>Missing widget: {cid}</div>;
                })
            }
          </section>

          {(uiCfg.showPatchPreview || uiCfg.showCurrentJson) && (
            <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {uiCfg.showPatchPreview && (
                <div>
                  <h4 style={{ margin: '8px 0' }}>Patch Preview ({mode})</h4>
                  <pre style={{ background: '#f7f7f7', padding: 12, borderRadius: 8, maxHeight: 300, overflow: 'auto' }}>
                    {JSON.stringify(patch, null, 2)}
                  </pre>
                  {uiCfg.showApplyButton && (
                    <button onClick={onApply} disabled={patch.length === 0} style={{ padding: '8px 12px' }}>
                      Apply Patch
                    </button>
                  )}
                </div>
              )}
              {uiCfg.showCurrentJson && (
                <div>
                  <h4 style={{ margin: '8px 0' }}>Current JSON</h4>
                  <pre style={{ background: '#f7f7f7', padding: 12, borderRadius: 8, maxHeight: 300, overflow: 'auto' }}>
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
