const defaultRegions = {
  malaysia: {
    currency: "RM",
    income: [{ name: "Salary", amount: 3500 }],
    expenses: [{ name: "房租", amount: 900 }],
    personalExpenses: [{ name: "餐饮", amount: 450 }],
    assets: [
      { category: "现金", name: "现金", amount: 800 },
      { category: "银行账户", name: "Maybank Saving Account", amount: 8000 },
      { category: "电子钱包", name: "TNG eWallet", amount: 1200 },
      { category: "基金／投资", name: "FSMOne Fund", amount: 3000 },
    ],
    liabilities: [{ name: "信用卡账单", amount: 500 }],
    managedAmount: 0,
  },
  taiwan: {
    currency: "NT$",
    income: [{ name: "Salary", amount: 65000 }],
    expenses: [{ name: "房租", amount: 18000 }],
    personalExpenses: [{ name: "餐饮", amount: 7000 }],
    assets: [
      { category: "现金", name: "现金", amount: 5000 },
      { category: "银行账户", name: "华南银行 Saving Account", amount: 120000 },
      { category: "定期存款", name: "玉山银行 Fixed Deposit", amount: 80000 },
      { category: "股票", name: "台湾股票", amount: 40000 },
    ],
    liabilities: [{ name: "学贷", amount: 30000 }],
    managedAmount: 0,
  },
};

const storageKey = "personal-finance-web-regions-v1";
const defaultSavingsGoals = { taiwan: 0, malaysia: 0 };
const supabaseClient = window.supabase?.createClient(
  window.SUPABASE_CONFIG?.url,
  window.SUPABASE_CONFIG?.publishableKey
);
let currentUser = null;
let cloudSyncTimer;
let automaticSync = false;

function queueCloudSync() {
  if (!currentUser || !localStorage.getItem(`personal-finance-cloud-imported-${currentUser.id}`)) return;
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(() => {
    automaticSync = true;
    document.getElementById("import-local-data").click();
  }, 1200);
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || "");
}

function makeDatabaseIds() {
  const collections = ["assets", "income", "expenses", "personalExpenses", "liabilities"];
  Object.values(financeData.months).forEach((monthRegions) => {
    ["taiwan", "malaysia"].forEach((country) => {
      const region = monthRegions[country];
      collections.forEach((collection) => {
        region[collection].forEach((item) => {
          if (!isUuid(item.id)) item.id = globalThis.crypto.randomUUID();
        });
      });
    });
  });
  saveRegions();
}

function getCloudRecords() {
  const typeMap = {
    assets: "asset",
    income: "income",
    expenses: "expense",
    personalExpenses: "personal_expense",
    liabilities: "liability",
  };
  const records = [];
  Object.entries(financeData.months).forEach(([monthKey, monthRegions]) => {
    ["taiwan", "malaysia"].forEach((country) => {
      const region = monthRegions[country];
      Object.entries(typeMap).forEach(([collection, recordType]) => {
        region[collection].forEach((item) => {
          records.push({
            id: item.id,
            user_id: currentUser.id,
            month_key: monthKey,
            country,
            record_type: recordType,
            category: recordType === "asset" ? item.category || null : null,
            institution: recordType === "asset" ? item.institution || null : null,
            name: item.name,
            currency: region.currency,
            amount: Number(item.amount),
            note: recordType === "asset" ? item.note || null : null,
          });
        });
      });
    });
  });
  return records;
}

async function loadCloudData() {
  if (!currentUser) return;
  const [recordsResult, settingsResult, goalsResult] = await Promise.all([
    supabaseClient.from("finance_records").select("*").eq("user_id", currentUser.id),
    supabaseClient.from("monthly_settings").select("*").eq("user_id", currentUser.id),
    supabaseClient.from("savings_goals").select("*").eq("user_id", currentUser.id),
  ]);
  const error = recordsResult.error || settingsResult.error || goalsResult.error;
  if (error) return;
  const records = recordsResult.data || [];
  const settings = settingsResult.data || [];
  const goals = goalsResult.data || [];
  if (!records.length && !settings.length && !goals.length) return;

  const months = {};
  const ensureMonth = (monthKey) => {
    if (!months[monthKey]) months[monthKey] = createEmptyRegions();
    return months[monthKey];
  };
  const collectionMap = { asset: "assets", income: "income", expense: "expenses", personal_expense: "personalExpenses", liability: "liabilities" };
  records.forEach((record) => {
    const region = ensureMonth(record.month_key)[record.country];
    region.currency = record.currency;
    region[collectionMap[record.record_type]].push({
      id: record.id, category: record.category || undefined, institution: record.institution || undefined,
      name: record.name, amount: Number(record.amount), note: record.note || undefined,
    });
  });
  settings.forEach((setting) => {
    const region = ensureMonth(setting.month_key)[setting.country];
    region.managedAmount = Number(setting.managed_amount || 0);
    region.note = setting.note || "";
  });
  financeData.months = months;
  financeData.savingsGoals = { ...defaultSavingsGoals };
  goals.forEach((goal) => { financeData.savingsGoals[goal.country] = Number(goal.target_amount || 0); });
  if (!financeData.months[selectedMonth]) selectedMonth = Object.keys(financeData.months).sort().at(-1);
  financeData.selectedMonth = selectedMonth;
  localStorage.setItem(`personal-finance-cloud-imported-${currentUser.id}`, "true");
  saveRegions();
  renderAll();
}

function renderCloudSync() {
  const tools = document.getElementById("cloud-sync-tools");
  const status = document.getElementById("cloud-sync-status");
  const button = document.getElementById("import-local-data");
  tools.hidden = !currentUser;
  if (!currentUser) return;
  if (localStorage.getItem(`personal-finance-cloud-imported-${currentUser.id}`)) {
    status.textContent = "已连接线上资料库。修改资料后，按这里同步最新内容。";
    button.textContent = "同步最新资料";
    button.hidden = false;
  } else {
    status.textContent = "导入会保留本机资料，并建立第一份线上副本。";
    button.textContent = "导入本机资料";
    button.hidden = false;
  }
}

function setAccountButton() {
  const button = document.getElementById("account-button");
  document.body.classList.toggle("is-authenticated", Boolean(currentUser));
  button.textContent = currentUser ? `已登入：${currentUser.email}` : "登入／注册";
}

