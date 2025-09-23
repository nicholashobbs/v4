import type { Operation } from '../types';
import type { ActionHandler } from '../types';

export const builtins = {
  /** Ensure an object exists at `path` (no-op if already there). */
  ensureObject: (path: string): ActionHandler => (ctx) => {
    return ctx.helpers.get(ctx.doc, path) === undefined
      ? [{ op: 'add', path, value: {} }]
      : [];
  },

  /** Ensure keys exist under base object; initialize with `init` value if missing. */
  ensureKeys: (base: string, keys: string[], init: any = ''): ActionHandler => (ctx) => {
    const ops: Operation[] = [];
    for (const k of keys) {
      const p = `${base}/${ctx.helpers.encode(k)}`;
      if (ctx.helpers.get(ctx.doc, p) === undefined) {
        ops.push({ op: 'add', path: p, value: init });
      }
    }
    return ops;
  },

  /** Write `vars[varName]` to targetPath, add|replace depending on existence. */
  writeFromVar: (varName: string, targetPath: string): ActionHandler => (ctx) => {
    const v = ctx.vars?.[varName];
    if (v == null || String(v).trim() === '') return [];
    const exists = ctx.helpers.get(ctx.doc, targetPath) !== undefined;
    return [{ op: exists ? 'replace' : 'add', path: targetPath, value: v }];
  },

  /** Copy array of {key,value} from working to destBase/<key>. */
  applyKeyValueList: (listPointer: string, destBase: string): ActionHandler => (ctx) => {
    const list = ctx.helpers.get(ctx.working, listPointer);
    if (!Array.isArray(list)) return [];
    const ops: Operation[] = [];
    for (const it of list) {
      const key = String(it?.key ?? '').trim();
      if (!key) continue;
      const p = `${destBase}/${ctx.helpers.encode(key)}`;
      const exists = ctx.helpers.get(ctx.doc, p) !== undefined;
      ops.push({ op: exists ? 'replace' : 'add', path: p, value: it?.value ?? '' });
    }
    return ops;
  },
};
