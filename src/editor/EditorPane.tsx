import { CodeEditor } from './CodeEditor';
import { EditorToolbar } from './EditorToolbar';

/**
 * Sol yari: G-code editoru.
 * Editordeki degisiklik -> debounce -> reparse -> 3D otomatik guncellenir.
 */
export function EditorPane() {
  return (
    <section className="pane pane--editor">
      <EditorToolbar />
      <div className="pane__body">
        <CodeEditor />
      </div>
    </section>
  );
}
