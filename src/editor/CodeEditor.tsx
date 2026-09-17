import { useMemo, useRef } from 'react';
import CodeMirror, { EditorView, type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { gcodeLanguage } from './gcodeLanguage';
import { useStore } from '@/state/store';
import { debounce } from '@/utils/debounce';

const editorTheme = EditorView.theme(
  {
    '&': { height: '100%', fontSize: '13px', backgroundColor: 'var(--bg-panel)' },
    '.cm-scroller': { fontFamily: 'ui-monospace, Menlo, Consolas, monospace' },
    '.cm-gutters': { backgroundColor: 'var(--bg-panel)', color: 'var(--text-dim)', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.04)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.06)' },
    '&.cm-focused': { outline: 'none' },
  },
  { dark: true },
);

const PLACEHOLDER = `; G-code dosyanizi buraya yapistirin veya soldan/ustten yukleyin
; Ornek:
G90
G1 X10 Y10 Z0.2 F1500
G1 X50 Y10 E2.5
G1 X50 Y50 E5.0
`;

/**
 * CodeMirror 6 tabanli G-code editoru.
 *
 * Editordeki degisiklik -> 300ms debounce -> store.reparse() -> 3D otomatik
 * guncellenir (bkz. viewer/Viewport.tsx store aboneligi).
 */
export function CodeEditor() {
  const source = useStore((s) => s.source);
  const setSource = useStore((s) => s.setSource);
  const reparse = useStore((s) => s.reparse);
  const editorRef = useRef<ReactCodeMirrorRef>(null);

  const debouncedReparse = useMemo(() => debounce(() => void reparse(), 300), [reparse]);

  const extensions = useMemo(() => [gcodeLanguage(), editorTheme], []);

  return (
    <CodeMirror
      ref={editorRef}
      value={source}
      placeholder={PLACEHOLDER}
      height="100%"
      theme="dark"
      extensions={extensions}
      onChange={(value) => {
        setSource(value);
        debouncedReparse();
      }}
      basicSetup={{
        lineNumbers: true,
        highlightActiveLine: true,
        foldGutter: false,
        autocompletion: false,
      }}
    />
  );
}
