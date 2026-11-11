export type ID = string;

export type PaperTemplate = 'blank' | 'ruled' | 'grid' | 'dotted';
export type InkTool = 'pen' | 'highlighter';

/** A4 at 96 dpi. All ink is stored in these page units, independent of screen size or zoom. */
export const PAGE_WIDTH = 794;
export const PAGE_HEIGHT = 1123;

export interface Stroke {
  id: ID;
  tool: InkTool;
  color: string;
  /** Base width in page units. */
  size: number;
  /** Flat list of [x, y, pressure, x, y, pressure, ...] in page units. */
  points: number[];
  /** False for mouse/finger input, where pressure is simulated from speed. */
  hasPressure: boolean;
  /** Pen type (pens only). Missing on older strokes = fountain pen. */
  brush?: 'fountain' | 'ballpoint' | 'pencil' | 'brush';
  /** Fill inside the shape (closed along its points). Missing = no fill. Strokes are
   *  immutable, so changing the fill makes a new stroke (new id) like recolouring. */
  fill?: string;
  /** Fill opacity 0–1 (default 0.3). */
  fillOpacity?: number;
  createdAt: number;
}

/** A page drawn on top of a page of an imported PDF (the PDF itself is in the files store). */
export interface PdfBackground {
  kind: 'pdf';
  fileId: ID;
  /** 0-based page number in the PDF. */
  pageIndex: number;
}

/** An imported file (currently PDFs). Immutable; synced to Google Drive as-is. */
export interface StoredFile {
  id: ID;
  name: string;
  mime: string;
  size: number;
  data: Blob;
  createdAt: number;
  /** 1 once a copy is in Google Drive. */
  uploaded: 0 | 1;
}

export interface Page {
  id: ID;
  notebookId: ID;
  template: PaperTemplate;
  width: number;
  height: number;
  /** Imported PDF page shown under the ink. */
  background?: PdfBackground;
  strokes: Stroke[];
  /** Tombstones: ids of erased strokes, kept so deletions survive merges with other devices. */
  deletedStrokeIds: ID[];
  updatedAt: number;
  /** 1 = has local changes not yet uploaded to Google Drive. */
  dirty: 0 | 1;
}

interface LibraryBase {
  id: ID;
  /** Containing folder, or null for the library root. */
  parentId: ID | null;
  createdAt: number;
  updatedAt: number;
  /** Set when moved to Trash. Purged automatically after 30 days. */
  trashedAt: number | null;
  favorite: boolean;
  /** Permanently deleted. Kept as a tombstone so the deletion syncs to other devices. */
  deleted: boolean;
}

export interface Folder extends LibraryBase {
  kind: 'folder';
  name: string;
  color: string;
}

export interface Notebook extends LibraryBase {
  kind: 'notebook';
  name: string;
  coverColor: string;
  template: PaperTemplate;
  pageIds: ID[];
  /** Removed pages, so a page deleted on one device isn't brought back by another. */
  deletedPageIds: ID[];
  tags: string[];
  lastOpenedAt: number | null;
}

export type LibraryItem = Folder | Notebook;

export function newId(): ID {
  return crypto.randomUUID();
}

export const FOLDER_COLORS = ['#5b8def', '#34a853', '#f4b400', '#ea4335', '#a142f4', '#00a5b5', '#8d6e63', '#607d8b'];
export const COVER_COLORS = ['#2f6fde', '#1e8e3e', '#d93025', '#f29900', '#9334e6', '#12a4af', '#5f6368', '#202124'];
