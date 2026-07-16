// ================= 1. FIREBASE CONFIGURATION =================
const firebaseConfig = {
  apiKey: "AIzaSyA6gAEZihvB5nR3X2fhHVTRuJjDvdy2wNw",
  authDomain: "cement-sales.firebaseapp.com",
  projectId: "cement-sales",
  storageBucket: "cement-sales.firebasestorage.app",
  messagingSenderId: "672621859889",
  appId: "1:672621859889:web:6be91ae4919637d7de7110"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const db = firebase.firestore();

const CLOUD_NAME = "o8a7vquz";
const UPLOAD_PRESET = "cement-receipt";
const PRICE_PER_BAG = 15400;

// Vigezo vya Bonus - inategemea jumla ya bags za mwezi mzima
const BONUS_THRESHOLD_1 = 3000; // chini ya hii, hakuna bonus (0)
const BONUS_THRESHOLD_2 = 6000;
const BONUS_THRESHOLD_3 = 9000;
const BONUS_RATE_1 = 250; // rate kwa bags 3000 - 5999
const BONUS_RATE_2 = 400; // rate kwa bags 6000 - 8999
const BONUS_RATE_3 = 550; // rate kwa bags 9000+

// Huamua rate ya bonus kwa kila bag kutegemea jumla ya bags za mwezi
function getBonusRate(totalBags) {
  if (totalBags >= BONUS_THRESHOLD_3) return BONUS_RATE_3;
  if (totalBags >= BONUS_THRESHOLD_2) return BONUS_RATE_2;
  return BONUS_RATE_1; // rate ya msingi (inatumika kwenye table hata chini ya 3000)
}

const monthNamesSw = ["January","February","March","April","May","June","July","August","September","Oktober","November","December"];

let supLastSumBalance = 0;
let supLastSumExpenses = 0;
let mngrLastSumBalance = 0;
let mngrLastSumExpenses = 0;

const loginSection = document.getElementById('loginSection');
const loginBtn = document.getElementById('loginBtn');
const errorMsg = document.getElementById('errorMsg');
const passwordInput = document.getElementById('password');

const supervisorDashboard = document.getElementById('supervisorDashboard');
const managerDashboard = document.getElementById('managerDashboard');

const supMonthPicker = document.getElementById('supMonthPicker');
const bagsInput = document.getElementById('bags');
const totalPriceInput = document.getElementById('totalPrice');
const amountPaidInput = document.getElementById('amountPaid');
const balanceInput = document.getElementById('balance');
const submitSaleBtn = document.getElementById('submitSaleBtn');
const saleStatusMsg = document.getElementById('saleStatusMsg');
const submitExpenseBtn = document.getElementById('submitExpenseBtn');
const expenseStatusMsg = document.getElementById('expenseStatusMsg');

const customerCreditDisplay = document.getElementById('customerCreditDisplay');
const checkCreditBtn = document.getElementById('checkCreditBtn');

const mngrMonthPicker = document.getElementById('mngrMonthPicker');

window.addEventListener('DOMContentLoaded', () => {
  if (supMonthPicker) supMonthPicker.value = currentMonthStr();
  if (mngrMonthPicker) mngrMonthPicker.value = currentMonthStr();
  
  const saleDateInput = document.getElementById('saleDate');
  if (saleDateInput) saleDateInput.value = new Date().toISOString().split('T')[0];

  const cachedRole = sessionStorage.getItem('userRole');
  if (cachedRole === 'supervisor') {
    showDashboard('supervisor');
  } else if (cachedRole === 'manager') {
    showDashboard('manager');
  } else {
    if (loginSection) loginSection.style.display = 'flex';
    if (supervisorDashboard) supervisorDashboard.style.display = 'none';
    if (managerDashboard) managerDashboard.style.display = 'none';
  }
});

function getMonthLabel(monthStr) {
  if (!monthStr) return "";
  const parts = monthStr.split('-');
  return monthNamesSw[parseInt(parts[1], 10) - 1] + " " + parts[0];
}

function currentMonthStr() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, '0');
}

