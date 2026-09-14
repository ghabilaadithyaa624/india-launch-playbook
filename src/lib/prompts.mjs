/**
 * Load versioned prompts from prompts/<agent_id>.md.
 *
 * Prompts live in git, not inside the workflow JSON, so every run can record
 * the sha256 of the exact prompt text that produced an output. If a playbook
 * later looks wrong you can identify precisely which prompt version made it.
 */

import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { REPO_ROOT, sha256 } from './util.mjs';

/** Pull the first fenced block that follows a given "## Heading". */
function sectionFence(md, heading) {
  const h = md.indexOf(`## ${heading}`);
  if (h === -1) return null;
  const open = md.indexOf('```', h);
  if (open === -1) return null;
  const start = md.indexOf('\n', open) + 1;
  const close = md.indexOf('```', start);
  if (close === -1) return null;
  return md.slice(start, close).trim();
}

/**
 * Pull the prose body of a "## Heading" up to the next "## " heading.
 *
 * Focus areas and the self-check live outside fenced blocks because they are
 * meant to be readable and reviewable as markdown. They are still prompt text:
 * they are appended to the system prompt below. Before this existed the loader
 * read only the fenced blocks, so every word under these headings was dead
 * text that never reached the model — which left all eight "specialists"
 * sharing 64 of 66 identical system-prompt lines.
 */
function sectionBody(md, heading) {
  const h = md.indexOf(`## ${heading}`);
  if (h === -1) return null;
  const start = md.indexOf('\n', h) + 1;
  const nextIdx = md.indexOf('\n## ', start);
  const body = (nextIdx === -1 ? md.slice(start) : md.slice(start, nextIdx)).trim();
  return body || null;
}

export async function loadPrompt(agentId) {
  const file = path.join(REPO_ROOT, 'prompts', `${agentId}.md`);
  const md = await readFile(file, 'utf8');

  const contract = sectionFence(md, 'System prompt');
  const userTemplate = sectionFence(md, 'User prompt template');
  if (!contract) throw new Error(`prompts/${agentId}.md: missing "## System prompt" fenced block`);
  if (!userTemplate) {
    throw new Error(`prompts/${agentId}.md: missing "## User prompt template" fenced block`);
  }

  const focus = sectionBody(md, 'Focus areas');
  const selfCheck = sectionBody(md, 'Self-check before returning');
  if (!focus) throw new Error(`prompts/${agentId}.md: missing "## Focus areas" section`);
  if (!selfCheck) {
    throw new Error(`prompts/${agentId}.md: missing "## Self-check before returning" section`);
  }

  const system = [
    contract,
    '',
    'FOCUS AREAS (domain guidance for this agent)',
    focus,
    '',
    'SELF-CHECK BEFORE RETURNING',
    selfCheck,
  ].join('\n');

  return {
    agentId,
    contract,
    focus,
    selfCheck,
    system,
    userTemplate,
    // Hash the whole file: focus areas and self-check are part of the prompt.
    sha256: sha256(md),
  };
}

/**
 * Fill {{placeholders}}. Unknown placeholders are an error rather than being
 * silently left in the prompt — a literal "{{business_idea}}" reaching the
 * model produces confidently wrong output that looks fine.
 */
export function fillTemplate(template, vars) {
  const missing = [];
  const out = template.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in vars) || vars[k] === undefined || vars[k] === null) {
      missing.push(k);
      return '';
    }
    return Array.isArray(vars[k]) ? vars[k].join(', ') : String(vars[k]);
  });
  if (missing.length) {
    throw new Error(`prompt template has unfilled placeholders: ${missing.join(', ')}`);
  }
  return out;
}