function setAuthMessage(message, isError = false) {
  const messageBox = document.getElementById("auth-message");
  messageBox.textContent = message;
  messageBox.style.color = isError ? "#dc2626" : "#527d30";
}

async function refreshAccount() {
  if (!supabaseClient) return;
  const { data } = await supabaseClient.auth.getUser();
  currentUser = data.user || null;
  if (currentUser) await loadCloudData();
  setAccountButton();
  renderCloudSync();
}

function setupAuth() {
  const modal = document.getElementById("auth-modal");
  const emailInput = document.getElementById("auth-email");
  const passwordInput = document.getElementById("auth-password");

  document.getElementById("account-button").addEventListener("click", () => {
    if (currentUser) {
      supabaseClient.auth.signOut().then(() => {
        currentUser = null;
        setAccountButton();
        renderCloudSync();
        alert("已登出。你的本机资料没有被删除。");
      });
      return;
    }
    setAuthMessage("");
    modal.hidden = false;
  });

  document.getElementById("login-required-button").addEventListener("click", () => {
    document.getElementById("account-button").click();
  });

  document.getElementById("auth-close").addEventListener("click", () => {
    modal.hidden = true;
  });

  document.getElementById("auth-login").addEventListener("click", async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || !password) {
      setAuthMessage("请先填写 Email 和密码。", true);
      return;
    }
    setAuthMessage("正在登入…");
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) {
      setAuthMessage(error.message, true);
      return;
    }
    currentUser = data.user;
    await loadCloudData();
    setAccountButton();
    renderCloudSync();
    modal.hidden = true;
    alert("登入成功。下一步会安全导入你现在的本机资料。");
  });

  document.getElementById("auth-signup").addEventListener("click", async () => {
    const email = emailInput.value.trim();
    const password = passwordInput.value;
    if (!email || password.length < 6) {
      setAuthMessage("请填写 Email，并使用至少 6 个字的密码。", true);
      return;
    }
    setAuthMessage("正在建立账号…");
    const { error } = await supabaseClient.auth.signUp({ email, password });
    if (error) {
      setAuthMessage(error.message, true);
      return;
    }
    setAuthMessage("账号已建立。请到 Email 收件箱确认后，再回来登入。");
  });

}

function setupCloudImport() {
  document.getElementById("import-local-data").addEventListener("click", async () => {
    if (!currentUser) {
      alert("请先登入。");
      return;
    }
    const button = document.getElementById("import-local-data");
    const status = document.getElementById("cloud-sync-status");
    const isAutomatic = automaticSync;
    automaticSync = false;
    button.disabled = true;
    status.textContent = isAutomatic ? "正在自动同步…" : "正在安全同步资料…";
    try {
      makeDatabaseIds();
      const records = getCloudRecords();
      const monthlySettings = Object.entries(financeData.months).flatMap(([monthKey, monthRegions]) =>
        ["taiwan", "malaysia"].map((country) => ({
          user_id: currentUser.id,
          month_key: monthKey,
          country,
          managed_amount: Number(monthRegions[country].managedAmount || 0),
          note: monthRegions[country].note || null,
        }))
      );
      const savingsGoals = ["taiwan", "malaysia"].map((country) => ({
        user_id: currentUser.id,
        country,
        target_amount: Number(financeData.savingsGoals[country] || 0),
      }));
      const recordsResult = records.length
        ? await supabaseClient.from("finance_records").upsert(records, { onConflict: "id" })
        : { error: null };
      if (recordsResult.error) throw recordsResult.error;

      const { data: cloudRecords, error: cloudRecordsError } = await supabaseClient
        .from("finance_records")
        .select("id")
        .eq("user_id", currentUser.id);
      if (cloudRecordsError) throw cloudRecordsError;
      const localIds = new Set(records.map((record) => record.id));
      const removedIds = (cloudRecords || []).map((record) => record.id).filter((id) => !localIds.has(id));
      if (removedIds.length) {
        const { error: deleteError } = await supabaseClient
          .from("finance_records")
          .delete()
          .eq("user_id", currentUser.id)
          .in("id", removedIds);
        if (deleteError) throw deleteError;
      }

      for (const setting of monthlySettings) {
        const { data: existingSettings, error: findError } = await supabaseClient
          .from("monthly_settings")
          .select("id")
          .eq("user_id", currentUser.id)
          .eq("month_key", setting.month_key)
          .eq("country", setting.country)
          .limit(1);
        if (findError) throw findError;
        const settingsResult = existingSettings.length
          ? await supabaseClient.from("monthly_settings").update(setting).eq("id", existingSettings[0].id).eq("user_id", currentUser.id)
          : await supabaseClient.from("monthly_settings").insert(setting);
        if (settingsResult.error) throw settingsResult.error;
      }

      for (const goal of savingsGoals) {
        const { data: existingGoals, error: findError } = await supabaseClient
          .from("savings_goals")
          .select("id")
          .eq("user_id", currentUser.id)
          .eq("country", goal.country)
          .limit(1);
        if (findError) throw findError;
        const goalsResult = existingGoals.length
          ? await supabaseClient.from("savings_goals").update(goal).eq("id", existingGoals[0].id).eq("user_id", currentUser.id)
          : await supabaseClient.from("savings_goals").insert(goal);
        if (goalsResult.error) throw goalsResult.error;
      }
      localStorage.setItem(`personal-finance-cloud-imported-${currentUser.id}`, "true");
      renderCloudSync();
      if (isAutomatic) {
        const syncedAt = new Date().toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        status.textContent = `已自动同步到线上 · ${syncedAt}`;
      }
      else alert(`同步完成：${records.length} 笔资料已安全保存到线上。`);
      button.disabled = false;
    } catch (error) {
      status.textContent = "导入未完成，本机资料仍保留。";
      button.disabled = false;
      alert(`导入失败：${error.message || "请检查网络后再试。"}`);
    }
  });
}

