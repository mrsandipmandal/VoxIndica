import type { GenerateScriptInput, GenerateScriptResult } from '../types/creator';

export async function generateScript(
  input: GenerateScriptInput
): Promise<GenerateScriptResult> {
  const response = await fetch('/api/creator/scripts/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input)
  });

  let payload: any = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || payload?.ok === false) {
    throw new Error(
      payload?.error ||
        `Script generation failed with HTTP ${response.status}. Check the server log for details.`
    );
  }

  return payload as GenerateScriptResult;
}
