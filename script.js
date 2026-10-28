// Firebase SDK のインポート
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  doc,
  deleteDoc,
  updateDoc,
  query,
  where,
  orderBy,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js";

// 💡 別ファイルから設定を読み込む！
import { firebaseConfig } from "./firebase-config.js";

// Firebase 初期化
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// アプリ内で保持するカテゴリ
let currentCategories = [];

// 状態管理
let currentUser = null;
let currentYearMonth = getInitialYearMonth();
let expensesData = [];
let customCategoriesData = [];
let incomesData = [];
let categoryChart = null;
let unsubExpenses = null;
let unsubCategories = null;
let unsubIncomes = null;
let balanceTrendChart = null; // 月別収支グラフ用

// DOM要素
const navHomeBtn = document.getElementById("nav-home-btn");
const navReportBtn = document.getElementById("nav-report-btn");
const navSettingsBtn = document.getElementById("nav-settings-btn");
const homeView = document.getElementById("home-view");
const reportView = document.getElementById("report-view");
const settingsView = document.getElementById("settings-view");

const currentMonthLabel = document.getElementById("current-month-label");
const summaryMonthText = document.getElementById("summary-month-text");
const prevMonthBtn = document.getElementById("prev-month-btn");
const nextMonthBtn = document.getElementById("next-month-btn");
const totalAmountEl = document.getElementById("total-amount");
const categoryListEl = document.getElementById("category-list");
const historyListEl = document.getElementById("history-list");
const historyTitleEl = document.getElementById("history-title");

const expenseForm = document.getElementById("expense-form");
const dateInput = document.getElementById("date");
const amountInput = document.getElementById("amount");
const categorySelect = document.getElementById("category");
const memoInput = document.getElementById("memo");

// 収入関連のDOM要素
const totalIncomeEl = document.getElementById("total-income");
const totalBalanceEl = document.getElementById("total-balance");
const openIncomeModalBtn = document.getElementById("open-income-modal-btn");
const incomeModal = document.getElementById("income-modal");
const incomeForm = document.getElementById("income-form");
const incomeAmountInput = document.getElementById("income-amount-input");
const cancelIncomeBtn = document.getElementById("cancel-income-btn");

// カテゴリ追加フォーム用
const categoryForm = document.getElementById("category-form");
const newCategoryNameInput = document.getElementById("new-category-name");
const customCategoryListEl = document.getElementById("custom-category-list");

// モーダル関連
const editModal = document.getElementById("edit-modal");
const editForm = document.getElementById("edit-form");
const editIdInput = document.getElementById("edit-id");
const editDateInput = document.getElementById("edit-date");
const editAmountInput = document.getElementById("edit-amount");
const editCategorySelect = document.getElementById("edit-category");
const editMemoInput = document.getElementById("edit-memo");
const cancelEditBtn = document.getElementById("cancel-edit");

// レポート用のDOM要素
const reportCategorySelect = document.getElementById("report-category-select");
const reportSelectedCatName = document.getElementById("report-selected-cat-name");
const reportHistoryListEl = document.getElementById("report-history-list");
const reportHistoryTitleEl = document.getElementById("report-history-title");
let reportChart = null;

// ▼ 固定費用のDOM要素 ＆ 変数
const fixedExpenseForm = document.getElementById("fixed-expense-form");
const fixedNameInput = document.getElementById("fixed-name");
const fixedAmountInput = document.getElementById("fixed-amount");
const fixedExpenseListEl = document.getElementById("fixed-expense-list");
let fixedExpensesData = [];
let unsubFixedExpenses = null;

const reportYearSelect = document.getElementById("report-year-select");

