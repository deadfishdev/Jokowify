# Jokowify

Ubah gambar yang diunggah menjadi animasi partikel yang membentuk ulang potret target.

**Jokowify** adalah eksperimen visual berbasis browser yang dibuat dengan **WebGL** dan simulasi partikel ringan. Kamu mengunggah gambar sumber, lalu aplikasi akan mengubahnya menjadi ribuan partikel yang bergerak dan membentuk struktur gambar target. Saat ini, aplikasi memakai `image.jpg` sebagai gambar target default dan menampilkan hasilnya langsung di browser. :contentReference[oaicite:0]{index=0}

## Fitur

- Upload gambar dari file
- Drag and drop gambar langsung ke halaman
- Efek remap partikel berbasis WebGL
- Kontrol crop sumber
- Pengaturan resolusi, ukuran partikel, spring, damping, threshold, dan kualitas mapping
- Tombol pause, play, restart, dan randomize mapping
- Export animasi menjadi GIF langsung dari browser :contentReference[oaicite:1]{index=1}

## Cara kerja

Aplikasi ini mengambil gambar yang kamu upload sebagai **source image**, lalu memakai `image.jpg` sebagai **target image**. Gambar sumber dipecah menjadi grid partikel, kemudian sistem mengekstrak titik-titik penting dari gambar target berdasarkan brightness dan edge detection. Setelah itu, partikel-partikel dari gambar sumber dianimasikan menuju posisi target dengan simulasi gerak berbasis spring. Render akhirnya dilakukan dengan WebGL agar tetap cepat meskipun jumlah partikelnya banyak. :contentReference[oaicite:2]{index=2}

## Alur penggunaan

1. Upload gambar
2. Aplikasi membaca dan memproses gambar menjadi partikel
3. Partikel diarahkan ke bentuk target
4. Animasi diputar otomatis di canvas output
5. Kamu bisa menyesuaikan parameter visual
6. Hasil animasi bisa diexport sebagai GIF :contentReference[oaicite:3]{index=3}

## Struktur proyek

```text
.
├── extension/           # File browser extension
├── index.html           # Halaman utama aplikasi
├── visualization.html   # Halaman visualisasi tambahan
├── image.jpg            # Gambar target default
├── LICENSE
└── README.md
