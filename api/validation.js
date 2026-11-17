export const categories = new Set(['Asosiy Taomlar', 'Shashlik', 'Salat', 'Ichimliklar', 'Shirinliklar']);
export const tables = new Set(Array.from({ length: 9 }, (_, index) => `Stol ${index + 1}`));
export const paymentMethods = new Set(['Karta / Payme', 'Naqd pul', 'Uzum Bank']);
export const orderStatuses = new Set(['yangi', 'tayyorlanmoqda', 'yetkazildi', 'tolandi']);

export class ValidationError extends Error {}

export function validateProduct(input) {
  input = input || {};
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const category = typeof input.category === 'string' ? input.category : '';
  const price = Number(input.price);
  const stock = Number(input.stock);
  const status = input.status;
  const image = typeof input.image === 'string' && input.image.trim()
    ? input.image.trim()
    : 'assets/images/palov.jpg';
  const description = typeof input.description === 'string' ? input.description.trim() : '';
  const badge = typeof input.badge === 'string' ? input.badge.trim() : null;

  if (name.length < 2 || name.length > 120) throw new ValidationError('Mahsulot nomi 2–120 belgi bo‘lishi kerak.');
  if (!categories.has(category)) throw new ValidationError('Mahsulot kategoriyasi noto‘g‘ri.');
  if (!Number.isSafeInteger(price) || price <= 0 || price > 1000000000) {
    throw new ValidationError('Narx 1–1 000 000 000 oralig‘idagi butun son bo‘lishi kerak.');
  }
  if (!Number.isSafeInteger(stock) || stock < 0 || stock > 1000000) {
    throw new ValidationError('Ombor qoldig‘i 0–1 000 000 oralig‘ida bo‘lishi kerak.');
  }
  if (!['mavjud', 'tugadi'].includes(status)) throw new ValidationError('Mahsulot holati noto‘g‘ri.');
  if (status === 'mavjud' && stock === 0) {
    throw new ValidationError('Qoldig‘i nol bo‘lgan mahsulotni mavjud deb belgilab bo‘lmaydi.');
  }
  if (image.length > 2048 || (!/^https:\/\//i.test(image) && !/^\/?assets\/images\/[\w.-]+$/i.test(image))) {
    throw new ValidationError('Rasm manzili HTTPS URL yoki assets/images ichidagi fayl bo‘lishi kerak.');
  }
  if (description.length > 2000 || (badge && badge.length > 50)) {
    throw new ValidationError('Ta’rif 2000, nishon esa 50 belgidan oshmasligi kerak.');
  }

  return {
    name,
    category,
    price,
    stock,
    status,
    image,
    description,
    badge: badge || null,
    isChefSpecial: input.isChefSpecial === true
  };
}

export function validateOrder(input) {
  const { table, guestCount, notes = '', paymentMethod, items } = input || {};
  if (!tables.has(table)) throw new ValidationError('Stol raqami noto‘g‘ri.');
  if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 20) {
    throw new ValidationError('Mehmonlar soni 1–20 oralig‘ida bo‘lishi kerak.');
  }
  if (typeof notes !== 'string' || notes.length > 500) {
    throw new ValidationError('Izoh 500 belgidan oshmasligi kerak.');
  }
  if (!paymentMethods.has(paymentMethod)) throw new ValidationError('To‘lov usuli noto‘g‘ri.');
  if (!Array.isArray(items) || items.length === 0 || items.length > 50) {
    throw new ValidationError('Buyurtmada 1–50 ta mahsulot bo‘lishi kerak.');
  }

  const quantities = new Map();
  for (const item of items) {
    if (!item || typeof item.id !== 'string' || item.id.length > 80 ||
        !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 100) {
      throw new ValidationError('Buyurtmadagi mahsulot yoki uning miqdori noto‘g‘ri.');
    }
    const totalQuantity = (quantities.get(item.id) || 0) + item.quantity;
    if (totalQuantity > 100) throw new ValidationError('Bir mahsulotdan 100 donadan ortiq buyurtma qilib bo‘lmaydi.');
    quantities.set(item.id, totalQuantity);
  }

  return { table, guestCount, notes: notes.trim(), paymentMethod, quantities };
}

export function validateWaiterCall(input) {
  const { table, guestCount } = input || {};
  if (!tables.has(table)) throw new ValidationError('Stol raqami noto‘g‘ri.');
  if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 20) {
    throw new ValidationError('Mehmonlar soni 1–20 oralig‘ida bo‘lishi kerak.');
  }
  return { table, guestCount };
}
