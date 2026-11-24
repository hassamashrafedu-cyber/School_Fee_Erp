/**
 * Manual regression tests: Advanced To + concession allocation (no DB).
 * Run: node scripts/test-advance-concession.js
 */
const {
  distributeLedger,
  roundMoney,
  attributedAmountForCalendarYear,
  concessionCountsTowardCalendarYear,
} = require("../src/services/feeLedgerService");

const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function bm(month, year, fee) {
  return {
    month,
    year,
    monthLabel: MONTH[month - 1],
    label: `${MONTH[month - 1]} ${year}`,
    fee: roundMoney(fee),
    monthlyPart: roundMoney(fee),
  };
}

function link(id, sy, sm, ty, tm, sort = 0) {
  return { id, source_year: sy, source_month: sm, target_year: ty, target_month: tm, sort_order: sort };
}

function pay(id, amount, date, allocations, type = "payment") {
  return {
    id,
    amount_paid: amount,
    payment_date: date,
    payment_type: type,
    deleted_at: null,
    allocations,
  };
}

function alloc(y, m, amount, kind, linkId = null) {
  return {
    ledger_year: y,
    month: m,
    amount: roundMoney(amount),
    allocation_kind: kind,
    fee_advance_link_id: linkId,
  };
}

function billing2026AugNov() {
  const months = [];
  for (let m = 1; m <= 12; m += 1) {
    if (m === 8) months.push(bm(8, 2026, 1000));
    else if (m === 11) months.push(bm(11, 2026, 500));
    else months.push(bm(m, 2026, 500));
  }
  return months;
}

const augNovLink = link(1, 2026, 8, 2026, 11);

