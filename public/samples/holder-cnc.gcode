; Ornek: harness table holder — 40x50x70 mm derlin bloktan isleme
; Once testereden bu olcude tam dolu blok kesilir, sonra CNC bu programi isler.
; Sifir noktasi: blogun MERKEZI (X0 Y0), ust yuzey Z0. Takim: 6mm duz freze.
G21
G90
G17
M3 S12000
G0 Z5
; --- Op 1: konnektor cebi (24 x 16, 12mm derin) ---
G0 X-9.00 Y-5.00
; paso Z-3.00
G1 Z-3.00 F250
G1 X9.00 Y-5.00 F800
G1 X9.00 Y5.00
G1 X-9.00 Y5.00
G1 X-9.00 Y-5.00
G1 X-9.00 Y-2.00
G1 X9.00 Y-2.00
G1 X9.00 Y1.00
G1 X-9.00 Y1.00
G1 X-9.00 Y4.00
G1 X9.00 Y4.00
G1 X-9.00 Y-5.00
; paso Z-6.00
G1 Z-6.00 F250
G1 X9.00 Y-5.00 F800
G1 X9.00 Y5.00
G1 X-9.00 Y5.00
G1 X-9.00 Y-5.00
G1 X-9.00 Y-2.00
G1 X9.00 Y-2.00
G1 X9.00 Y1.00
G1 X-9.00 Y1.00
G1 X-9.00 Y4.00
G1 X9.00 Y4.00
G1 X-9.00 Y-5.00
; paso Z-9.00
G1 Z-9.00 F250
G1 X9.00 Y-5.00 F800
G1 X9.00 Y5.00
G1 X-9.00 Y5.00
G1 X-9.00 Y-5.00
G1 X-9.00 Y-2.00
G1 X9.00 Y-2.00
G1 X9.00 Y1.00
G1 X-9.00 Y1.00
G1 X-9.00 Y4.00
G1 X9.00 Y4.00
G1 X-9.00 Y-5.00
; paso Z-12.00
G1 Z-12.00 F250
G1 X9.00 Y-5.00 F800
G1 X9.00 Y5.00
G1 X-9.00 Y5.00
G1 X-9.00 Y-5.00
G1 X-9.00 Y-2.00
G1 X9.00 Y-2.00
G1 X9.00 Y1.00
G1 X-9.00 Y1.00
G1 X-9.00 Y4.00
G1 X9.00 Y4.00
G1 X-9.00 Y-5.00
G0 Z5
; --- Op 2: vida delikleri (2 adet, 18mm derin) ---
G0 X0 Y-17.00
G1 Z-18 F250
G0 Z5
G0 X0 Y17.00
G1 Z-18 F250
G0 Z5
; --- Op 3: kablo kanali (X boyunca, 5mm derin) ---
G0 X-20 Y-21
G1 Z-5 F250
G1 X20 Y-21 F800
G0 Z5
G0 X0 Y0
M5
M30