// ==========================================
// 1. 初期化 ＆ 認証
// ==========================================
window.addEventListener("DOMContentLoaded", () => {
  dateInput.value = getTodayDateString();
  updateMonthLabel();

  if (prevMonthBtn) prevMonthBtn.addEventListener("click", () => changeMonth(-1));
  if (nextMonthBtn) nextMonthBtn.addEventListener("click", () => changeMonth(1));

  if (openIncomeModalBtn) openIncomeModalBtn.addEventListener("click", openIncomeModal);
  if (cancelIncomeBtn) cancelIncomeBtn.addEventListener("click", closeIncomeModal);
  if (incomeForm) incomeForm.addEventListener("submit", handleSaveIncome);

  if (navHomeBtn) navHomeBtn.addEventListener("click", () => switchView("home"));
  if (navReportBtn) navReportBtn.addEventListener("click", () => {
    switchView("report");
    updateReportCategorySelect();
    updateReportView();
  });
  if (navSettingsBtn) navSettingsBtn.addEventListener("click", () => switchView("settings"));

  if (reportCategorySelect) {
    reportCategorySelect.addEventListener("change", () => {
      updateReportView();
    });
  }

  signInAnonymously(auth)
    .then(() => { console.log("匿名ログイン成功"); })
    .catch((error) => { console.error("ログインエラー:", error); });

  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentUser = user;
      setupRealtimeListeners();
    } else {
      currentUser = null;
    }
  });

  expenseForm.addEventListener("submit", handleAddExpense);
  categoryForm.addEventListener("submit", handleAddCategory);
  fixedExpenseForm.addEventListener("submit", handleAddFixedExpense);
  editForm.addEventListener("submit", handleUpdateExpense);
  cancelEditBtn.addEventListener("click", closeModal);

  if (reportYearSelect) {
    reportYearSelect.addEventListener("change", () => {
      updateReportView();
    });
  }
});

function switchView(viewName) {
  navHomeBtn.classList.remove("active");
  navReportBtn.classList.remove("active");
  navSettingsBtn.classList.remove("active");
  homeView.classList.remove("active");
  reportView.classList.remove("active");
  settingsView.classList.remove("active");

  if (viewName === "home") {
    navHomeBtn.classList.add("active");
    homeView.classList.add("active");
  } else if (viewName === "report") {
    navReportBtn.classList.add("active");
    reportView.classList.add("active");
  } else if (viewName === "settings") {
    navSettingsBtn.classList.add("active");
    settingsView.classList.add("active");
  }
}

// ==========================================
// 2. Firestore データ同期の設定
// ==========================================
function setupRealtimeListeners() {
  if (!currentUser) return;

  if (unsubExpenses) unsubExpenses();
  if (unsubCategories) unsubCategories();
  if (unsubIncomes) unsubIncomes();
  if (unsubFixedExpenses) unsubFixedExpenses();

  // ① カテゴリの監視（order順に並び替え）
  const categoriesRef = collection(db, "users", currentUser.uid, "categories");
  unsubCategories = onSnapshot(categoriesRef, async (snapshot) => {
    let tempCategories = [];
    snapshot.forEach((docSnap) => {
      tempCategories.push({ id: docSnap.id, ...docSnap.data() });
    });

    if (tempCategories.length === 0) {
      const defaultInitialCategories = ["食費", "外食", "日用品", "その他"];
      for (let i = 0; i < defaultInitialCategories.length; i++) {
        await addDoc(categoriesRef, {
          name: defaultInitialCategories[i],
          order: i,
          createdAt: new Date().toISOString()
        });
      }
      return;
    }

    tempCategories.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    customCategoriesData = tempCategories;
    currentCategories = customCategoriesData.map(c => c.name);

    updateCategorySelects();
    renderCustomCategoryList();
    updateReportCategorySelect();
  });

  // ② 支出データの監視
  const expensesRef = collection(db, "users", currentUser.uid, "expenses");
  const q = query(expensesRef, orderBy("date", "desc"));

  unsubExpenses = onSnapshot(q, (snapshot) => {
    expensesData = [];
    snapshot.forEach((docSnap) => {
      expensesData.push({ id: docSnap.id, ...docSnap.data() });
    });
    updateUI();
  });

  // ③ 収入データの監視
  const incomesRef = collection(db, "users", currentUser.uid, "incomes");
  unsubIncomes = onSnapshot(incomesRef, (snapshot) => {
    incomesData = [];
    snapshot.forEach((docSnap) => {
      incomesData.push({ id: docSnap.id, ...docSnap.data() });
    });
    updateUI();
  });

  // ④ 固定費データのリアルタイム監視
  const fixedRef = collection(db, "users", currentUser.uid, "fixed_expenses");
  unsubFixedExpenses = onSnapshot(fixedRef, (snapshot) => {
    fixedExpensesData = [];
    snapshot.forEach((docSnap) => {
      fixedExpensesData.push({ id: docSnap.id, ...docSnap.data() });
    });
    renderFixedExpenseList();
    updateUI();
  });
}

