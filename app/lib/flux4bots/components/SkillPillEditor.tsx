import React, { useMemo, useState } from 'react';
import type { SkillPillOptions } from '../types';

const palette = {
  border: '1px solid var(--f4b-border)',
  borderMuted: '1px solid var(--f4b-border-muted)',
  surfaceSoft: 'var(--f4b-surface-soft)',
  textPrimary: 'var(--f4b-text-primary)',
  textSecondary: 'var(--f4b-text-secondary)',
  textMuted: 'var(--f4b-text-muted)',
  accent: 'var(--f4b-accent)',
};

type Skill = { name: string; categories: string[] };

type SkillPillEditorProps = {
  label?: string;
  skills: any[];
  persist: (updater: (current: any[]) => any[]) => Promise<void>;
  options?: SkillPillOptions;
};

function normalizeSkill(raw: any): Skill | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    return { name: trimmed, categories: [] };
  }
  if (raw && typeof raw === 'object') {
    const obj = raw as { name?: unknown; categories?: unknown };
    const name = typeof obj.name === 'string' ? obj.name.trim() : '';
    if (!name) return null;
    const categoriesRaw: unknown[] = Array.isArray(obj.categories) ? obj.categories : [];
    const categorySet = new Set<string>();
    for (const entry of categoriesRaw) {
      const normalized = String(entry ?? '').trim();
      if (normalized) categorySet.add(normalized);
    }
    return { name, categories: Array.from(categorySet) };
  }
  return null;
}

function normalizeSkillArray(raw: any): Skill[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Skill[] = [];
  for (const item of raw) {
    const skill = normalizeSkill(item);
    if (!skill) continue;
    const key = skill.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(skill);
  }
  return out;
}

function sanitizeCategories(categories: string[]): string[] {
  const set = new Set<string>();
  for (const cat of categories) {
    const trimmed = cat.trim();
    if (trimmed) set.add(trimmed);
  }
  return Array.from(set);
}

function diffCaseInsensitive(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function toDocSkills(skills: Skill[]): any[] {
  return skills.map(skill => ({ name: skill.name, categories: skill.categories }));
}

function Pill({ children, onRemove }: { children: React.ReactNode; onRemove?: () => void }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 999,
        border: palette.borderMuted,
        background: 'transparent',
        fontSize: 13,
      }}
    >
      {children}
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          style={{
            border: 'none',
            background: 'transparent',
            fontSize: 12,
            cursor: 'pointer',
            color: palette.textSecondary,
          }}
        >
          ×
        </button>
      )}
    </span>
  );
}

