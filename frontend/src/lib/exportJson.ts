/**
 * JSON export helper — turns any serializable object into a downloadable .json
 * file with a timestamped filename. Used by the "Export JSON" buttons on each
 * stage so the user can capture the exact state for the project report.
 */

export function exportJSON(filename: string, data: unknown): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = withTimestamp(filename);
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

function withTimestamp(name: string): string {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  // Insert stamp before .json extension if present
  if (name.endsWith(".json")) {
    return `${name.slice(0, -5)}-${stamp}.json`;
  }
  return `${name}-${stamp}.json`;
}
