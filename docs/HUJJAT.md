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
          guard_in → users.id, guard_out → users.id, receipt_no
settings  key, value   (tarif: base_hour, step_hour, premium_mult)
```

- **200 joy**: 5 zona × 40 joy. A zona — **Premium** (yopiq, kamera, keng joy), narxi ko'paytiriladi.
- Bitta joyda bir vaqtda faqat bitta ochiq sessiya bo'ladi (`left_at IS NULL` ga unique index).
- Cheklar `sessions` jadvalining o'zida saqlanadi — chiqishda `receipt_no` beriladi, arxiv hech qachon o'chmaydi.

## 3. Narx — vaqt o'tgan sari oshadi

Har boshlangan soat avvalgisidan qimmatroq:

```
n-soat narxi = base_hour + (n - 1) × step_hour
Jami (h soat) = h × base_hour + step_hour × h × (h - 1) / 2
Premium joy   = Jami × premium_mult
```

Standart: `base_hour = 5000`, `step_hour = 1000`, `premium_mult = 2`.
Misol: 3 soat → 5000 + 6000 + 7000 = **18 000 so'm**; premiumda 36 000.
Minimal — 1 soat. Admin tarifni paneldan o'zgartiradi.

## 4. API

| Metod | Yo'l | Kim | Vazifa |
|---|---|---|---|
| POST | `/api/login` | hamma | `{username, password}` → token |
| GET | `/api/spots` | qorovul | 200 joy, id tartibida, ochiq sessiya bilan |
| POST | `/api/enter` | qorovul | `{spot_id?, plate}` — joy band, yangi sessiya. `spot_id` bo'lmasa keyingi bo'sh joy |
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
