# AvtoStoyanka — loyiha hujjati

Qorovul bir qarashda ko'rishi kerak: qaysi joy bo'sh, qaysi band, bugun qancha pul yig'ildi.
Admin esa joylarni, tariflarni, qorovullarni va cheklar arxivini boshqaradi.

## 1. Tarkib

| Papka | Nima | Texnologiya |
|---|---|---|
| `avto-stoyanka-server/` | API server | Node.js, Express, pg, cors |
| `avto-stoyanka/` | Qorovul paneli + admin panel | Vite + React, Three.js (3D darvoza) |
| `docs/` | Shu hujjat | — |

## 2. Baza (PostgreSQL, `stoyanka`)

```
users     id, username, password_hash, full_name, role ('admin'|'guard'), active
spots     id, label (A-01..E-40), zone (A..E), is_premium, is_busy, is_disabled
sessions  id, spot_id → spots.id, plate, entered_at, left_at, fee,
          guard_in → users.id, guard_out → users.id,
          ticket_no (kirish cheki, QR), receipt_no (chiqish cheki)
settings  key, value   (tarif: base_hour, step_hour, premium_hour)
```

- **200 joy**: 5 zona × 40 joy. A zona — **Premium** (yopiq, kamera, keng joy), narxi ko'paytiriladi.
- Bitta joyda bir vaqtda faqat bitta ochiq sessiya bo'ladi (`left_at IS NULL` ga unique index).
- Kirishda **QR kodli kirish cheki** beriladi: `T26110200038-9EB053` ko'rinishida, oxiridagi tasodifiy qism tufayli har mashinaning QR kodi boshqacha. Mashina ichkarida ekan chek **faol**, chiqqach **faol emas**.
- Chiqishda `receipt_no` (chiqish cheki) beriladi. Ikkala chek ham `sessions` jadvalida saqlanadi, arxiv o'chmaydi.

## 3. Narx — vaqt o'tgan sari oshadi

Har boshlangan soat avvalgisidan qimmatroq:

```
n-soat narxi  = boshlang'ich + (n - 1) × step_hour
boshlang'ich  = base_hour (oddiy) yoki premium_hour (premium)
Jami (h soat) = h × boshlang'ich + step_hour × h × (h - 1) / 2
```

Standart: `base_hour = 5000`, `step_hour = 1000`, `premium_hour = 30000`.
Misol: 3 soat → 5000 + 6000 + 7000 = **18 000 so'm**; premiumda 30 000 + 31 000 + 32 000 = **93 000 so'm**.
Minimal — 1 soat. Admin tarifni paneldan o'zgartiradi.

## 4. API

| Metod | Yo'l | Kim | Vazifa |
|---|---|---|---|
| POST | `/api/login` | hamma | `{username, password}` → token |
| GET | `/api/spots` | qorovul | 200 joy, id tartibida, ochiq sessiya bilan |
| POST | `/api/enter` | qorovul | `{spot_id?, plate}` — joy band, yangi sessiya. `spot_id` bo'lmasa keyingi bo'sh joy |
| GET | `/api/tickets/:code` | qorovul | QR chek yoki mashina raqami bo'yicha: chek faolmi, qaysi joyda, hozirgi narx |
| PUT | `/api/expel/:spot_id` | qorovul | mijoz to'lay olmadi: haydab chiqariladi, summa qarz (`paid = false`, chek `QZ-`) bo'lib yoziladi, tushumga qo'shilmaydi |
| PUT | `/api/exit/:spot_id` | qorovul | joy bo'sh, sessiya yopiladi, narx hisoblanadi, chek qaytadi |
| GET | `/api/revenue` | qorovul | bugungi tushum (SUM) |
| GET | `/api/receipts` | qorovul | cheklar arxivi (`q`, `from`, `to`) |
| GET | `/api/events` | qorovul | SSE — real vaqt xabarlari |
| GET | `/api/admin/stats` | admin | bandlik, 7 kunlik tushum, qorovullar bo'yicha |
| PUT | `/api/admin/spots/:id` | admin | premium / ta'mirda belgilash |
| GET/PUT | `/api/admin/settings` | admin | tarif |
| GET/POST/PUT/DELETE | `/api/admin/users` | admin | qorovullar |

Qoidalar: SQL qiymatlari faqat `$1, $2` orqali. Xato → `500`, noto'g'ri so'rov → `400`, ruxsat yo'q → `401/403`.
Token — HMAC imzolangan (kutubxonasiz), parol — `crypto.scrypt`.

