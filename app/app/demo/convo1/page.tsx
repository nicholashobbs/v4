import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'js-yaml';
import { loadYamlTemplateFromString, type Template } from '../../../lib/flux4bots';
import ClientConvo1 from './ClientConvo1';

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

async function readConversationYaml(): Promise<ConversationSpec> {
  const candidates = [
    path.join(process.cwd(), 'app', 'app', 'demo', 'convo1', 'conversation.yaml'),
    path.join(process.cwd(), 'app', 'demo', 'convo1', 'conversation.yaml'),
    path.join(process.cwd(), 'demo', 'convo1', 'conversation.yaml'),
  ];
  for (const p of candidates) {
    try {
      const txt = await readText(p);
      return YAML.load(txt) as ConversationSpec;
    } catch {}
  }
  throw new Error('conversation.yaml not found in convo1 folder');
}

async function loadTemplateByPath(templatePath: string): Promise<Template> {
  // templatePath comes from YAML; we treat it as absolute within the container
  const txt = await readText(templatePath);
  return loadYamlTemplateFromString(txt);
}

export default async function Page() {
  const convo = await readConversationYaml();
  const loadedSteps = await Promise.all(
    convo.steps.map(async (s) => ({
      templatePath: s.template,
      mode: s.mode,
      template: await loadTemplateByPath(s.template),
    }))
  );

  return (
    <ClientConvo1
      title={convo.title ?? 'Convo1'}
      initialDoc={convo.initial.doc}
      steps={loadedSteps}
    />
  );
}
