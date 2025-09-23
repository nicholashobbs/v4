import type { ConversationsAdapter, CommittedStep } from '../engine/ConversationEngine';

export class FastApiAdapter implements ConversationsAdapter {
  private baseUrl: string;
  constructor(opts: { baseUrl: string }) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
  }

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    return res.json();
  }

  async create(title: string, initial: any) {
    return this.api<{ id: string; title: string }>('/conversations', {
      method: 'POST',
      body: JSON.stringify({ title, initial }),
    });
  }

  async list() {
    const out = await this.api<{ items: { id: string; title: string; updated_at: string }[] }>('/conversations');
    return out.items;
  }

  async load(id: string) {
    return this.api<{ id: string; title: string; initial: any; steps: CommittedStep[] }>(`/conversations/${id}`);
  }

  async rename(id: string, title: string) {
    await this.api<{ ok: boolean }>(`/conversations/${id}/title`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
  }

  async appendStep(id: string, step: Omit<CommittedStep, 'at'>) {
    await this.api<{ ok: boolean }>(`/conversations/${id}/appendStep`, {
      method: 'POST',
      body: JSON.stringify(step),
    });
  }

  async undo(id: string) {
    await this.api<{ ok: boolean }>(`/conversations/${id}/undo`, { method: 'POST' });
  }
}
