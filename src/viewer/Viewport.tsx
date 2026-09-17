/**
 * SceneManager'i bir DOM konteynerine baglayan ince React kabugu.
 *
 * ONEMLI KURAL: Three.js nesneleri React state'inde TUTULMAZ. Bu bilesen
 * yalnizca mount/unmount ve store -> SceneManager yonunde tek yonlu kopru
 * kurar (store.subscribe ile), boylece her karede React render olmaz.
 *
 * TODO(sonnet):
 *   - useRef<HTMLDivElement> + useEffect ile SceneManager.mount/dispose
 *   - varsayilan katmanlari ekle: GridLayer, BuildVolumeLayer, ToolpathLayer,
 *     ToolHeadLayer  (mode === 'cnc' ise ayrica StockLayer)
 *   - store.subscribe(selector) ile onData / onViewSettings / onProgress dagit
 */
export function Viewport() {
  return <div className="viewport" data-placeholder="Viewport: TODO" />;
}
