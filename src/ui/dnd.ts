const MIME = 'application/x-noteboard-items';

export function writeDragIds(e: React.DragEvent, ids: string[]): void {
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData(MIME, JSON.stringify(ids));
  e.dataTransfer.setData('text/plain', JSON.stringify(ids)); // iPad Safari only exposes text types reliably
}

export function readDragIds(e: React.DragEvent): string[] {
  const raw = e.dataTransfer.getData(MIME) || e.dataTransfer.getData('text/plain');
  try {
    const ids: unknown = JSON.parse(raw);
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