// ==========================================
// 3. カテゴリ管理 ＆ ドラッグ並び替え機能
// ==========================================
async function handleAddCategory(e) {
  e.preventDefault();
  if (!currentUser) return;

  const categoryName = newCategoryNameInput.value.trim();
  if (!categoryName) return;

  if (currentCategories.includes(categoryName)) {
    alert("すでに存在するカテゴリです。");
    return;
  }

  try {
    const categoriesRef = collection(db, "users", currentUser.uid, "categories");
    await addDoc(categoriesRef, {
      name: categoryName,
      order: customCategoriesData.length,
      createdAt: new Date().toISOString()
    });
    newCategoryNameInput.value = "";
  } catch (error) {
    console.error("カテゴリ追加失敗:", error);
    alert("カテゴリの追加に失敗しました。");
  }
}

async function handleDeleteCategory(categoryId, categoryName) {
  if (!currentUser) return;
  if (confirm(`カテゴリ「${categoryName}」を削除しますか？`)) {
    try {
      const docRef = doc(db, "users", currentUser.uid, "categories", categoryId);
      await deleteDoc(docRef);
    } catch (error) {
      console.error("カテゴリ削除失敗:", error);
      alert("削除に失敗しました。");
    }
  }
}

async function saveNewCategoryOrder(newOrderedIds) {
  if (!currentUser) return;
  try {
    const batchPromises = newOrderedIds.map((id, newIndex) => {
      const docRef = doc(db, "users", currentUser.uid, "categories", id);
      return updateDoc(docRef, { order: newIndex });
    });
    await Promise.all(batchPromises);
  } catch (error) {
    console.error("並び替えの保存に失敗:", error);
    alert("並び替えの保存に失敗しました。");
  }
}

function renderCustomCategoryList() {
  if (!customCategoryListEl) return;
  customCategoryListEl.innerHTML = "";

  if (customCategoriesData.length === 0) {
    customCategoryListEl.innerHTML = `<p style="text-align: center; color: #888; font-size: 0.85rem;">カテゴリがありません</p>`;
    return;
  }

  customCategoriesData.forEach((cat, index) => {
    const item = document.createElement("div");
    item.className = "category-item";

    item.setAttribute("draggable", "true");
    item.dataset.id = cat.id;
    item.style.cursor = "grab";
    item.style.userSelect = "none";
    item.style.transition = "background-color 0.2s";

    item.innerHTML = `
      <div class="category-item-left" style="display: flex; align-items: center; gap: 8px;">
        <span style="color: #cbd5e1; font-weight: bold; cursor: grab;">☰</span>
        <span>${escapeHTML(cat.name)}</span>
      </div>
      <div>
        <button type="button" class="btn-delete" data-id="${cat.id}" data-name="${escapeHTML(cat.name)}">削除</button>
      </div>
    `;

    item.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", cat.id);
      item.style.opacity = "0.4";
    });

    item.addEventListener("dragend", () => {
      item.style.opacity = "1";
      const rows = customCategoryListEl.querySelectorAll(".category-item");
      const newOrderedIds = Array.from(rows).map(row => row.dataset.id);
      saveNewCategoryOrder(newOrderedIds);
    });

    item.addEventListener("dragover", (e) => {
      e.preventDefault();
      const draggingItem = customCategoryListEl.querySelector("[style*='opacity: 0.4']");
      if (!draggingItem || draggingItem === item) return;

      const rect = item.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;

      if (e.clientY < midpoint) {
        customCategoryListEl.insertBefore(draggingItem, item);
      } else {
        customCategoryListEl.insertBefore(draggingItem, item.nextSibling);
      }
    });

    item.querySelector(".btn-delete").addEventListener("click", () => {
      handleDeleteCategory(cat.id, cat.name);
    });

    customCategoryListEl.appendChild(item);
  });
}

function updateCategorySelects() {
  const selects = [categorySelect, editCategorySelect];
  selects.forEach((select) => {
    if (!select) return;
    const currentValue = select.value;
    select.innerHTML = "";
    currentCategories.forEach((cat) => {
      const option = document.createElement("option");
      option.value = cat;
      option.textContent = cat;
      select.appendChild(option);
    });
    if (currentCategories.includes(currentValue)) {
      select.value = currentValue;
    }
  });
}

// ==========================================
// 4. 支出データの追加・編集・削除
// ==========================================
async function handleAddExpense(e) {
  e.preventDefault();
  if (!currentUser) return;

  const newExpense = {
    date: dateInput.value,
    amount: Number(amountInput.value),
    category: categorySelect.value,
    memo: memoInput.value.trim(),
    createdAt: new Date().toISOString()
  };

  try {
    const expensesRef = collection(db, "users", currentUser.uid, "expenses");
    await addDoc(expensesRef, newExpense);
    amountInput.value = "";
    memoInput.value = "";
    dateInput.value = getTodayDateString();
  } catch (error) {
    console.error("データ追加エラー:", error);
    alert("データの追加に失敗しました。");
  }
}

