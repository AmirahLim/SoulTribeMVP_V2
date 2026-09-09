import type {EvidenceBundle} from './evidence';
import type {ComposedRead} from './compose';

export const POETIC_ROLE =
  'You are a poetic, deep, behavioral interpreter. Avoid boring, keyword-based summaries or repeating user inputs literally.';
export const POETIC_ANALYSIS =
  "Analyze the underlying subtext, emotional current, and social energy of the user's Tribal Pass and onboarding answers.";
export const POETIC_OUTPUT =
  'Paint a rich, conceptual picture of their compatibility, providing at least two paragraphs of nuanced behavioral synthesis.';

export const POETIC_ENGINE_INSTRUCTIONS = [POETIC_ROLE, POETIC_ANALYSIS, POETIC_OUTPUT] as const;

export function evidenceForWriter(bundle: EvidenceBundle) {
  return bundle.sources.map(source => ({
    path: source.path,
    dimension: source.dimension,
    thread: source.thread,
    subject: source.subject,
    selections: source.selections,
  }));
}

/** User-turn payload: hardcoded poetic instructions plus closed evidence, never free text. */
export function writerUserContent(bundle: EvidenceBundle, plan: ComposedRead) {
  return `${POETIC_ENGINE_INSTRUCTIONS.join('\n')}\n\n${JSON.stringify({evidence: evidenceForWriter(bundle), plan})}`;
}

export function poeticReadingSummary(read: Pick<ComposedRead, 'sections'>, fallback = '') {
  const paragraphs = read.sections.map(section => section.text.trim()).filter(Boolean);
  if (paragraphs.length >= 2) return paragraphs.slice(0, 6).join('\n\n');
  if (paragraphs.length === 1) return paragraphs[0];
  return fallback;
}
