export type ID = string;

export type PaperTemplate = 'blank' | 'ruled' | 'grid' | 'dotted';
/**
 * 'image' items are pictures placed on the page. They are stored as strokes so they share
 * everything strokes have: immutable ids, tombstones, sync merge, undo, select / move / resize /
 * rotate, and layering. Their `points` are the 4 corners (top-left, top-right, bottom-right,
 * bottom-left, pressure 0) and `image.fileId` points at the picture in the files table.
 */
export type InkTool = 'pen' | 'highlighter' | 'image' | 'text' | 'tape';

/** Pen types. Each is a different response to Pencil pressure and a different look. */
export type BrushKind =
  | 'fountain'
  | 'ballpoint'
  | 'pencil'
  | 'brush'
  | 'fineliner'
  | 'marker'
  | 'calligraphy'
  | 'crayon';

/** Line style of a stroke (shapes, lines). Missing = solid. */
export type DashStyle = 'dashed' | 'dotted';

/** Fonts for text boxes (each maps to fonts the iPad has; see ink/text.ts). */
export type TextFont = 'sans' | 'serif' | 'mono' | 'rounded' | 'hand';

/**
 * A text box. Laid out at its own size (`width` × `height` page units, `size` = font size) and
 * then mapped onto the stroke's 4 corner points, exactly like a picture: so moving, resizing,
 * rotating, layering, undo and sync all work unchanged.
 */
export interface TextContent {
  content: string;
  font: TextFont;
  size: number;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: 'left' | 'center' | 'right';
  /** Box size the text was laid out in (page units). */
  width: number;
  height: number;
  /** Optional background colour behind the text. */
  background?: string;
}

/**
 * Per-pen look, saved with each stroke so it draws the same on every device.
 * Missing values use the pen type's defaults (ink/brushes.ts).
 */
export interface PenStyle {
  /** 0–1 ink opacity. */
  opacity?: number;
  /** How much Pencil pressure changes the width (0 = none, 1 = a lot). */
  thinning?: number;
  /** Tapered ends, page units. */
  taper?: number;
  /** Extra smoothing of wobbly lines, 0–1. */
  stabilize?: number;
}

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
  brush?: BrushKind;
  /** Pen look overrides (opacity, pressure response, taper, smoothing). */
  penStyle?: PenStyle;
  /** Dashed or dotted line. Missing = solid. */
  dash?: DashStyle;
  /** Arrowheads at the start / end of an open line. */
  arrowStart?: boolean;
  arrowEnd?: boolean;
  /** Text boxes only (tool 'text'): its 4 corners are in `points`, like a picture. */
  text?: TextContent;
  /** Fill inside the shape (closed along its points). Missing = no fill. Strokes are
   *  immutable, so changing the fill makes a new stroke (new id) like recolouring. */
  fill?: string;
  /** Fill opacity 0–1 (default 0.3). */
  fillOpacity?: number;
  /**
   * Pictures only (tool 'image'). Tape (tool 'tape') is a band `size` wide along `points` that
   * hides what is under it until tapped.
   */
  image?: { fileId: ID };
  /**
   * Stacking order: items are drawn oldest first, so a larger createdAt is in front.
   * "Bring to front / send to back" give the item a new createdAt (fractions allowed).
   */
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
  /** Page look: night mode ('dark'), always light, or missing = follow the app's appearance. */
  pageTheme?: 'light' | 'dark';
  /** In night mode, also invert imported PDF pages (white PDFs become dark). */
  invertPdf?: boolean;
  /** Size of new pages (page units). Missing = A4 portrait. Each page keeps its own size. */
  pageSize?: { width: number; height: number };
}

/** Notebook settings changed through setNotebookSettings (last change wins when syncing). */
export type NotebookSettings = Partial<Pick<Notebook, 'pageTheme' | 'invertPdf' | 'pageSize'>>;

export type LibraryItem = Folder | Notebook;

export function newId(): ID {
  return crypto.randomUUID();
}

export const FOLDER_COLORS = ['#5b8def', '#34a853', '#f4b400', '#ea4335', '#a142f4', '#00a5b5', '#8d6e63', '#607d8b'];
export const COVER_COLORS = ['#2f6fde', '#1e8e3e', '#d93025', '#f29900', '#9334e6', '#12a4af', '#5f6368', '#202124'];
