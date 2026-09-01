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

// Enable offline persistence/caching so repeat reads don't always hit the network
db.enablePersistence().catch((err) => {
  console.warn("Offline persistence haikuwezekana: ", err.code);
});

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

// Balance iliyobaki kutoka mwezi uliopita (Opening Balance) - carry-forward
let supOpeningBalance = 0;
let mngrOpeningBalance = 0;

// ================= PERFORMANCE CACHE (per month) =================
// Sales/expenses ni sawa kwa Supervisor na Manager (collection moja), hivyo
// tunacache kwa "month" bila kujali role - ikiisha muda (TTL) inasoma tena.
const salesCache = {};     // month -> { docs, time }
const expensesCache = {};  // month -> { docs, time }
const DATA_CACHE_TTL_MS = 30000; // sekunde 30

async function getSalesForMonth(month, forceRefresh) {
  const cached = salesCache[month];
  if (!forceRefresh && cached && (Date.now() - cached.time < DATA_CACHE_TTL_MS)) {
    return cached.docs;
  }
  const snap = await db.collection('sales').where('month', '==', month).orderBy('date').get();
  const docs = snap.docs.map(d => ({ id: d.id, data: d.data() }));
  salesCache[month] = { docs, time: Date.now() };
  return docs;
}

async function getExpensesForMonth(month, forceRefresh) {
  const cached = expensesCache[month];
  if (!forceRefresh && cached && (Date.now() - cached.time < DATA_CACHE_TTL_MS)) {
    return cached.docs;
  }
  const snap = await db.collection('expenses').where('month', '==', month).orderBy('createdAt').get();
  const docs = snap.docs.map(d => ({ id: d.id, data: d.data() }));
  expensesCache[month] = { docs, time: Date.now() };
  return docs;
}

function invalidateMonthCache(month) {
  delete salesCache[month];
  delete expensesCache[month];
}

// ================= OPENING/CLOSING BALANCE (KUBEBA BALANCE KATI YA MIEZI) =================
function getPreviousMonthStr(monthStr) {
  const parts = monthStr.split('-');
  let year = parseInt(parts[0], 10);
  let month = parseInt(parts[1], 10);
  month -= 1;
  if (month < 1) { month = 12; year -= 1; }
  return year + "-" + String(month).padStart(2, '0');
}

async function getOpeningBalance(month) {
  const prevMonth = getPreviousMonthStr(month);
  return await getOrComputeClosingBalance(prevMonth);
}

async function getOrComputeClosingBalance(month) {
  try {
    const doc = await db.collection('monthlyBalances').doc(month).get();
    if (doc.exists) return doc.data().closingBalance || 0;
  } catch (err) {
    console.error('Imeshindikana kusoma closing balance:', err);
  }

  let salesDocs = [], expenseDocs = [];
  try {
    [salesDocs, expenseDocs] = await Promise.all([
      getSalesForMonth(month),
      getExpensesForMonth(month)
    ]);
  } catch (err) {
    console.error('Imeshindikana kusoma sales/expenses za backfill:', err);
    return 0;
  }

  if (salesDocs.length === 0 && expenseDocs.length === 0) {
    return 0;
  }

  let sumBalance = 0, sumExpenses = 0;
  salesDocs.forEach(d => sumBalance += d.data.balance || 0);
  expenseDocs.forEach(d => sumExpenses += d.data.amount || 0);

  const prevOpening = await getOrComputeClosingBalance(getPreviousMonthStr(month));
  const closing = prevOpening + sumBalance - sumExpenses;

  await saveClosingBalance(month, closing);
  return closing;
}

async function saveClosingBalance(month, closingBalance) {
  try {
    await db.collection('monthlyBalances').doc(month).set({
      closingBalance,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    });
  } catch (err) {
    console.error('Imeshindikana kuhifadhi closing balance:', err);
  }
}

// ================= SUPERVISOR BALANCE POOL (fedha zilizohamishwa kutoka kwa wateja) =================
// "supervisorPool/main" ni document moja inayoshikilia jumla ya fedha
// zilizohamishwa kutoka kwa wateja kwenda kwa Supervisor. Fedha hizi
// hupungua kila zinapotumika kulipia sale mpya kwa chaguo "Balance ya Supervisor".
const SUPERVISOR_POOL_DOC = 'main';