async function handleDeleteExpense(id) {
  if (!currentUser) return;
  if (confirm("この記録を削除しますか？")) {
    try {
      const docRef = doc(db, "users", currentUser.uid, "expenses", id);
      await deleteDoc(docRef);
    } catch (error) {
      console.error("削除エラー:", error);
      alert("削除に失敗しました。");
    }
  }
}

function openEditModal(expense) {
  editIdInput.value = expense.id;
  editDateInput.value = expense.date;
  editAmountInput.value = expense.amount;
  editCategorySelect.value = expense.category;
  editMemoInput.value = expense.memo || "";
  editModal.classList.add("active");
}

function closeModal() {
  editModal.classList.remove("active");
}

async function handleUpdateExpense(e) {
  e.preventDefault();
  if (!currentUser) return;

  const id = editIdInput.value;
  const updatedData = {
    date: editDateInput.value,
    amount: Number(editAmountInput.value),
    category: editCategorySelect.value,
    memo: editMemoInput.value.trim()
  };

  try {
    const docRef = doc(db, "users", currentUser.uid, "expenses", id);
    await updateDoc(docRef, updatedData);
    closeModal();
  } catch (error) {
    console.error("更新エラー:", error);
    alert("更新に失敗しました。");
  }
}

// ==========================================
// 5. 収入モーダル＆管理機能
// ==========================================
function openIncomeModal() {
  const currentIncome = incomesData.find(item => item.yearMonth === currentYearMonth);
  incomeAmountInput.value = currentIncome ? currentIncome.amount : "";
  incomeModal.classList.add("active");
}

function closeIncomeModal() {
  incomeModal.classList.remove("active");
}

async function handleSaveIncome(e) {
  e.preventDefault();
  if (!currentUser) return;

  const amount = Number(incomeAmountInput.value);

  // 💡 マイナス金額の入力をチェックしてブロック！
  if (amount < 0) {
    alert("収入には0以上の金額を入力してください。");
    return;
  }

  const incomesRef = collection(db, "users", currentUser.uid, "incomes");
  const existingIncome = incomesData.find(item => item.yearMonth === currentYearMonth);

  try {
    if (existingIncome) {
      const docRef = doc(db, "users", currentUser.uid, "incomes", existingIncome.id);
      await updateDoc(docRef, { amount: amount });
    } else {
      await addDoc(incomesRef, {
        yearMonth: currentYearMonth,
        amount: amount,
        createdAt: new Date().toISOString()
      });
    }
    closeIncomeModal();
  } catch (error) {
    console.error("収入保存エラー:", error);
    alert("収入の保存に失敗しました。");
  }
}

// ==========================================
// 6. 画面描画 ＆ 集計ロジック
// ==========================================
function updateUI() {
  const filteredExpenses = expensesData.filter(item => {
    return item.date.startsWith(currentYearMonth);
  });

  // 1. 通常の支出の合計
  const expensesTotal = filteredExpenses.reduce((sum, item) => sum + item.amount, 0);

  // 💡 2. 今月の収入を取得
  const currentIncomeObj = incomesData.find(item => item.yearMonth === currentYearMonth);
  const totalIncome = currentIncomeObj ? currentIncomeObj.amount : 0;

  // 💡 3. 【重要】収入が未設定（0円）の場合は、固定費を「今月の総支出」に含めないようにする
  // （※収入が入力されて初めて固定費が合算される仕組みにします）
  const fixedTotal = (totalIncome > 0) ? fixedExpensesData.reduce((sum, item) => sum + item.amount, 0) : 0;

  // 総支出（収入がない月は通常の支出のみ、収入がある月は固定費も合算）
  const totalAmount = expensesTotal + fixedTotal;

  totalAmountEl.textContent = `￥${totalAmount.toLocaleString()}`;
  totalIncomeEl.textContent = `￥${totalIncome.toLocaleString()}`;

  const totalBalance = totalIncome - totalAmount;
  const summaryCardEl = document.querySelector(".summary-card");

  // 💡 4. 収入が未設定（0円）のときの表示制御
  if (totalIncome === 0) {
    totalBalanceEl.textContent = `収入の未設定`;
    totalBalanceEl.style.color = "#94a3b8"; // 落ち着いたグレー文字
    if (summaryCardEl) {
      summaryCardEl.classList.remove("danger-card", "success-card");
    }
  } else if (totalBalance < 0) {
    totalBalanceEl.textContent = `￥-${Math.abs(totalBalance).toLocaleString()}`;
    totalBalanceEl.style.color = "#ef4444"; // 赤字
    if (summaryCardEl) {
      summaryCardEl.classList.add("danger-card");
      summaryCardEl.classList.remove("success-card");
    }
  } else {
    totalBalanceEl.textContent = `￥+${totalBalance.toLocaleString()}`;
    totalBalanceEl.style.color = "#166534"; // 黒字（グリーン）
    if (summaryCardEl) {
      summaryCardEl.classList.remove("danger-card");
      summaryCardEl.classList.add("success-card");
    }
  }

  renderHistoryList(filteredExpenses);

  // 💡 収入が未設定（0円）のときは、カテゴリ別内訳と円グラフを表示しない
  if (totalIncome > 0) {
    renderCategoryBreakdown(filteredExpenses, totalAmount);
  } else {
    // 収入が未設定のときはリストを空にして、グラフをクリアする
    if (categoryListEl) categoryListEl.innerHTML = `<p style="text-align: center; color: #888; font-size: 0.85rem; padding: 15px;">収入を設定すると内訳とグラフが表示されます</p>`;
    if (categoryChart) {
      categoryChart.destroy();
      categoryChart = null;
    }
  }

  updateReportView();
}

