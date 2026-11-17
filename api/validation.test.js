import assert from 'node:assert/strict';
import test from 'node:test';
import { validateOrder, validateProduct, validateWaiterCall, ValidationError } from './validation.js';

test('validates product prices, stock, status, and image URLs', () => {
  const product = validateProduct({
    name: 'Osh',
    category: 'Asosiy Taomlar',
    price: '52000',
    stock: '5',
    status: 'mavjud',
    image: 'assets/images/palov.jpg'
  });

  assert.equal(product.price, 52000);
  assert.equal(product.stock, 5);
  assert.throws(() => validateProduct({ ...product, price: -1 }), ValidationError);
  assert.throws(() => validateProduct({ ...product, stock: 0 }), ValidationError);
  assert.throws(() => validateProduct({ ...product, image: 'javascript:alert(1)' }), ValidationError);
});

test('validates order inputs and aggregates duplicate product IDs', () => {
  const order = validateOrder({
    table: 'Stol 3',
    guestCount: 4,
    notes: '  Kamroq piyoz  ',
    paymentMethod: 'Naqd pul',
    items: [
      { id: 'prod-1', quantity: 2 },
      { id: 'prod-1', quantity: 1 }
    ]
  });
  assert.equal(order.notes, 'Kamroq piyoz');
  assert.equal(order.quantities.get('prod-1'), 3);
  assert.throws(() => validateOrder({ ...order, guestCount: 0 }), ValidationError);
  assert.throws(() => validateOrder({
    table: 'Stol 3',
    guestCount: 4,
    paymentMethod: 'Naqd pul',
    items: [{ id: 'prod-1', quantity: 0 }]
  }), ValidationError);
  assert.throws(() => validateOrder({
    table: 'Stol 3',
    guestCount: 4,
    paymentMethod: 'Naqd pul',
    items: [{ id: 'prod-1', quantity: 100 }, { id: 'prod-1', quantity: 1 }]
  }), ValidationError);
});

test('validates waiter calls before accepting them', () => {
  assert.deepEqual(validateWaiterCall({ table: 'Stol 9', guestCount: 2 }), {
    table: 'Stol 9',
    guestCount: 2
  });
  assert.throws(() => validateWaiterCall({ table: 'Stol 10', guestCount: 2 }), ValidationError);
});
