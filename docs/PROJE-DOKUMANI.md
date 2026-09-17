# G-code Visualizer — Proje Dokümanı

## 1. Amaç
Kullanıcının yüklediği bir G-code dosyasını (3D yazıcı çıktısı) tarayıcıda 3D olarak görselleştiren, katman katman inceleme ve adım adım simülasyon imkanı sunan bir web uygulaması.

## 2. Teknoloji Yığını
- **Frontend:** React (ya da vanilla JS, karar verilecek) + **Three.js** (3D render)
- **Parser:** Kendi yazacağımız G-code parser (JS/TS), regex tabanlı satır ayrıştırma
- **State yönetimi:** Zustand veya React Context (basit tutulacak)
- **Build:** Vite
- **Barındırma:** Statik site (Vercel/Netlify) — backend'e gerek yok, her şey client-side

> Not: Dosyalar client tarafında işlenecek, sunucuya yüklenmeyecek. Büyük dosyalarda (>50MB) performans için Web Worker kullanılabilir.

## 3. Temel Özellikler (MVP kapsamı)

### 3.1 Dosya Yükleme
- `.gcode` / `.nc` / `.g` dosya uzantılarını destekle
- Drag & drop + dosya seçici
- Dosya boyutu uyarısı (çok büyük dosyalarda parse süresi uzayabilir)

### 3.2 G-code Parser
Desteklenecek komutlar (öncelik sırasıyla):
- `G0` / `G1` — hareket (extrude olsun olmasın)
- `G2` / `G3` — yay (arc) hareketleri (opsiyonel, sonraki fazda)
- `G28` — home
- `G90` / `G91` — absolute/relative positioning
- `G92` — pozisyon reset
- `M104` / `M109` / `M140` / `M190` — sıcaklık (bilgi amaçlı, görsel değil)
- Yorum satırları (`;` ile başlayan) — bazı slicer'lar buraya katman/süre bilgisi yazar (Cura, PrusaSlicer, Simplify3D formatları farklı, bunlara dikkat)

Parser çıktısı, her satır için şu bilgileri içeren bir hareket listesi olmalı:
```
{ x, y, z, e (extrusion miktarı), f (feedrate), layer, isExtrusion, isTravel }
```

### 3.3 3D Görselleştirme
- Extrusion yapılan hareketler: dolu çizgi (renkli, örn. turuncu/mavi)
- Travel (boş) hareketler: kesikli/soluk çizgi, opsiyonel gizle/göster toggle'ı
- Katmana göre renklendirme (rainbow/gradient mode) — isteğe bağlı görünüm modu
- Kamera kontrolleri: orbit, pan, zoom (Three.js `OrbitControls`)
- Build plate (yazıcı tablası) gösterimi — boyutları kullanıcı girebilsin veya varsayılan (örn. 220x220x250mm)

### 3.4 Katman Katman İnceleme
- Katman slider'ı: "1. katmandan N. katmana kadar göster"
- Tek katman izole gösterim modu
- Katman sayısı ve mevcut katman yüksekliği (Z) bilgisi ekranda

### 3.5 Simülasyon / Adım Adım Yürütme
- Play/pause/step ileri-geri kontrolleri
- Hız ayarı (1x, 2x, 5x, anlık geçiş)
- Şu ana kadar basılmış kısmı göster, geri kalanı gizle veya soluk göster
- Timeline scrubber (video oynatıcı gibi ileri-geri sarma)

