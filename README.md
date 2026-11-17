# Samovar.digital

QR menyu, buyurtma va admin boshqaruv paneli. Mahsulotlar, ombor qoldig‘i va buyurtmalar PostgreSQL’da saqlanadi; buyurtma va qoldiq o‘zgarishlari serverda bitta tranzaksiyada bajariladi.

## Lokal ishga tushirish

Talablar: Node.js 20.19+ va Docker Compose yoki lokal sinov uchun PGlite.

1. Bog‘liqliklarni o‘rnating:
   ```bash
   npm install
   ```
2. Lokal sozlamalarni yarating va `ADMIN_PASSWORD` qiymatini kamida 12 belgili kuchli parolga almashtiring:
   ```powershell
   Copy-Item .env.example .env
   ```
3. PostgreSQL’ni ishga tushiring:
   ```bash
   docker compose up -d
   ```
   Docker o‘rnatilmagan bo‘lsa, `.env` faylidagi `DATABASE_URL` ni
   `postgres://postgres:postgres@127.0.0.1:5432/postgres` qilib o‘zgartirib,
   PGlite sinov serverini ishga tushiring:
   ```bash
   npm run db:dev
   ```
   PGlite ma’lumotlarni `.local-pg` ichida saqlaydi va Docker/PostgreSQL o‘rniga
   faqat lokal ishlab chiqish hamda sinov uchun mo‘ljallangan.
4. API serverini bir terminalda ishga tushiring:
   ```bash
   npm run api
   ```
   Birinchi ishga tushishda jadvallar yaratiladi va boshlang‘ich menyu bazaga qo‘shiladi.
5. Frontend’ni boshqa terminalda ishga tushiring:
   ```bash
   npm run dev
   ```
6. `http://localhost:3000` manzilini ochib, `.env` faylida sozlangan admin nomi va paroli bilan kiring.

`npm run build` production frontend to‘plamini yaratadi. Production muhitida API va PostgreSQL alohida ishga tushiriladi; HTTPS reverse proxy `/api` so‘rovlarini API serveriga yo‘naltirishi kerak.

## Render’da ommaviy sinov deployi

GitHub repo’ni Render’ga ulang va Blueprint sifatida `render.yaml` ni tanlang.
Deploy paytida `ADMIN_PASSWORD` uchun kamida 12 belgili kuchli qiymat kiriting.
Blueprint web/API xizmatini va PostgreSQL bazasini yaratadi; frontend ham shu
HTTPS manzilda xizmat qiladi. QR kod aynan deploy yakunida berilgan ommaviy URL’ga
yo‘naltirilishi kerak.

`render.yaml` hozir Render Free rejimini ishlatadi: web xizmati 15 daqiqa
faollik bo‘lmasa to‘xtaydi va keyingi so‘rovda qayta ishga tushishi mumkin;
Free PostgreSQL bazasi 30 kundan keyin tugaydi. Bu rejimni faqat tanishtirish
yoki vaqtinchalik sinov uchun ishlating. Doimiy ishlatish uchun pullik xizmat
tanlab, zaxira nusxa sozlang.

## Asosiy API

- `GET /api/products` — ommaga ochiq mahsulotlar ro‘yxati
- `POST /api/orders` — serverda tekshirib, zaxirani tranzaksiya bilan kamaytirib buyurtma yaratish
- `GET /api/orders/:id/status` — buyurtma holatini ko‘rish
- `POST /api/waiter-calls` — ofitsiant chaqiruvini yuborish
- `POST /api/admin/login`, `POST /api/admin/logout` — admin tizimiga kirish/chiqish
- `GET /api/admin/orders`, `GET /api/admin/waiter-calls` — admin buyurtmalari va chaqiruvlari
- `/api/admin/products` — mahsulot qo‘shish, tahrirlash, o‘chirish va holatini o‘zgartirish
- `GET /api/health` — API va ma’lumotlar bazasi holatini tekshirish

Admin sessiyasi HttpOnly, SameSite cookie ishlatadi. Haqiqiy deployda `.env` faylini repozitoriyga qo‘shmang; HTTPS, kuchli parol, zaxira nusxa va ma’lumotlar bazasi migratsiyalarini sozlang.

## Hozirgi imkoniyatlar

- Buyurtma narxi, xizmat haqi va zaxira serverda tekshiriladi; takroriy so‘rovlar idempotency kaliti bilan himoyalangan.
- Ma’lumotlar PostgreSQL orqali qurilmalar o‘rtasida almashadi. Menyu 15 soniyada, admin buyurtma va chaqiruvlari 5 soniyada yangilanadi.
- Tanlangan to‘lov usuli buyurtmaga yoziladi, lekin onlayn to‘lov provayderi ulanmagan.
- Chop etiladigan hujjat buyurtma xulosasi, **fiskal chek emas**. Fiskal tizim va haqiqiy to‘lov integratsiyasi alohida amalga oshirilishi kerak.
