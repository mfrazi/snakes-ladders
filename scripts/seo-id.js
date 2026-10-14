// Everything the Indonesian landing page (/id) says to search engines and
// link previews, and its install manifest. scripts/build.js reads this to turn
// index.html into dist/id.html and manifest.json into dist/manifest-id.json.
// Build-time only: nothing here ships as a file of its own.
//
// Same brief as i18n.js and data-id.js: "Tulis ulang teks ini pakai bahasa
// Indonesia yang santai, asyik dibaca, dan nggak kaku, kayak lagi ngobrol sama
// teman." It's also written for how people search here: "ular tangga" is the
// game's own name in Indonesia, and these are the searches it targets:
// "ular tangga online", "ular tangga gratis", "main ular tangga gratis",
// "ular tangga pertanyaan", "ular tangga ngobrol", "ular tangga pasangan" and
// "ular tangga LDR" (also typed "lrd"; search engines fold the typo in, so the
// copy spells it properly). Each one appears in readable sentences, mostly in
// `about`. Don't paste them in as a list: that reads as keyword stuffing.
//
// The counts (600+, 12 topics, 42 cards) are hardcoded, like the ones in
// index.html and manifest.json. If the bank changes size, update all three.
module.exports = {
  title: 'Ular Tangga Online Gratis: Game Ngobrol buat Pasangan & Teman',
  description:
    'Main ular tangga gratis yang bikin ngobrol: 600+ pertanyaan deep talk & tantangan buat pasangan, LDR, atau geng kamu. Langsung main, tanpa daftar.',

  siteName: 'Ular Tangga: Edisi Cinta & Sahabat',
  ogTitle: 'Ular Tangga Online: Edisi Cinta & Sahabat',
  ogDescription:
    'Main ular tangga gratis, dan tiap kotak yang kamu injak bikin ngobrol beneran. 600+ pertanyaan, tantangan, dan kejutan buat pasangan atau geng kamu. Tanpa daftar, bisa offline.',
  twitterDescription:
    'Tiap kotak yang kamu injak bikin ngobrol beneran. 600+ pertanyaan, tantangan, dan kejutan buat pasangan atau geng kamu.',
  imageAlt:
    'Papan ular tangga pink dengan tangga emas beranak tangga hati, ular yang ramah, dua bidak, dan hati kecil yang melayang di atasnya.',
  appleTitle: 'Ular Tangga',

  // Merged over the schema.org block in index.html, which supplies the rest
  // (type, category, images). The build sets `url` to the page's own address.
  jsonLd: {
    name: 'Ular Tangga: Edisi Cinta & Sahabat',
    alternateName: [
      'Ular Tangga Online',
      'Ular Tangga Ngobrol',
      'Ular Tangga Pasangan',
      'Ular Tangga LDR',
      'Snakes & Ladders: Love & Friends Edition',
    ],
    description:
      'Ular tangga online gratis buat 2 sampai 6 orang, dan tiap kotak yang kamu injak bikin kalian ngobrol. Pilih mode Pasangan atau mode Teman, biar pertanyaan, tantangan, dan kejutannya pas sama siapa yang main. Lagi LDR? Share layar lewat video call, terus main bareng. Langsung jalan di browser, bisa di-install jadi aplikasi, dan tetap bisa dimainin offline.',
    keywords:
      'ular tangga online, ular tangga gratis, main ular tangga gratis, ular tangga pertanyaan, ular tangga ngobrol, ular tangga pasangan, ular tangga LDR, ular tangga lrd, game pasangan, deep talk',
    operatingSystem: 'Semua perangkat (lewat browser)',
    browserRequirements: 'Butuh JavaScript.',
    inLanguage: ['id', 'en'],
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'IDR' },
    featureList: [
      'Mode Pasangan dan mode Teman, masing-masing punya pertanyaan dan tantangan sendiri',
      '600+ pertanyaan buat ngobrol, dibagi ke 12 topik',
      '42 kartu kejutan',
      'Main 2 sampai 6 orang di satu HP',
      'Bisa dimainin bareng pasangan LDR lewat share layar di video call',
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
      Ular tangga online gratis buat dua sampai enam orang di satu HP, dan tiap
      kotak yang kamu injak bikin kalian ngobrol. Kena kotak pertanyaan?
      Siap-siap jawab sesuatu yang seru buat dibahas. Kena kotak kejutan?
      Bisa-bisa kamu tukeran posisi, skip giliran, atau wajib muji seseorang.
    </p>
    <p>
      Pilih <strong>mode Pasangan</strong> buat pertanyaan dan tantangan khusus
      berdua, atau <strong>mode Teman</strong> yang sama sekali nggak ada
      romantis-romantisnya. Ada 600+ pertanyaan di dua belas topik — Cinta, Duit,
      Impian, Deep talk, Kenangan, Keluarga, Naik level, Bersyukur, Petualangan,
      Sehari-hari, Santai, dan Tantangan — plus 42 kartu kejutan, enam tema papan
      yang hidup, dan mode opsional yang bikin pertanyaan baru pakai API key AI
      kamu sendiri. Lagi LDR? Share layar lewat video call, terus main bareng.
    </p>
    <p>
      Gratis, nggak perlu daftar, semua datanya tetap di browser kamu, dan bisa
      di-install jadi aplikasi yang jalan offline.
    </p>
    <p><strong>Game ini butuh JavaScript. Nyalain dulu, ya, biar bisa main.</strong></p>
  </div>
</noscript>`,

  // The page's one block of real reading text, and the reason /id can rank
  // for more than its title. Google runs the JavaScript, and once it does it
  // mostly ignores <noscript>, so the only words it sees otherwise are the
  // hidden <h1> and the button labels. build.js puts this in place of the
  // <!-- seo-about --> marker in index.html, below the setup card: the card
  // still opens alone on the first screen, and this is a scroll away.
  //
  // Visible on purpose. Text hidden from players but served to crawlers is
  // cloaking, and gets a page demoted rather than ranked. lang="id" because a
  // player can switch the app to English and this block stays as it is.
  // Markup, inserted as is: escape any & or < you add.
  about: `<section class="seo-about" lang="id" aria-labelledby="seo-about-title">
    <h2 id="seo-about-title">Ular tangga online gratis, tapi bikin ngobrol</h2>
    <p>
      Masih ingat serunya main ular tangga waktu kecil? Ini versi yang sama:
      kocok dadu, naik tangga, awas digigit ular. Bedanya, game ini dirancang jadi
      <strong>ular tangga ngobrol</strong>: tiap kotak yang kamu injak bisa
      munculin pertanyaan atau kejutan. Jadi sambil ngejar kotak 100, kalian juga
      ngobrol beneran, dari obrolan santai sampai deep talk.
    </p>
    <p>
      Main 2 sampai 6 orang gantian di satu HP, langsung di browser. Nggak perlu
      download, nggak perlu daftar.
    </p>

    <h3>Main ular tangga gratis, beneran?</h3>
    <p>
      Beneran gratis. Main ular tangga gratis di sini nggak ada iklan mengganggu,
      nggak perlu bikin akun, dan nggak ada biaya langganan. Semua data tersimpan
      di browser kamu sendiri. Kalau sering main, pasang aja jadi aplikasi di HP,
      tetap lancar walau lagi offline.
    </p>

    <h3>Ular tangga pertanyaan: isinya apa aja?</h3>
    <p>
      Di edisi ular tangga pertanyaan ini, ada 600+ pertanyaan di 12 topik: Cinta,
      Duit, Impian, Deep talk, Kenangan, Keluarga, Naik level, Bersyukur,
      Petualangan, Sehari-hari, Santai, dan Tantangan. Pilih topik yang mau ikut,
      sisanya nggak bakal muncul. Ditambah 42 kartu kejutan: tukeran posisi, skip
      giliran, sampai wajib muji seseorang. Pengin pertanyaan yang lebih fresh?
      Ada mode opsional yang bikin pertanyaan baru pakai API key AI kamu sendiri.
    </p>

    <h3>Ular tangga pasangan atau bareng teman?</h3>
    <p>
      Dua-duanya bisa. Mode <strong>ular tangga pasangan</strong> punya
      pertanyaan dan tantangan khusus berdua, pas banget buat date night atau
      ngobrol santai sebelum tidur. Mode Teman sama sekali nggak ada
      romantis-romantisnya, aman dimainin bareng geng, keluarga, atau teman kantor.
    </p>

    <h3>Bisa main ular tangga LDR bareng pasangan?</h3>
    <p>
      Bisa banget. Banyak yang nyari game ular tangga LDR (atau sering dicari
      dengan ketikan ular tangga lrd) buat seru-seruan jarak jauh. Caranya
      gampang: satu orang buka game-nya, terus share layar lewat video call,
      entah Google Meet, Zoom, atau WhatsApp. Yang buka game ngocok dadu buat
      giliran kalian berdua, dan tiap pertanyaan dijawab bareng di call.
      Jaraknya jauh, obrolannya tetap dekat.
    </p>
  </section>`,

  // Merged over manifest.json. start_url is the Indonesian page, so the
  // installed app keeps opening in Indonesian; id is left as it is, so both
  // manifests describe the same app.
  manifest: {
    name: 'Ular Tangga: Edisi Cinta & Sahabat',
    short_name: 'Ular Tangga',
    description:
      'Ular tangga online gratis buat pasangan atau geng kamu, dan tiap kotak yang kamu injak bikin ngobrol. 600+ pertanyaan, tantangan, dan kejutan.',
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
