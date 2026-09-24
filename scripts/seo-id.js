// Everything the Indonesian landing page (/id) says to search engines and
// link previews, and its install manifest. scripts/build.js reads this to turn
// index.html into dist/id.html and manifest.json into dist/manifest-id.json.
// Build-time only: nothing here ships as a file of its own.
//
// Same brief as i18n.js and data-id.js: "Tulis ulang teks ini pakai bahasa
// Indonesia yang santai, asyik dibaca, dan nggak kaku, kayak lagi ngobrol sama
// teman." It's also written for how people search here: "ular tangga" is the
// game's own name in Indonesia, and "ular tangga online", "game pasangan" and
// "deep talk" are what they type.
//
// The counts (600+, 12 topics, 42 cards) are hardcoded, like the ones in
// index.html and manifest.json. If the bank changes size, update all three.
module.exports = {
  title: 'Ular Tangga Online: Game Ngobrol Seru buat Pasangan & Teman',
  description:
    'Ular tangga, tapi tiap kotak bikin ngobrol beneran. 600+ pertanyaan deep talk & tantangan buat pasangan atau geng kamu. Gratis, tanpa daftar, bisa offline.',

  siteName: 'Ular Tangga: Edisi Cinta & Sahabat',
  ogTitle: 'Ular Tangga: Edisi Cinta & Sahabat',
  ogDescription:
    'Tiap kotak yang kamu injak bikin ngobrol beneran. 600+ pertanyaan, tantangan, dan kejutan buat pasangan atau geng kamu. Gratis, tanpa daftar, bisa offline.',
  twitterDescription:
    'Tiap kotak yang kamu injak bikin ngobrol beneran. 600+ pertanyaan, tantangan, dan kejutan buat pasangan atau geng kamu.',
  imageAlt:
    'Papan ular tangga pink dengan tangga emas beranak tangga hati, ular yang ramah, dua bidak, dan hati kecil yang melayang di atasnya.',
  appleTitle: 'Ular Tangga',

  // Merged over the schema.org block in index.html, which supplies the rest
  // (type, category, images). The build sets `url` to the page's own address.
  jsonLd: {
    name: 'Ular Tangga: Edisi Cinta & Sahabat',
    alternateName: ['Ular Tangga Online', 'Snakes & Ladders: Love & Friends Edition'],
    description:
      'Ular tangga buat 2 sampai 6 orang, dan tiap kotak yang kamu injak bikin kalian ngobrol. Pilih mode Pasangan atau mode Teman, biar pertanyaan, tantangan, dan kejutannya pas sama siapa yang main. Langsung jalan di browser, bisa di-install jadi aplikasi, dan tetap bisa dimainin offline.',
    operatingSystem: 'Semua perangkat (lewat browser)',
    browserRequirements: 'Butuh JavaScript.',
    inLanguage: ['id', 'en'],
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'IDR' },
    featureList: [
      'Mode Pasangan dan mode Teman, masing-masing punya pertanyaan dan tantangan sendiri',
      '600+ pertanyaan buat ngobrol, dibagi ke 12 topik',
      '42 kartu kejutan',
      'Main 2 sampai 6 orang di satu HP',
      'Enam tema papan yang hidup, lengkap sama suara suasananya',
      'Bisa main pakai bahasa Indonesia atau Inggris',
      'Pertanyaan tulisan AI (opsional), pakai API key kamu sendiri',
      'Semua pertanyaan dan jawaban bisa kamu download',
      'Bisa di-install jadi aplikasi dan jalan offline',
    ],
  },

  // What a crawler, or anyone with JavaScript off, reads instead of the app.
  // Markup, because it replaces the <noscript> block in index.html as is.
  noscript: `<noscript>
  <div class="noscript">
    <h1>Ular Tangga: Edisi Cinta &amp; Sahabat</h1>
    <p>
      Ular tangga buat dua sampai enam orang di satu HP, dan tiap kotak yang
      kamu injak bikin kalian ngobrol. Kena kotak pertanyaan? Siap-siap jawab
      sesuatu yang seru buat dibahas. Kena kotak kejutan? Bisa-bisa kamu
      tukeran posisi, skip giliran, atau wajib muji seseorang.
    </p>
    <p>
      Pilih <strong>mode Pasangan</strong> buat pertanyaan dan tantangan khusus
      berdua, atau <strong>mode Teman</strong> yang sama sekali nggak ada
      romantis-romantisnya. Ada 600+ pertanyaan di dua belas topik — Cinta, Duit,
      Impian, Deep talk, Kenangan, Keluarga, Naik level, Bersyukur, Petualangan,
      Sehari-hari, Santai, dan Tantangan — plus 42 kartu kejutan, enam tema papan
      yang hidup, dan mode opsional yang bikin pertanyaan baru pakai API key AI
      kamu sendiri.
    </p>
    <p>
      Gratis, nggak perlu daftar, semua datanya tetap di browser kamu, dan bisa
      di-install jadi aplikasi yang jalan offline.
    </p>
    <p><strong>Game ini butuh JavaScript. Nyalain dulu, ya, biar bisa main.</strong></p>
  </div>
</noscript>`,

  // Merged over manifest.json. start_url is the Indonesian page, so the
  // installed app keeps opening in Indonesian; id is left as it is, so both
  // manifests describe the same app.
  manifest: {
    name: 'Ular Tangga: Edisi Cinta & Sahabat',
    short_name: 'Ular Tangga',
    description:
      'Ular tangga buat pasangan atau geng kamu, dan tiap kotak yang kamu injak bikin ngobrol. 600+ pertanyaan, tantangan, dan kejutan.',
    lang: 'id',
    start_url: './id',
    // In manifest.json's order: narrow, then wide. Indonesian captures, so
    // the install dialog shows the game as it'll be played.
    screenshots: [
      { src: 'assets/screenshot-mobile-id.webp', label: 'Papan di tengah permainan, lengkap sama skor pemain dan tombol Kocok' },
      { src: 'assets/screenshot-desktop-id.webp', label: 'Papan di tengah permainan, di layar lebar' },
    ],
  },
};