function createRecordId(prefix) {
  const uniquePart = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${uniquePart}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function createEmptyRegions() {
  return {
    malaysia: {
      currency: "RM",
      income: [],
      expenses: [],
      personalExpenses: [],
      note: "",
      assets: [],
      liabilities: [],
      managedAmount: 0,
    },
    taiwan: {
      currency: "NT$",
      income: [],
      expenses: [],
      personalExpenses: [],
      note: "",
      assets: [],
      liabilities: [],
      managedAmount: 0,
    },
  };
}

function loadFinanceData() {
  try {
    const savedData = localStorage.getItem(storageKey);
    if (!savedData) {
      return { selectedMonth: "2026-08", months: { "2026-08": defaultRegions }, savingsGoals: { ...defaultSavingsGoals } };
    }

    const parsedData = JSON.parse(savedData);
    if (parsedData.months) {
      return parsedData;
    }

    return { selectedMonth: "2026-08", months: { "2026-08": parsedData }, savingsGoals: { ...defaultSavingsGoals } };
  } catch {
    return { selectedMonth: "2026-08", months: { "2026-08": defaultRegions }, savingsGoals: { ...defaultSavingsGoals } };
  }
}

function saveRegions() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(financeData));
    queueCloudSync();
  } catch {
    // 浏览器不允许本机储存时，网页仍可继续使用当前画面。
  }
}

function downloadBackup() {
  const backup = {
    version: 2,
    exportedAt: new Date().toISOString(),
    selectedMonth: financeData.selectedMonth,
    months: financeData.months,
    savingsGoals: financeData.savingsGoals,
  };
  const backupFile = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const downloadUrl = URL.createObjectURL(backupFile);
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = `personal-finance-backup-${selectedMonth}.json`;
  link.click();
  URL.revokeObjectURL(downloadUrl);
}

function isBackupData(data) {
  if (!data || typeof data !== "object" || !data.months || typeof data.months !== "object") {
    return "找不到月份资料。";
  }

  for (const [month, monthRegions] of Object.entries(data.months)) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return `月份格式错误：${month}`;
    for (const [id, currency] of [["taiwan", "NT$"], ["malaysia", "RM"]]) {
      const region = monthRegions?.[id];
      if (!region || region.currency !== currency || !Array.isArray(region.assets) || !Array.isArray(region.income) || !Array.isArray(region.expenses) || !Array.isArray(region.personalExpenses) || !Array.isArray(region.liabilities)) {
        return `${month} 的${id === "taiwan" ? "台湾" : "马来西亚"}资料格式不完整。`;
      }
      const validAmount = (item) => item && typeof item.name === "string" && Number.isFinite(item.amount) && item.amount >= 0;
      if (!region.assets.every((item) => validAmount(item) && typeof item.category === "string") || !region.income.every(validAmount) || !region.expenses.every(validAmount) || !region.personalExpenses.every(validAmount) || !region.liabilities.every(validAmount) || !Number.isFinite(Number(region.managedAmount || 0))) {
        return `${month} 的${id === "taiwan" ? "台湾" : "马来西亚"}资料包含无效金额或栏位。`;
      }
    }
  }
  if (data.savingsGoals && (!Number.isFinite(Number(data.savingsGoals.taiwan || 0)) || !Number.isFinite(Number(data.savingsGoals.malaysia || 0)))) {
    return "储蓄目标金额格式错误。";
  }
  return "";
}

function restoreBackup(file) {
  const reader = new FileReader();

  reader.addEventListener("load", () => {
    try {
      const backup = JSON.parse(reader.result);
      const validationError = isBackupData(backup);
      if (validationError) {
        alert(`无法还原备份：${validationError}`);
        return;
      }

      if (!confirm("还原会覆盖目前浏览器内的所有资料。确定继续吗？")) {
        return;
      }

      const availableMonths = Object.keys(backup.months);
      financeData.months = backup.months;
      financeData.savingsGoals = { ...defaultSavingsGoals, ...(backup.savingsGoals || {}) };
      selectedMonth = backup.selectedMonth && backup.months[backup.selectedMonth]
        ? backup.selectedMonth
        : availableMonths[0];
      financeData.selectedMonth = selectedMonth;
      saveRegions();
      renderAll();
      alert("资料已还原。");
    } catch {
      alert("无法读取这个备份档，请确认你选择了正确的档案。");
    }
  });

  reader.readAsText(file);
}

const financeData = loadFinanceData();
financeData.savingsGoals = { ...defaultSavingsGoals, ...(financeData.savingsGoals || {}) };
let selectedMonth = financeData.selectedMonth;
let regions = financeData.months[selectedMonth];
let pickerYear = Number(selectedMonth.slice(0, 4));
let selectedTrendRegion = "taiwan";

let migratedLocalData = false;
Object.values(financeData.months).forEach((monthRegions) => {
  Object.values(monthRegions).forEach((region) => {
    if ("previousMonthExpense" in region) {
      delete region.previousMonthExpense;
      migratedLocalData = true;
    }
    if (!Number.isFinite(region.managedAmount)) {
      region.managedAmount = 0;
      migratedLocalData = true;
    }
    [["assets", "asset"], ["income", "income"], ["expenses", "expense"], ["personalExpenses", "personal-expense"], ["liabilities", "liability"]].forEach(([collection, prefix]) => {
      if (!Array.isArray(region[collection])) return;
      region[collection].forEach((item) => {
        if (!item.id) {
          item.id = createRecordId(prefix);
          migratedLocalData = true;
        }
      });
    });
  });
});
if (migratedLocalData) {
  saveRegions();
}

function getCurrentRegions() {
  return financeData.months[selectedMonth];
}

function formatMonth(month) {
  const [year, monthNumber] = month.split("-");
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
    new Date(Number(year), Number(monthNumber) - 1, 1)
  );
}

function monthKey(year, month) {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function renderMonthPicker() {
  const [selectedYear, selectedMonthNumber] = selectedMonth.split("-").map(Number);
  document.getElementById("selected-month-label").textContent = `${selectedYear} 年 ${selectedMonthNumber} 月`;
  document.getElementById("picker-year").textContent = `${pickerYear} 年`;
  document.getElementById("month-grid").innerHTML = Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const isSelected = pickerYear === selectedYear && month === selectedMonthNumber;
    return `<button type="button" class="month-option ${isSelected ? "is-selected" : ""}" data-picker-month="${month}">${month}月</button>`;
  }).join("");

  document.querySelectorAll("[data-picker-month]").forEach((button) => {
    button.addEventListener("click", () => {
      selectMonth(monthKey(pickerYear, Number(button.dataset.pickerMonth)));
      closeMonthPanel();
    });
  });
}

function closeMonthPanel() {
  const panel = document.getElementById("month-panel");
  panel.hidden = true;
  document.getElementById("month-toggle").setAttribute("aria-expanded", "false");
}

