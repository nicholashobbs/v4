import React, { useEffect, useMemo, useState } from 'react';
import type { CardCollectionOptions, ListItemSpec, TextWidget, SelectWidget } from '../types';
import { setAtPointer } from '../core/pointer';

const palette = {
  border: '1px solid var(--f4b-border)',
  borderMuted: '1px solid var(--f4b-border-muted)',
  surfaceSoft: 'var(--f4b-surface-soft)',
  surfaceMuted: 'var(--f4b-surface-muted)',
  accent: 'var(--f4b-accent)',
  textPrimary: 'var(--f4b-text-primary)',
  textSecondary: 'var(--f4b-text-secondary)',
  textMuted: 'var(--f4b-text-muted)',
};

type FieldWidget = TextWidget | SelectWidget;

type CardCollectionEditorProps = {
  label?: string;
  entries: any[];
  itemSpec: ListItemSpec;
  options: CardCollectionOptions;
  persist: (updater: (current: any[]) => any[]) => Promise<void>;
};

type FormMode = 'add' | 'edit';

type FieldMap = Record<string, FieldWidget>;

type FormState = Record<string, string | string[]>;

type PendingState = 'idle' | 'saving';

type ValidationError = {
  field: string;
  message: string;
};

function deriveFieldMap(fields: FieldWidget[]): FieldMap {
  return fields.reduce<FieldMap>((acc, field) => {
    acc[field.id] = field;
    return acc;
  }, {});
}

function buildEntryFromForm(
  form: FormState,
  fieldMap: FieldMap,
  bulletsFieldId: string | undefined,
): any {
  const entry = {} as Record<string, any>;
  for (const [fieldId, widget] of Object.entries(fieldMap)) {
    const ptr = (widget as TextWidget | SelectWidget).binding?.path ?? '';
    if (ptr === '') continue;
    const rawValue = form[fieldId];
    if (rawValue === undefined) continue;
    if (bulletsFieldId && fieldId === bulletsFieldId) {
      const bulletArray = Array.isArray(rawValue) ? rawValue : [];
      setAtPointer(entry, ptr, bulletArray);
    } else {
      const strValue = typeof rawValue === 'string' ? rawValue.trim() : String(rawValue ?? '');
      setAtPointer(entry, ptr, strValue);
    }
  }
  return entry;
}

function normalizeBullets(value: unknown): string[] {
  if (!Array.isArray(value)) {
    if (value == null) return [];
    return [String(value)];
  }
  return value.map(v => String(v ?? ''));
}

function defaultFormState(
  fieldMap: FieldMap,
  bulletsFieldId: string | undefined,
): FormState {
  const state: FormState = {};
  for (const fieldId of Object.keys(fieldMap)) {
    if (bulletsFieldId && fieldId === bulletsFieldId) {
      state[fieldId] = [''];
    } else {
      state[fieldId] = '';
    }
  }
  return state;
}

function formStateFromEntry(
  entry: any,
  fieldMap: FieldMap,
  bulletsFieldId: string | undefined,
): FormState {
  const state: FormState = {};
  for (const [fieldId, widget] of Object.entries(fieldMap)) {
    const ptr = widget.binding?.path ?? '';
    if (!ptr) {
      state[fieldId] = '';
      continue;
    }
    const value = getValueAtPointer(entry, ptr);
    if (bulletsFieldId && fieldId === bulletsFieldId) {
      state[fieldId] = normalizeBullets(value);
    } else {
      state[fieldId] = value == null ? '' : String(value);
    }
  }
  return state;
}

function getValueAtPointer(obj: any, pointer: string): any {
  if (!pointer) return undefined;
  const segments = pointer.split('/').slice(1);
  let current = obj;
  for (const segment of segments) {
    if (current == null) return undefined;
    const decoded = decodeSegment(segment);
    current = current?.[decoded];
  }
  return current;
}

function decodeSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function sanitizeBullets(values: string[]): string[] {
  return values.map(v => v.trim()).filter(Boolean);
}