function showDashboard(role) {
  if (loginSection) loginSection.style.display = 'none';
  
  if (role === 'supervisor') {
    if (supervisorDashboard) supervisorDashboard.style.display = 'block';
    if (managerDashboard) managerDashboard.style.display = 'none';
    refreshSupTitles();
    loadSupervisorData();
  } else if (role === 'manager') {
    if (supervisorDashboard) supervisorDashboard.style.display = 'none';
    if (managerDashboard) managerDashboard.style.display = 'block';
    refreshMngrTitles();
    loadManagerData();
  }
}

if (loginBtn) {
  loginBtn.addEventListener('click', doLogin);
}
if (passwordInput) {
  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') doLogin();
  });
}

async function doLogin() {
  const password = passwordInput.value.trim();
  if (errorMsg) errorMsg.style.display = 'none';
  if (!password) return;

  loginBtn.disabled = true;
  loginBtn.textContent = 'loading...';

  try {
    const managerDoc = await db.collection('users').doc('manager').get();
    if (managerDoc.exists) {
      const dbPassword = String(managerDoc.data().password).trim();
      if (dbPassword === password) {
        sessionStorage.setItem('userRole', 'manager');
        showDashboard('manager');
        return;
      }
    }
    
    const supervisorDoc = await db.collection('users').doc('supervisor').get();
    if (supervisorDoc.exists) {
      const dbPassword = String(supervisorDoc.data().password).trim();
      if (dbPassword === password) {
        sessionStorage.setItem('userRole', 'supervisor');
        showDashboard('supervisor');
        return;
      }
    }
    
    showError('Password si sahihi. Jaribu tena.');
  } catch (err) {
    console.error("Firebase Login Error:", err);
    showError('Connection Error. Angalia connection yako.');
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = 'Login';
  }
}

function showError(msg) {
  if (errorMsg) {
    errorMsg.textContent = msg;
    errorMsg.style.display = 'block';
  }
}

function refreshSupTitles() {
  const label = getMonthLabel(supMonthPicker.value);
  const title1 = document.getElementById('supPageTitle');
  const title2 = document.getElementById('supSalesTableTitle');
  if (title1) title1.textContent = "SALES SUPERVISOR - " + label;
  if (title2) title2.textContent = "Mauzo ya " + label;
}

if (supMonthPicker) {
  supMonthPicker.addEventListener('change', () => {
    refreshSupTitles();
    loadSupervisorData();
  });
}

function recalc() {
  if (!bagsInput || !totalPriceInput || !amountPaidInput || !balanceInput) return;
  const bags = parseFloat(bagsInput.value) || 0;
  const total = bags * PRICE_PER_BAG;
  totalPriceInput.value = total.toLocaleString();
  const paid = parseFloat(amountPaidInput.value.replace(/,/g, '')) || 0;
  const balance = paid - total;
  balanceInput.value = balance.toLocaleString();
}
if (bagsInput) bagsInput.addEventListener('input', recalc);

if (amountPaidInput) {
  amountPaidInput.addEventListener('input', () => {
    let digitsOnly = amountPaidInput.value.replace(/[^0-9]/g, '');
    if (digitsOnly === '') {
      amountPaidInput.value = '';
    } else {
      amountPaidInput.value = parseInt(digitsOnly, 10).toLocaleString();
    }
    recalc();
  });
}

// ================= ANGALIA CREDIT/BALANCE YA MTEJA (LIVE, KUTOKA HISTORIA YA MAUZO) =================
// Hakuna collection ya ziada - tunachukua mauzo yote ya nyuma ya mteja huyu (Jina + Namba ya Gari)
// na kujumlisha balance zake (paid - total). Jumla chanya = ana credit. Jumla hasi = anadaiwa.
async function checkCustomerCredit() {
  const name = document.getElementById('customerName').value.trim();
  const vehicle = document.getElementById('vehicleNumber').value.trim();

  if (!name || !vehicle) {
    alert('Jaza Jina na Namba ya Gari kwanza, kisha Click View.');
    return;
  }

  checkCreditBtn.disabled = true;
  checkCreditBtn.textContent = '...';

  try {
    const snap = await db.collection('sales')
      .where('customerName', '==', name)
      .where('vehicleNumber', '==', vehicle)
      .get();

    let sumBalance = 0;
    snap.forEach(doc => {
      sumBalance += doc.data().balance || 0;
    });

    customerCreditDisplay.textContent = 'TZS ' + sumBalance.toLocaleString();
  } catch (err) {
    console.error(err);
    customerCreditDisplay.textContent = 'Error';
  } finally {
    checkCreditBtn.disabled = false;
    checkCreditBtn.textContent = 'View';
  }
}
if (checkCreditBtn) checkCreditBtn.addEventListener('click', checkCustomerCredit);

