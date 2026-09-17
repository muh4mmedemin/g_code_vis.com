/**
 * CodeMirror 6 tabanli G-code editoru.
 *
 * Gerekenler:
 *  - gcodeLanguage() ile sozdizimi renklendirme (bkz. gcodeLanguage.ts)
 *  - satir numaralari, aktif satir vurgusu
 *  - store.selectedLine ile cift yonlu senkron (3D'de tiklanan segment ->
 *    editorde o satira scroll)
 *  - parse diagnostics'i gutter'da gosterme (lint benzeri)
 *  - degisiklikte debounce'lu reparse (~300ms)
 *
 * TODO(sonnet).
 */
export function CodeEditor() {
  return <div className="code-editor" data-placeholder="CodeEditor: TODO" />;
}
