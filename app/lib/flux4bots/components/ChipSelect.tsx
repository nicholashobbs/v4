'use client';

import React from 'react';

export type ChipOption = { value: string; label: string };

export type ChipSelectProps = {
  options: ChipOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  multiple?: boolean;
};

export function ChipSelect({ options, selected, onChange, multiple = true }: ChipSelectProps) {
  function toggle(value: string) {
    const has = selected.includes(value);
    if (multiple) {
      const next = has ? selected.filter(v => v !== value) : [...selected, value];
      onChange(next);
    } else {
      onChange(has ? [] : [value]);
    }
  }

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {options.map(opt => {
        const isSelected = selected.includes(opt.value);
        const background = isSelected ? 'var(--f4b-accent)' : 'var(--f4b-surface-soft)';
        const color = isSelected ? '#0f1422' : 'var(--f4b-text-secondary)';
        const border = isSelected ? 'var(--f4b-accent)' : 'var(--f4b-border)';
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => toggle(opt.value)}
            aria-pressed={isSelected}
            style={{
              cursor: 'pointer',
              borderRadius: 999,
              border: `1px solid ${border}`,
              background,
              color,
              padding: '6px 14px',
              fontSize: 13,
              fontWeight: 600,
              transition: 'background 0.15s ease, color 0.15s ease, transform 0.15s ease',
              boxShadow: isSelected ? '0 0 0 2px color-mix(in srgb, var(--f4b-accent) 45%, transparent)' : 'none',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={e => {
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
