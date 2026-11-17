const localImageUrls = import.meta.glob('../assets/images/*', {
  eager: true,
  query: '?url',
  import: 'default'
});

function resolveImageUrl(image) {
  if (!image || /^https?:\/\//i.test(image)) return image || '';
  const key = `../${image.replace(/^\/+/, '')}`;
  return localImageUrls[key] || image;
}

function normalizeProduct(product) {
  return {
    ...product,
    imageSource: product.image,
    image: resolveImageUrl(product.image)
  };
}

class SamovarStore {
  constructor() {
    this.storageKeyCart = 'samovar_cart_v5';
    this.storageKeyTable = 'samovar_selected_table_v5';
    this.storageKeyGuests = 'samovar_guest_count_v5';
    this.storageKeyTableConfirmed = 'samovar_table_confirmed_v5';

    this.products = [];
    this.orders = [];
    this.waiterCalls = [];
    this.cart = this.loadCart();
    const savedTable = localStorage.getItem(this.storageKeyTable) || '';
    const savedGuests = Number(localStorage.getItem(this.storageKeyGuests));
    this.selectedTable = /^Stol [1-9]$/.test(savedTable) ? savedTable : 'Stol 1';
    this.guestCount = Number.isInteger(savedGuests) && savedGuests >= 1 && savedGuests <= 20 ? savedGuests : 2;
    this.isTableConfirmed = localStorage.getItem(this.storageKeyTableConfirmed) === 'true';
    this.currentView = 'client';
    this.isAdminLoggedIn = false;
    this.adminUsername = '';
    this.activeCategory = 'all';
    this.searchQuery = '';
    this.listeners = [];
    this.audioCtx = null;
    this.pendingOrder = this.loadPendingOrder();
  }

  async request(path, options = {}) {
    const response = await fetch(`/api${path}`, {
      ...options,
      credentials: 'same-origin',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers
      }
    });

    let body = null;
    if (response.status !== 204) {
      try {
        body = await response.json();
      } catch {
        if (response.ok) throw new Error('Serverdan noto‘g‘ri javob keldi.');
      }
    }
    if (!response.ok) {
      const error = new Error(body?.error || `Server xatosi (${response.status}).`);
      error.status = response.status;
      throw error;
    }
    return body;
  }

  async initialize() {
    this.products = (await this.request('/products')).map(normalizeProduct);
    this.reconcileCart();
    this.notify('products-updated');
  }

  async refreshProducts() {
    const products = (await this.request('/products')).map(normalizeProduct);
    if (JSON.stringify(products) !== JSON.stringify(this.products)) {
      this.products = products;
      this.reconcileCart();
      this.notify('products-updated');
    }
  }

  async refreshOrders() {
    if (!this.isAdminLoggedIn) return;
    let orders;
    try {
      orders = await this.request('/admin/orders');
    } catch (error) {
      if (error.status === 401) this.expireAdminSession();
      throw error;
    }
    if (JSON.stringify(orders) !== JSON.stringify(this.orders)) {
      this.orders = orders;
      this.notify('orders-updated');
    }
  }

  async refreshWaiterCalls() {
    if (!this.isAdminLoggedIn) return;
    let calls;
    try {
      calls = await this.request('/admin/waiter-calls');
    } catch (error) {
      if (error.status === 401) this.expireAdminSession();
      throw error;
    }
    if (JSON.stringify(calls) !== JSON.stringify(this.waiterCalls)) {
      this.waiterCalls = calls;
      this.notify('orders-updated');
    }
  }

  expireAdminSession() {
    this.isAdminLoggedIn = false;
    this.adminUsername = '';
    this.currentView = 'client';
    this.orders = [];
    this.waiterCalls = [];
    this.notify('view-changed', 'client');
    this.notify('admin-session-expired');
  }

  loadCart() {
    try {
      const saved = localStorage.getItem(this.storageKeyCart);
      const parsed = saved ? JSON.parse(saved) : {};
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      return Object.fromEntries(Object.entries(parsed).filter(([id, quantity]) =>
        typeof id === 'string' && Number.isSafeInteger(quantity) && quantity > 0
      ));
    } catch (error) {
      console.warn('Savat ma’lumotini o‘qib bo‘lmadi:', error);
      return {};
    }
  }

  loadPendingOrder() {
    try {
      const saved = JSON.parse(localStorage.getItem('samovar_pending_order_v1') || 'null');
      if (saved && /^[0-9a-f-]{36}$/i.test(saved.key) && typeof saved.fingerprint === 'string') return saved;
    } catch (error) {
      console.warn('Kutilayotgan buyurtma kalitini o‘qib bo‘lmadi:', error);
    }
    return null;
  }

  reconcileCart() {
    let changed = false;
    Object.entries(this.cart).forEach(([id, quantity]) => {
      const product = this.products.find(item => item.id === id);
      if (!product || product.status !== 'mavjud' || product.stock <= 0) {
        delete this.cart[id];
        changed = true;
      } else if (quantity > product.stock) {
        this.cart[id] = product.stock;
        changed = true;
      }
    });
    if (changed) this.saveCart();
  }

  saveCart() {
    localStorage.setItem(this.storageKeyCart, JSON.stringify(this.cart));
    this.notify('cart-updated');
  }

  setTableAndGuests(table, guests) {
    const guestCount = Number(guests);
    if (!/^Stol [1-9]$/.test(table) || !Number.isInteger(guestCount) || guestCount < 1 || guestCount > 20) {
      throw new Error('Stol yoki mehmonlar soni noto‘g‘ri.');
    }

    this.selectedTable = table;
    this.guestCount = guestCount;
    this.isTableConfirmed = true;
    localStorage.setItem(this.storageKeyTable, table);
    localStorage.setItem(this.storageKeyGuests, String(guestCount));
    localStorage.setItem(this.storageKeyTableConfirmed, 'true');
    this.playTone(600, 0.12);
    this.notify('table-guests-updated', { table, guestCount });
  }

  async loginAdmin(username, password) {
    const session = await this.request('/admin/login', {
      method: 'POST',
      body: JSON.stringify({ username, password })
    });
    this.isAdminLoggedIn = true;
    this.adminUsername = session.username;
    this.currentView = 'admin';
    try {
      await Promise.all([this.refreshOrders(), this.refreshWaiterCalls()]);
    } catch (error) {
      this.isAdminLoggedIn = false;
      this.adminUsername = '';
      this.currentView = 'client';
      this.orders = [];
      this.waiterCalls = [];
      await this.request('/admin/logout', { method: 'POST' }).catch(logoutError => {
        console.error('Admin sessiyasini yakunlab bo‘lmadi:', logoutError);
      });
      throw error;
    }
    this.playTone(880, 0.15);
    this.notify('admin-login-success');
    this.notify('view-changed', 'admin');
    return session;
  }

  async logoutAdmin() {
    await this.request('/admin/logout', { method: 'POST' });
    this.isAdminLoggedIn = false;
    this.adminUsername = '';
    this.currentView = 'client';
    this.orders = [];
    this.waiterCalls = [];
    this.notify('admin-logout');
    this.notify('view-changed', 'client');
  }

  setView(view) {
    if (view === 'admin' && !this.isAdminLoggedIn) {
      this.notify('admin-login-required');
      return;
    }
    this.currentView = view;
    this.notify('view-changed', view);
  }

  setCategory(category) {
    this.activeCategory = category;
    this.notify('category-changed');
  }

  setSearch(query) {
    this.searchQuery = query.toLowerCase().trim();
    this.notify('search-changed');
  }

  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(current => current !== listener);
    };
  }

  notify(event, payload = null) {
    this.listeners.forEach(listener => {
      try {
        listener(event, payload);
      } catch (error) {
        console.error('Store tinglovchisida xatolik:', error);
      }
    });
  }

  async toggleProductStatus(productId) {
    const product = this.products.find(item => item.id === productId);
    if (!product) throw new Error('Mahsulot topilmadi.');
    const updated = await this.request(`/admin/products/${encodeURIComponent(productId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: product.status === 'mavjud' ? 'tugadi' : 'mavjud' })
    });
    this.replaceProduct(updated);
    if (updated.status === 'tugadi') delete this.cart[productId];
    this.saveCart();
    this.playTone(updated.status === 'mavjud' ? 523.25 : 329.63, 0.15);
    return updated;
  }

  async addProduct(product) {
    const saved = await this.request('/admin/products', {
      method: 'POST',
      body: JSON.stringify(product)
    });
    this.replaceProduct(saved, true);
    this.playOrderChime();
    return saved;
  }

  async updateProduct(id, updateData) {
    const updated = await this.request(`/admin/products/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(updateData)
    });
    this.replaceProduct(updated);
    return updated;
  }

  async deleteProduct(id) {
    await this.request(`/admin/products/${encodeURIComponent(id)}`, { method: 'DELETE' });
    this.products = this.products.filter(product => product.id !== id);
    delete this.cart[id];
    this.saveCart();
    this.notify('products-updated');
  }

  replaceProduct(product, prepend = false) {
    const normalized = normalizeProduct(product);
    const index = this.products.findIndex(current => current.id === normalized.id);
    if (index >= 0) this.products[index] = normalized;
    else if (prepend) this.products.unshift(normalized);
    this.notify('products-updated');
  }

  addToCart(productId, quantity = 1) {
    const product = this.products.find(item => item.id === productId);
    if (!product || product.status !== 'mavjud' || !Number.isInteger(quantity) || quantity < 1) return false;
    const nextQuantity = (this.cart[productId] || 0) + quantity;
    if (nextQuantity > product.stock) {
      this.notify('operation-error', `“${product.name}” uchun omborda ${product.stock} dona qoldi.`);
      return false;
    }

    this.cart[productId] = nextQuantity;
    this.saveCart();
    this.playTone(659.25, 0.1);
    return true;
  }

  decrementCart(productId) {
    if (!this.cart[productId]) return;
    if (this.cart[productId] <= 1) delete this.cart[productId];
    else this.cart[productId] -= 1;
    this.saveCart();
    this.playTone(440, 0.08);
  }

  setCartQuantity(productId, quantity) {
    const product = this.products.find(item => item.id === productId);
    if (!product || !Number.isInteger(quantity) || quantity > product.stock) return;
    if (quantity <= 0) delete this.cart[productId];
    else this.cart[productId] = quantity;
    this.saveCart();
  }

  removeFromCart(productId) {
    if (this.cart[productId]) {
      delete this.cart[productId];
      this.saveCart();
    }
  }

  clearCart() {
    this.cart = {};
    this.saveCart();
  }

  getCartItems() {
    return Object.entries(this.cart).flatMap(([id, quantity]) => {
      const product = this.products.find(item => item.id === id);
      if (!product || product.status !== 'mavjud' || quantity > product.stock) return [];
      return [{ product, quantity, totalPrice: product.price * quantity }];
    });
  }

  getCartSummary() {
    const items = this.getCartItems();
    const count = items.reduce((sum, item) => sum + item.quantity, 0);
    const subtotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
    const serviceFee = Math.round(subtotal * 0.1);
    return { items, count, subtotal, serviceFee, total: subtotal + serviceFee };
  }

  async placeOrder(customerNotes = '', paymentMethod = 'Karta / Payme') {
    const summary = this.getCartSummary();
    if (!summary.items.length) return null;
    const requestBody = {
      table: this.selectedTable,
      guestCount: this.guestCount,
      notes: customerNotes,
      paymentMethod,
      items: summary.items.map(item => ({ id: item.product.id, quantity: item.quantity }))
    };
    const fingerprint = JSON.stringify(requestBody);
    if (!this.pendingOrder || this.pendingOrder.fingerprint !== fingerprint) {
      this.pendingOrder = { key: crypto.randomUUID(), fingerprint };
      localStorage.setItem('samovar_pending_order_v1', JSON.stringify(this.pendingOrder));
    }

    const order = await this.request('/orders', {
      method: 'POST',
      headers: { 'Idempotency-Key': this.pendingOrder.key },
      body: JSON.stringify(requestBody)
    });

    this.pendingOrder = null;
    localStorage.removeItem('samovar_pending_order_v1');
    this.clearCart();
    summary.items.forEach(item => {
      const product = this.products.find(current => current.id === item.product.id);
      if (product) {
        product.stock = Math.max(0, product.stock - item.quantity);
        if (product.stock === 0) product.status = 'tugadi';
      }
    });
    this.notify('products-updated');
    if (this.isAdminLoggedIn) {
      this.orders.unshift(order);
      this.notify('orders-updated');
    }
    this.playOrderChime();
    this.notify('order-placed', order);
    return order;
  }

  async updateOrderStatus(orderId, status) {
    await this.request(`/admin/orders/${encodeURIComponent(orderId)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    await this.refreshOrders();
    this.playTone(587.33, 0.12);
    return this.orders.find(order => order.id === orderId);
  }

  async callWaiter() {
    const waiterCall = await this.request('/waiter-calls', {
      method: 'POST',
      body: JSON.stringify({ table: this.selectedTable, guestCount: this.guestCount })
    });
    this.notify('waiter-call-placed', waiterCall);
    this.playTone(880, 0.2);
    return waiterCall;
  }

  async completeWaiterCall(id) {
    await this.request(`/admin/waiter-calls/${encodeURIComponent(id)}`, { method: 'PATCH' });
    await this.refreshWaiterCalls();
  }

  playTone(frequency, duration = 0.1) {
    try {
      if (!this.audioCtx) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) this.audioCtx = new AudioContext();
      }
      if (!this.audioCtx) return;
      if (this.audioCtx.state === 'suspended') this.audioCtx.resume();

      const oscillator = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(frequency, this.audioCtx.currentTime);
      gain.gain.setValueAtTime(0.12, this.audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + duration);
      oscillator.connect(gain);
      gain.connect(this.audioCtx.destination);
      oscillator.start();
      oscillator.stop(this.audioCtx.currentTime + duration);
    } catch (error) {
      console.warn('Audio xabarnomasi ijro etilmadi:', error);
    }
  }

  playOrderChime() {
    [523.25, 659.25, 783.99, 1046.5].forEach((frequency, index) => {
      setTimeout(() => this.playTone(frequency, 0.25), index * 100);
    });
  }
}

export const store = new SamovarStore();
