# G-code Visualizer

G-code dosyalarini tarayicida 3D olarak gosteren, solda editor / sagda 3D sahne
duzenine sahip client-side uygulama. Dosyalar sunucuya gonderilmez.

```
+---------------------------------------------------------------+
|  Toolbar                                                       |
+------------------------------+--------------------------------+
|  G-code editoru (CodeMirror) |  3D sahne (Three.js + grid)     |
|  duzenle -> otomatik reparse |  orbit / pan / zoom, katman,    |
|                              |  simulasyon, (ilerde) CNC blok  |
+------------------------------+--------------------------------+
|  StatusBar                                                     |
+---------------------------------------------------------------+
```

## Teknoloji secimi

| Alan | Secim | Neden |
|---|---|---|
| Build | **Vite 6** | Hizli dev sunucu, kolay worker paketleme, statik cikti |
| Dil | **TypeScript (strict)** | Parser/render sozlesmelerini tip guvenli tutmak |
| UI | **React 19** | Panel/overlay yogun arayuz; bilesen bazli genisleme |
| 3D | **Three.js** | WebGL icin olgun standart, `BufferGeometry` kontrolu |
| Editor | **CodeMirror 6** | Monaco'ya gore cok daha hafif, buyuk dosyada akici |
| State | **Zustand** | Slice'lara bolunebilen, selector'lu, boilerplate'siz |
| Bolme | **react-resizable-panels** | Surukle-birak ikiye bolme |
| Parse | Kendi parser'imiz + **Web Worker** | Buyuk dosyalarda UI'yi bloklamamak |
| Barindirma | Statik (Vercel/Netlify) | Backend yok, her sey client-side |

## Kurulum

```bash
npm install
npm run dev
```

## Belgeler

- [docs/PROJE-DOKUMANI.md](docs/PROJE-DOKUMANI.md) — kapsam ve faz plani
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — mimari kararlar
- [docs/HANDOFF.md](docs/HANDOFF.md) — implementasyon sirasi ve kurallar

## Durum

Iskelet asamasi: klasor yapisi, tip sozlesmeleri, modul sinirlari ve
genisleme noktalari hazir. Govde implementasyonlari `NOT_IMPLEMENTED` /
`TODO(sonnet)` olarak isaretli.
