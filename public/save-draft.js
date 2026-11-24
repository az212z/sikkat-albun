export function loadDraft() {
  return null;
}

export async function saveDraft(payload) {
  const response = await fetch('/api/drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    const error = new Error('draft');
    error.status = response.status;
    throw error;
  }
  return response.json();
}