function renderHistoryList(expenses) {
  historyListEl.innerHTML = "";
  if (expenses.length === 0) {
    historyListEl.innerHTML = `<p style="text-align: center; color: #888; padding: 20px 0;">この月の記録はありません</p>`;
    return;
  }

  expenses.forEach((item) => {
    const historyItem = document.createElement("div");
    historyItem.className = "history-item";
    const memoHtml = item.memo ? `<span class="history-memo">${escapeHTML(item.memo)}</span>` : "";

    historyItem.innerHTML = `
      <div class="history-info">
        <div class="history-date">${escapeHTML(item.date)}</div>
        <div class="history-main-row">
          <span class="history-category">${escapeHTML(item.category)}</span>
          ${memoHtml}
        </div>
      </div>
      <div class="history-right">
        <div class="history-amount">￥${item.amount.toLocaleString()}</div>
        <div class="history-actions">
          <button class="btn-edit" data-id="${item.id}">編集</button>
          <button class="btn-delete" data-id="${item.id}">削除</button>
        </div>
      </div>
    `;

    historyItem.querySelector(".btn-edit").addEventListener("click", () => openEditModal(item));
    historyItem.querySelector(".btn-delete").addEventListener("click", () => handleDeleteExpense(item.id));
    historyListEl.appendChild(historyItem);
  });
}

function renderCategoryBreakdown(expenses, totalAmount) {
  // 1. まず通常のカテゴリごとの合計を計算
  const categoryTotals = {};
  currentCategories.forEach(cat => {
    categoryTotals[cat] = 0;
  });

  expenses.forEach(item => {
    if (categoryTotals[item.category] !== undefined) {
      categoryTotals[item.category] += item.amount;
    } else {
      categoryTotals[item.category] = item.amount;
    }
  });

  // 💡 2. 【追加】登録されている固定費の合計を計算し、「固定費」というカテゴリとしてまとめる
  const fixedTotal = fixedExpensesData.reduce((sum, item) => sum + item.amount, 0);
  if (fixedTotal > 0) {
    categoryTotals["固定費"] = fixedTotal;
  }

  // 💡 3. 通常のカテゴリ一覧に「固定費」も含めた全カテゴリのリストを作成
  const allCategoriesToDisplay = [...currentCategories];
  if (fixedTotal > 0 && !allCategoriesToDisplay.includes("固定費")) {
    allCategoriesToDisplay.push("固定費");
  }

  const activeCategories = allCategoriesToDisplay
    .map(cat => ({ name: cat, amount: categoryTotals[cat] || 0 }))
    .filter(item => item.amount > 0);

  categoryListEl.innerHTML = "";
  const backgroundColors = [
    "#3498db", "#e74c3c", "#2ecc71", "#f1c40f",
    "#9b59b6", "#1abc9c", "#e67e22", "#34495e", "#95a5a6", "#e84393"
  ];

  activeCategories.forEach((cat, index) => {
    const percentage = totalAmount > 0 ? ((cat.amount / totalAmount) * 100).toFixed(1) : 0;
    const color = backgroundColors[index % backgroundColors.length];

    const row = document.createElement("div");
    row.className = "category-item";
    row.innerHTML = `
      <div class="category-item-left">
        <div class="category-color-box" style="background-color: ${color};"></div>
        <span>${escapeHTML(cat.name)}</span>
      </div>
      <div class="category-item-right">
        <span>￥${cat.amount.toLocaleString()}</span>
        <span class="category-percentage">(${percentage}%)</span>
      </div>
    `;
    categoryListEl.appendChild(row);
  });

  renderChart(activeCategories, backgroundColors);
}