function selectMonth(newMonth) {
  if (!financeData.months[newMonth]) {
    financeData.months[newMonth] = createEmptyRegions();
  }

  selectedMonth = newMonth;
  pickerYear = Number(newMonth.slice(0, 4));
  financeData.selectedMonth = newMonth;
  saveRegions();
  renderAll();
}

function shiftMonth(amount) {
  const [year, month] = selectedMonth.split("-").map(Number);
  const next = new Date(year, month - 1 + amount, 1);
  selectMonth(monthKey(next.getFullYear(), next.getMonth() + 1));
}

function getPreviousMonthKey() {
  const [year, month] = selectedMonth.split("-").map(Number);
  const previous = new Date(year, month - 2, 1);
  return monthKey(previous.getFullYear(), previous.getMonth() + 1);
}

function copyPreviousAssets() {
  const previousMonth = getPreviousMonthKey();
  const previousRegions = financeData.months[previousMonth];

  if (!previousRegions) {
    alert(`找不到 ${previousMonth.replace("-", " 年 ")} 月的资料，无法复制资产。`);
    return;
  }

  if (!confirm(`会覆盖 ${selectedMonth.replace("-", " 年 ")} 月现有的 MYR 与 TWD 资产资料。\n不会复制收入、支出或负债。确定继续吗？`)) {
    return;
  }

  regions.malaysia.assets = (previousRegions.malaysia.assets || []).map((asset) => ({ ...structuredClone(asset), id: createRecordId("asset") }));
  regions.taiwan.assets = (previousRegions.taiwan.assets || []).map((asset) => ({ ...structuredClone(asset), id: createRecordId("asset") }));
  saveRegions();
  renderAll();
  alert("已复制上个月资产资料。");
}

function total(items) {
  return items.reduce((sum, item) => sum + item.amount, 0);
}

function managedAmount(region) {
  return Number(region.managedAmount) || 0;
}

function money(currency, amount) {
  return `${escapeHtml(currency)}${amount.toLocaleString("en-US")}`;
}

function renderDashboard() {
  const dashboard = document.getElementById("dashboard-grid");
  dashboard.innerHTML = ["taiwan", "malaysia"]
    .map((id) => {
      const region = regions[id];
      const totalAssets = total(region.assets);
      const totalLiabilities = total(region.liabilities);
      const netAssets = totalAssets - totalLiabilities - managedAmount(region);
      const regionTitle = id === "taiwan" ? "Taiwan（TWD）" : "Malaysia（MYR）";
      return `
        <section class="dashboard-region">
          <h3>${regionTitle}</h3>
          <div class="dashboard-metrics">
            <article class="metric-card">
              <p>总资产</p>
              <strong>${money(region.currency, totalAssets)}</strong>
            </article>
            <article class="metric-card liability-metric">
              <p>总负债</p>
              <strong>${money(region.currency, totalLiabilities)}</strong>
            </article>
            <article class="metric-card net-asset-metric">
              <p>净资产</p>
              <strong>${money(region.currency, netAssets)}</strong>
            </article>
            <article class="metric-card">
              <p>资产笔数</p>
              <strong>${region.assets.length} 笔</strong>
            </article>
          </div>
        </section>
      `;
    })
    .join("");
}

function renderAssetAllocation() {
  const allocationGrid = document.getElementById("asset-allocation-grid");
  const labels = { taiwan: "台湾", malaysia: "马来西亚" };

  allocationGrid.innerHTML = ["taiwan", "malaysia"]
    .map((id) => {
      const region = regions[id];
      const totalAssets = total(region.assets);
      const categories = region.assets.reduce((groups, asset) => {
        const category = asset.category || "其他资产";
        groups[category] = (groups[category] || 0) + asset.amount;
        return groups;
      }, {});
      const rows = Object.entries(categories)
        .map(([category, amount]) => {
          const percentage = totalAssets ? (amount / totalAssets) * 100 : 0;
          return `<div class="allocation-row">
            <div class="allocation-row-details"><span>${escapeHtml(category)}</span><span>${money(region.currency, amount)} <b>${percentage.toFixed(1)}%</b></span></div>
            <div class="allocation-bar"><i style="width: ${percentage}%"></i></div>
          </div>`;
        })
        .join("");

      return `<article class="asset-allocation-card">
        <div class="asset-allocation-heading"><h3><i class="allocation-pie-icon" aria-hidden="true"></i>${labels[id]} 资产配置</h3><span>总计 ${money(region.currency, totalAssets)}</span></div>
        ${rows || `<div class="allocation-empty"><i class="allocation-empty-icon" aria-hidden="true"></i><strong>尚无资产资料</strong><span>新增资产后，这里会自动显示分类占比</span></div>`}
      </article>`;
    })
    .join("");
}

function renderSavingsGoals() {
  const goalCard = document.getElementById("savings-goals-card");
  const labels = { taiwan: "台湾", malaysia: "马来西亚" };
  const regionsOrder = ["taiwan", "malaysia"];

  goalCard.innerHTML = `<div class="savings-goals-heading"><h3><i class="savings-goal-icon" aria-hidden="true"></i>储蓄目标</h3><span>以净资产计算</span></div>
    <div class="savings-goals-regions">${regionsOrder.map((id) => {
      const region = regions[id];
      const goal = Number(financeData.savingsGoals[id]) || 0;
      const current = total(region.assets) - total(region.liabilities) - managedAmount(region);
      const progress = goal > 0 ? Math.min(100, Math.max(0, (current / goal) * 100)) : 0;
      const remaining = goal - current;
      return `<article class="savings-goal-region">
        <div class="savings-goal-region-heading"><span>${labels[id]} 储蓄目标</span><button type="button" class="savings-goal-edit" data-savings-goal-region="${id}">设定</button></div>
        <strong>${goal > 0 ? money(region.currency, goal) : "尚未设定"}</strong>
        <div class="savings-goal-progress"><span>目前净资产：${money(region.currency, current)}</span><b>${goal > 0 ? `${progress.toFixed(1)}%` : "—"}</b></div>
        <div class="savings-goal-bar"><i style="width: ${progress}%"></i></div>
        ${goal > 0 ? (remaining > 0 ? `<p>距离目标尚差 <b>${money(region.currency, remaining)}</b></p>` : `<p class="goal-achieved">✓ 恭喜！已达成储蓄目标</p>`) : `<p>设定目标后，会自动显示完成进度</p>`}
      </article>`;
    }).join("")}</div>`;

  document.querySelectorAll("[data-savings-goal-region]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.savingsGoalRegion;
      const region = regions[id];
      const target = button.closest(".savings-goal-region");
      target.innerHTML = `<div class="savings-goal-region-heading"><span>${labels[id]} 储蓄目标</span></div>
        <div class="savings-goal-edit-form"><span>${region.currency}</span><input type="number" min="0" step="0.01" aria-label="${labels[id]}储蓄目标" value="${Number(financeData.savingsGoals[id]) || ""}" placeholder="输入目标金额"><button type="button" class="savings-goal-save">储存</button><button type="button" class="savings-goal-cancel">取消</button></div>
        <p>输入 0 可清除这个目标。</p>`;
      target.querySelector(".savings-goal-cancel").addEventListener("click", renderSavingsGoals);
      target.querySelector(".savings-goal-save").addEventListener("click", () => {
        const amount = Number(target.querySelector("input").value || 0);
        if (!Number.isFinite(amount) || amount < 0) {
          alert("储蓄目标必须是 0 或更大的数字。");
          return;
        }
        financeData.savingsGoals[id] = amount;
        saveRegions();
        renderAll();
      });
    });
  });
}

