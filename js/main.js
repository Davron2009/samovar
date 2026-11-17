import { store } from './store.js';
import { initClientApp, renderClientProducts, renderStickyCartBar, renderCartDrawer, updateTableInfoPill, stopOrderStatusPolling } from './client.js';
import { initAdminApp, renderTopStats, renderAdminSection } from './admin.js';
import { closeThermalReceiptModal } from './receipt.js';
import { closeProductModal } from './admin.js';

let pollingErrorShownAt = 0;

document.addEventListener('DOMContentLoaded', async () => {
  try {
    await store.initialize();
  } catch (error) {
    showStartupError(error);
    return;
  }

  initClientApp();
  initAdminApp();

  // Apply initial view (Default is Client QR Menu)
  applyView(store.currentView);

  // Setup live clock in admin topbar
  startLiveClock();

  // Wire Admin login modal
  setupAdminAuth();

  // Wire global modals
  setupGlobalModals();

  // Subscribe to reactive store changes
  store.subscribe((event, payload) => {
    if (event === 'products-updated') {
      renderClientProducts();
      renderAdminSection();
      renderTopStats();
    } else if (event === 'orders-updated') {
      renderAdminSection();
      renderTopStats();
    } else if (event === 'cart-updated') {
      renderClientProducts();
      renderStickyCartBar();
      renderCartDrawer();
    } else if (event === 'category-changed' || event === 'search-changed') {
      renderClientProducts();
    } else if (event === 'table-guests-updated') {
      updateTableInfoPill();
      renderCartDrawer();
    } else if (event === 'order-placed') {
      showToastNotification(`🔔 Yangi Buyurtma: ${payload.table} (${payload.guestCount} kishi) - ${new Intl.NumberFormat('uz-UZ').format(payload.total)} so'm`);
    } else if (event === 'waiter-call-placed') {
      showToastNotification(`${payload.table} uchun ofitsiant chaqiruvi yuborildi.`);
    } else if (event === 'view-changed') {
      applyView(store.currentView);
    } else if (event === 'operation-error') {
      showToastNotification(payload);
    }
  });

  window.setInterval(() => {
    pollStore(store.refreshProducts);
  }, 15000);
  window.setInterval(() => {
    pollStore(store.refreshOrders);
    pollStore(store.refreshWaiterCalls);
  }, 5000);
});

function pollStore(operation) {
  operation.call(store).then(() => {
    pollingErrorShownAt = 0;
  }).catch(error => {
    if (Date.now() - pollingErrorShownAt > 30000) {
      pollingErrorShownAt = Date.now();
      showToastNotification(error.message);
    }
  });
}

function showStartupError(error) {
  const message = document.createElement('div');
  message.setAttribute('role', 'alert');
  message.style.cssText = 'max-width: 680px; margin: 12vh auto; padding: 24px; border-radius: 12px; background: #fff; color: #7f1d1d; font: 600 16px/1.5 sans-serif; box-shadow: 0 8px 30px #0002;';
  message.textContent = `Ilova serverga ulana olmadi. PostgreSQL va API serverini ishga tushiring. Tafsilot: ${error.message}`;
  document.body.replaceChildren(message);
}

function applyView(view) {
  if (view === 'admin') {
    document.body.classList.add('view-admin');
    renderAdminSection();
    renderTopStats();
  } else {
    document.body.classList.remove('view-admin');
  }
}

