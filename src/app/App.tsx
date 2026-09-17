import { Toolbar } from '@/ui/panels/Toolbar';
import { StatusBar } from '@/ui/panels/StatusBar';
import { SplitLayout } from '@/layout/SplitLayout';
import { EditorPane } from '@/editor/EditorPane';
import { ViewerPane } from '@/viewer/ViewerPane';

/**
 * Uygulama kabugu:
 *
 *  +--------------------------------------------------+
 *  |                    Toolbar                       |
 *  +---------------------+----------------------------+
 *  |                     |                            |
 *  |   EditorPane        |   ViewerPane               |
 *  |   (G-code editoru)  |   (3D sahne + overlay UI)  |
 *  |                     |                            |
 *  +---------------------+----------------------------+
 *  |                   StatusBar                      |
 *  +--------------------------------------------------+
 */
export function App() {
  return (
    <div className="app-shell">
      <Toolbar />
      <SplitLayout left={<EditorPane />} right={<ViewerPane />} />
      <StatusBar />
    </div>
  );
}
