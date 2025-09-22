'use client';
import { useEffect, useState } from 'react';
import * as YAML from 'js-yaml';
import type { Template } from '../types';

// Fetch + parse YAML at runtime (client)
export function useYamlTemplate(url: string): Template | null {
  const [tpl, setTpl] = useState<Template | null>(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        const text = await r.text();
        const obj = YAML.load(text) as Template;
        if (mounted) setTpl(obj);
      } catch {
        if (mounted) setTpl(null);
      }
    })();
    return () => { mounted = false; };
  }, [url]);
  return tpl;
}