function row(ledger, month, year) {
  return ledger.monthRows.find((r) => r.month === month && r.year === year);
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function runScenario(name, fn) {
  try {
    fn();
    console.log(`  OK ${name}`);
  } catch (e) {
    console.error(`  FAIL ${name}: ${e.message}`);
    process.exitCode = 1;
  }
}

console.log("Advanced To + concession tests\n");

runScenario("same year: partial payment + concession fills Nov", () => {
  const payments = [
    pay("p1", 600, "2026-08-01", [
      alloc(2026, 8, 500, "normal"),
      alloc(2026, 11, 100, "advance", 1),
    ]),
    pay("c1", 400, "2026-08-02", [alloc(2026, 11, 400, "concession")], "concession"),
  ];
  const ledger = distributeLedger(payments, billing2026AugNov(), { month: 8, year: 2026 }, 2026, [augNovLink]);
  const aug = row(ledger, 8, 2026);
  assert(aug.bundleFullyPaid, "August bundle should be fully paid");
  assert(aug.advanceRemainder === 0, `August advance remainder should be 0, got ${aug.advanceRemainder}`);
});

runScenario("same year: full concession only on inferred target", () => {
  const payments = [
    pay("c1", 1000, "2026-08-01", [
      alloc(2026, 8, 500, "concession"),
      alloc(2026, 11, 500, "concession"),
    ], "concession"),
  ];
  const ledger = distributeLedger(payments, billing2026AugNov(), { month: 8, year: 2026 }, 2026, [augNovLink]);
  const aug = row(ledger, 8, 2026);
  assert(aug.bundleFullyPaid, "August should be fully paid via concession split");
});

runScenario("same year: multiple partial concessions", () => {
  const payments = [
    pay("p1", 600, "2026-08-01", [
      alloc(2026, 8, 500, "normal"),
      alloc(2026, 11, 100, "advance", 1),
    ]),
    pay("c1", 200, "2026-08-02", [alloc(2026, 11, 200, "concession")], "concession"),
    pay("c2", 200, "2026-08-03", [alloc(2026, 11, 200, "concession")], "concession"),
  ];
  const ledger = distributeLedger(payments, billing2026AugNov(), { month: 8, year: 2026 }, 2026, [augNovLink]);
  const aug = row(ledger, 8, 2026);
  assert(aug.bundleFullyPaid, "two concessions should complete Nov remainder");
});

runScenario("cross year: pay 600 then concession 450 completes Feb 2027", () => {
  const cyLink = link(4, 2026, 12, 2027, 2);
  const billing = [];
  for (let m = 1; m <= 12; m += 1) {
    if (m === 12) billing.push(bm(12, 2026, 1050));
    else billing.push(bm(m, 2026, 500));
  }
  const offGrid = { "2027-2": 550 };
  const payments = [
    pay("p1", 600, "2026-12-01", [
      alloc(2026, 12, 500, "normal"),
      alloc(2027, 2, 100, "advance", 4),
    ]),
    pay("c1", 450, "2026-12-02", [alloc(2027, 2, 450, "concession")], "concession"),
  ];
  const ledger = distributeLedger(
    payments,
    billing,
    { month: 12, year: 2026 },
    2026,
    [cyLink],
    offGrid
  );
  const dec = row(ledger, 12, 2026);
  assert(dec.bundleFullyPaid, "Dec bundle fully paid after concession to Feb");
  assert(dec.advanceRemainder === 0, `Feb remainder 0, got ${dec.advanceRemainder}`);
});

runScenario("cross year: Dec 2026 → Nov 2027 partial pay + concession", () => {
  const cyLink = link(2, 2026, 12, 2027, 11);
  const billing = [];
  for (let m = 1; m <= 12; m += 1) {
    if (m === 12) billing.push(bm(12, 2026, 1000));
    else billing.push(bm(m, 2026, 500));
  }
  const offGrid = { "2027-11": 500 };
  const payments = [
    pay("p1", 600, "2026-12-01", [
      alloc(2026, 12, 500, "normal"),
      alloc(2027, 11, 100, "advance", 2),
    ]),
    pay("c1", 400, "2026-12-02", [alloc(2027, 11, 400, "concession")], "concession"),
  ];
  const ledger = distributeLedger(
    payments,
    billing,
    { month: 12, year: 2026 },
    2026,
    [cyLink],
    offGrid
  );
  const dec = row(ledger, 12, 2026);
  assert(dec.bundleFullyPaid, "December bundle should be fully paid");
  assert(dec.advanceRemainder === 0, `Dec advance remainder 0, got ${dec.advanceRemainder}`);
});

runScenario("edge: excess concession on target still explicit", () => {
  const payments = [
    pay("p1", 600, "2026-08-01", [
      alloc(2026, 8, 500, "normal"),
      alloc(2026, 11, 100, "advance", 1),
    ]),
    pay("c1", 600, "2026-08-02", [alloc(2026, 11, 600, "concession")], "concession"),
  ];
  const ledger = distributeLedger(payments, billing2026AugNov(), { month: 8, year: 2026 }, 2026, [augNovLink]);
  const aug = row(ledger, 8, 2026);
  assert(aug.bundleFullyPaid, "excess concession should still mark bundle paid");
});

runScenario("attribution: cross-year concession counts source and target year like payment", () => {
  const cyLink = link(5, 2026, 12, 2027, 2);
  const line = alloc(2027, 2, 450, "concession");
  const conPay = pay("c1", 450, "2026-12-02", [line], "concession");
  assert(
    concessionCountsTowardCalendarYear(line, 2026, [cyLink]),
    "concession on Feb 2027 should count toward 2026"
  );
  assert(
    concessionCountsTowardCalendarYear(line, 2027, [cyLink]),
    "concession on Feb 2027 should count toward 2027"
  );
  assert(
    attributedAmountForCalendarYear(conPay, 2026, [cyLink]) === 450,
    "attributed 2026 should be 450"
  );
  assert(
    attributedAmountForCalendarYear(conPay, 2027, [cyLink]) === 450,
    "attributed 2027 should be 450"
  );
});

runScenario("cross year: 2027 billing view Feb card paid after concession", () => {
  const cyLink = link(6, 2026, 12, 2027, 2);
  const billing2027 = [];
  for (let m = 1; m <= 12; m += 1) {
    billing2027.push(bm(m, 2027, m === 2 ? 550 : 500));
  }
  const payments = [
    pay("p1", 600, "2026-12-01", [
      alloc(2026, 12, 500, "normal"),
      alloc(2027, 2, 100, "advance", 6),
    ]),
    pay("c1", 450, "2026-12-02", [alloc(2027, 2, 450, "concession")], "concession"),
  ];
  const ledger = distributeLedger(
    payments,
    billing2027,
    { month: 2, year: 2027 },
    2027,
    [cyLink],
    {}
  );
  const feb = row(ledger, 2, 2027);
  assert(feb != null, "Feb 2027 row should exist");
  assert(
    feb.paidDisplay >= 550 || feb.status === "paid",
    `Feb 2027 should show paid (paidDisplay=${feb.paidDisplay}, status=${feb.status})`
  );
});

runScenario("simple month: single-line concession unchanged", () => {
  const billing = [bm(3, 2026, 500)];
  const payments = [pay("c1", 300, "2026-03-01", [alloc(2026, 3, 300, "concession")], "concession")];
  const ledger = distributeLedger(payments, billing, { month: 3, year: 2026 }, 2026, []);
  const mar = row(ledger, 3, 2026);
  assert(mar.paidDisplay === 300, `March paid 300, got ${mar.paidDisplay}`);
  assert(mar.status === "partial", `March partial, got ${mar.status}`);
});

console.log(process.exitCode ? "\nSome tests failed." : "\nAll tests passed.");