function renderManagedAmountCards() {
  const cardGrid = document.getElementById("managed-amount-grid");
  const labels = { taiwan: "台湾", malaysia: "马来西亚" };

  cardGrid.innerHTML = ["taiwan", "malaysia"]
    .map((id) => {
      const region = regions[id];
      return `<article class="managed-amount-card" data-managed-card="${id}">
        <div class="managed-card-heading"><strong><i class="managed-icon" aria-hidden="true"></i>${labels[id]} 代管理</strong><button type="button" class="managed-edit-button" data-managed-edit="${id}"><i aria-hidden="true"></i>编辑</button></div>
        <b>${money(region.currency, managedAmount(region))}</b>
        <span>代管理金额从净资产中扣除</span>
      </article>`;
    })
    .join("");

  document.querySelectorAll("[data-managed-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.managedEdit;
      const region = regions[id];
      const card = button.closest(".managed-amount-card");
      card.innerHTML = `<div class="managed-card-heading"><strong><i class="managed-icon" aria-hidden="true"></i>${labels[id]} 代管理</strong></div>
        <div class="managed-edit-form"><span>${region.currency}</span><input type="number" min="0" step="0.01" aria-label="代管理金额" value="${managedAmount(region)}"><button type="button" class="managed-save-button">储存</button><button type="button" class="managed-cancel-button">取消</button></div>
        <span>代管理金额从净资产中扣除</span>`;

      card.querySelector(".managed-cancel-button").addEventListener("click", renderManagedAmountCards);
      card.querySelector(".managed-save-button").addEventListener("click", () => {
        const amount = Number(card.querySelector("input").value);
        if (!Number.isFinite(amount) || amount < 0) {
          alert("代管理金额必须是 0 或更大的数字。");
          return;
        }
        region.managedAmount = amount;
        saveRegions();
        renderAll();
      });
    });
  });
}

function renderIncomeOverview() {
  const highlightGrid = document.getElementById("income-highlight-grid");
  const labels = { taiwan: "台湾", malaysia: "马来西亚" };
  const order = ["taiwan", "malaysia"];

  highlightGrid.innerHTML = order
    .map((id) => {
      const region = regions[id];
      const income = total(region.income);
      const expenses = total(region.expenses) + total(region.personalExpenses);
      const balance = income - expenses;
      return `
        <div class="income-region-group">
          <article class="income-highlight-card">
            <h3>⚖ ${labels[id]} 当月损益</h3>
            <div class="income-balance-box">
              <p>当月结余</p>
              <strong class="${balance < 0 ? "negative-balance" : ""}">${money(region.currency, balance)}</strong>
              <div class="income-balance-details">
                <span>↗ 总收入 <b>${money(region.currency, income)}</b></span>
                <span>↘ 总支出 <b>${money(region.currency, expenses)}</b></span>
              </div>
            </div>
            <p class="income-help">总支出＝一般开销＋个人开销</p>
          </article>
          <div class="income-metric-grid">
            <article class="income-metric-card income-total-card"><p>${labels[id]}总收入</p><strong>${money(region.currency, income)}</strong></article>
            <article class="income-metric-card expense-total-card"><p>${labels[id]}总支出</p><strong>${money(region.currency, expenses)}</strong></article>
          </div>
        </div>
      `;
    })
    .join("");
}

function trendRegionButtons() {
  return `<div class="trend-region-buttons">
    <button type="button" class="${selectedTrendRegion === "taiwan" ? "is-selected" : ""}" data-trend-region="taiwan">台湾 TWD</button>
    <button type="button" class="${selectedTrendRegion === "malaysia" ? "is-selected" : ""}" data-trend-region="malaysia">马来西亚 MYR</button>
  </div>`;
}

function renderSingleTrendCard(months, subtitle, series) {
  const region = financeData.months[months[0]][selectedTrendRegion];
  const title = selectedTrendRegion === "taiwan" ? "台湾（TWD）" : "马来西亚（MYR）";
  return `<article class="trend-card trend-card-dark single-trend-card">
    <div class="single-trend-heading"><div><h4>↗ 历月趋势</h4><p>${subtitle} · ${title}</p></div>${trendRegionButtons()}</div>
    ${createLineChart(months, series, region.currency, `${title} ${subtitle}`)}
  </article>`;
}

function bindTrendRegionButtons() {
  document.querySelectorAll("[data-trend-region]").forEach((button) => {
    button.onclick = () => {
      selectedTrendRegion = button.dataset.trendRegion;
      renderNetAssetTrend();
      renderAssetLiabilityTrend();
      bindTrendRegionButtons();
    };
  });
}