function resetCreditUI() {
  if (customerCreditDisplay) customerCreditDisplay.textContent = 'TZS 0';
}

async function uploadToCloudinary(file) {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('upload_preset', UPLOAD_PRESET);
  const res = await fetch("https://api.cloudinary.com/v1_1/" + CLOUD_NAME + "/image/upload", {
    method: 'POST', body: formData
  });
  const data = await res.json();
  if (!data.secure_url) throw new Error('Upload failed');
  return data.secure_url;
}

if (submitSaleBtn) {
  submitSaleBtn.addEventListener('click', async () => {
    const date = document.getElementById('saleDate').value;
    const customerName = document.getElementById('customerName').value.trim();
    const vehicleNumber = document.getElementById('vehicleNumber').value.trim();
    const trailerNumber = document.getElementById('trailerNumber').value.trim();
    const bags = parseFloat(bagsInput.value) || 0;
    const amountPaid = parseFloat(amountPaidInput.value.replace(/,/g, '')) || 0;
    const receiptFile = document.getElementById('receiptFile').files[0];

    saleStatusMsg.textContent = '';
    saleStatusMsg.className = 'status-msg';

    if (!date || !vehicleNumber || !trailerNumber || !bags || !receiptFile) {
      saleStatusMsg.textContent = 'Jaza Tarehe, Namba ya Gari, Namba ya Trailer, Bags, na Picha ya Risiti.';
      saleStatusMsg.classList.add('error');
      return;
    }

    submitSaleBtn.disabled = true;
    submitSaleBtn.textContent = 'Uploading picture...';

    try {
      const receiptUrl = await uploadToCloudinary(receiptFile);
      const total = bags * PRICE_PER_BAG;
      const balance = amountPaid - total;
      const month = date.substring(0,7);

      submitSaleBtn.textContent = 'Saving...';

      await db.collection('sales').add({
        date, customerName, vehicleNumber, trailerNumber,
        bags, totalPrice: total, amountPaid, balance,
        receiptUrl, month,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      saleStatusMsg.textContent = 'Records are saved successifully!';
      saleStatusMsg.classList.add('success');

      document.getElementById('customerName').value = '';
      document.getElementById('vehicleNumber').value = '';
      document.getElementById('trailerNumber').value = '';
      bagsInput.value = '';
      amountPaidInput.value = '';
      document.getElementById('receiptFile').value = '';
      resetCreditUI();
      recalc();

      if (month === supMonthPicker.value) loadSupervisorData();

    } catch (err) {
      console.error(err);
      saleStatusMsg.textContent = 'Hitilafu: ' + err.message;
      saleStatusMsg.classList.add('error');
    } finally {
      submitSaleBtn.disabled = false;
      submitSaleBtn.textContent = 'Save Data';
    }
  });
}

async function loadSupervisorData() {
  await loadSupSales();
  await loadSupExpenses();
}

async function loadSupSales() {
  const tbody = document.getElementById('supSalesTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="11">Download...</td></tr>';

  const snap = await db.collection('sales').where('month', '==', supMonthPicker.value).orderBy('date').get();
  const docs = snap.docs;

  // Pass 1: pata jumla ya bags kwanza, ili tujue rate ya bonus inayotumika
  let sumBags = 0;
  docs.forEach(doc => {
    sumBags += doc.data().bags || 0;
  });
  const bonusRate = getBonusRate(sumBags);

  let sumTotal=0, sumPaid=0, sumBalance=0, sumBonus=0;
  tbody.innerHTML = '';

  if (docs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="11">Hakuna rekodi kwa mwezi huu.</td></tr>';
  }

  docs.forEach(doc => {
    const d = doc.data();
    sumTotal += d.totalPrice || 0;
    sumPaid += d.amountPaid || 0;
    sumBalance += d.balance || 0;
    const rowBonus = (d.bags || 0) * bonusRate;
    sumBonus += rowBonus;

    const tr = document.createElement('tr');
    tr.innerHTML =
       '<td>' + d.date + '</td>' +
       '<td>' + (d.customerName||'') + '</td>' +
       '<td>' + d.vehicleNumber + '</td>' +
       '<td>' + d.trailerNumber + '</td>' +
       '<td>' + d.bags + '</td>' +
       '<td>' + (d.totalPrice||0).toLocaleString() + '</td>' +
       '<td>' + (d.amountPaid||0).toLocaleString() + '</td>' +
       '<td>' + (d.balance||0).toLocaleString() + '</td>' +
       '<td><a class="receipt-link" href="' + d.receiptUrl + '" target="_blank">View receipt</a></td>' +
       '<td>' + rowBonus.toLocaleString() + '</td>' +
       '<td><button class="del-btn" onclick="deleteSale(\'' + doc.id + '\')">X</button></td>';
    tbody.appendChild(tr);
  });

  document.getElementById('supSumBags').textContent = sumBags.toLocaleString();
  document.getElementById('supSumTotal').textContent = sumTotal.toLocaleString();
  document.getElementById('supSumPaid').textContent = sumPaid.toLocaleString();
  document.getElementById('supSumBalance').textContent = sumBalance.toLocaleString();
  document.getElementById('supSumBonus').textContent = sumBonus.toLocaleString();
  document.getElementById('supBalanceJuu').textContent = 'TZS ' + sumBalance.toLocaleString();

  // Total Bonus box: 0 mpaka jumla ya bags ifike 3000
  const totalBonusDisplay = (sumBags >= BONUS_THRESHOLD_1) ? sumBonus : 0;
  document.getElementById('supBonusJuu').textContent = 'TZS ' + totalBonusDisplay.toLocaleString();

  updateSupBalanceKuu(sumBalance, null);
}

window.deleteSale = async function(id) {
  if (!confirm('Are you sure you want to delete this record?')) return;
  await db.collection('sales').doc(id).delete();
  loadSupervisorData();
};

if (submitExpenseBtn) {
  submitExpenseBtn.addEventListener('click', async () => {
    const desc = document.getElementById('expenseDesc').value.trim();
    const amount = parseFloat(document.getElementById('expenseAmount').value) || 0;

    expenseStatusMsg.textContent = '';
    expenseStatusMsg.className = 'status-msg';

    if (!desc || !amount) {
      expenseStatusMsg.textContent = 'Jaza maelezo na kiasi cha matumizi.';
      expenseStatusMsg.classList.add('error');
      return;
    }

    submitExpenseBtn.disabled = true;

    try {
      await db.collection('expenses').add({
        description: desc, amount,
        month: supMonthPicker.value,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      expenseStatusMsg.textContent = 'Expenses Saved!';
      expenseStatusMsg.classList.add('success');

      document.getElementById('expenseDesc').value = '';
      document.getElementById('expenseAmount').value = '';

      loadSupervisorData();
    } catch (err) {
      console.error(err);
      expenseStatusMsg.textContent = 'Hitilafu: ' + err.message;
      expenseStatusMsg.classList.add('error');
    } finally {
      submitExpenseBtn.disabled = false;
    }
  });
}

async function loadSupExpenses() {
  const tbody = document.getElementById('supExpensesTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="3">Uploading...</td></tr>';

  const snap = await db.collection('expenses').where('month', '==', supMonthPicker.value).orderBy('createdAt').get();
  let sumExpenses = 0;
  tbody.innerHTML = '';

  if (snap.empty) {
    tbody.innerHTML = '<tr><td colspan="3">Hakuna matumizi kwa mwezi huu.</td></tr>';
  }

  snap.forEach(doc => {
    const d = doc.data();
    sumExpenses += d.amount || 0;
    const tr = document.createElement('tr');
    tr.innerHTML =
       '<td>' + d.description + '</td>' +
       '<td>' + (d.amount||0).toLocaleString() + '</td>' +
       '<td><button class="del-btn" onclick="deleteExpense(\'' + doc.id + '\')">X</button></td>';
    tbody.appendChild(tr);
  });

  document.getElementById('supSumExpenses').textContent = sumExpenses.toLocaleString();
  updateSupBalanceKuu(null, sumExpenses);
}

window.deleteExpense = async function(id) {
  if (!confirm('Are you sure you want to delete this expense?')) return;
  await db.collection('expenses').doc(id).delete();
  loadSupervisorData();
};

function updateSupBalanceKuu(sumBalance, sumExpenses) {
  if (sumBalance !== null && sumBalance !== undefined) supLastSumBalance = sumBalance;
  if (sumExpenses !== null && sumExpenses !== undefined) supLastSumExpenses = sumExpenses;
  const kuu = supLastSumBalance - supLastSumExpenses;
  const el = document.getElementById('supBalanceKuu');
  if (el) el.textContent = 'TZS ' + kuu.toLocaleString();
}

function refreshMngrTitles() {
  const label = getMonthLabel(mngrMonthPicker.value);
  const title1 = document.getElementById('mngrPageTitle');
  const title2 = document.getElementById('mngrSalesTableTitle');
  if (title1) title1.textContent = "BUSINESS MANAGER -"+ label;
  if (title2) title2.textContent = "Rekodi za Mauzo - " + label;
}

if (mngrMonthPicker) {
  mngrMonthPicker.addEventListener('change', () => {
    refreshMngrTitles();
    loadManagerData();
  });
}

async function loadManagerData() {
  await loadMngrSales();
  await loadMngrExpenses();
}

async function loadMngrSales() {
  const tbody = document.getElementById('mngrSalesTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="10">Uploading...</td></tr>';

  const snap = await db.collection('sales').where('month', '==', mngrMonthPicker.value).orderBy('date').get();
  const docs = snap.docs;

  // Pass 1: pata jumla ya bags kwanza, ili tujue rate ya bonus inayotumika
  let sumBags = 0;
  docs.forEach(doc => {
    sumBags += doc.data().bags || 0;
  });
  const bonusRate = getBonusRate(sumBags);

  let sumTotal=0, sumPaid=0, sumBalance=0, sumBonus=0;
  
  const weeklyData = {
    1:{count:0,bags:0,total:0,paid:0,balance:0},
    2:{count:0,bags:0,total:0,paid:0,balance:0},
    3:{count:0,bags:0,total:0,paid:0,balance:0},
    4:{count:0,bags:0,total:0,paid:0,balance:0},
    5:{count:0,bags:0,total:0,paid:0,balance:0}
  };

  tbody.innerHTML = '';
  if (docs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10">Hakuna rekodi kwa mwezi huu.</td></tr>';
  }

  docs.forEach(doc => {
    const d = doc.data();
    sumTotal += d.totalPrice || 0;
    sumPaid += d.amountPaid || 0;
    sumBalance += d.balance || 0;
    const rowBonus = (d.bags || 0) * bonusRate;
    sumBonus += rowBonus;

    const day = parseInt(d.date.split('-')[2], 10);
    const weekNum = Math.min(Math.ceil(day / 7), 5);
    weeklyData[weekNum].count += 1;
    weeklyData[weekNum].bags += d.bags || 0;
    weeklyData[weekNum].total += d.totalPrice || 0;
    weeklyData[weekNum].paid += d.amountPaid || 0;
    weeklyData[weekNum].balance += d.balance || 0;

    const tr = document.createElement('tr');
    tr.innerHTML =
       '<td>' + d.date + '</td>' +
       '<td>' + (d.customerName||'') + '</td>' +
       '<td>' + d.vehicleNumber + '</td>' +
       '<td>' + d.trailerNumber + '</td>' +
       '<td>' + d.bags + '</td>' +
       '<td>' + (d.totalPrice||0).toLocaleString() + '</td>' +
       '<td>' + (d.amountPaid||0).toLocaleString() + '</td>' +
       '<td>' + (d.balance||0).toLocaleString() + '</td>' +
       '<td><a class="receipt-link" href="' + d.receiptUrl + '" target="_blank">View receipt</a></td>' +
       '<td>' + rowBonus.toLocaleString() + '</td>';
    tbody.appendChild(tr);
  });

  document.getElementById('mngrSumBags').textContent = sumBags.toLocaleString();
  document.getElementById('mngrSumTotal').textContent = sumTotal.toLocaleString();
  document.getElementById('mngrSumPaid').textContent = sumPaid.toLocaleString();
  document.getElementById('mngrSumBalance').textContent = sumBalance.toLocaleString();
  document.getElementById('mngrSumBonus').textContent = sumBonus.toLocaleString();
  document.getElementById('mngrBalanceJuu').textContent = 'TZS ' + sumBalance.toLocaleString();

  // Total Bonus box: 0 mpaka jumla ya bags ifike 3000
  const totalBonusDisplay = (sumBags >= BONUS_THRESHOLD_1) ? sumBonus : 0;
  document.getElementById('mngrBonusJuu').textContent = 'TZS ' + totalBonusDisplay.toLocaleString();

  updateMngrBalanceKuu(sumBalance, null);

  const weeklyBody = document.getElementById('weeklyTableBody');
  if (!weeklyBody) return;
  weeklyBody.innerHTML = '';
  for (let w = 1; w <= 5; w++) {
    const wd = weeklyData[w];
    if (wd.count === 0) continue;
    const tr = document.createElement('tr');
    tr.innerHTML =
       '<td>Wiki ' + w + '</td>' +
       '<td>' + wd.count + '</td>' +
       '<td>' + wd.bags.toLocaleString() + '</td>' +
       '<td>' + wd.total.toLocaleString() + '</td>' +
       '<td>' + wd.paid.toLocaleString() + '</td>' +
       '<td>' + wd.balance.toLocaleString() + '</td>';
    weeklyBody.appendChild(tr);
  }
  if (weeklyBody.innerHTML === '') {
    weeklyBody.innerHTML = '<tr><td colspan="6">Hakuna data kwa mwezi huu.</td></tr>';
  }
}

async function loadMngrExpenses() {
  const tbody = document.getElementById('mngrExpensesTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="2">Uploading...</td></tr>';

  const snap = await db.collection('expenses').where('month', '==', mngrMonthPicker.value).orderBy('createdAt').get();
  let sumExpenses = 0;
  tbody.innerHTML = '';
  if (snap.empty) {
    tbody.innerHTML = '<tr><td colspan="2">Hakuna matumizi kwa mwezi huu.</td></tr>';
  }

  snap.forEach(doc => {
    const d = doc.data();
    sumExpenses += d.amount || 0;
    const tr = document.createElement('tr');
    tr.innerHTML = '<td>' + d.description + '</td><td>' + (d.amount||0).toLocaleString() + '</td>';
    tbody.appendChild(tr);
  });

  document.getElementById('mngrSumExpenses').textContent = sumExpenses.toLocaleString();
  updateMngrBalanceKuu(null, sumExpenses);
}

function updateMngrBalanceKuu(sumBalance, sumExpenses) {
  if (sumBalance !== null && sumBalance !== undefined) mngrLastSumBalance = sumBalance;
  if (sumExpenses !== null && sumExpenses !== undefined) mngrLastSumExpenses = sumExpenses;
  const kuu = mngrLastSumBalance - mngrLastSumExpenses;
  const el = document.getElementById('mngrBalanceKuu');
  if (el) el.textContent = 'TZS ' + kuu.toLocaleString();
}

const logoutHandler = () => {
  sessionStorage.clear();
  if (loginSection) loginSection.style.display = 'flex';
  if (supervisorDashboard) supervisorDashboard.style.display = 'none';
  if (managerDashboard) managerDashboard.style.display = 'none';
  if (passwordInput) passwordInput.value = '';
};

const supLogout = document.getElementById('supLogoutBtn');
const mngrLogout = document.getElementById('mngrLogoutBtn');
if (supLogout) supLogout.addEventListener('click', logoutHandler);
if (mngrLogout) mngrLogout.addEventListener('click', logoutHandler);
