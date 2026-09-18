# Mimari

## 1. Katmanlar ve bagimlilik yonu

```
  ui / editor / layout        (React — sadece store'u okur)
          |
        state                 (zustand slice'lari — tek dogruluk kaynagi)
          |
   gcode  |  viewer  |  cnc   (saf TypeScript, React'ten bagimsiz)
          |
        core/types            (herkesin paylastigi veri sozlesmesi)
```

Kural: oklar tek yonludur. `gcode/`, `viewer/` ve `cnc/` React'i **import etmez**;
bu sayede parser worker'da, viewer ise ilerde farkli bir kabukta calisabilir.

## 2. Veri akisi

```
dosya / editor metni
      -> worker/client.parseInWorker()
      -> parser (tokenizer -> COMMAND_HANDLERS -> MachineState)
      -> Move[] + Layer[] + stats
      -> buildToolpathBuffers()  (typed array, transferable)
      -> store.parseResult
      -> SceneManager -> her SceneLayer.onData()
```

Simulasyon ve katman slider'i **yeniden parse etmez**; yalnizca
`PlaybackFrame` uretir ve katmanlarin `onProgress()` metodunu tetikler.
Toolpath tarafinda bu, geometri kurmadan `drawRange`/uniform guncellemesine
dusurulur — 1M+ segmentte akiciligin sarti budur.

## 3. SceneLayer sozlesmesi (genisleme noktasi)

`src/viewer/core/SceneLayer.ts` projenin en kritik arayuzu. Grid, calisma
hacmi, toolpath, takim basligi ve **CNC ham malzeme blogu** ayni arayuzu
uygular. Yeni bir gorsel alt sistem eklemek = yeni bir dosya + tek satir
`sceneManager.addLayer(...)`. Viewer govdesi degismez.

Bu yuzden "kesilen parcanin 3D modeli" (Faz 6) mevcut yapiya sonradan degil,
**zaten ayrilmis bir yuvaya** takilir: `src/cnc/StockLayer.ts`.

## 4. CNC talas kaldirma yolu (uygulandi)

```
StockDefinition + ToolDefinition + cozunurluk
      -> VoxelGrid.fill()
      -> simulasyon ilerledikce carveRange(grid, moves, from, to, tool)
      -> remeshRegion(grid, degisen bolge)   // sadece degisen kisim
      -> StockLayer mesh guncelle
```

Voxel + greedy meshing tercih edildi; CSG boolean cikarma cok sayida
harekette pratik degil (bkz. proje dokumani 3.7).

Uygulama notlari:
 - Grid CHUNK'lara (32^3) bolunur; bir kesme hareketi yalnizca dokundugu
   chunk'lari kirli isaretler ve sadece onlar yeniden mesh'lenir. Tum blogu
   her adimda yeniden mesh'lemek pratik degildi (40x50x70 blok / 0.5mm
   hucre icin ~126ms).
 - Takim supurmesi: kolon bazli. Her XY kolonu icin takimin o kolonun
   yaricapi icinde kaldigi [tMin, tMax] araligindaki EN DUSUK uc Z'si
   bulunur ve o Z'den yukarisi bosaltilir. Sadece "en yakin noktanin Z'si"
   kullanilirsa dikey dalmalar (delik delme) hic talas kaldirmaz.
 - Ileride: kure uclu takim destegi ve carve/mesh isleminin kendi
   worker'ina alinmasi (`gcode/worker/` ile ayni protokol deseni).

## 5. Performans kararlari (dokumandaki acik sorularin cevabi)

| Soru | Karar |
|---|---|
| Buyuk dosya stratejisi | Web Worker + typed array buffer'lar; LOD sonraki asama |
| `Line` mi `LineSegments` mi | Tek `LineSegments` + `BufferGeometry` + `drawRange` |
| Sure tahmini | Basit `mesafe / feedrate`; ivme/jerk opsiyonel genisleme |
| Slicer dialect'leri | `gcode/dialects/` altinda tak-cikar; fallback `generic` |

## 6. Klasor haritasi

| Yol | Sorumluluk |
|---|---|
| `src/core/` | Tipler ve sabitler — veri sozlesmesi |
| `src/gcode/parser/` | Tokenizer, modal makine durumu, komut handler registry'si |
| `src/gcode/dialects/` | Slicer'a ozgu yorum/katman ipuclari |
| `src/gcode/worker/` | Worker protokolu, worker govdesi, Promise istemcisi |
| `src/viewer/core/` | SceneManager, kamera, SceneLayer arayuzu |
| `src/viewer/layers/` | Grid, calisma hacmi, toolpath, takim basligi |
| `src/cnc/` | Voxel grid, carver, mesher, StockLayer (Faz 6) |
| `src/state/` | zustand slice'lari |
| `src/editor/` | CodeMirror editoru ve G-code dil tanimi |
| `src/ui/` | Panel/overlay bilesenleri |
