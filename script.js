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

// デフォルトのカテゴリリスト
const DEFAULT_CATEGORIES = [
  "食費", "外食", "日用品", "漫画", "学習", "趣味", "旅行", "交通費", "衣服・美容", "サブスク", "ペット", "その他"
];

// アプリ内で保持する全カテゴリ（デフォルト ＋ カスタム）
let currentCategories = [...DEFAULT_CATEGORIES];

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

// DOM要素
const navHomeBtn = document.getElementById("nav-home-btn");
const navSettingsBtn = document.getElementById("nav-settings-btn");
const homeView = document.getElementById("home-view");
const settingsView = document.getElementById("settings-view");

const currentMonthLabel = document.getElementById("current-month-label");
const summaryMonthText = document.getElementById("summary-month-text");
const prevMonthBtn = document.getElementById("prev-month-btn"); // ◀ 追加
const nextMonthBtn = document.getElementById("next-month-btn"); // ▶ 追加
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

// ==========================================
// 1. 初期化 ＆ 認証
// ==========================================
window.addEventListener("DOMContentLoaded", () => {
  // 今日の日付をデフォルトセット
  dateInput.value = getTodayDateString();
  updateMonthLabel();

  // 💡 矢印ボタンのクリックイベント設定
  if (prevMonthBtn) prevMonthBtn.addEventListener("click", () => changeMonth(-1));
  if (nextMonthBtn) nextMonthBtn.addEventListener("click", () => changeMonth(1));

  // 収入モーダルのイベント設定
  if (openIncomeModalBtn) openIncomeModalBtn.addEventListener("click", openIncomeModal);
  if (cancelIncomeBtn) cancelIncomeBtn.addEventListener("click", closeIncomeModal);
  if (incomeForm) incomeForm.addEventListener("submit", handleSaveIncome);

  // タブ切り替えのイベント設定
  navHomeBtn.addEventListener("click", () => switchView("home"));
  navSettingsBtn.addEventListener("click", () => switchView("settings"));

  // 匿名ログイン実行
  signInAnonymously(auth)
    .then(() => {
      console.log("匿名ログイン成功");
    })
    .catch((error) => {
      console.error("ログインエラー:", error);
    });

  // 認証状態の監視
  onAuthStateChanged(auth, (user) => {
    if (user) {
      currentUser = user;
      // データのリアルタイム監視を開始
      setupRealtimeListeners();
    } else {
      currentUser = null;
    }
  });

  // フォーム送信イベント
  expenseForm.addEventListener("submit", handleAddExpense);
  categoryForm.addEventListener("submit", handleAddCategory);
  editForm.addEventListener("submit", handleUpdateExpense);
  cancelEditBtn.addEventListener("click", closeModal);
});

// 画面タブ切り替え関数
function switchView(viewName) {
  if (viewName === "home") {
    navHomeBtn.classList.add("active");
    navSettingsBtn.classList.remove("active");
    homeView.classList.add("active");
    settingsView.classList.remove("active");
  } else {
    navSettingsBtn.classList.add("active");
    navHomeBtn.classList.remove("active");
    settingsView.classList.add("active");
    homeView.classList.remove("active");
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

  // ① カスタムカテゴリの監視
  const categoriesRef = collection(db, "users", currentUser.uid, "categories");
  unsubCategories = onSnapshot(categoriesRef, (snapshot) => {
    customCategoriesData = [];
    snapshot.forEach((docSnap) => {
      customCategoriesData.push({ id: docSnap.id, ...docSnap.data() });
    });

    const customNames = customCategoriesData.map(c => c.name);
    currentCategories = [...DEFAULT_CATEGORIES, ...customNames];

    updateCategorySelects();
    renderCustomCategoryList();
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
}

// ==========================================
// 3. カテゴリ管理機能
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

function renderCustomCategoryList() {
  if (!customCategoryListEl) return;
  customCategoryListEl.innerHTML = "";

  DEFAULT_CATEGORIES.forEach((catName) => {
    const item = document.createElement("div");
    item.className = "category-item";
    item.innerHTML = `
      <div class="category-item-left">
        <span>${escapeHTML(catName)} <span style="font-size: 0.75rem; color: #888; margin-left: 6px;">(初期)</span></span>
      </div>
      <span style="font-size: 0.8rem; color: #aaa;">固定</span>
    `;
    customCategoryListEl.appendChild(item);
  });

  customCategoriesData.forEach((cat) => {
    const item = document.createElement("div");
    item.className = "category-item";
    item.innerHTML = `
      <div class="category-item-left">
        <span>${escapeHTML(cat.name)}</span>
      </div>
      <button type="button" class="btn-delete" data-id="${cat.id}" data-name="${escapeHTML(cat.name)}">削除</button>
    `;
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

  const totalAmount = filteredExpenses.reduce((sum, item) => sum + item.amount, 0);
  totalAmountEl.textContent = `￥${totalAmount.toLocaleString()}`;

  const currentIncomeObj = incomesData.find(item => item.yearMonth === currentYearMonth);
  const totalIncome = currentIncomeObj ? currentIncomeObj.amount : 0;
  totalIncomeEl.textContent = `￥${totalIncome.toLocaleString()}`;

  // 収支（残金）の計算
  const totalBalance = totalIncome - totalAmount;
  totalBalanceEl.textContent = `￥${totalBalance.toLocaleString()}`;
  
  // ▼ ここから上書き・追加します ▼
  const summaryCardEl = document.querySelector(".summary-card");

  if (totalBalance < 0) {
    totalBalanceEl.textContent = `￥-${Math.abs(totalBalance).toLocaleString()}`;
    totalBalanceEl.style.color = "#ef4444"; // 赤字：赤文字
    if (summaryCardEl) {
      summaryCardEl.classList.add("danger-card");
      summaryCardEl.classList.remove("success-card");
    }
  } else {
    totalBalanceEl.textContent = `￥+${totalBalance.toLocaleString()}`; // 💡 プラスのときに "+" をつける
    totalBalanceEl.style.color = "#166534"; // 黒字：緑文字
    if (summaryCardEl) {
      summaryCardEl.classList.remove("danger-card");
      summaryCardEl.classList.add("success-card");
    }
  }

  renderHistoryList(filteredExpenses);
  renderCategoryBreakdown(filteredExpenses, totalAmount);
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

  const activeCategories = Object.keys(categoryTotals)
    .map(cat => ({ name: cat, amount: categoryTotals[cat] }))
    .filter(item => item.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  categoryListEl.innerHTML = "";
  const backgroundColors = [
    "#3498db", "#e74c3c", "#2ecc71", "#f1c40f", 
    "#9b59b6", "#1abc9c", "#e67e22", "#34495e", "#95a5a6"
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