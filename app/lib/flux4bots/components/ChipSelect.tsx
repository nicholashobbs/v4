'use client';

import React, { useCallback, useRef } from 'react';

export type ChipOption = { value: string; label: string };

export type ChipSelectProps = {
  options: ChipOption[];
  selected: string[];
  onChange: (next: string[]) => void;
  multiple?: boolean;
  onCommitRequest?: () => void;
  focusCommitOnTabExit?: () => void;
  markFirstFocusable?: boolean;
};

export function ChipSelect({
  options,
  selected,
  onChange,
  multiple = true,
  onCommitRequest,
  focusCommitOnTabExit,
  markFirstFocusable = false,
}: ChipSelectProps) {
  function toggle(value: string) {
    const has = selected.includes(value);
    if (multiple) {
      const next = has ? selected.filter(v => v !== value) : [...selected, value];
      onChange(next);
    } else {
      onChange(has ? [] : [value]);
    }
  }

  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const registerButton = useCallback((index: number) => (node: HTMLButtonElement | null) => {
    buttonRefs.current[index] = node;
  }, []);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!focusCommitOnTabExit) return;
    if (event.key !== 'Tab' || event.shiftKey) return;
    const buttons = buttonRefs.current.filter(Boolean);
    if (buttons.length === 0) return;
    const target = event.target as HTMLElement | null;
    if (target !== buttons[buttons.length - 1]) return;
    event.preventDefault();
    focusCommitOnTabExit();
  }, [focusCommitOnTabExit]);

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }} onKeyDown={handleKeyDown}>
      {options.map((opt, idx) => {
        const isSelected = selected.includes(opt.value);
        const background = isSelected ? 'var(--f4b-accent)' : 'var(--f4b-surface-soft)';
        const color = isSelected ? '#0f1422' : 'var(--f4b-text-secondary)';
        const border = isSelected ? 'var(--f4b-accent)' : 'var(--f4b-border)';
        return (
          <button
            key={opt.value}
            type="button"
            ref={registerButton(idx)}
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
            onKeyUp={event => {
              if (multiple) return;
              if (event.key !== 'Enter') return;
              if (!onCommitRequest) return;
              event.preventDefault();
              requestAnimationFrame(() => {
                onCommitRequest();
              });
            }}
            data-f4b-focusable={markFirstFocusable && idx === 0 ? 'true' : undefined}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