function renderChart(activeCategories, colors) {
  const ctx = document.getElementById("category-chart").getContext("2d");
  const labels = activeCategories.map(item => item.name);
  const data = activeCategories.map(item => item.amount);
  const chartColors = activeCategories.map((_, i) => colors[i % colors.length]);

  if (categoryChart) {
    categoryChart.destroy();
  }

  categoryChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: data,
        backgroundColor: chartColors,
        borderWidth: 1
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        datalabels: {
          color: '#fff',
          font: { weight: 'bold', size: 11 },
          formatter: (value, ctx) => {
            const sum = ctx.dataset.data.reduce((a, b) => a + b, 0);
            const percentage = (value * 100 / sum).toFixed(1);
            return percentage > 4 ? `${percentage}%` : '';
          }
        }
      }
    },
    plugins: [ChartDataLabels]
  });
}

// ==========================================
// 7. ユーティリティ関数
// ==========================================
function getInitialYearMonth() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

function getTodayDateString() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function updateMonthLabel() {
  if (currentMonthLabel) {
    const [year, month] = currentYearMonth.split('-');
    currentMonthLabel.textContent = `${year}年${Number(month)}月`;
  }
  if (summaryMonthText) {
    const [, month] = currentYearMonth.split('-');
    summaryMonthText.textContent = `${Number(month)}月`;
  }
}

function changeMonth(direction) {
  const [year, month] = currentYearMonth.split('-').map(Number);
  const date = new Date(year, month - 1 + direction, 1);
  const newYear = date.getFullYear();
  const newMonth = String(date.getMonth() + 1).padStart(2, '0');
  currentYearMonth = `${newYear}-${newMonth}`;
  updateMonthLabel();
  updateUI();
}

function escapeHTML(str) {
  return str.replace(/[&'`"<>]/g, (match) => {
    return {
      '&': '&amp;',
      "'": '&#x27;',
      '`': '&#x60;',
      '"': '&quot;',
      '<': '&lt;',
      '>': '&gt;',
    }[match];
  });
}

// ==========================================
// 📊 レポート機能（選択式・月別推移）
// ==========================================
function updateReportCategorySelect() {
  if (!reportCategorySelect) return;
  const currentVal = reportCategorySelect.value;
  reportCategorySelect.innerHTML = "";

  currentCategories.forEach((cat) => {
    const option = document.createElement("option");
    option.value = cat;
    option.textContent = cat;
    reportCategorySelect.appendChild(option);
  });

  if (currentCategories.includes(currentVal)) {
    reportCategorySelect.value = currentVal;
  }
}

function updateReportView() {
  if (!reportCategorySelect) return;
  updateReportYearSelect(); // 年の選択肢を最新に更新

  const selectedYear = reportYearSelect ? reportYearSelect.value : String(new Date().getFullYear());
  const selectedCategory = reportCategorySelect.value || currentCategories[0];
  if (reportSelectedCatName) {
    reportSelectedCatName.textContent = selectedCategory;
  }

  // 選ばれた年の「1月〜12月」の12ヶ月分の配列を作成
  const months = [];
  for (let m = 1; m <= 12; m++) {
    const monthStr = String(m).padStart(2, '0');
    months.push(`${selectedYear}-${monthStr}`);
  }

  // 1. カテゴリ別の月別データ（12ヶ月分）
  const monthlyData = months.map(ym => {
    const matched = expensesData.filter(item => item.date.startsWith(ym) && item.category === selectedCategory);
    const total = matched.reduce((sum, item) => sum + item.amount, 0);
    return { ym, total };
  });

  const labels = months.map(ym => `${Number(ym.split('-')[1])}月`);
  const monthlyTotals = monthlyData.map(d => d.total);

  renderReportChart(labels, monthlyTotals, selectedCategory);
  renderReportMonthlySummary(monthlyData, selectedCategory);

  // 2. 💡 月別収支（貯金額）の推移（折れ線グラフ）も連動して更新！
  updateBalanceTrendView(selectedYear, months);
}

