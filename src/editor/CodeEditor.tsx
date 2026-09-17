import { useEffect, useMemo, useRef } from 'react';
import CodeMirror, { EditorView, type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { gcodeLanguage } from './gcodeLanguage';
import { useStore } from '@/state/store';
import { debounce } from '@/utils/debounce';
import type { ParseDiagnostic } from '@/core/types';

const editorTheme = EditorView.theme(
  {
    '&': { height: '100%', fontSize: '13px', backgroundColor: 'var(--bg-panel)' },
    '.cm-scroller': { fontFamily: 'ui-monospace, Menlo, Consolas, monospace' },
    '.cm-gutters': { backgroundColor: 'var(--bg-panel)', color: 'var(--text-dim)', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.04)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgba(255,255,255,0.06)' },
    '&.cm-focused': { outline: 'none' },

    // --- Tani (uyari/hata) gorunurlugu -------------------------------------
    // Sorunlu satir boyanir ve altina kalin bir cizgi cekilir; gutter'da da
    // renkli bir isaret durur. Amac: uyarilarin kodun icinde GOZE CARPMASI.
    '.cm-gcode-warning': {
      backgroundColor: 'rgba(255, 180, 84, 0.14)',
      borderBottom: '2px solid #ffb454',
      borderRadius: '2px',
    },
    '.cm-gcode-error': {
      backgroundColor: 'rgba(255, 107, 107, 0.18)',
      borderBottom: '2px solid #ff6b6b',
      borderRadius: '2px',
    },
    '.cm-diagnostic-warning': { borderLeftColor: '#ffb454' },
    '.cm-diagnostic-error': { borderLeftColor: '#ff6b6b' },
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

const SEVERITY_LABEL: Record<ParseDiagnostic['severity'], string> = {
  error: 'Hata',
  warning: 'Uyari',
  info: 'Bilgi',
};

/**
 * Parser tanilarini CodeMirror'un lint tanilarina cevirir.
 *
 * 'info' seviyesindekiler (yok sayilan yardimci M kodlari gibi) editorde
 * GOSTERILMEZ: gercek bir slicer dosyasinda yuzlercesi bulunur ve asil
 * uyarilarin goze carpmasini engellerler.
 */
function toCodeMirrorDiagnostics(
  view: EditorView,
  parseDiagnostics: ParseDiagnostic[],
): Diagnostic[] {
  const totalLines = view.state.doc.lines;
  const result: Diagnostic[] = [];

  for (const d of parseDiagnostics) {
    if (d.severity === 'info') continue;
    const lineNumber = Math.min(Math.max(d.lineIndex + 1, 1), totalLines);
    const line = view.state.doc.line(lineNumber);
    result.push({
      from: line.from,
      to: line.to,
      severity: d.severity,
      message: `${SEVERITY_LABEL[d.severity]}: ${d.message}`,
      source: d.code,
      markClass: d.severity === 'error' ? 'cm-gcode-error' : 'cm-gcode-warning',
    });
  }

  return result;
}

/**
 * CodeMirror 6 tabanli G-code editoru.
 *
 * Editordeki degisiklik -> 300ms debounce -> store.reparse() -> 3D otomatik
 * guncellenir (bkz. viewer/Viewport.tsx store aboneligi).
 *
 * Parser tanilari (uyari/hata) satir icinde gosterilir: gutter isareti,
 * satir vurgusu ve uzerine gelince aciklama balonu.
 */
export function CodeEditor() {
  const source = useStore((s) => s.source);
  const setSource = useStore((s) => s.setSource);
  const reparse = useStore((s) => s.reparse);
  const diagnostics = useStore((s) => s.parseResult?.diagnostics);
  const selectedLine = useStore((s) => s.selectedLine);
  const editorRef = useRef<ReactCodeMirrorRef>(null);

  // Lint kaynagi store'dan OKUR; boylece her tani degisiminde extension
  // yeniden kurulmak zorunda kalmaz (editor durumu korunur).
  const diagnosticsRef = useRef<ParseDiagnostic[]>([]);
  diagnosticsRef.current = diagnostics ?? [];

  const debouncedReparse = useMemo(() => debounce(() => void reparse(), 300), [reparse]);

  // linter() yerine setDiagnostics(): tanilarimiz editorde degil, worker'daki
  // parser'da uretiliyor. Bu API tam olarak "disarida hesaplanmis tanilari
  // editore bildir" senaryosu icindir.
  const extensions = useMemo(() => [gcodeLanguage(), editorTheme, lintGutter()], []);

  // Yeni tani listesi geldiginde editore bildir.
  useEffect(() => {
    const view = editorRef.current?.view;
    if (!view) return;
    view.dispatch(setDiagnostics(view.state, toCodeMirrorDiagnostics(view, diagnosticsRef.current)));
  }, [diagnostics]);

  // Baska bir panelden bir satir secildiginde (ornegin durum cubugundaki
  // uyari sayaci) editoru o satira kaydir ve imleci oraya koy.
  useEffect(() => {
    const view = editorRef.current?.view;
    if (!view || selectedLine === null) return;
    const lineNumber = Math.min(Math.max(selectedLine + 1, 1), view.state.doc.lines);
    const line = view.state.doc.line(lineNumber);
    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    });
    view.focus();
  }, [selectedLine]);

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
