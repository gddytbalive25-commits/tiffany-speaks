export type Cue = { key: string; label: string; detail: string };

const whWords = /\b(what|who|where|when|why|how|which)\b/i;
const yesNoStarts = /^(are|is|am|do|does|did|can|could|will|would|have|has|should|may)\b/i;
const negativeWords = /\b(no|not|never|none|nothing|nobody|cannot|can't|won't|don't|doesn't|didn't|isn't|aren't|wasn't|weren't)\b/i;
const timeWords = /\b(today|tomorrow|yesterday|now|later|tonight|morning|afternoon|evening|next week|last week)\b/i;

/** Lightweight language cues only; this is not an ASL translation engine. */
export function getGrammarCues(text: string): Cue[] {
  const cues: Cue[] = [];
  const time = text.match(timeWords)?.[0];
  cues.push({
    key: 'structure',
    label: 'Time → topic → comment',
    detail: time
      ? `Possible time cue: “${time}”. Use this as a discussion scaffold, not a translation.`
      : 'Consider time first if the sentence includes it, then topic and comment. This is only a scaffold.',
  });

  if (whWords.test(text)) {
    cues.push({ key: 'wh', label: 'Furrowed brows', detail: 'Possible wh-question marker; confirm with a fluent ASL signer.' });
  } else if (text.includes('?') || yesNoStarts.test(text.trim())) {
    cues.push({ key: 'yesno', label: 'Raised brows', detail: 'Possible yes/no question marker; confirm with a fluent ASL signer.' });
  }
  if (negativeWords.test(text)) {
    cues.push({ key: 'negation', label: 'Head shake', detail: 'Possible negation marker; confirm with a fluent ASL signer.' });
  }
  if (cues.length === 1) {
    cues.push({ key: 'neutral', label: 'Neutral expression', detail: 'No basic question or negation cue detected.' });
  }
  return cues;
}
