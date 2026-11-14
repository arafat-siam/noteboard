import { useEffect, useState } from 'react';
import { db } from './db/db';
import { markOpened, purgeExpiredTrash } from './db/library';
import { sync } from './sync/instance';
import { startIndexer } from './search/indexer';
import { Sidebar } from './ui/Sidebar';
import { LibraryView } from './ui/LibraryView';
import { NotebookEditor } from './ui/NotebookEditor';

export type Route =
  | { view: 'library'; folderId: string | null }
  | { view: 'favorites' }
  | { view: 'recents' }
  | { view: 'trash' }
  | { view: 'tag'; tag: string }
  | { view: 'notebook'; id: string; from: Route; pageId?: string };

export function App() {
  const [route, setRoute] = useState<Route>({ view: 'library', folderId: null });
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 900);

  useEffect(() => {
    void purgeExpiredTrash(db);
    const stopSync = sync.start();
    const stopIndex = startIndexer();
    return () => {
      stopSync();
      stopIndex();
    };
  }, []);

  const openNotebook = (id: string, pageId?: string) => {
    void markOpened(db, id);
    setRoute((from) => ({ view: 'notebook', id, pageId, from: from.view === 'notebook' ? from.from : from }));
  };

  if (route.view === 'notebook') {
    return <NotebookEditor key={route.id} notebookId={route.id} initialPageId={route.pageId} onClose={() => setRoute(route.from)} onOpenNotebook={openNotebook} />;
  }

  return (
    <div className={`app ${sidebarOpen ? 'sidebar-open' : ''}`}>
      <Sidebar
        route={route}
        onNavigate={(r) => {
          setRoute(r);
          if (window.innerWidth <= 900) setSidebarOpen(false);
        }}
      />
      <main className="main">
        <LibraryView
          route={route}
          onNavigate={setRoute}
          onOpenNotebook={openNotebook}
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
        />
      </main>
      {sidebarOpen && <div className="scrim" onClick={() => setSidebarOpen(false)} />}
    </div>
  );
}