function renderReportChart(labels, data, categoryName) {
  const ctx = document.getElementById("report-chart");
  if (!ctx) return;

  if (reportChart) {
    reportChart.destroy();
  }

  reportChart = new Chart(ctx.getContext("2d"), {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: categoryName,
        data: data,
        backgroundColor: '#3498db',
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function (value) {
              return '￥' + value.toLocaleString();
            }
          }
        }
      }
    }
  });
}

function renderReportMonthlySummary(monthlyData, categoryName) {
  if (!reportHistoryListEl) return;
  reportHistoryListEl.innerHTML = "";

  if (reportHistoryTitleEl) {
    reportHistoryTitleEl.textContent = `「${categoryName}」の月別合計一覧`;
  }

  const reversedData = [...monthlyData].reverse();

  reversedData.forEach(item => {
    const [y, m] = item.ym.split('-');
    const row = document.createElement("div");
    row.className = "category-item";
    row.innerHTML = `
      <div class="category-item-left">
        <span>${y}年${Number(m)}月</span>
      </div>
      <div class="category-item-right">
        <span>￥${item.total.toLocaleString()}</span>
      </div>
    `;
    reportHistoryListEl.appendChild(row);
  });
}

// ==========================================
// 💡 固定費の管理・描画機能
// ==========================================
async function handleAddFixedExpense(e) {
  e.preventDefault();
  if (!currentUser) return;

  (async () => {
    const name = fixedNameInput.value.trim();
    const amount = Number(fixedAmountInput.value);
    if (!name || !amount) return;

    try {
      const fixedRef = collection(db, "users", currentUser.uid, "fixed_expenses");
      await addDoc(fixedRef, {
        name: name,
        amount: amount,
        createdAt: new Date().toISOString()
      });
      fixedNameInput.value = "";
      fixedAmountInput.value = "";
    } catch (error) {
      console.error("固定費の追加に失敗:", error);
      alert("固定費の追加に失敗しました。");
    }
  })();
}

async function handleDeleteFixedExpense(id, name) {
  if (!currentUser) return;
  if (confirm(`固定費「${name}」を削除しますか？`)) {
    try {
      const docRef = doc(db, "users", currentUser.uid, "fixed_expenses", id);
      await deleteDoc(docRef);
    } catch (error) {
      console.error("固定費の削除に失敗:", error);
      alert("削除に失敗しました。");
    }
  }
}

function renderFixedExpenseList() {
  if (!fixedExpenseListEl) return;
  fixedExpenseListEl.innerHTML = "";

  if (fixedExpensesData.length === 0) {
    fixedExpenseListEl.innerHTML = `<p style="text-align: center; color: #888; font-size: 0.85rem; padding: 10px;">登録されている固定費はありません</p>`;
    return;
  }

  fixedExpensesData.forEach((item) => {
    const row = document.createElement("div");
    row.className = "category-item";
    row.innerHTML = `
      <div class="category-item-left">
        <span>${escapeHTML(item.name)}</span>
      </div>
      <div class="category-item-right">
        <span>￥${item.amount.toLocaleString()}</span>
        <button type="button" class="btn-delete" data-id="${item.id}" data-name="${escapeHTML(item.name)}">削除</button>
      </div>
    `;
    row.querySelector(".btn-delete").addEventListener("click", () => {
      handleDeleteFixedExpense(item.id, item.name);
    });
    fixedExpenseListEl.appendChild(row);
  });
}