### 3.6 İstatistikler
- Toplam katman sayısı
- Tahmini baskı süresi (feedrate ve mesafe üzerinden hesaplama — slicer'ın kendi tahminiyle birebir tutmayabilir, bunu kullanıcıya belirtmek gerek)
- Toplam filament kullanımı (E değerlerinden, mm cinsinden; yoğunluk/çap girilirse gram/metre'ye çevrilebilir)
- Katman başına süre/hareket sayısı
- Toplam hareket mesafesi (extrusion + travel ayrı ayrı)

## 3.7 CNC / Talaş Kaldırma Modu (opsiyonel, kullanıcı seçimine bağlı)
G-code'un yorumu iki farklı bağlamda değişir:
- **3D Print (additive):** çizgiler malzeme ekler → mevcut MVP planı bunu kapsıyor
- **CNC/Milling (subtractive):** çizgiler malzeme kaldırır → ham bir blok (küp/silindir) üzerinden tool'un geçtiği yerler oyulur

Bu mod **zorunlu değil**, kullanıcı dosya yükledikten sonra "Print modu" / "CNC (kesim) modu" seçebilir. Varsayılan mod Print olacak.

**Yaklaşım: Voxel carving**
- Ham malzeme (küp/blok) bir 3D voxel grid olarak temsil edilir (örn. 100x100x100 hücre, kullanıcı çözünürlük seçebilir)
- Kullanıcı tool çapını girer (varsayılan bir değer olur)
- G-code'daki her kesme hareketi (tool merkez yolu + tool çapı kadar genişlik) alınır, bu yol boyunca hangi voxel'lerin kaldırılacağı hesaplanır
- Kaldırılan voxeller render'dan çıkarılır, geri kalanı mesh'e çevrilip (greedy meshing veya marching cubes) gösterilir
- Simülasyon ilerledikçe blok gerçekten "oyuluyormuş" gibi güncellenir

**Neden voxel carving:** Alternatif olan CSG boolean çıkarma (her hareket için silindir geometrisi oluşturup ana bloktan subtract etme) çok sayıda hareket için performans açısından pratik değil. Voxel yaklaşımı, gerçek açık kaynak CNC simülatörlerinin (örn. CAMotics) de kullandığı yöntem.

**Bu mod için ek gereksinimler:**
- Ham malzeme boyutu girişi (X/Y/Z mm)
- Tool çapı / tipi girişi (flat end mill, ball nose vb. — başlangıçta sadece flat end mill yeterli)
- Voxel çözünürlüğü ayarı (performans/detay dengesi)
- Ayrı bir render pipeline (print modundaki çizgi bazlı gösterimden farklı, mesh bazlı)

**Faz sırası:** Bu mod, MVP ve print modundaki tüm fazlar (1-4) tamamlandıktan sonra, ayrı bir **Faz 6** olarak ele alınacak — çünkü teknik olarak bağımsız bir alt sistem.

## 4. Faz Planı
1. **Faz 1 (MVP):** Dosya yükle → parse et → statik 3D görsel (tüm toolpath tek seferde çizilir)
2. **Faz 2:** Katman slider + katmana göre renklendirme
3. **Faz 3:** Simülasyon/animasyon (play-pause-step)
4. **Faz 4:** İstatistik paneli
5. **Faz 5 (opsiyonel):** G2/G3 arc desteği, çoklu renk/multi-extruder desteği, dosya karşılaştırma
6. **Faz 6 (opsiyonel, kullanıcı seçimine bağlı):** CNC/Talaş kaldırma modu — voxel carving ile gerçekçi işleme simülasyonu (bkz. 3.7)

## 5. Açık Sorular / Kararlaştırılacaklar
- [ ] Çok büyük G-code dosyalarında (>1M satır) performans stratejisi — Web Worker mı, LOD (level of detail) mı?
- [ ] Three.js `Line` mı yoksa performans için `LineSegments` + `BufferGeometry` mi kullanılacak? (Büyük dosyalar için ikincisi şart)
- [ ] Süre tahmini algoritması ne kadar hassas olacak (ivme/jerk hesaba katılacak mı, yoksa basit feedrate/mesafe mi?)
- [ ] Hangi slicer'ların (Cura, PrusaSlicer, Bambu Studio) yorum formatları özel olarak destekklenecek?

## 6. İlk Adım Önerisi
Faz 1'i başlatmak için:
1. Vite + Three.js iskelet proje kurulumu
2. Basit bir G-code parser (sadece G0/G1) yaz, test için örnek bir .gcode dosyası bul
3. Parse edilen noktaları `BufferGeometry` ile tek seferde çiz
4. OrbitControls ekle, build plate grid'i ekle

Bu adımdan sonra katman slider'ına geçilebilir.