function createLineChart(months, series, currency, summary) {
  const width = 460;
  const height = 250;
  const left = 68;
  const right = 20;
  const top = 22;
  const bottom = 42;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const allValues = series.flatMap((item) => item.values);
  const minimum = Math.min(0, ...allValues);
  const maximum = Math.max(0, ...allValues);
  const range = maximum - minimum || 1;
  const y = (value) => top + ((maximum - value) / range) * chartHeight;
  const x = (index) =>
    months.length === 1 ? left + chartWidth / 2 : left + (index / (months.length - 1)) * chartWidth;
  const smoothPath = (values) => {
    if (values.length === 1) {
      return `M${x(0)},${y(values[0])}`;
    }

    let result = `M${x(0)},${y(values[0])}`;
    for (let index = 1; index < values.length; index += 1) {
      const previousX = x(index - 1);
      const previousY = y(values[index - 1]);
      const currentX = x(index);
      const currentY = y(values[index]);
      const middleX = (previousX + currentX) / 2;
      result += ` C${middleX},${previousY} ${middleX},${currentY} ${currentX},${currentY}`;
    }
    return result;
  };
  const compactMoney = (amount) => {
    const absoluteAmount = Math.abs(amount);
    if (absoluteAmount >= 1000000) return `${currency}${(amount / 1000000).toFixed(1)}M`;
    if (absoluteAmount >= 1000) return `${currency}${(amount / 1000).toFixed(1)}K`;
    return money(currency, Math.round(amount));
  };
  const gridValues = [maximum, minimum + range / 2, minimum];
  const grid = gridValues
    .map((value) => `<g><line x1="${left}" x2="${width - right}" y1="${y(value)}" y2="${y(value)}" class="chart-grid-line" /><text x="${left - 8}" y="${y(value) + 4}" text-anchor="end" class="chart-axis-text">${compactMoney(value)}</text></g>`)
    .join("");
  const xLabels = months
    .map((month, index) => `<text x="${x(index)}" y="${height - 16}" text-anchor="middle" class="chart-axis-text">${month.replace("-", "/")}</text>`)
    .join("");
  const lines = series
    .map(
      (item) =>
        `<path d="${smoothPath(item.values)}" class="chart-line ${item.className}" /><g>${item.values.map((value, index) => `<circle cx="${x(index)}" cy="${y(value)}" r="4" class="chart-point ${item.className}" data-tooltip="${item.name}：${money(currency, value)}" tabindex="0"></circle>`).join("")}</g>`
    )
    .join("");
  const legend = series.map((item) => `<span class="chart-legend-item"><i class="chart-swatch ${item.className}"></i>${item.name}</span>`).join("");

  return `
    <div class="chart-legend">${legend}</div>
    <svg class="line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${summary}">
      <title>${summary}</title>
      ${grid}
      <line x1="${left}" x2="${width - right}" y1="${height - bottom}" y2="${height - bottom}" class="chart-axis-line" />
      ${xLabels}
      ${lines}
    </svg>
  `;
}

function renderNetAssetTrend() {
  const months = Object.keys(financeData.months).sort();
  const trendGrid = document.getElementById("net-asset-trend-grid");
  const values = months.map((month) => {
    const region = financeData.months[month][selectedTrendRegion];
    return total(region.assets) - total(region.liabilities) - managedAmount(region);
  });
  trendGrid.innerHTML = renderSingleTrendCard(months, "净资产趋势", [{ name: "净资产", values, className: "net-asset-series" }]);
}

function renderAssetLiabilityTrend() {
  const months = Object.keys(financeData.months).sort();
  const trendGrid = document.getElementById("asset-liability-trend-grid");
  const assetValues = months.map((month) => total(financeData.months[month][selectedTrendRegion].assets));
  const liabilityValues = months.map((month) => total(financeData.months[month][selectedTrendRegion].liabilities));
  const series = [
    { name: "总资产", values: assetValues, className: "asset-series" },
    { name: "总负债", values: liabilityValues, className: "liability-series" },
  ];
  trendGrid.innerHTML = renderSingleTrendCard(months, "资产与负债趋势", series);
}

function renderRegion(id, region) {
  const totalIncome = total(region.income);
  const totalExpenses = total(region.expenses);
  const totalPersonalExpenses = total(region.personalExpenses);
  const totalAssets = total(region.assets);
  const totalLiabilities = total(region.liabilities);
  const netAssets = totalAssets - totalLiabilities - managedAmount(region);

  const transactionRows = (items, label, className, type) =>
    items
      .map(
        (item) =>
          `<div class="transaction-row example-row ${className}"><span>${label}：${escapeHtml(item.name)} — ${money(region.currency, item.amount)}</span><span class="row-actions"><button class="edit-button" data-edit-region="${id}" data-edit-collection="${type}" data-edit-id="${item.id}">修改</button></span></div>`
      )
      .join("");

  document.getElementById(`${id}-statement`).innerHTML = `
    ${transactionRows(region.income, "收入", "", "income")}
    ${transactionRows(region.expenses, "开销", "expense-row", "expenses")}
    ${transactionRows(region.personalExpenses, "个人开销", "personal-expense-row", "personalExpenses")}
    <div class="statement-totals">
      <p>总收入：${money(region.currency, totalIncome)}</p>
      <p>总开销：${money(region.currency, totalExpenses)}</p>
      <p>总个人开销：${money(region.currency, totalPersonalExpenses)}</p>
    </div>
  `;

  document.getElementById(`${id}-statement-summary`).innerHTML = `
    <p>当月结余</p>
    <strong class="${totalIncome - totalExpenses - totalPersonalExpenses < 0 ? "negative-balance" : ""}">${money(region.currency, totalIncome - totalExpenses - totalPersonalExpenses)}</strong>
    <div><span>总收入 ${money(region.currency, totalIncome)}</span><span>总支出 ${money(region.currency, totalExpenses + totalPersonalExpenses)}</span></div>
  `;

  const assetGroups = region.assets.reduce((groups, asset) => {
    const category = asset.category || "其他资产";
    if (!groups[category]) groups[category] = [];
    groups[category].push(asset);
    return groups;
  }, {});

  document.getElementById(`${id}-assets`).innerHTML = region.assets.length
    ? Object.entries(assetGroups)
        .map(([category, assets]) => {
          const categoryTotal = total(assets);
          return `<section class="asset-category-group">
            <div class="asset-category-heading"><span><i class="asset-category-icon" aria-hidden="true"></i>${escapeHtml(category)} <em>${assets.length} 笔</em></span><strong>${money(region.currency, categoryTotal)}</strong></div>
            ${assets
              .map((asset) => {
                const percentage = totalAssets > 0 ? Math.round((asset.amount / totalAssets) * 100) : 0;
                const assetLabel = asset.institution ? `${escapeHtml(asset.institution)} ${escapeHtml(asset.name)}` : escapeHtml(asset.name);
                const noteLabel = asset.note ? `（备注：${escapeHtml(asset.note)}）` : "";
                return `<div class="asset-row"><span>${assetLabel} — ${money(region.currency, asset.amount)}（${percentage}%）${noteLabel}</span><span class="row-actions"><button class="edit-button" data-edit-region="${id}" data-edit-collection="assets" data-edit-id="${asset.id}">修改</button></span></div>`;
              })
              .join("")}
          </section>`;
        })
        .join("")
    : `<div class="empty-assets"><strong>尚无资产记录</strong><span>点击右上角新增第一笔资产</span><button type="button" class="open-asset-form" data-asset-form-region="${id}">＋ 新增资产</button></div>`;

  document.getElementById(`${id}-liabilities`).innerHTML = region.liabilities
    .map(
      (liability) =>
        `<div class="liability-row"><span>债务：${escapeHtml(liability.name)} — ${money(region.currency, liability.amount)}</span><span class="row-actions"><button class="edit-button" data-edit-region="${id}" data-edit-collection="liabilities" data-edit-id="${liability.id}">修改</button></span></div>`
    )
    .join("");

  document.getElementById(`${id}-liability-summary`).innerHTML = `
    <p>该地区总负债</p>
    <strong>${money(region.currency, totalLiabilities)}</strong>
    <span>共 ${region.liabilities.length} 笔负债</span>
  `;

  document.getElementById(`${id}-summary`).innerHTML = `
    <p>该地区总资产</p>
    <strong>${money(region.currency, totalAssets)}</strong>
    <span>共 ${region.assets.length} 笔资产</span>
    <div><span>净资产（资产－负债－代管理）</span><b>${money(region.currency, netAssets)}</b></div>
  `;

  bindEditButtons(id, region);
  bindAssetPanelButtons();
  bindTransactionPanelButtons();
  bindLiabilityPanelButtons();
}

