function fallbackCopy(text, documentRef) {
  if (!documentRef?.createElement || !documentRef?.body?.appendChild) return false;
  const textarea = documentRef.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  documentRef.body.appendChild(textarea);
  textarea.select?.();
  let copied = false;
  try {
    copied = !!documentRef.execCommand?.('copy');
  } catch {
    copied = false;
  } finally {
    textarea.remove?.();
    if (textarea.parentElement) textarea.parentElement.removeChild?.(textarea);
  }
  return copied;
}

export async function copyText(text, {
  navigatorRef = globalThis.navigator,
  documentRef = globalThis.document
} = {}) {
  const value = String(text ?? '');
  if (!value) return false;

  const writeText = navigatorRef?.clipboard?.writeText;
  if (typeof writeText === 'function') {
    try {
      await writeText.call(navigatorRef.clipboard, value);
      return true;
    } catch {
      // HTTP/non-secure contexts and denied clipboard permissions fall through.
    }
  }

  return fallbackCopy(value, documentRef);
}
