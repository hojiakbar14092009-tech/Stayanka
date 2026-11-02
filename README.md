# AvtoStoyanka

200 joyli avtoturargoh uchun qorovul paneli va admin panel.
Node.js + Express + PostgreSQL server, Vite + React frontend, Three.js 3D darvoza.

To'liq hujjat: [docs/HUJJAT.md](docs/HUJJAT.md)

## Tez ishga tushirish

```bash
psql -U postgres -c "CREATE DATABASE stoyanka;"

cd avto-stoyanka-server
npm install
copy .env.example .env     # DATABASE_URL dagi parolni o'zingiznikiga almashtiring
npm run init-db
npm start                  # http://localhost:3000

cd ../avto-stoyanka
npm install
npm run dev                # http://localhost:5173
```

Kirish: `admin / admin123`, qorovullar: `aziz / qorovul1`, `bekzod / qorovul2`, `dilshod / qorovul3`.

## Imkoniyatlar

- 5 zona × 40 = 200 joy, A zona — Premium
- Raqamni yozib Enter: keyingi bo'sh joy avtomatik tanlanadi
- Vaqt o'tgan sari narx oshadi: har keyingi soat qimmatroq. Premium joy: 1-soat 30 000 so'm
- Kirishda QR kodli chek (har mashinaga boshqa), chiqishda skanerlanadi; chek mashina chiqquncha faol
- 200 joy bo'ylab mashinani topish, zonalar mini-xaritasi
- Premium zona yopiq tom ostida, moykachi mashinalarni yuvadi; 3D qorovul personaji
- Chiqishda chek printerdan chiqqandek animatsiya bilan chiqadi, arxivda saqlanadi
- Mashina kirsa yoki chiqsa, hamma ochiq panelga xabar keladi va 3D darvoza ochiladi
- Admin: statistika, joylarni ta'mirga yopish va premium qilish, tarif, qorovul profillari
- Boshliq sahifasi (alohida havola): kunlik/haftalik/oylik tushum, ish haqi (qorovul 200 000, moykachi 150 000), xarajatlar va sof foyda — animatsion grafiklar bilan