function setupAdminAuth() {
  const openLoginBtn = document.getElementById('btn-open-admin-login');
  const loginModal = document.getElementById('admin-login-modal');
  const closeLoginBtn = document.getElementById('btn-close-admin-login');
  const cancelLoginBtn = document.getElementById('btn-cancel-admin-login');
  const exitAdminBtn = document.getElementById('btn-exit-admin');
  const sidebarExitBtn = document.getElementById('btn-sidebar-exit');
  const loginForm = document.getElementById('admin-login-form');
  const authError = document.getElementById('admin-auth-error');

  if (openLoginBtn) {
    openLoginBtn.onclick = () => {
      if (authError) authError.style.display = 'none';
      if (loginModal) loginModal.classList.add('active');
      document.getElementById('admin-username')?.focus();
    };
  }

  if (closeLoginBtn) {
    closeLoginBtn.onclick = () => {
      if (loginModal) loginModal.classList.remove('active');
    };
  }
  if (cancelLoginBtn) {
    cancelLoginBtn.onclick = () => {
      if (loginModal) loginModal.classList.remove('active');
    };
  }

  if (exitAdminBtn) {
    exitAdminBtn.onclick = async () => {
      try {
        await store.logoutAdmin();
        showToastNotification('Mijoz menyusiga qaytildi.');
      } catch (error) {
        showToastNotification(error.message);
      }
    };
  }
  if (sidebarExitBtn && exitAdminBtn) {
    sidebarExitBtn.onclick = () => exitAdminBtn.click();
  }

  if (loginForm) {
    loginForm.onsubmit = async event => {
      event.preventDefault();
      if (authError) authError.style.display = 'none';
      const username = document.getElementById('admin-username').value.trim();
      const password = document.getElementById('admin-password').value;
      const submit = document.getElementById('btn-submit-admin-login');
      if (submit) submit.disabled = true;

      try {
        await store.loginAdmin(username, password);
        const displayName = document.getElementById('admin-display-name');
        const avatar = document.getElementById('admin-avatar');
        if (displayName) displayName.textContent = store.adminUsername;
        if (avatar) avatar.textContent = store.adminUsername
          .split(/[\s._-]+/)
          .filter(Boolean)
          .slice(0, 2)
          .map(part => part[0].toUpperCase())
          .join('');
        loginForm.reset();
        if (loginModal) loginModal.classList.remove('active');
        showToastNotification('Xush kelibsiz, administrator.');
      } catch (error) {
        if (authError) {
          authError.textContent = error.message;
          authError.style.display = 'block';
        }
      } finally {
        if (submit) submit.disabled = false;
      }
    };
  }

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && loginModal?.classList.contains('active')) {
      loginModal.classList.remove('active');
    }
  });
}

function setupGlobalModals() {
  // Thermal receipt modal close
  const closeReceiptBtn = document.getElementById('btn-close-receipt-modal');
  const closeReceiptFooterBtn = document.getElementById('btn-close-receipt-footer');
  const receiptOverlay = document.getElementById('thermal-receipt-modal');
  if (closeReceiptBtn) closeReceiptBtn.onclick = closeThermalReceiptModal;
  if (closeReceiptFooterBtn) closeReceiptFooterBtn.onclick = closeThermalReceiptModal;
  if (receiptOverlay) {
    receiptOverlay.onclick = (e) => {
      if (e.target === receiptOverlay) closeThermalReceiptModal();
    };
  }

  // Product modal close
  const closeProdBtn = document.getElementById('btn-close-product-modal');
  const cancelProdBtn = document.getElementById('btn-cancel-product-modal');
  const prodOverlay = document.getElementById('product-modal');
  if (closeProdBtn) closeProdBtn.onclick = closeProductModal;
  if (cancelProdBtn) cancelProdBtn.onclick = closeProductModal;
  if (prodOverlay) {
    prodOverlay.onclick = (e) => {
      if (e.target === prodOverlay) closeProductModal();
    };
  }

  // Order status modal close
  const orderModal = document.getElementById('order-status-modal');
  const closeOrderBtn = document.getElementById('btn-close-order-modal');
  const dismissOrderBtn = document.getElementById('btn-dismiss-order-modal');
  if (closeOrderBtn && orderModal) {
    closeOrderBtn.onclick = () => {
      orderModal.classList.remove('active');
      stopOrderStatusPolling();
    };
  }
  if (dismissOrderBtn && orderModal) {
    dismissOrderBtn.onclick = () => {
      orderModal.classList.remove('active');
      stopOrderStatusPolling();
    };
  }
  if (orderModal) {
    orderModal.onclick = (e) => {
      if (e.target === orderModal) {
        orderModal.classList.remove('active');
        stopOrderStatusPolling();
      }
    };
  }
}

function startLiveClock() {
  const clockEl = document.getElementById('admin-live-clock');
  const update = () => {
    if (!clockEl) return;
    const now = new Date();
    const timeStr = now.toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const dateStr = now.toLocaleDateString('uz-UZ', { day: '2-digit', month: 'short', year: 'numeric' });
    clockEl.textContent = `🕒 ${timeStr} • ${dateStr}`;
  };
  update();
  setInterval(update, 1000);
}

export function showToastNotification(message) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  const icon = document.createElement('span');
  icon.style.fontSize = '1.2rem';
  icon.textContent = '✨';
  const text = document.createElement('span');
  text.textContent = message;
  toast.append(icon, text);

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4500);
}