async function getSupervisorPoolBalance() {
  try {
    const doc = await db.collection('supervisorPool').doc(SUPERVISOR_POOL_DOC).get();
    if (doc.exists) return doc.data().balance || 0;
    return 0;
  } catch (err) {
    console.error('Imeshindikana kusoma Balance ya Supervisor:', err);
    return 0;
  }
}

async function adjustSupervisorPoolBalance(delta) {
  const ref = db.collection('supervisorPool').doc(SUPERVISOR_POOL_DOC);
  await ref.set({
    balance: firebase.firestore.FieldValue.increment(delta),
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
}

async function refreshSupervisorPoolDisplay() {
  const el = document.getElementById('supPoolBalanceDisplay');
  if (!el) return;
  const bal = await getSupervisorPoolBalance();
  el.textContent = 'TZS ' + bal.toLocaleString();
}

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

// ---- CHANZO CHA MALIPO (Cash / Balance ya Supervisor) ----
const paymentSourceSelect = document.getElementById('paymentSource');
const balanceInfoBox = document.getElementById('balanceInfoBox');
const balCurrentAmountEl = document.getElementById('balCurrentAmount');

// ---- HAMISHA BALANCE YA MTEJA KWENDA KWA SUPERVISOR ----
const transferCustomerNameInput = document.getElementById('transferCustomerName');
const transferCheckBalanceBtn = document.getElementById('transferCheckBalanceBtn');
const transferCustomerBalanceDisplay = document.getElementById('transferCustomerBalanceDisplay');
const transferAmountInput = document.getElementById('transferAmount');
const transferReasonInput = document.getElementById('transferReason');
const transferSubmitBtn = document.getElementById('transferSubmitBtn');
const transferStatusMsg = document.getElementById('transferStatusMsg');

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
    refreshSupervisorPoolDisplay();
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
    const [managerDoc, supervisorDoc] = await Promise.all([
      db.collection('users').doc('manager').get(),
      db.collection('users').doc('supervisor').get()
    ]);

    if (managerDoc.exists) {
      const dbPassword = String(managerDoc.data().password).trim();
      if (dbPassword === password) {
        sessionStorage.setItem('userRole', 'manager');
        showDashboard('manager');
        return;
      }
    }

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

// ================= ANGALIA CREDIT/BALANCE YA MTEJA (LIVE) =================
// Balance ya mteja = jumla ya (paid - total) za sales zake, TOA kiasi
// chochote ambacho tayari amekwisha "kihamisha" kwenda kwa Supervisor.
async function getCustomerBalance(name) {
  const salesSnap = await db.collection('sales')
    .where('customerName', '==', name)
    .get();

  let sumBalance = 0;
  salesSnap.forEach(doc => {
    sumBalance += doc.data().balance || 0;
  });

  const transfersSnap = await db.collection('balanceTransfers')
    .where('customerName', '==', name)
    .get();

  let sumTransferred = 0;
  transfersSnap.forEach(doc => {
    sumTransferred += doc.data().amount || 0;
  });

  return sumBalance - sumTransferred;
}

async function checkCustomerCredit() {
  const name = document.getElementById('customerName').value.trim();

  if (!name) {
    alert('Jaza Jina la Mteja kwanza, kisha Click View.');
    return;
  }

  checkCreditBtn.disabled = true;
  checkCreditBtn.textContent = '...';

  try {
    const sumBalance = await getCustomerBalance(name);
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

// ---- CHANZO CHA MALIPO: onyesha Balance ya Supervisor mtu anapochagua "Balance ya Supervisor" ----
async function updateBalanceInfoBox() {
  if (!paymentSourceSelect || paymentSourceSelect.value !== 'balance') {
    if (balanceInfoBox) balanceInfoBox.style.display = 'none';
    return;
  }
  if (balanceInfoBox) balanceInfoBox.style.display = 'block';
  if (balCurrentAmountEl) balCurrentAmountEl.textContent = '...';
  try {
    const bal = await getSupervisorPoolBalance();
    if (balCurrentAmountEl) balCurrentAmountEl.textContent = 'TZS ' + bal.toLocaleString();
  } catch (err) {
    console.error(err);
    if (balCurrentAmountEl) balCurrentAmountEl.textContent = 'Error';
  }
}

if (paymentSourceSelect) {
  paymentSourceSelect.addEventListener('change', updateBalanceInfoBox);
}

// ================= HAMISHA BALANCE YA MTEJA KWENDA KWA SUPERVISOR =================
if (transferCheckBalanceBtn) {
  transferCheckBalanceBtn.addEventListener('click', async () => {
    const name = transferCustomerNameInput.value.trim();
    if (!name) {
      alert('Jaza Jina la Mteja kwanza.');
      return;
    }
    transferCheckBalanceBtn.disabled = true;
    transferCheckBalanceBtn.textContent = '...';
    try {
      const bal = await getCustomerBalance(name);
      transferCustomerBalanceDisplay.textContent = 'TZS ' + bal.toLocaleString();
    } catch (err) {
      console.error(err);
      transferCustomerBalanceDisplay.textContent = 'Error';
    } finally {
      transferCheckBalanceBtn.disabled = false;
      transferCheckBalanceBtn.textContent = 'View';
    }
  });
}

if (transferSubmitBtn) {
  transferSubmitBtn.addEventListener('click', async () => {
    const name = transferCustomerNameInput.value.trim();
    const amount = parseFloat(transferAmountInput.value.replace(/,/g, '')) || 0;
    const reason = transferReasonInput ? transferReasonInput.value.trim() : '';

    transferStatusMsg.textContent = '';
    transferStatusMsg.className = 'status-msg';

    if (!name || !amount || amount <= 0) {
      transferStatusMsg.textContent = 'Jaza Jina la Mteja na Kiasi sahihi cha kuhamisha.';
      transferStatusMsg.classList.add('error');
      return;
    }

    transferSubmitBtn.disabled = true;
    transferSubmitBtn.textContent = 'Inaangalia balance...';

    try {
      const currentBalance = await getCustomerBalance(name);
      if (amount > currentBalance) {
        transferStatusMsg.textContent = 'Balance ya ' + name + ' ni TZS ' + currentBalance.toLocaleString() + ' - huwezi kuhamisha zaidi ya hapo.';
        transferStatusMsg.classList.add('error');
        transferSubmitBtn.disabled = false;
        transferSubmitBtn.textContent = 'Hamisha';
        return;
      }

      transferSubmitBtn.textContent = 'Inahamisha...';

      await db.collection('balanceTransfers').add({
        customerName: name,
        amount,
        reason,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });

      await adjustSupervisorPoolBalance(amount);

      transferStatusMsg.textContent = 'Balance ya TZS ' + amount.toLocaleString() + ' imehamishwa kutoka kwa ' + name + ' kwenda kwako.';
      transferStatusMsg.classList.add('success');

      transferCustomerNameInput.value = '';
      transferAmountInput.value = '';
      if (transferReasonInput) transferReasonInput.value = '';
      if (transferCustomerBalanceDisplay) transferCustomerBalanceDisplay.textContent = 'TZS 0';

      refreshSupervisorPoolDisplay();

    } catch (err) {
      console.error(err);
      transferStatusMsg.textContent = 'Hitilafu: ' + err.message;
      transferStatusMsg.classList.add('error');
    } finally {
      transferSubmitBtn.disabled = false;
      transferSubmitBtn.textContent = 'Hamisha';
    }
  });
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
    const paymentSource = paymentSourceSelect ? paymentSourceSelect.value : 'cash';

    saleStatusMsg.textContent = '';
    saleStatusMsg.className = 'status-msg';

    if (!date || !vehicleNumber || !trailerNumber || !bags || !receiptFile) {
      saleStatusMsg.textContent = 'Jaza Tarehe, Namba ya Gari, Namba ya Trailer, Bags, na Picha ya Risiti.';
      saleStatusMsg.classList.add('error');
      return;
    }

    // Kama malipo yanatoka "Balance ya Supervisor" - HAKUNA haja ya jina la mteja.
    // Tunaangalia tu kama Balance ya Supervisor iliyopo inatosha kiasi kinachotumika.
    if (paymentSource === 'balance') {
      submitSaleBtn.disabled = true;
      submitSaleBtn.textContent = 'Inaangalia Balance ya Supervisor...';

      let poolBalance = 0;
      try {
        poolBalance = await getSupervisorPoolBalance();
      } catch (err) {
        console.error(err);
        saleStatusMsg.textContent = 'Imeshindikana kuangalia Balance ya Supervisor. Jaribu tena.';
        saleStatusMsg.classList.add('error');
        submitSaleBtn.disabled = false;
        submitSaleBtn.textCont