function mergeDateRange(values: Record<string, string | string[]>, config: CardCollectionOptions['card']) {
  if (!config?.dateRangeFields) return null;
  const { start, end } = config.dateRangeFields;
  if (!start && !end) return null;
  const startRaw = start ? values[start] : '';
  const endRaw = end ? values[end] : '';
  const startValue = typeof startRaw === 'string' ? startRaw.trim() : '';
  const endValue = typeof endRaw === 'string' ? endRaw.trim() : '';
  if (!startValue && !endValue) return null;
  if (!startValue) return endValue;
  if (!endValue) return startValue;
  return `${startValue} – ${endValue}`;
}

export default function CollectionCardEditor(props: CardCollectionEditorProps) {
  const { label, entries, itemSpec, options, persist } = props;
  const [mode, setMode] = useState<FormMode>('add');
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const fieldMap = useMemo(() => deriveFieldMap(itemSpec.fields), [itemSpec.fields]);
  const bulletsFieldId = options.bulletsField ?? (itemSpec.fields.find(f => f.id === 'bullets')?.id);
  const [form, setForm] = useState<FormState>(() => defaultFormState(fieldMap, bulletsFieldId));
  const [errors, setErrors] = useState<ValidationError | null>(null);
  const [pending, setPending] = useState<PendingState>('idle');

  useEffect(() => {
    if (mode === 'edit' && activeIndex != null) {
      const entry = entries[activeIndex];
      setForm(formStateFromEntry(entry, fieldMap, bulletsFieldId));
      setErrors(null);
      return;
    }
    if (mode === 'add') {
      setForm(defaultFormState(fieldMap, bulletsFieldId));
      setErrors(null);
    }
  }, [entries, mode, activeIndex, fieldMap, bulletsFieldId]);

  const orderedFields = useMemo(() => {
    const order = options.formOrder;
    if (!order || order.length === 0) {
      return itemSpec.fields;
    }
    const orderSet = new Set(order);
    const ordered: FieldWidget[] = [];
    for (const id of order) {
      const match = fieldMap[id];
      if (match) ordered.push(match);
    }
    for (const field of itemSpec.fields) {
      if (!orderSet.has(field.id)) ordered.push(field);
    }
    return ordered;
  }, [itemSpec.fields, options.formOrder, fieldMap]);

  const displayEntries = useMemo(() => {
    const base = entries.map((entry, originalIndex) => ({ entry, originalIndex }));
    if (activeIndex == null || activeIndex <= 0) return base;
    const cloned = base.slice();
    const [selected] = cloned.splice(activeIndex, 1);
    return [selected, ...cloned];
  }, [entries, activeIndex]);

  function resetForm() {
    setForm(defaultFormState(fieldMap, bulletsFieldId));
    setMode('add');
    setActiveIndex(null);
    setErrors(null);
  }

  function updateField(fieldId: string, value: string) {
    setForm(prev => ({ ...prev, [fieldId]: value }));
  }

  function updateBullet(index: number, value: string) {
    if (!bulletsFieldId) return;
    setForm(prev => {
      const current = Array.isArray(prev[bulletsFieldId]) ? [...(prev[bulletsFieldId] as string[])] : [];
      current[index] = value;
      return { ...prev, [bulletsFieldId]: current };
    });
  }

  function addBulletField() {
    if (!bulletsFieldId) return;
    setForm(prev => {
      const current = Array.isArray(prev[bulletsFieldId]) ? [...(prev[bulletsFieldId] as string[])] : [];
      return { ...prev, [bulletsFieldId]: [...current, ''] };
    });
  }

  function removeBulletField(targetIndex: number) {
    if (!bulletsFieldId) return;
    setForm(prev => {
      const current = Array.isArray(prev[bulletsFieldId]) ? [...(prev[bulletsFieldId] as string[])] : [];
      current.splice(targetIndex, 1);
      return { ...prev, [bulletsFieldId]: current.length > 0 ? current : [''] };
    });
  }

  function validate(formState: FormState): boolean {
    const titleFieldId = options.card?.titleField ?? 'title';
    const titleValue = formState[titleFieldId];
    if (typeof titleValue !== 'string' || titleValue.trim() === '') {
      setErrors({ field: titleFieldId, message: 'Title is required.' });
      return false;
    }
    setErrors(null);
    return true;
  }

  function sanitizeForm(formState: FormState): FormState {
    if (!bulletsFieldId) return formState;
    const value = formState[bulletsFieldId];
    if (!Array.isArray(value)) return formState;
    return { ...formState, [bulletsFieldId]: sanitizeBullets(value as string[]) };
  }

  async function handleAdd() {
    const sanitized = sanitizeForm(form);
    if (!validate(sanitized)) return;

    const prepared = buildEntryFromForm(sanitized, fieldMap, bulletsFieldId);
    setPending('saving');
    try {
      await persist(current => {
        const next = current ? current.slice() : [];
        next.unshift(prepared);
        return next;
      });
      resetForm();
    } catch (err) {
      console.error('Failed to add entry', err);
    } finally {
      setPending('idle');
    }
  }

  async function handleSave() {
    if (activeIndex == null) return;
    const sanitized = sanitizeForm(form);
    if (!validate(sanitized)) return;
    const prepared = buildEntryFromForm(sanitized, fieldMap, bulletsFieldId);

    setPending('saving');
    try {
      await persist(current => {
        const next = current ? current.slice() : [];
        next.splice(activeIndex, 1);
        next.unshift(prepared);
        return next;
      });
      resetForm();
    } catch (err) {
      console.error('Failed to save entry', err);
    } finally {
      setPending('idle');
    }
  }

  async function handleDelete(target: number) {
    if (!window.confirm('Delete this entry?')) return;
    setPending('saving');
    try {
      await persist(current => {
        const next = current ? current.slice() : [];
        next.splice(target, 1);
        return next;
      });
      if (activeIndex === target) {
        resetForm();
      }
    } catch (err) {
      console.error('Failed to delete entry', err);
    } finally {
      setPending('idle');
    }
  }

  function enterEdit(index: number) {
    setActiveIndex(index);
    setMode('edit');
    setForm(formStateFromEntry(entries[index], fieldMap, bulletsFieldId));
    setErrors(null);
  }

  const titleFieldId = options.card?.titleField ?? 'title';

  return (
    <div style={{ marginBottom: 16 }}>
      {label ? <h4 style={{ margin: '8px 0' }}>{label}</h4> : null}
      <div
        style={{
          display: 'flex',
          gap: 16,
          alignItems: 'flex-start',
          flexWrap: 'wrap',
        }}
      >
        <div
          style={{
            flex: '1 1 320px',
            minWidth: 280,
            maxHeight: 360,
            overflowY: 'auto',
            paddingRight: 4,
          }}
        >
          {displayEntries.length === 0 && (
            <div style={{ opacity: 0.7 }}>No entries yet.</div>
          )}
          {displayEntries.map(({ entry, originalIndex }) => {
            const formValues = formStateFromEntry(entry, fieldMap, bulletsFieldId);
            const title = typeof formValues[titleFieldId] === 'string' ? String(formValues[titleFieldId]) : '';
            const subtitleField = options.card?.subtitleField;
            const subtitle = subtitleField ? String(formValues[subtitleField] ?? '') : '';
            const metaValues = options.card?.metaFields ?? [];
            const meta = metaValues
              .map(fieldId => String(formValues[fieldId] ?? ''))
              .filter(Boolean)
              .join(' • ');
            const dateRange = mergeDateRange(formValues as Record<string, string>, options.card);
            const bullets = bulletsFieldId ? normalizeBullets(formValues[bulletsFieldId]) : [];
            const isActive = mode === 'edit' && originalIndex === activeIndex;

            return (
              <div
                key={originalIndex}
                style={{
                  border: palette.borderMuted,
                  background: isActive ? 'color-mix(in srgb, var(--f4b-accent) 12%, transparent)' : palette.surfaceSoft,
                  borderRadius: 10,
                  padding: '12px 14px',
                  marginBottom: 12,
                  boxShadow: isActive ? '0 0 0 1px var(--f4b-accent)' : 'none',
                  cursor: 'pointer',
                }}
                onClick={() => enterEdit(originalIndex)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600 }}>{title || 'Untitled entry'}</div>
                    {subtitle && <div style={{ fontSize: 13, opacity: 0.75 }}>{subtitle}</div>}
                    {meta && <div style={{ fontSize: 12, opacity: 0.65, marginTop: 4 }}>{meta}</div>}
                    {dateRange && <div style={{ fontSize: 12, opacity: 0.65, marginTop: 2 }}>{dateRange}</div>}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(originalIndex);
                    }}
                    disabled={pending === 'saving'}
                    style={{
                      border: palette.borderMuted,
                      background: 'transparent',
                      borderRadius: 999,
                      width: 28,
                      height: 28,
                      fontWeight: 600,
                      cursor: pending === 'saving' ? 'not-allowed' : 'pointer',
                    }}
                    title="Delete"
                  >
                    –
                  </button>
                </div>
                {isActive && (
                  <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: palette.textSecondary }}>
                    Editing…
                  </div>
                )}
                {bullets.length > 0 && (
                  <ul style={{ marginTop: 12, paddingLeft: 18, maxHeight: 120, overflowY: 'auto' }}>
                    {bullets.map((bullet, bulletIdx) => (
                      <li key={bulletIdx} style={{ marginBottom: 4, fontSize: 13 }}>
                        {bullet}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        <div
          style={{
            flex: '1 1 320px',
            minWidth: 280,
            border: palette.border,
            background: palette.surfaceMuted,
            borderRadius: 12,
            padding: '16px 18px',
            position: 'relative',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>
              {mode === 'add' ? 'Add entry' : 'Edit entry'}
            </div>
            {mode === 'edit' && (
              <button
                type="button"
                onClick={resetForm}
                style={{ border: 'none', background: 'transparent', color: palette.textSecondary, fontSize: 13, textDecoration: 'underline' }}
                disabled={pending === 'saving'}
              >
                Cancel
              </button>
            )}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: 12,
            }}
          >
            {orderedFields.map((widget) => {
              const fieldId = widget.id;
              const labelText = widget.label ?? fieldId;
              const value = form[fieldId];
              const isBullet = bulletsFieldId && fieldId === bulletsFieldId;

              if (isBullet) {
                const bulletValues = Array.isArray(value) ? (value as string[]) : [];
                return (
                  <div key={fieldId} style={{ gridColumn: '1 / -1' }}>
                    <div style={{ fontWeight: 600, marginBottom: 6 }}>{labelText}</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {bulletValues.map((bullet, bulletIdx) => (
                        <div key={bulletIdx} style={{ display: 'flex', gap: 8 }}>
                          <input
                            value={bullet}
                            onChange={e => updateBullet(bulletIdx, e.target.value)}
                            placeholder={`Bullet ${bulletIdx + 1}`}
                            style={{ flex: 1, padding: '8px 10px', border: palette.borderMuted, borderRadius: 6 }}
                            data-f4b-focusable="true"
                          />
                          <button
                            type="button"
                            onClick={() => removeBulletField(bulletIdx)}
                            style={{
                              width: 32,
                              borderRadius: 6,
                              border: palette.borderMuted,
                              background: 'transparent',
                              fontWeight: 600,
                            }}
                          >
                            –
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        onClick={addBulletField}
                        style={{
                          alignSelf: 'flex-start',
                          border: palette.borderMuted,
                          background: 'transparent',
                          borderRadius: 999,
                          padding: '6px 12px',
                          fontWeight: 600,
                        }}
                      >
                        + Bullet
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <label key={fieldId} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <span style={{ fontWeight: 600 }}>{labelText}</span>
                  <input
                    value={typeof value === 'string' ? value : ''}
                    onChange={e => updateField(fieldId, e.target.value)}
                    style={{ padding: '8px 10px', border: palette.borderMuted, borderRadius: 6 }}
                    data-f4b-focusable="true"
                  />
                  {errors?.field === fieldId && (
                    <span style={{ color: 'var(--f4b-warning)', fontSize: 12 }}>{errors.message}</span>
                  )}
                </label>
              );
            })}
          </div>

          <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
            {mode === 'add' ? (
              <button
                type="button"
                onClick={handleAdd}
                disabled={pending === 'saving'}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: palette.accent,
                  color: '#0f1422',
                  fontWeight: 600,
                  cursor: pending === 'saving' ? 'not-allowed' : 'pointer',
                }}
              >
                + Add
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSave}
                disabled={pending === 'saving'}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: palette.accent,
                  color: '#0f1422',
                  fontWeight: 600,
                  cursor: pending === 'saving' ? 'not-allowed' : 'pointer',
                }}
              >
                Save changes
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