// ==========================================
// 📈 月別収支（貯金額）の推移レポート機能
// ==========================================
function updateBalanceTrendView(targetYear, months) {
  // 年が指定されていない場合は今年の12ヶ月分を作成
  if (!months) {
    months = [];
    for (let m = 1; m <= 12; m++) {
      months.push(`${targetYear}-${String(m).padStart(2, '0')}`);
    }
  }

  const balanceData = months.map(ym => {
    const incomeObj = incomesData.find(item => item.yearMonth === ym);
    const income = incomeObj ? incomeObj.amount : 0;

    const matchedExpenses = expensesData.filter(item => item.date.startsWith(ym));
    const expensesTotal = matchedExpenses.reduce((sum, item) => sum + item.amount, 0);

    const fixedTotal = fixedExpensesData.reduce((sum, item) => sum + item.amount, 0);
    const totalExpense = expensesTotal + fixedTotal;

    const balance = income > 0 ? income - totalExpense : 0;
    const hasIncome = income > 0;

    return { ym, balance, income, totalExpense, hasIncome };
  });

  // 💡 【追加】1年間の収支（貯金額）の合計を計算
  const yearlyTotal = balanceData.reduce((sum, item) => {
    return sum + (item.hasIncome ? item.balance : 0);
  }, 0);

  // 💡 年間総貯金額カードの表示と背景色を更新
  const yearDisplayEl = document.getElementById("report-year-display");
  const yearlyTotalEl = document.getElementById("yearly-total-balance");
  const yearlyCardEl = document.querySelector(".yearly-total-card"); // 年間総貯金額のカード要素

  if (yearDisplayEl) yearDisplayEl.textContent = targetYear;
  if (yearlyTotalEl && yearlyCardEl) {
    if (yearlyTotal >= 0) {
      yearlyTotalEl.textContent = `￥+${yearlyTotal.toLocaleString()}`;
      yearlyTotalEl.style.color = "#166534"; // プラスなら緑文字
      yearlyCardEl.classList.remove("danger-card");
      yearlyCardEl.classList.add("success-card");
    } else {
      yearlyTotalEl.textContent = `￥-${Math.abs(yearlyTotal).toLocaleString()}`;
      yearlyTotalEl.style.color = "#ef4444"; // マイナスなら赤文字
      yearlyCardEl.classList.add("danger-card");
      yearlyCardEl.classList.remove("success-card");
    }
  }

  const labels = months.map(ym => `${Number(ym.split('-')[1])}月`);
  const balanceTotals = balanceData.map(d => d.hasIncome ? d.balance : 0);

  renderBalanceTrendChart(labels, balanceTotals);
  renderBalanceTrendSummary(balanceData, `${targetYear}年 月別収支（貯金額）の推移`);
}

function renderBalanceTrendChart(labels, data) {
  const ctx = document.getElementById("balance-trend-chart");
  if (!ctx) return;

  if (balanceTrendChart) {
    balanceTrendChart.destroy();
  }

  balanceTrendChart = new Chart(ctx.getContext("2d"), {
    type: 'line', // 💡 折れ線グラフを指定！
    data: {
      labels: labels,
      datasets: [{
        label: '月別収支（貯金額）',
        data: data,
        borderColor: '#2ecc71', // 落ち着いたグリーン（貯金・プラスのイメージ）
        backgroundColor: 'rgba(46, 204, 113, 0.1)',
        borderWidth: 3,
        tension: 0.2, // 緩やかな曲線にする
        fill: true
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          ticks: {
            callback: function (value) {
              return '￥' + value.toLocaleString();
            }
          }
        }
      }
    }
  });
}

function renderBalanceTrendSummary(balanceData, titleText) {
  const listEl = document.getElementById("balance-trend-list");
  const titleEl = document.getElementById("balance-trend-title");

  if (titleEl && titleText) {
    titleEl.textContent = titleText;
  }

  if (!listEl) return;
  listEl.innerHTML = "";

  const reversedData = [...balanceData].reverse();

  reversedData.forEach(item => {
    const [y, m] = item.ym.split('-');
    const row = document.createElement("div");
    row.className = "category-item";

    let balanceText = "未設定";
    let textColor = "#888";

    if (item.hasIncome) {
      balanceText = `￥${item.balance.toLocaleString()}`;
      textColor = item.balance >= 0 ? "#166534" : "#ef4444"; // プラスなら緑、マイナスなら赤
    }

    row.innerHTML = `
      <div class="category-item-left">
        <span>${y}年${Number(m)}月</span>
      </div>
      <div class="category-item-right">
        <span style="font-weight: bold; color: ${textColor};">${balanceText}</span>
      </div>
    `;
    listEl.appendChild(row);
  });
}

function updateReportYearSelect() {
  if (!reportYearSelect) return;
  const currentVal = reportYearSelect.value;

  // 登録されているデータや今年を基準に、選択できる年のリストを作る
  const years = new Set();
  const currentYear = new Date().getFullYear();
  years.add(String(currentYear));

  // 支出データや収入データが存在する年も自動で選択肢に含める
  expensesData.forEach(item => {
    if (item.date) years.add(item.date.split('-')[0]);
  });
  incomesData.forEach(item => {
    if (item.yearMonth) years.add(item.yearMonth.split('-')[0]);
  });

  const sortedYears = Array.from(years).sort().reverse(); // 新しい年が上に来るように

  reportYearSelect.innerHTML = "";
  sortedYears.forEach(year => {
    const option = document.createElement("option");
    option.value = year;
    option.textContent = `${year}年`;
    reportYearSelect.appendChild(option);
  });

  if (sortedYears.includes(currentVal)) {
    reportYearSelect.value = currentVal;
  } else {
    reportYearSelect.value = String(currentYear);
  }
}

