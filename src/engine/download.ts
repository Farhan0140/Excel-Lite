// hand a generated file to the browser as a download; returns false when that is not possible
export function downloadFile(data: string | Blob, name: string, type: string): boolean {
  try {
    const blob = typeof data === 'string' ? new Blob([data], { type: type || 'application/json' }) : data;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch {
    return false;
  }
}
