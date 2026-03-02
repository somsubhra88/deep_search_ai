/**
 * Extract a JSON object from LLM or mixed text (e.g. code blocks, plain JSON).
 */
export function extractJson(text: string): Record<string, unknown> | null {
  const cleaned = text.trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    /* continue */
  }
  const codeBlock = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    try {
      return JSON.parse(codeBlock[1].trim());
    } catch {
      /* continue */
    }
  }
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[0]);
    } catch {
      /* continue */
    }
  }
  return null;
}
