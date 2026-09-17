# Devir Notu (Sonnet icin)

Iskelet hazir; govde yazilmadi. Her bos govde `NOT_IMPLEMENTED: <ad>` firlatir
ve basinda `TODO(sonnet)` notu vardir:

```bash
grep -rn "NOT_IMPLEMENTED\|TODO(sonnet)" src
```

## Onerilen sira

1. **Bagimliliklar** — `npm install` (package.json hazir).
2. **Faz 1 — parse ve ciz**
   - `gcode/parser/tokenizer.ts`
   - `gcode/parser/commands.ts` (once `G0/G1/G90/G91/G92/G28`)
   - `gcode/parser/index.ts` → `parseGcode`
   - `gcode/buffers.ts` → `buildToolpathBuffers`
   - `viewer/core/SceneManager.ts`, `viewer/layers/GridLayer.ts`,
     `BuildVolumeLayer.ts`, `ToolpathLayer.ts`
   - `state/store.ts` + `documentSlice` / `viewSlice`
   - `layout/SplitLayout.tsx`, `editor/CodeEditor.tsx`, `viewer/Viewport.tsx`
3. **Faz 2** — `LayerSlider`, katmana gore renklendirme (`utils/color.ts`)
4. **Faz 3** — `playbackSlice` + `PlaybackControls` + `ToolHeadLayer`
5. **Faz 4** — `gcode/stats.ts` + `StatsPanel`
6. **Faz 5** — `G2/G3`, `gcode/dialects/*`
7. **Faz 6** — `src/cnc/*` + `MachineModePanel`

## Bozulmamasi gereken kurallar

- `src/core/types.ts` veri sozlesmesidir; once burasi guncellenir, sonra kullanan kod.
- `gcode/`, `viewer/`, `cnc/` React import **etmez**.
- Three.js nesneleri React state'inde tutulmaz; store → SceneManager koprusu
  `store.subscribe` ile kurulur.
- Toolpath icin tek `LineSegments`; katman/simulasyon filtreleri geometri
  yeniden kurmadan `drawRange` / uniform ile yapilir.
- Yeni gorsel alt sistem = yeni `SceneLayer`; `SceneManager` govdesi degismez.

## Henuz yapilmayanlar (bilerek)

- Test altyapisi kurulmadi (kullanici kendi test edecek).
- Bagimliliklar yuklenmedi, build calistirilmadi.
- ESLint yapilandirmasi eklenmedi (script hazir, config sonra).
