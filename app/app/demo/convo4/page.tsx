import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'js-yaml';
import { loadYamlTemplateFromString } from '../../../lib/flux4bots';
import type { Template } from '../../../lib/flux4bots/types';
import ClientConvo4 from './ClientConvo4';

type StepDef = { template: string; mode: 'diff' | 'explicit' };
type ConversationSpec = {
  version: 1;
  title?: string;
  initial: { doc: any };
  steps: StepDef[];
};

async function readText(p: string) {
  return await fs.readFile(p, 'utf-8');
}

/**
 * Locate conversation.yaml and return both its absolute path and parsed content.
 * We keep the same three candidate roots you used before.
 */
async function findConversationYaml(): Promise<{ absPath: string; spec: ConversationSpec }> {
  const candidates = [
    path.join(process.cwd(), 'app', 'app', 'demo', 'convo4', 'conversation.yaml'),
    path.join(process.cwd(), 'app', 'demo', 'convo4', 'conversation.yaml'),
    path.join(process.cwd(), 'demo', 'convo4', 'conversation.yaml'),
  ];
  for (const abs of candidates) {
    try {
      const txt = await readText(abs);
      const spec = YAML.load(txt) as ConversationSpec;
      return { absPath: abs, spec };
    } catch {
      // try next candidate
    }
  }
  throw new Error('conversation.yaml not found in convo4 folder');
}

async function loadTemplateFromFile(absPath: string): Promise<Template> {
  const txt = await readText(absPath);
  return loadYamlTemplateFromString(txt);
}

export default async function Page(): Promise<JSX.Element> {
  // 1) Find & parse conversation.yaml
  const { absPath: convoYamlPath, spec: convo } = await findConversationYaml();
  const baseDir = path.dirname(convoYamlPath);

  // 2) Load each step’s template (resolve relative to conversation.yaml folder)
  const loadedSteps = await Promise.all(
    convo.steps.map(async (s) => {
      const templateAbs = path.isAbsolute(s.template)
        ? s.template
        : path.join(baseDir, s.template);
      return {
        templatePath: templateAbs,
        mode: s.mode,
        template: await loadTemplateFromFile(templateAbs),
      };
    })
  );

  // 3) Render client component
  return (
    <ClientConvo4
      title={convo.title ?? 'Convo4 — Contact Builder'}
      initialDoc={convo.initial.doc}
      steps={loadedSteps}
    />
  );
}
