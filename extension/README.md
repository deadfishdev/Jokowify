# Jokoify

Ini adalah prototipe ekstensi Chrome Manifest V3 yang memantau thumbnail YouTube dan menerapkan animasi partikel sekali jalan.

## Apa yang dilakukan

* Mendeteksi thumbnail YouTube yang baru ditemukan.
* Mengambil sampel thumbnail itu sendiri sebagai gambar sumber.
* Menghitung gambar target berbasis tepi/struktur dari thumbnail tersebut.
* Menganimasikan piksel/partikel dari gambar asli ke versi hasil perhitungan tersebut.
* Menghentikan rendering saat animasi selesai.
* Menunggu hingga thumbnail lain ditemukan sebelum menganimasikan lagi.
* Membatasi jumlah partikel maksimum hingga `16000`.

## Cara memuat di Chrome

1. Buka `chrome://extensions`.
2. Aktifkan **Developer mode**.
3. Klik **Load unpacked**.
4. Pilih folder berikut:

`C:\Users\reza\Documents\kenny\extension`

## Catatan

* Popup memungkinkan Anda mengatur jumlah partikel, hingga `16000`.
* Versi ini sengaja dibuat ringan dan menggunakan Canvas 2D agar lebih mudah dimuat sebagai ekstensi.
* Jika Anda mau, langkah berikutnya bisa ditingkatkan agar menggunakan lebih banyak logika partikel WebGL yang sudah ada dari `index.html` untuk animasi yang lebih kaya.

# EN

# YouTube Thumbnail Particle Animator

This is a Manifest V3 Chrome extension prototype that watches YouTube thumbnails and applies a one-shot particle animation.

## What it does

- Detects newly encountered YouTube thumbnails.
- Samples the thumbnail itself as the source image.
- Calculates an edge/structure-based target image from that thumbnail.
- Animates pixels/particles from the original image into that calculated version.
- Stops rendering when the animation completes.
- Waits until another thumbnail is encountered before animating again.
- Caps the particle budget at `16000`.

## Load it in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the folder:

`C:\Users\reza\Documents\kenny\extension`

## Notes

- The popup lets you set the particle budget, up to `16000`.
- This version is intentionally lightweight and uses Canvas 2D so it is easier to load as an extension.
- If you want, the next step can be upgrading this to reuse more of the existing WebGL particle logic from `index.html` for a richer animation.