export function SkillPillEditor(props: SkillPillEditorProps) {
  const { label, skills, persist, options } = props;

  const normalizedSkills = useMemo(() => normalizeSkillArray(skills), [skills]);
  const [mode, setMode] = useState<'add' | 'edit'>('add');
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [categoriesDraft, setCategoriesDraft] = useState<string[]>([]);
  const [categoryInput, setCategoryInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const suggestionSet = useMemo(() => {
    const set = new Set<string>();
    if (options?.suggestions) {
      for (const suggestion of options.suggestions) {
        const trimmed = String(suggestion ?? '').trim();
        if (trimmed) set.add(trimmed);
      }
    }
    for (const skill of normalizedSkills) {
      for (const cat of skill.categories) set.add(cat);
    }
    for (const cat of categoriesDraft) set.add(cat);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [options?.suggestions, normalizedSkills, categoriesDraft]);

  const selectedCategorySet = useMemo(() => new Set(categoriesDraft.map(cat => cat.toLowerCase())), [categoriesDraft]);

  function resetForm() {
    setMode('add');
    setActiveIndex(null);
    setNameDraft('');
    setCategoriesDraft([]);
    setCategoryInput('');
    setError(null);
  }

  function enterEdit(index: number) {
    const skill = normalizedSkills[index];
    if (!skill) return;
    setMode('edit');
    setActiveIndex(index);
    setNameDraft(skill.name);
    setCategoriesDraft(skill.categories);
    setCategoryInput('');
    setError(null);
  }

  function addCategoryFromDraft() {
    const trimmed = categoryInput.trim();
    if (!trimmed) return;
    if (!selectedCategorySet.has(trimmed.toLowerCase())) {
      setCategoriesDraft(prev => sanitizeCategories([...prev, trimmed]));
    }
    setCategoryInput('');
  }

  function toggleCategory(cat: string) {
    const lower = cat.toLowerCase();
    if (selectedCategorySet.has(lower)) {
      setCategoriesDraft(prev => prev.filter(existing => existing.toLowerCase() !== lower));
    } else {
      setCategoriesDraft(prev => sanitizeCategories([...prev, cat]));
    }
  }

  async function handleDelete(index: number) {
    if (pending) return;
    setPending(true);
    try {
      await persist(current => {
        const next = normalizeSkillArray(current);
        next.splice(index, 1);
        return toDocSkills(next);
      });
      if (mode === 'edit' && activeIndex === index) {
        resetForm();
      }
    } finally {
      setPending(false);
    }
  }

  async function handleSubmit() {
    const trimmedName = nameDraft.trim();
    if (!trimmedName) {
      setError('Enter a skill name.');
      return;
    }
    const normalizedCategories = sanitizeCategories(categoriesDraft);
    const existingIndex = normalizedSkills.findIndex(skill => diffCaseInsensitive(skill.name, trimmedName));

    if (mode === 'add') {
      if (existingIndex !== -1) {
        setError('That skill already exists. Editing it now.');
        enterEdit(existingIndex);
        return;
      }
      setPending(true);
      try {
        await persist(current => {
          const next = normalizeSkillArray(current);
          next.push({ name: trimmedName, categories: normalizedCategories });
          return toDocSkills(next);
        });
        resetForm();
      } finally {
        setPending(false);
      }
      return;
    }

    // edit mode
    if (activeIndex == null) {
      resetForm();
      return;
    }
    if (existingIndex !== -1 && existingIndex !== activeIndex) {
      setError('Another skill already uses that name.');
      return;
    }
    const originalSkill = normalizedSkills[activeIndex];
    if (!originalSkill) {
      resetForm();
      return;
    }
    setPending(true);
    try {
      await persist(current => {
        const next = normalizeSkillArray(current);
        const targetIndex = next.findIndex(skill => diffCaseInsensitive(skill.name, originalSkill.name));
        if (targetIndex !== -1) {
          next[targetIndex] = { name: trimmedName, categories: normalizedCategories };
        } else {
          next.push({ name: trimmedName, categories: normalizedCategories });
        }
        return toDocSkills(next);
      });
      resetForm();
    } finally {
      setPending(false);
    }
  }

  const pills = normalizedSkills.map((skill, index) => {
    const selected = mode === 'edit' && activeIndex === index;
    return (
      <button
        key={skill.name}
        type="button"
        onClick={() => enterEdit(index)}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 4,
          padding: '8px 12px',
          borderRadius: 999,
          border: selected ? `1px solid ${palette.accent}` : palette.borderMuted,
          background: selected ? 'color-mix(in srgb, var(--f4b-accent) 16%, transparent)' : palette.surfaceSoft,
          color: palette.textPrimary,
          cursor: 'pointer',
          position: 'relative',
        }}
      >
        <div style={{ fontWeight: 600 }}>{skill.name}</div>
        {skill.categories.length > 0 && (
          <div style={{ fontSize: 12, color: palette.textSecondary }}>
            {skill.categories.join(', ')}
          </div>
        )}
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            void handleDelete(index);
          }}
          style={{
            position: 'absolute',
            top: 4,
            right: 4,
            border: 'none',
            background: 'transparent',
            fontSize: 12,
            cursor: 'pointer',
            color: palette.textMuted,
          }}
          title="Remove skill"
        >
          ×
        </button>
      </button>
    );
  });

  return (
    <div>
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
            flex: '1 1 360px',
            minWidth: 280,
            border: palette.border,
            background: palette.surfaceSoft,
            borderRadius: 12,
            padding: '14px 16px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
            <div style={{ width: 110, minWidth: 110, fontWeight: 600 }}>Skill</div>
            <input
              value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              placeholder="e.g. JavaScript"
              style={{ flex: 1, padding: '6px 8px', border: palette.borderMuted, borderRadius: 6 }}
              data-f4b-focusable="true"
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ width: 110, minWidth: 110, fontWeight: 600, paddingTop: 6 }}>Categories</div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  value={categoryInput}
                  onChange={e => setCategoryInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addCategoryFromDraft();
                    }
                  }}
                  placeholder="Add category"
                  style={{ flex: 1, padding: '6px 8px', border: palette.borderMuted, borderRadius: 6 }}
                  data-f4b-focusable="true"
                />
                <button
                  type="button"
                  onClick={addCategoryFromDraft}
                  style={{
                    borderRadius: 6,
                    border: palette.borderMuted,
                    background: 'transparent',
                    padding: '6px 12px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  + Add
                </button>
              </div>

              {categoriesDraft.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {categoriesDraft.map(cat => (
                    <Pill key={cat} onRemove={() => toggleCategory(cat)}>
                      {cat}
                    </Pill>
                  ))}
                </div>
              )}

              {suggestionSet.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {suggestionSet.map(cat => {
                    const selected = selectedCategorySet.has(cat.toLowerCase());
                    return (
                      <button
                        type="button"
                        key={cat}
                        onClick={() => toggleCategory(cat)}
                        style={{
                          borderRadius: 999,
                          border: selected ? `1px solid ${palette.accent}` : palette.borderMuted,
                          background: selected
                            ? 'color-mix(in srgb, var(--f4b-accent) 15%, transparent)'
                            : 'transparent',
                          padding: '4px 10px',
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {error && (
            <div style={{ color: 'var(--f4b-warning)', fontSize: 12, marginTop: 10 }}>{error}</div>
          )}

          <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={pending}
              style={{
                padding: '8px 14px',
                borderRadius: 8,
                border: 'none',
                background: palette.accent,
                color: '#0f1422',
                fontWeight: 600,
                cursor: pending ? 'not-allowed' : 'pointer',
              }}
            >
              {mode === 'add' ? '+ Add skill' : 'Save changes'}
            </button>
            {mode === 'edit' && (
              <button
                type="button"
                onClick={resetForm}
                disabled={pending}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: palette.borderMuted,
                  background: 'transparent',
                  fontWeight: 600,
                  cursor: pending ? 'not-allowed' : 'pointer',
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </div>

        <div
          style={{
            flex: '1 1 360px',
            minWidth: 260,
            maxHeight: 360,
            overflowY: 'auto',
            paddingRight: 4,
          }}
        >
          {label ? <h4 style={{ margin: '0 0 10px' }}>{label}</h4> : null}
          {normalizedSkills.length === 0 ? (
            <div style={{ opacity: 0.7 }}>No skills added yet.</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {pills}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