## 5. Real vaqt xabarlari

Server-Sent Events (`/api/events`). Mashina kirsa yoki chiqsa, hamma ochiq panelga xabar boradi:
«01A123BC → A-07 joyini band qildi (Qorovul: Aziz)». Panel spotlarni o'zi qayta yuklaydi.

## 6. Dizayn yo'nalishi — «Bo'yalgan asfalt»

Boshqa admin panellardan farqi: ekranning o'zi — tepadan ko'rilgan stoyanka rejasi.
Joylar oq bo'yoq chiziqlari bilan chizilgan, band joyda tepadan ko'rilgan mashina turadi,
zonalar orasida yo'lak va yo'l belgilari bor.

| Token | Hex | Qayerda |
|---|---|---|
| Asfalt | `#2B2E33` | fon |
| Asfalt-chuqur | `#212328` | yo'lak |
| Bo'yoq | `#ECEAE4` | joy chiziqlari, matn |
| Yo'l sariq | `#F2C230` | premium, ogohlantirish, raqamlar |
| Belgi ko'k | `#2257D6` | «P» belgisi, asosiy tugma |
| Signal qizil | `#E5484D` | band |
| Signal yashil | `#2FB679` | bo'sh |

Shrift: **Barlow Condensed** (yo'l belgilari uslubi) — raqamlar va sarlavhalar; **Barlow** — matn.

Harakat (faqat amalga javoban):
- **3D darvoza** (Three.js): mashina kirganda shlagbaum ko'tariladi, mashina kirib keladi.
- **Chek** — termoprinterdan qog'oz chiqqandek pastga «chop etiladi».
- Joy band bo'lganda mashina joyga sirg'alib kiradi.
- `prefers-reduced-motion` — animatsiyalar o'chadi.

## 7. Qorovul uchun qulayliklar

- **Ketma-ket to'ldirish:** B blok to'lmaguncha C ga o'tilmaydi. Premium joy avtomatik berilmaydi — faqat mijoz xohlasa («Premium, yopiq» tugmasi).
- **Raqam kamerasi:** mashina shlagbaum oldida to'xtaydi, kamera raqamni o'qiydi va keyingi bo'sh joyni tayyorlaydi (mijoz xohlasa — premium). Mashina **chek berilmaguncha kirmaydi**: qorovul «Chek chop etish» → «Chek berildi, kirgizish» (yoki «Cheksiz kirgizish») bosgandagina shlagbaum ochiladi va rejada mashina joyiga kiradi. Joy bo'lmasa — «Mashinani qaytarish».
- **3D darvoza:** alohida kirish va chiqish yo'laklari, o'rtada orolcha; har yo'lakning o'z shlagbaumi (qarshi yuk, uchida tayanch, miltillovchi chiroq). Katta oynali «QO'RIQLASH POSTI» budkasi: ichida stol, monitor va stulda o'tirgan keksa qorovul (yashil forma, oq mo'ylov) — kirganlar bilan salomlashadi. Tashqarida yosh qorovul (ko'k forma, jilet) — chiqqanlarni kuzatadi va to'lamaganni haydaydi.
- Skaner, kirish cheki va chiqish cheki oynalari **chap tomonda** chiqadi — o'ngdagi kamera va raqam yopilmaydi. Chek qog'ozi qotmasdan, ravon chiqadi.
- **Moykachilar jamoasi** (3 kishi, har biri boshqa forma va asbobda): har biri boshqa mashinani yuvadi, qimmat mashinani ko'rsa «Vuy j....b, Rolls-Royce-mi?!» deb hayron qoladi.
- Mashina markasi raqamdan aniqlanadi (sinov uchun), rejada sedan, SUV va sport mashinalar har xil ko'rinadi.
- **To'lay olmagan mijoz:** skanerda «To'lay olmadi — haydab chiqarish». 3D sahnada qorovul mashina yoniga yurib boradi, tsenzura belgilarida (#@$%!) baqiradi, shlagbaum ochiladi, mashina chiqib ketadi. Qarz keyingi kelishida chekda va xabarda ko'rinadi.
- Xabarlar pastki chap burchakda, kichik — ish maydonini yopmaydi.

- Kirishda QR kodli chek chop etiladi (joy raqami katta yozilgan).
- Chiqishda chek skanerlanadi: lazer animatsiyasi, keyin «Chek faol» va to'lov summasi. Qayta skanerlansa — «Chek faol emas». USB QR skaner ham ishlaydi: u kodni yozib Enter bosadi.
- Mashinani topish: raqamning istalgan qismi yoki chek raqami bo'yicha 200 joy bo'ylab qidiradi. Har zona tabida 40 nuqtali mini-xarita bor, topilgan mashina sariq yonadi, rejada ustida ko'rsatkich chiqadi.
- A zona — yopiq tom ostida, moykachi band mashinalarni navbat bilan yuvadi.
- 3D darvozada qorovul personaji turadi va kirgan mashinaga qo'l ko'taradi.

- Raqamni yozib **Enter** — tizim keyingi bo'sh joyni o'zi tanlaydi (ketma-ket to'ldirish).
- Joyni bosish — kirgizish yoki chiqarish.
- Band joyda turgan vaqt va hozirgi narx jonli ko'rinadi.
- Zona tablari: A (Premium) … E, har birida bo'sh/band soni.
- Raqam bo'yicha qidiruv: mashina qayerda turganini topadi.

## 8. Profillar (seed)

| Login | Parol | Rol |
|---|---|---|
| `admin` | `admin123` | admin |
| `aziz` | `qorovul1` | qorovul |
| `bekzod` | `qorovul2` | qorovul |
| `dilshod` | `qorovul3` | qorovul |

Ishga tushirishdan keyin parollarni admin paneldan o'zgartiring.

## 9. Ishga tushirish

```bash
# 1. PostgreSQL ishlab turishi kerak, baza yaratiladi:
psql -U postgres -c "CREATE DATABASE stoyanka;"
cd avto-stoyanka-server
npm install
copy .env.example .env      # DATABASE_URL ni to'g'rilang
npm run init-db             # bazani yaratadi: 200 joy + profillar
npm start                   # http://localhost:3000

cd ../avto-stoyanka
npm install
npm run dev                 # http://localhost:5173
```

## 10. Boshliq sahifasi

Alohida havola: `http://<sayt>/boshliq?key=<kalit>`. Login kerak emas — kalitni bilgan kishi ko'radi.
Admin panel → «Umumiy» → «Boshliq sahifasi»: havolani nusxalash, ochish, yangilash (eski havola ishlamay qoladi).

Davrlar: **Bugun** (soatma-soat), **Hafta** (7 kun), **Oy** (30 kun). Ko'rsatkichlar: kirgan/chiqqan mashinalar,
tushum, premium ulushi, o'rtacha turish vaqti, to'lanmagan qarz, qorovullar bo'yicha tushum.

```
Foyda = Tushum − Ish haqi − Xarajatlar
Ish haqi   = har xodimning kunlik haqi × davr kunlari (qorovul 200 000, moykachi 150 000 so'm/kun)
Xarajatlar = kunlik × kunlar + oylik × kunlar / 30 + foizli × tushum / 100
```

- Har ishchi uchun kunlik, haftalik va oylik summa avtomatik hisoblanadi. Ishchi qaysi muddatda olishni xohlasa
  (kunlik / haftalik / oylik), shu belgilanadi — «Qo'liga» va «Keyingi to'lov» sanasi shunga qarab chiqadi.
- Xarajatlar ro'yxati (ijara, elektr, suv, internet, ta'mir fondi, moyka vositalari, soliq %) — sahifaning o'zida tahrirlanadi.
- Raqamlar sanab chiqadi, grafik ustunlari o'sib chiqadi, taqsimot halqasi chiziladi; sahifa har 30 soniyada yangilanadi.

| Metod | Yo'l | Vazifa |
|---|---|---|
| GET | `/api/boss?key=&period=day\|week\|month` | statistika, ish haqi, xarajatlar, foyda |
| PUT | `/api/boss/staff/:id?key=` | `{ pay_period }` — ishchi olish muddati |
| POST/PUT/DELETE | `/api/boss/expenses[/:id]?key=` | xarajatlar |
| GET/POST | `/api/admin/boss-link` | (admin) kalitni ko'rish / yangilash |

Sinov uchun 30 kunlik tarix: `npm run demo` (server papkasida).

## 11. Nogironlar uchun bepul

- Har oddiy zonaning kirishga eng yaqin 2 joyi (B-01, B-02, C-01, C-02, …) — **nogironlar joyi**: ko'k bo'yoq,
  yerda xalqaro nogironlar belgisi. Admin → «Joylar» → «♿ Nogironlar joyi» rejimida o'zgartiriladi.
- Qorovul kirishda (kamera kartasida yoki qo'lda) **«Nogironlik guvohnomasi bor»** tugmasini bosadi.
  Mashina avval nogironlar joyiga, u band bo'lsa — oddiy joyga qo'yiladi. **To'lov — 0 so'm**, premium joyda ham.
- Guvohnomasiz mashina nogironlar joyiga qo'yilmaydi (avtomatik ham, qo'lda ham).
- Kirish chekida, chiqish chekida, arxivda, xabarda va boshliq sahifasida «♿ bepul» belgisi; 3D darvozada
  «Nogironlar uchun BEPUL» belgisi va yo'lda bo'yalgan belgi.
- API: `POST /api/enter` `{ disabled_driver: true }`; `sessions.disabled_driver`, `spots.is_accessible`.

## 12. Kirish sahifasi, yuklanish va oflayn rejim

- **Yuklanish** — bosqichlar haqiqatan bajariladi: shriftlar, 3D dvigatel va personajlar, darvoza sahnasi,
  server bilan aloqa (`GET /api/health`), saqlangan smena sessiyasi. Har bosqich tugaganda bitta mashina joyiga kiradi, foiz — tugagan bosqichlar ulushi.
- **Oflayn** — build qilingan saytda `sw.js` sahifa va fayllarni keshlaydi: internet bo'lmasa ham sayt ochiladi.
  Server javob bermasa, kirish sahifasida ogohlantirish chiqadi va har 5 soniyada qayta tekshiriladi. API so'rovlari keshlanmaydi.
- **Premium kirish** — orqada qiyalatilgan tungi stoyanka (mashinalar kirib-chiqadi, yo'lakda faralar yuradi), oltin hoshiyali karta.
- **Personajlar** — login yozilganda o'sha kishining 3D personaji: Aziz (ko'k forma, jilet), Bekzod (yashil forma, mo'ylov),
  Dilshod (kulrang forma, ko'zoynak, qizil kepka), admin (to'q ko'k kostyum, galstuk, ko'zoynak). Yangi xodimlarga ism asosida
  boshqa-boshqa forma. Boshliq sahifasi — eng elegant personaj (qora kostyum, oltin galstuk, qora ko'zoynak, oltin soat) kutib oladi.
- **Kirish tugmasi** — bosilganda ichida 3D mashina kirib keladi; muvaffaqiyatda o'tib ketadi, personaj sakrab xursand bo'ladi
  (konfetti); xatoda mashina orqaga qaytadi, personaj bosh chayqaydi.
- **Vercel** — `avto-stoyanka/vercel.json` barcha yo'llarni `index.html` ga yo'naltiradi (`/boshliq` ham ochiladi).
  Server manzili: build paytida `VITE_API=https://<server>/api` muhit o'zgaruvchisi.

## 13. Realistik 3D va joy raqami tablosi

- **Atrof:** kechki osmon, atrof-muhit aksi (lak va oynalar yaltiraydi), teksturali asfalt, trotuar plitkasi, maysa;
  daraxtlar qatori va butalar, ko'cha chiroqlari, uzoqda binolar, shlagbaumdan keyin to'xtab turgan mashinalar.
  Budka — g'isht devor, eshik, konditsioner, kuzatuv kamerasi, tarnov.
- **Mashinalar:** markaga qarab kuzov — sedan, SUV, sport; lakli bo'yoq, xrom bel chizig'i va tutqichlar, panjara,
  faralar, g'ildirak arkalari, disklar.
- **Kamera:** asosiy ko'rinish kirish tomondan — kelayotgan mashina, shlagbaum va budka bir kadrda.
  Raqam kamerasi mashinani oldidan kuzatib boradi — raqam doim kadrda (to'siq yoki burchak xalaqit bermaydi).
- **Moykachilar:** Cobalt va boshqa qimmat mashinalarni ko'rganda har doim hayron qoladi; Rolls-Royce va Lamborghini'da
  har safar emas (taxminan 4 tadan 1 tasida). Premium joyga ba'zan Cobalt ham keladi.
- **Joy raqami:** har joyning orqa chizig'ida «aqlli stoyanka» LED tablosi — raqam va chiroq (yashil bo'sh, qizil band,
  sariq ta'mirda, ko'k nogironlar uchun). Mashina turganda ham raqam ko'rinadi.

## 14. Savdo markazi va to'xtash maydoni (3D)

- Shlagbaumdan keyin — **to'xtash maydoni** (2 qator × 10 joy, o'rtada yo'lak) va uning ortida noodatiy savdo markazi:
  qavariq egri shisha fasad, to'lqinli tom-soyabon, burama shisha minora (har qavat 7° burilgan), aylanma eshik, bayroqlar.
  Podium tepasida oltin harflarda **«Tashkent City Mall»** yozuvi.
- **Kirish:** chek berilgach shlagbaum ochiladi, mashina maydonga burilib, yo'lak bo'ylab yuradi va bo'sh joyga kirib to'xtaydi —
  o'sha joyda qoladi. Maydon to'lsa, eng eski mashina ketgan hisoblanadi.
- **Chiqish / haydash:** mashina maydondagi joyidan orqaga yurib chiqadi, orolcha uchini aylanib chiqish shlagbaumiga keladi.
- **Realizm:** mashinalar tagida kontakt soya, piyodalar savdo markazi eshigiga borib-kelishadi, bayroqlar hilpiraydi,
  aylanma eshik aylanadi, quyosh soyasi butun maydonni qoplaydi.
- **Kamera:** savdo markazi, maydon va darvoza bir kadrda; harakatdagi mashinani yumshoq kuzatadi.
  «Kattalashtirish» tugmasi 3D ni butun ekranga ochadi (Esc — yopish).

## 15. 3 qavatli garaj — 200 joy (3D)

- Ochiq maydon o'rniga 3 qavatli garaj: 1-qavat — A (VIP) va B, 2-qavat — C va D, 3-qavat (ochiq tom) — E. Har zona 2D rejadagidek 10 × 4 joy, raqamlar polga chizilgan (`A-01` …).
- 3D garaj serverdagi bandlik bilan bir xil: band joyda mashina turadi, bo'shda yo'q. Har joy ustida chiroq: yashil — bo'sh, qizil — band, ko'k — nogironlar uchun. Kirishdagi LED tablo har qavatdagi bo'sh joylarni ko'rsatadi.
- Mashinalar paydo bo'lmaydi: shlagbaumdan garajga kirib, ikki spiral rampa bor: sharqiysi (ko'k, «P ↑ KIRISH») orqali o'z qavatiga ko'tariladi va aynan o'z joyiga kiradi; chiqishda joyidan orqaga chiqib, g'arbiy rampa (yashil, «↓ CHIQISH») orqali tushadi — u chiqish yo'liga eng yaqin. Shlagbaum yopilgach darvoza keyingi mashinani qabul qiladi.
- "Kesim": mashina pastki qavatda yursa, ustidagi qavatlar shaffof bo'lib ichkari ko'rinadi.
- Zona tugmasi bosilsa, kamera o'sha zonaga boradi, qavat ochiladi va zona oltin ramka hamda "Zona C · 2-qavat" yozuvi bilan belgilanadi (7 soniya).
- VIP A (avvalgi «Premium»): yaltiroq qora pol, joylar orasida shisha devorchalar, oltin ship yoritgichi, "PREMIUM" peshtoqi, oltin ustunlar, elektromobil quvvatlagichlari va mashinani yuvayotgan moykachilar. Kirishda «VIP qulayliklari» tablosi turadi; xuddi shu ro'yxat (`VIP_PERKS`, `api.js`) qorovul panelida A zona ochilganda jadval bo'lib chiqadi.
- Savdo markazi 1,7 barobar katta va garajning o'ng yonida, yo'lga qaragan: g'arbiy devori garaj rampasiga tegib turadi, garaj tomidan unga qisqa shisha ko'prik o'tadi.

## 16. Tashkent City Park (3D)

- Savdo markazining ro'parasida, yo'lning narigi tomonida: kirish arkasi, xiyobonlar, 16 kabinali charxpalak (LED gardish rangi o'zgarib turadi), karusel, amerikan tepaligi (vagonchalar yuguradi), tushish minorasi va raqsga tushadigan favvora.
- Darvozada voqea bo'lmasa, kamera 12 soniyadan keyin sekin aylana boshlaydi: darvoza → garaj va mall → park → qaytish. Mashina kelsa yoki zona tanlansa, darhol darvozaga/zonaga qaytadi. «Harakatni kamaytirish» yoqilgan bo'lsa aylanmaydi.

## 17. Bulutda ishlatish (noutbuk o'chiq bo'lsa ham)

Sayt (Vercel) serverni `VITE_API` manzilidan qidiradi; berilmasa — `localhost:3000`, ya'ni faqat shu kompyuterda ishlaydi.
Doimiy ishlashi uchun server va baza bulutda turadi:

1. **Baza — Neon** (bepul): neon.tech → yangi loyiha → ulanish satrini (`postgresql://...?sslmode=require`) nusxalash.
2. **Server — Render** (bepul): render.com → New → Blueprint → shu GitHub repo. `render.yaml` o'qiladi,
   `DATABASE_URL` so'raladi — Neon satrini qo'yish. Server birinchi ishga tushganda bo'sh bazada jadvallar,
   200 joy va profillarni o'zi yaratadi (`seed.js`). Manzil: `https://stayanka-api.onrender.com`.
3. **Sayt — Vercel**: Settings → Environment Variables → `VITE_API=https://stayanka-api.onrender.com/api` → Redeploy.
4. Birinchi kirishdan keyin admin va qorovul parollarini almashtirish (boshlang'ich parollar repoda ochiq).

Bepul Render 15 daqiqa so'rov bo'lmasa uxlaydi; birinchi so'rovda ~1 daqiqada uyg'onadi (kirish sahifasi shu vaqt
"server javob bermayapti" deb qayta tekshirib turadi).
**Lokal ishga tushirish (Postgres o'rnatmasdan):** `avto-stoyanka-server` da `npm run local` — PGlite bazasi (`.pgdata/`) va server birga ko'tariladi;
bazani tozadan yaratish: `npm run local:init-db`. `.env` da `PG_POOL_MAX=1` bo'lishi shart: PGlite bitta ulanishda ishlaydi,
ulanish yopilib qayta ochilsa qotib qoladi (login va so'rovlar javobsiz qoladi, "Serverda xato").
Vercel'dagi sayt shu kompyuterdagi serverga ulanganda Chrome "mahalliy tarmoqqa kirish" ruxsatini so'rashi mumkin — Ruxsat berish.

## 18. Kengaygan shahar: katta mall, Humo Arena, katta park, ikkinchi garaj (3D)

- **Mall** 2.3 baravar kattalashdi (eni ~60 m), g'arbiy devori garaj rampasiga tegib turadi. Garajdan mallga ikki yo'l:
  2-qavat tomidan shisha ko'prik va yer sathida yopiq shisha soyabonli piyodalar yo'lagi («Tashkent City Mall →»).
- **Humo Arena** — yo'lning park tomonida, mall bilan park o'rtasida; park janubga surilgan, ular orasida ochiq xiyobon va yo'lda piyodalar o'tish joyi (zebra) — mall ↔ park yo'li to'silmaydi: elliptik bino, pastda shisha foye, ko'k chiroq halqalari,
  egilgan oq qanotlar (Humo qushi patlari), gumbazsimon oq tom, «HUMO ARENA» yozuvi, oldida maydon va zinapoyalar.
- **Park** janubga kengaydi (z 9..75): zanjirli arg'imchoq (aylanib-to'xtaydi), choynak karusel, urilma mashinalar,
  ko'l va oqqush qayiqlar, ko'l atrofida bolalar poyezdi, qaroqchi kemasi; xiyobonlarda 8 kishi sayr qiladi, tartibsiz daraxtzor.
- **Ikkinchi garaj (200 joy)** — park yonida, yo'lning narigi tomonida, birinchisiga ko'zgudek; joylarning ~60% band (bezak),
  sensorlar va LED tablo shunga mos. Kirish yo'li va «P 200» belgisi.
- **Kamera:** voqea bo'lsa — darvozaga to'g'ridan (yo'lga tik), ortida garaj va Humo Arena; raqam kamerasi — kichik oyna, chap pastki burchakda; 12 soniya tinch bo'lsa — o'rtadan umumiy ko'rinish, hamma binolar bir kadrda.
- **Avtomatik oqim:** qorovul panelida har 2 daqiqada bitta chiqish (QR skaner) va bitta kirish (chek bilan).

## 19. Ikki stoyanka, ikki qorovul

- **1-stoyanka** — mall yonidagi garaj, **2-stoyanka** — park yonidagi garaj; har biri 200 joy (`spots.lot`).
  Eski bazada 2-stoyanka joylari server ishga tushganda o'zi qo'shiladi (1-sining nusxasi), ma'lumot o'chmaydi.
- Har qorovul bitta stoyankaga biriktiriladi (`users.lot`): Aziz va Dilshod — 1, Bekzod — 2. Admin «Qorovullar»da almashtiradi.
- Qorovul sahifasi faqat o'z stoyankasini ko'rsatadi: joylar ro'yxati, tushum, cheklar, real vaqt xabarlari, 3D darvoza.
  2-stoyanka sahifasida 3D shahar ko'zgudek aylanadi — park yonidagi garaj faol, mall yonidagisi bezak.
- Boshqa stoyankaning chekini skanerlasa: «Bu chek 2-stoyankaniki». Mashina bir vaqtda ikki stoyankada bo'lolmaydi.
- Admin tepa paneldagi «1-stoyanka / 2-stoyanka» tugmasi bilan almashtiradi.
- Bir brauzerda ikki qorovul: token har tabda alohida (sessionStorage) — har tab o'z qorovulida qoladi.

## 20. Erkin kamera

- 3D sahnada sichqoncha: chap tugma — aylantirish, o'ng tugma — siljitish, g'ildirak — yaqinlashtirish; sahna tanlansa strelkalar bilan siljitish.
- Tegilgan zahoti avtomatik kamera to'xtaydi, o'ng yuqorida «Avtomatik kamera» tugmasi chiqadi; 45 soniya tegilmasa o'zi qaytadi.

## 21. Hashamatli binolar va butiklar (3D)

- Shahar bo'ylab 28 ta qimmat minora: shimolda garaj va mall ortidagi sayr xiyoboni (daraxt, chiroq) bo'ylab 10 ta,
  mall sharqida katta yo'l bo'yida 3 ta, darvozaning g'arbida, arena g'arbida va ikkinchi garaj janubida qolganlari.
- Har binoning pastki qavati — 3 ta butik: iliq yorug' vitrina (manekenlar, sumkalar, eshik), nomli peshtoq
  (LUMIÈRE, ZARAFSHON, OLTIN IPAK, SAMARQAND SILK, AURUM ... — o'ylab topilgan nomlar), rangli soyabon, gul tuvaklar, oltin karniz.
- Minora shakllari: oltin tojli va shpilli shisha, oltin halqali oq silindr, zinapoyasimon tosh (mansard tom), burama shisha.

## 22. Soddalashtirish: faqat stoyanka (bu bo'lim 14–21-bo'limlardagi shahar qismlarini bekor qiladi)

- **3D:** xaritada faqat stoyanka qoldi — darvoza, raqam kamerasi (chap pastda), 3 qavatli 200 joylik garaj, yo'l, daraxtlar,
  uzoqdagi shahar fon. Mall, park, Humo Arena, hashamatli binolar va ikkinchi garaj olib tashlandi. Erkin kamera qoldi.
- **Bitta stoyanka:** barcha qorovullar 1-stoyankada (server ishga tushganda o'zi o'tkazadi), admin almashtirgichi yo'q.
  Serverdagi `lot` ustuni keyinchalik ikkinchi stoyanka uchun saqlab qolindi.
- **Tasodifiy joy:** mashina bir blokka ketma-ket emas, bo'sh joylardan tasodifiy joyga qo'yiladi (VIP va nogironlar joyi qoidasi o'zgarmagan).
  Ekrandagi "Keyingi joy" — aynan shu joy.
- **Avtomatik oqim:** har daqiqada 1 chiqish (QR chek skanerlanadi) va 3 kirish (kamera raqamni o'qiydi, chek chop etiladi).
- **Ichkaridagi mashinalar:** stoyanka rejasi ostida jadval — raqam, joy, kirgan vaqti, qancha turgani, hozirgi to'lov (har 10 soniyada yangilanadi).
- **Qotmaslik:** so'rovlar 10 s, ulanish kutish 8 s dan oshsa xato bilan tugaydi; nazoratchi har 15 s bazani tekshiradi,
  2 marta javob bo'lmasa server chiqib ketadi va `npm run local` (local.js) baza bilan serverni 2 soniyada qayta ko'taradi.

## 23. Zona darvozalari, LED tablo, pul statistikasi faqat rahbariyatga

- **Har zonaning o'z kirishi (3D):** garaj ichida har zona oldida ikkala yo'lakda shlagbaumli darvoza va «B zona · kirish» peshtog'i
  (A — oltin, VIP). 1-qavatda (A, B) darvoza g'arb tomonda (mashinalar darvozadan keladi), yuqori qavatlarda (C, D, E) — sharqda
  (mashinalar sharqiy rampadan chiqadi). Yonida harakatlanayotgan mashina bo'lsa shlagbaum ko'tariladi.
- **Sahna:** orqa fondagi binolar olib tashlandi — faqat stoyanka. Darvoza kamerasi qorovul uchun: kadr o'rtasida budka va qorovul,
  chapda kelayotgan mashina va shlagbaum, ortida garaj kirishi. Bo'sh paytda — budka bilan butun garaj.
- **Tepadagi hisoblagichlar** — stoyanka kirishidagi LED tablo: qora nuqtali panel, «bo'sh joy» qahrabo, «band» qizil yonadi
  (`DotGothic16` shrifti). Butun ilovada «bo'sh / tayyor» belgisi endi yashil emas, qahrabo LED (`--led`).
- **Qorovul pulni ko'rmaydi:** tepadagi «Bugun» tushumi va cheklar arxividagi jami summa faqat adminda; server `GET /api/revenue`
  qorovulga 403 qaytaradi. Har chekning o'z summasi (to'lov olish uchun) qoladi.
- **Boshliq sahifasi soddalashdi:** davr tanlash, sof foyda tenglamasi, 4 ta ko'rsatkich (kirgan, ichkarida, o'rtacha turish, qarz),
  bitta grafik, ish haqi jadvali (ishchi, olish muddati, qo'liga, keyingi to'lov) va xarajatlar. Halqa diagramma,
  qorovullar reytingi va takroriy ustunlar olib tashlandi.

## 24. Kim kiritgani, o'g'irlangan mashinalar va tekshiruvchilar, Novikov tepa paneli

- **Kim kiritgani:** «Ichkaridagi mashinalar» jadvalida — kun va soat (04.11, 17:53) va kiritgan qorovul (smenadagi qorovul nomidan:
  Aziz kirsa — Aziz, Bekzod kirsa — Bekzod). Cheklar arxivida «Kiritdi» va «Chiqardi» ustunlari.
- **Qidiruvdagi raqamlar** (`wanted`): admin «Xavfsizlik» bo'limida qo'shadi/olib tashlaydi (namuna uchun 5 ta raqam bor).
  Avtomatik oqimda taxminan 25 mashinadan biri qidiruvdagi raqam bilan keladi.
- **Tekshiruvchilar** (`staff.role = 'inspector'`): smenada ko'pi bilan 2 kishi (server tekshiradi). Admin yangi tekshiruvchi qo'shadi va
  smenaga qo'yadi. 3D da to'q sariq kiyimda yuradi: 1-chisi 1-qavat (A, B), 2-chisi 2–3-qavatlar (C, D, E); boshi ustida ismi va
  «B-03 sari / B-03 tekshirilmoqda». 2D rejada tekshirilayotgan joyda ism belgisi, panelda «Tekshiruvchilar» kartasi.
- **O'g'irlangan topilsa:** hammaga qizil ogohlantirish (raqam, joy, kim topdi, qidiruv sababi), `stolen_found` ga yoziladi,
  «O'g'irlanganlar» ro'yxatida turadi, jadvalda va rejada qizil belgi. Bunday mashina chiqarilmaydi (server 409);
  admin «Militsiyaga topshirildi» bosganda sessiya to'lovsiz yopiladi, joy bo'shaydi.
- **Avtomatik oqim:** har daqiqada 3 kirish; stoyanka 85% to'lsa kirishlar orasida birma-bir chiqadi (o'g'irlanganlar chiqmaydi).
- **Tepa panel:** Novikov restorani fasadi (oltin chiziqlar, kamar derazalar, fonarlar), peshtoqda NOVIKOV — ikkinchi «O» rul g'ildiragi.
  Past kontrastda, o'ng tomonda: raqam va yozuvlarga xalaqit bermaydi. LED raqamlar o'zgarganda yumshoq siljib almashadi.
- **Mini-xarita:** bo'sh joy — chiziqli bo'sh katak, band — yonib turgan qizil, nogironlar — ko'k chiziq (yashil yo'q).