function bindLiabilityPanelButtons() {
  document.querySelectorAll(".open-liability-form").forEach((button) => {
    button.onclick = () => {
      document.getElementById(`${button.dataset.liabilityFormRegion}-liability-modal`).hidden = false;
    };
  });
}

function bindTransactionPanelButtons() {
  document.querySelectorAll(".open-transaction-form").forEach((button) => {
    button.onclick = () => {
      document.getElementById(`${button.dataset.transactionFormRegion}-transaction-modal`).hidden = false;
    };
  });
}

function bindAssetPanelButtons() {
  document.querySelectorAll(".open-asset-form").forEach((button) => {
    button.onclick = () => {
      document.getElementById(`${button.dataset.assetFormRegion}-asset-modal`).hidden = false;
    };
  });
}

function setupAssetForm(id, region) {
  const categoryInput = document.getElementById(`${id}-category`);
  const institutionInput = document.getElementById(`${id}-institution`);
  const nameInput = document.getElementById(`${id}-name`);
  const amountInput = document.getElementById(`${id}-amount`);
  const noteInput = document.getElementById(`${id}-asset-note`);
  const addButton = document.getElementById(`${id}-add-asset`);

  addButton.addEventListener("click", () => {
    const currentRegion = getCurrentRegions()[id];
    const institution = institutionInput.value.trim();
    const name = nameInput.value.trim();
    const amount = Number(amountInput.value);

    if (!institution || !name || amount <= 0) {
      alert("请先填写机构／平台、资产名称和大于 0 的金额。");
      return;
    }

    currentRegion.assets.push({
      id: createRecordId("asset"),
      category: categoryInput.value,
      institution,
      name,
      amount,
      note: noteInput.value.trim(),
    });

    saveRegions();
    renderAll();
    institutionInput.value = "";
    nameInput.value = "";
    amountInput.value = "";
    noteInput.value = "";
    document.getElementById(`${id}-asset-modal`).hidden = true;
  });
}

function setupAssetPanel(id) {
  document.querySelector(`[data-asset-form-region="${id}"].close-asset-form`).addEventListener("click", () => {
    document.getElementById(`${id}-asset-modal`).hidden = true;
  });
}

function setupTransactionForm(id, region) {
  const typeInput = document.getElementById(`${id}-transaction-type`);
  const nameInput = document.getElementById(`${id}-transaction-name`);
  const amountInput = document.getElementById(`${id}-transaction-amount`);
  const addButton = document.getElementById(`${id}-add-transaction`);

  addButton.addEventListener("click", () => {
    const currentRegion = getCurrentRegions()[id];
    const name = nameInput.value.trim();
    const amount = Number(amountInput.value);

    if (!name || amount <= 0) {
      alert("请先填写项目名称和大于 0 的金额。");
      return;
    }

    currentRegion[typeInput.value].push({ id: createRecordId(typeInput.value), name, amount });
    saveRegions();
    renderAll();
    nameInput.value = "";
    amountInput.value = "";
    document.getElementById(`${id}-transaction-modal`).hidden = true;
  });
}

function setupTransactionPanel(id) {
  document.querySelector(`[data-transaction-form-region="${id}"].close-transaction-form`).addEventListener("click", () => {
    document.getElementById(`${id}-transaction-modal`).hidden = true;
  });
}

function bindEditButtons(id, region) {
  document.querySelectorAll(`[data-edit-region="${id}"]`).forEach((button) => {
    button.addEventListener("click", () => {
      const collection = button.dataset.editCollection;
      const recordId = button.dataset.editId;
      const item = region[collection].find((record) => record.id === recordId);
      if (!item) {
        renderAll();
        return;
      }
      const row = button.closest(".asset-row, .liability-row, .transaction-row");
      row.innerHTML = `
        <input class="inline-name-input" type="text" aria-label="修改名称" />
        <input class="inline-amount-input" type="number" min="0" aria-label="修改金额" />
        <span class="row-actions">
          <button class="save-edit-button" type="button">储存</button>
          <button class="delete-edit-button" type="button">删除</button>
          <button class="cancel-edit-button" type="button">取消</button>
        </span>
      `;
      row.querySelector(".inline-name-input").value = item.name;
      row.querySelector(".inline-amount-input").value = item.amount;

      row.querySelector(".cancel-edit-button").addEventListener("click", () => {
        renderRegion(id, region);
      });

      row.querySelector(".save-edit-button").addEventListener("click", () => {
        const newName = row.querySelector(".inline-name-input").value.trim();
        const newAmount = Number(row.querySelector(".inline-amount-input").value);

        if (!newName || !Number.isFinite(newAmount) || newAmount < 0) {
          alert("名称不可空白，金额必须是 0 或更大的数字。");
          return;
        }

        item.name = newName;
        item.amount = newAmount;
        saveRegions();
        renderAll();
      });

      row.querySelector(".delete-edit-button").addEventListener("click", () => {
        if (!confirm(`确定删除「${item.name}」吗？`)) {
          return;
        }

        const recordIndex = region[collection].findIndex((record) => record.id === recordId);
        if (recordIndex >= 0) region[collection].splice(recordIndex, 1);
        saveRegions();
        renderAll();
      });
    });
  });
}

function setupLiabilityForm(id, region) {
  const nameInput = document.getElementById(`${id}-liability-name`);
  const amountInput = document.getElementById(`${id}-liability-amount`);
  const addButton = document.getElementById(`${id}-add-liability`);

  addButton.addEventListener("click", () => {
    const currentRegion = getCurrentRegions()[id];
    const name = nameInput.value.trim();
    const amount = Number(amountInput.value);

    if (!name || amount <= 0) {
      alert("请先填写债务名称和大于 0 的金额。");
      return;
    }

    currentRegion.liabilities.push({ id: createRecordId("liability"), name, amount });
    saveRegions();
    renderAll();
    nameInput.value = "";
    amountInput.value = "";
    document.getElementById(`${id}-liability-modal`).hidden = true;
  });
}

function setupLiabilityPanel(id) {
  document.querySelector(`[data-liability-form-region="${id}"].close-liability-form`).addEventListener("click", () => {
    document.getElementById(`${id}-liability-modal`).hidden = true;
  });
}

function setupNoteForm(id) {
  const noteInput = document.getElementById(`${id}-note`);
  const saveButton = document.getElementById(`${id}-save-note`);

  saveButton.addEventListener("click", () => {
    getCurrentRegions()[id].note = noteInput.value.trim();
    saveRegions();
    alert("本月备注已储存。");
  });
}

function renderAll() {
  regions = getCurrentRegions();
  renderMonthPicker();
  renderDashboard();
  renderIncomeOverview();
  renderNetAssetTrend();
  renderAssetLiabilityTrend();
  renderAssetAllocation();
  renderSavingsGoals();
  renderManagedAmountCards();
  bindTrendRegionButtons();
  renderRegion("malaysia", regions.malaysia);
  renderRegion("taiwan", regions.taiwan);
  document.getElementById("malaysia-note").value = regions.malaysia.note || "";
  document.getElementById("taiwan-note").value = regions.taiwan.note || "";
}

document.getElementById("previous-month").addEventListener("click", () => shiftMonth(-1));
document.getElementById("next-month").addEventListener("click", () => shiftMonth(1));
document.getElementById("copy-previous-assets").addEventListener("click", copyPreviousAssets);
document.getElementById("month-toggle").addEventListener("click", () => {
  const panel = document.getElementById("month-panel");
  panel.hidden = !panel.hidden;
  document.getElementById("month-toggle").setAttribute("aria-expanded", String(!panel.hidden));
  renderMonthPicker();
});
document.getElementById("previous-year").addEventListener("click", () => {
  pickerYear -= 1;
  renderMonthPicker();
});
document.getElementById("next-year").addEventListener("click", () => {
  pickerYear += 1;
  renderMonthPicker();
});
document.getElementById("month-today").addEventListener("click", () => {
  const today = new Date();
  selectMonth(monthKey(today.getFullYear(), today.getMonth() + 1));
  closeMonthPanel();
});
document.getElementById("month-current").addEventListener("click", () => {
  const today = new Date();
  selectMonth(monthKey(today.getFullYear(), today.getMonth() + 1));
  closeMonthPanel();
});

document.getElementById("download-backup").addEventListener("click", downloadBackup);
document.getElementById("restore-backup").addEventListener("click", () => {
  document.getElementById("backup-file").click();
});
document.getElementById("backup-file").addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (file) {
    restoreBackup(file);
  }
  event.target.value = "";
});

function setActiveTab(tab) {
  document.body.dataset.activeTab = tab;
  try { localStorage.setItem("personal-finance-web-active-tab", tab); } catch {}
  document.querySelectorAll(".tab-button").forEach((button) => {
    const isActive = button.dataset.tab === tab;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function setTheme(theme) {
  const isDarkMode = theme === "dark";
  document.body.classList.toggle("dark-mode", isDarkMode);
  document.getElementById("theme-toggle").textContent = isDarkMode ? "☀ 浅色模式" : "☾ 深色模式";
  try {
    localStorage.setItem("personal-finance-web-theme", theme);
  } catch {
    // 浏览器不允许本机储存时，仍可在当前画面切换颜色。
  }
}

function loadTheme() {
  try {
    return localStorage.getItem("personal-finance-web-theme") || "light";
  } catch {
    return "light";
  }
}

function loadActiveTab() {
  try {
    return localStorage.getItem("personal-finance-web-active-tab") || "assets";
  } catch {
    return "assets";
  }
}

document.querySelectorAll(".tab-button").forEach((button) => {
  button.addEventListener("click", () => setActiveTab(button.dataset.tab));
});

document.getElementById("theme-toggle").addEventListener("click", () => {
  setTheme(document.body.classList.contains("dark-mode") ? "light" : "dark");
});

renderAll();
setActiveTab(loadActiveTab());
setTheme(loadTheme());
setupAssetForm("malaysia", regions.malaysia);
setupAssetForm("taiwan", regions.taiwan);
setupAssetPanel("malaysia");
setupAssetPanel("taiwan");
setupTransactionForm("malaysia", regions.malaysia);
setupTransactionForm("taiwan", regions.taiwan);
setupTransactionPanel("malaysia");
setupTransactionPanel("taiwan");
setupLiabilityForm("malaysia", regions.malaysia);
setupLiabilityForm("taiwan", regions.taiwan);
setupLiabilityPanel("malaysia");
setupLiabilityPanel("taiwan");
setupNoteForm("malaysia");
setupNoteForm("taiwan");
setupAuth();
setupCloudImport();
refreshAccount();

