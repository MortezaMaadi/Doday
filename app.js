/* ===================================================================
   app.js — Doday v2
   =================================================================== */
(() => {
  'use strict';

  // ------------------------------------------------------------------
  // ۱) ذخیره‌سازی محلی
  // ------------------------------------------------------------------
  const STORE_KEY = 'doday_v2';

  function defaultDB() {
    return {
      version: 2,
      occasions: [], tasks: [], routines: [],
      routineCompletions: {},
      settings: { theme: 'dark', autoLaunch: false },
    };
  }

  function loadStore() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) throw new Error('empty');
      return Object.assign(defaultDB(), JSON.parse(raw));
    } catch (e) { return defaultDB(); }
  }

  let DB = loadStore();
  let saveTimer = null;
  function persist(skipSync) {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(DB)); }
      catch (e) { console.error('خطا در ذخیره‌سازی', e); }
      if (!skipSync && window.Sync && Sync.isLoggedIn && Sync.isLoggedIn()) {
        Sync.pushDataSafe(DB);
      }
    }, 150);
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  // ------------------------------------------------------------------
  // ۲) کمک‌تابع‌های تاریخ
  // ------------------------------------------------------------------
  function today() { return Cal.todayJalali(); }
  function keyOf(jy, jm, jd) { return Cal.jalaliKey(jy, jm, jd); }
  function compareDate(a, b) {
    if (a.jy !== b.jy) return a.jy - b.jy;
    if (a.jm !== b.jm) return a.jm - b.jm;
    return a.jd - b.jd;
  }
  function faNum(n) { return Cal.toFaDigits(n); }

  // ------------------------------------------------------------------
  // ۳) الگوی تکرار یکپارچه
  //    weekly:  {type:'weekly',  days:[0..6]}
  //    monthly: {type:'monthly', days:[1..31]}
  //    yearly:  {type:'yearly',  dates:[{jm,jd}, ...]}
  //    interval:{type:'interval',unit:'day'|'week'|'month', every:N, anchorJy,anchorJm,anchorJd}
  // ------------------------------------------------------------------
  function isDueOn(repeat, jy, jm, jd) {
    if (!repeat) return false;
    switch (repeat.type) {
      case 'weekly': {
        const wd = Cal.weekdayIndex(...Cal.jalaliToGregorian(jy, jm, jd));
        return Array.isArray(repeat.days) && repeat.days.includes(wd);
      }
      case 'monthly':
        return Array.isArray(repeat.days) && repeat.days.includes(jd);
      case 'yearly':
        return Array.isArray(repeat.dates) && repeat.dates.some((d) => d.jm === jm && d.jd === jd);
      case 'interval': {
        const a = { jy: repeat.anchorJy, jm: repeat.anchorJm, jd: repeat.anchorJd };
        const d = Cal.diffDays(a.jy, a.jm, a.jd, jy, jm, jd);
        if (d < 0) return false;
        const every = Math.max(1, repeat.every || 1);
        if (repeat.unit === 'day') return d % every === 0;
        if (repeat.unit === 'week') return d % 7 === 0 && (d / 7) % every === 0;
        if (repeat.unit === 'month') {
          const monthsDiff = (jy - a.jy) * 12 + (jm - a.jm);
          if (monthsDiff < 0 || monthsDiff % every !== 0) return false;
          const len = Cal.jalaliMonthLength(jy, jm);
          const effectiveDay = Math.min(a.jd, len);
          return jd === effectiveDay;
        }
        return false;
      }
      default: return false;
    }
  }

  function nearestDueOnOrAfter(repeat, fromJy, fromJm, fromJd, maxDays) {
    let cur = { jy: fromJy, jm: fromJm, jd: fromJd };
    const limit = maxDays || 400;
    for (let i = 0; i < limit; i += 1) {
      if (isDueOn(repeat, cur.jy, cur.jm, cur.jd)) return cur;
      cur = Cal.addDaysToJalali(cur.jy, cur.jm, cur.jd, 1);
    }
    return null;
  }

  function nextDueDateAfter(jy, jm, jd, repeat) {
    const n = Cal.addDaysToJalali(jy, jm, jd, 1);
    return nearestDueOnOrAfter(repeat, n.jy, n.jm, n.jd);
  }

  function repeatLabel(repeat) {
    if (!repeat) return 'بدون تکرار';
    if (repeat.type === 'weekly') return 'هفتگی · ' + repeat.days.map((d) => Cal.WEEKDAYS_SHORT[d]).join('،');
    if (repeat.type === 'monthly') return 'روزهای ' + repeat.days.map(faNum).join('،') + ' هر ماه';
    if (repeat.type === 'yearly') return repeat.dates.map((d) => `${faNum(d.jd)} ${Cal.JALALI_MONTHS[d.jm - 1]}`).join(' / ');
    if (repeat.type === 'interval') {
      const unitLabel = { day: 'روز', week: 'هفته', month: 'ماه' }[repeat.unit] || '';
      return `هر ${faNum(repeat.every)} ${unitLabel} یک‌بار`;
    }
    return '';
  }

  // ------------------------------------------------------------------
  // ۴) منطق وظایف (اضافه/انجام/پاکسازی روزانه)
  // ------------------------------------------------------------------
  function taskIsOverdue(task) {
    if (!task.dueJy) return false;
    return compareDate({ jy: task.dueJy, jm: task.dueJm, jd: task.dueJd }, today()) < 0;
  }

  function taskVisibleToday(task) {
    const t = today();
    const tk = keyOf(t.jy, t.jm, t.jd);
    if (task.completedOnKey === tk) return true; // امروز انجام شده -> با خط‌خورده نشون بده
    if (task.completedOnKey && task.completedOnKey !== tk) return false; // قبلاً (روز دیگه) انجام شده -> پاکسازی جدا انجام میشه
    if (!task.dueJy) return true;
    return compareDate({ jy: task.dueJy, jm: task.dueJm, jd: task.dueJd }, t) <= 0;
  }

  function checkTask(task) {
    const t = today();
    task.completedOnKey = keyOf(t.jy, t.jm, t.jd);
  }
  function uncheckTask(task) { task.completedOnKey = null; }

  // پاکسازی روزانه: وظایفی که «دیروز یا قبل‌تر» انجام شده بودن رو جمع کن
  function runDailyCleanup() {
    const t = today();
    const tk = keyOf(t.jy, t.jm, t.jd);
    const survivors = [];
    let changed = false;
    DB.tasks.forEach((task) => {
      if (task.completedOnKey && task.completedOnKey !== tk) {
        changed = true;
        if (task.repeat) {
          const done = Cal.parseJalaliKey(task.completedOnKey);
          const next = nextDueDateAfter(done.jy, done.jm, done.jd, task.repeat);
          if (next) {
            task.dueJy = next.jy; task.dueJm = next.jm; task.dueJd = next.jd;
          }
          task.completedOnKey = null;
          survivors.push(task);
        }
        // بدون تکرار و قبلاً انجام‌شده -> برای همیشه حذف (اضافه نشه به survivors)
      } else {
        survivors.push(task);
      }
    });
    DB.tasks = survivors;
    if (changed) persist();
  }

  // ------------------------------------------------------------------
  // ۵) یادآورها (فقط نمایشی، چند‌تایی، بدون ساعت)
  // ------------------------------------------------------------------
  function computeActiveReminders() {
    const t = today();
    const active = [];

    DB.occasions.forEach((occ) => {
      (occ.reminders || []).forEach((rem) => {
        const target = nearestDueOnOrAfter({ type: 'yearly', dates: [{ jm: occ.jm, jd: occ.jd }] }, t.jy, t.jm, t.jd);
        if (!target) return;
        const diff = Cal.diffDays(t.jy, t.jm, t.jd, target.jy, target.jm, target.jd);
        if (diff === rem.daysBefore) active.push({ kind: 'occasion', title: occ.title, daysBefore: rem.daysBefore });
      });
    });

    DB.tasks.forEach((task) => {
      if (!task.dueJy) return;
      (task.reminders || []).forEach((rem) => {
        const diff = Cal.diffDays(t.jy, t.jm, t.jd, task.dueJy, task.dueJm, task.dueJd);
        if (diff === rem.daysBefore) active.push({ kind: 'task', title: task.title, daysBefore: rem.daysBefore });
      });
    });

    DB.routines.forEach((routine) => {
      (routine.reminders || []).forEach((rem) => {
        const target = nearestDueOnOrAfter(routine.repeat, t.jy, t.jm, t.jd);
        if (!target) return;
        const diff = Cal.diffDays(t.jy, t.jm, t.jd, target.jy, target.jm, target.jd);
        if (diff === rem.daysBefore) active.push({ kind: 'routine', title: routine.title, daysBefore: rem.daysBefore });
      });
    });

    return active;
  }

  // ------------------------------------------------------------------
  // ۶) رندر عمومی
  // ------------------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function gregorianDateStr(jy, jm, jd) {
    const [gy, gm, gd] = Cal.jalaliToGregorian(jy, jm, jd);
    return `${String(gd).padStart(2, '0')} ${Cal.GREGORIAN_MONTHS[gm - 1]} ${gy}`;
  }

  function renderHero() {
    const t = today();
    $('#heroDayNum').textContent = faNum(t.jd);
    $('#heroWeekday').textContent = Cal.WEEKDAYS[Cal.weekdayIndex(...Cal.jalaliToGregorian(t.jy, t.jm, t.jd))];
    $('#heroMonthYear').textContent = `${Cal.JALALI_MONTHS[t.jm - 1]} ${faNum(t.jy)}`;
    $('#heroGregorian').textContent = gregorianDateStr(t.jy, t.jm, t.jd);

    const official = getOfficialOccasions(t.jy, t.jm, t.jd);
    const officialList = $('#officialList');
    officialList.innerHTML = official.length
      ? official.map((o) => `<li class="${o.holiday ? 'holiday' : ''}">${o.title}</li>`).join('')
      : '<li class="occ-empty-mini">مناسبتی ثبت نشده</li>';

    const personal = DB.occasions.filter((o) => o.jm === t.jm && o.jd === t.jd);
    const personalList = $('#personalList');
    personalList.innerHTML = personal.length
      ? personal.map((o) => `<li>${o.title}</li>`).join('')
      : '<li class="occ-empty-mini">مناسبتی ثبت نشده</li>';
  }

  function renderReminders() {
    const active = computeActiveReminders();
    const section = $('#remindersSection');
    section.hidden = active.length === 0;
    if (!active.length) return;
    const dotColor = { occasion: 'var(--dot-personal)', task: 'var(--dot-task)', routine: 'var(--dot-routine)' };
    $('#remindersList').innerHTML = active.map((r) => `
      <div class="reminder-row">
        <span class="rem-kind" style="background:${dotColor[r.kind]}"></span>
        <span style="flex:1">${r.title}</span>
        <span class="rem-days">${r.daysBefore === 0 ? 'امروز' : faNum(r.daysBefore) + ' روز مانده'}</span>
      </div>`).join('');
  }

  function itemCardHTML({ id, title, note, meta, checked, kind }) {
    return `
      <li class="item-card" data-id="${id}" data-kind="${kind}">
        <button class="item-check ${checked ? 'checked' : ''}" data-action="check">${checked ? '✓' : ''}</button>
        <div class="item-body">
          <div class="item-title ${checked ? 'done' : ''}">${title}</div>
          <div class="item-meta">${meta}</div>
          ${note ? `<div class="item-note">${note}</div>` : ''}
        </div>
      </li>`;
  }

  function renderTasks() {
    runDailyCleanup();
    const t = today();
    const visible = DB.tasks.filter(taskVisibleToday).sort((a, b) => {
      if (!a.dueJy && !b.dueJy) return 0;
      if (!a.dueJy) return 1;
      if (!b.dueJy) return -1;
      return compareDate({ jy: a.dueJy, jm: a.dueJm, jd: a.dueJd }, { jy: b.dueJy, jm: b.dueJm, jd: b.dueJd });
    });
    $('#tasksCount').textContent = faNum(visible.length);
    const tk = keyOf(t.jy, t.jm, t.jd);
    $('#tasksList').innerHTML = visible.map((task) => {
      const checked = task.completedOnKey === tk;
      let meta = '';
      if (task.dueJy) {
        const overdue = compareDate({ jy: task.dueJy, jm: task.dueJm, jd: task.dueJd }, t) < 0;
        const sameDay = task.dueJy === t.jy && task.dueJm === t.jm && task.dueJd === t.jd;
        const label = sameDay ? 'امروز' : `${faNum(task.dueJd)} ${Cal.JALALI_MONTHS[task.dueJm - 1]}`;
        meta += `<span class="tag ${overdue && !checked ? 'overdue' : ''}">${overdue && !checked ? 'عقب‌افتاده · ' : ''}${label}</span>`;
      }
      if (task.repeat) meta += `<span class="tag">${repeatLabel(task.repeat)}</span>`;
      return itemCardHTML({ id: task.id, title: task.title, note: task.note, meta, checked, kind: 'task' });
    }).join('');
    $('#tasksEmpty').hidden = visible.length > 0;
  }

  function renderRoutines() {
    const t = today();
    const due = DB.routines.filter((r) => isDueOn(r.repeat, t.jy, t.jm, t.jd));
    const dk = keyOf(t.jy, t.jm, t.jd);
    $('#routinesCount').textContent = faNum(due.length);
    $('#routinesList').innerHTML = due.map((routine) => {
      const done = !!(DB.routineCompletions[`${routine.id}|${dk}`]);
      const meta = `<span class="tag">${repeatLabel(routine.repeat)}</span>`;
      return itemCardHTML({ id: routine.id, title: routine.title, note: routine.note, meta, checked: done, kind: 'routine' });
    }).join('');
    $('#routinesEmpty').hidden = due.length > 0;
  }

  function renderHome() { renderHero(); renderReminders(); renderTasks(); renderRoutines(); }

  // ---------------- تقویم ماهانه ----------------
  const monthState = { jy: 0, jm: 0 };

  function getDayData(jy, jm, jd) {
    const official = getOfficialOccasions(jy, jm, jd);
    const personal = DB.occasions.filter((o) => o.jm === jm && o.jd === jd);
    const tasksDue = DB.tasks.filter((x) => x.dueJy === jy && x.dueJm === jm && x.dueJd === jd);
    const routinesDue = DB.routines.filter((r) => isDueOn(r.repeat, jy, jm, jd));
    return { official, personal, tasksDue, routinesDue };
  }

  function renderMonth() {
    if (!monthState.jy) { const t = today(); monthState.jy = t.jy; monthState.jm = t.jm; }
    $('#monthTitle').textContent = `${Cal.JALALI_MONTHS[monthState.jm - 1]} ${faNum(monthState.jy)}`;
    const t = today();
    const len = Cal.jalaliMonthLength(monthState.jy, monthState.jm);
    const firstWd = Cal.weekdayIndex(...Cal.jalaliToGregorian(monthState.jy, monthState.jm, 1));
    let html = '';
    for (let i = 0; i < firstWd; i += 1) html += '<div class="month-cell empty"></div>';
    for (let d = 1; d <= len; d += 1) {
      const data = getDayData(monthState.jy, monthState.jm, d);
      const isToday = t.jy === monthState.jy && t.jm === monthState.jm && t.jd === d;
      const dots = [];
      if (data.official.length || data.personal.length) dots.push('var(--dot-official)');
      if (data.tasksDue.length) dots.push('var(--dot-task)');
      if (data.routinesDue.length) dots.push('var(--dot-routine)');
      html += `
        <button class="month-cell ${isToday ? 'is-today' : ''}" data-jd="${d}">
          <span>${faNum(d)}</span>
          <span class="cell-dots">${dots.map((c) => `<span style="background:${c}"></span>`).join('')}</span>
        </button>`;
    }
    $('#monthBody').innerHTML = html;
  }

  function openDayDetail(jy, jm, jd) {
    const t = today();
    const isToday = jy === t.jy && jm === t.jm && jd === t.jd;
    const [gy, gm, gd] = Cal.jalaliToGregorian(jy, jm, jd);
    const wd = Cal.weekdayIndex(gy, gm, gd);
    const data = getDayData(jy, jm, jd);
    const chips = (arr, cls, key) => arr.length
      ? `<div class="pager-chip-row">${arr.map((s) => `<span class="pager-chip ${cls(s)}">${s.title || s[key]}</span>`).join('')}</div>`
      : '<div class="pager-empty">—</div>';

    $('#dayDetailSheet').innerHTML = `
      <div class="modal-grip"></div>
      <div class="pager-day-head">
        <div class="pager-day-num">${faNum(jd)}</div>
        <div class="pager-day-info">
          <div class="pager-day-weekday">${Cal.WEEKDAYS[wd]}${isToday ? ' · امروز' : ''}</div>
          <div class="pager-day-month">${Cal.JALALI_MONTHS[jm - 1]} ${faNum(jy)}</div>
          <div class="pager-day-greg">${gd} ${Cal.GREGORIAN_MONTHS[gm - 1]} ${gy}</div>
        </div>
      </div>
      <div class="pager-section-title">مناسبت‌ها</div>
      ${chips([...data.official.map((o) => ({ title: o.title, holiday: o.holiday })), ...data.personal], (s) => (s.holiday ? 'holiday' : 'personal'))}
      <div class="pager-section-title">وظایف</div>
      ${chips(data.tasksDue, () => 'task')}
      <div class="pager-section-title">روتین‌ها</div>
      ${chips(data.routinesDue, () => 'routine')}
      <div class="modal-actions"><button class="btn-secondary" id="dayDetailClose" style="flex:1">بستن</button></div>`;
    $('#dayDetailOverlay').hidden = false;
    $('#dayDetailClose').addEventListener('click', () => { $('#dayDetailOverlay').hidden = true; });
  }

  function openGoToDate() {
    const t = today();
    openCustomForm('برو به تاریخ', `
      <div class="field-row">
        <div class="field"><label>روز</label><input type="number" id="gtD" min="1" max="31" value="${t.jd}"></div>
        <div class="field"><label>ماه</label><select id="gtM">${Cal.JALALI_MONTHS.map((m, i) => `<option value="${i + 1}">${m}</option>`).join('')}</select></div>
        <div class="field"><label>سال</label><input type="number" id="gtY" value="${t.jy}"></div>
      </div>`, () => {
      monthState.jy = Number($('#gtY').value);
      monthState.jm = Number($('#gtM').value);
      renderMonth();
      closeModal();
    }, 'برو');
  }

  // ------------------------------------------------------------------
  // ۷) مدیریت رویدادها
  // ------------------------------------------------------------------
  const manageState = { tab: 'occasions', query: '' };

  function manageItemMeta(kind, item) {
    if (kind === 'occasions') {
      const remCount = (item.reminders || []).length;
      return `${faNum(item.jd)} ${Cal.JALALI_MONTHS[item.jm - 1]} هر سال${remCount ? ' · ' + faNum(remCount) + ' یادآور' : ''}`;
    }
    if (kind === 'tasks') {
      const due = item.dueJy ? `${faNum(item.dueJd)} ${Cal.JALALI_MONTHS[item.dueJm - 1]} ${faNum(item.dueJy)}` : 'بدون سررسید';
      return `${due}${item.repeat ? ' · ' + repeatLabel(item.repeat) : ''}`;
    }
    return repeatLabel(item.repeat);
  }

  function renderManage() {
    $$('#manageTabs .tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === manageState.tab));
    const arr = DB[manageState.tab] || [];
    const q = manageState.query.trim();
    const filtered = q ? arr.filter((it) => it.title.includes(q)) : arr;
    $('#manageList').innerHTML = filtered.map((item) => `
      <li class="manage-card" data-id="${item.id}" data-kind="${manageState.tab}">
        <div class="item-body">
          <div class="item-title">${item.title}</div>
          <div class="item-meta">${manageItemMeta(manageState.tab, item)}</div>
        </div>
        <div class="item-actions">
          <button data-action="edit" title="ویرایش">✎</button>
          <button data-action="delete" title="حذف">✕</button>
        </div>
      </li>`).join('');
    $('#manageEmpty').hidden = filtered.length > 0;
  }

  // ------------------------------------------------------------------
  // ۸) مودال تایید حذف (سفارشی، بدون confirm مرورگر)
  // ------------------------------------------------------------------
  function askConfirm(message) {
    return new Promise((resolve) => {
      $('#confirmMsg').textContent = message || 'این مورد برای همیشه حذف میشه و قابل بازگشت نیست. مطمئنی؟';
      $('#confirmOverlay').hidden = false;
      const cleanup = () => { $('#confirmOverlay').hidden = true; ok.removeEventListener('click', onOk); cancel.removeEventListener('click', onCancel); };
      const ok = $('#confirmOk'); const cancel = $('#confirmCancel');
      function onOk() { cleanup(); resolve(true); }
      function onCancel() { cleanup(); resolve(false); }
      ok.addEventListener('click', onOk);
      cancel.addEventListener('click', onCancel);
    });
  }

  // ------------------------------------------------------------------
  // ۹) فرم تکرار یکپارچه (کامپوننت مشترک برای وظیفه/روتین)
  // ------------------------------------------------------------------
  function weekdayChipsHTML(selected, groupId) {
    return Cal.WEEKDAYS_SHORT.map((label, idx) => `
      <button type="button" data-group="${groupId}" data-day="${idx}" class="${(selected || []).includes(idx) ? 'active' : ''}">${label}</button>
    `).join('');
  }
  function monthDaysGridHTML(selected, groupId) {
    let html = '';
    for (let d = 1; d <= 31; d += 1) {
      html += `<button type="button" data-group="${groupId}" data-mday="${d}" class="${(selected || []).includes(d) ? 'active' : ''}">${faNum(d)}</button>`;
    }
    return html;
  }
  function monthOptionsHTML(sel) {
    return Cal.JALALI_MONTHS.map((m, i) => `<option value="${i + 1}" ${sel === i + 1 ? 'selected' : ''}>${m}</option>`).join('');
  }

  function repeatFormHTML(prefix, repeat) {
    const type = repeat ? repeat.type : 'interval';
    const t = today();
    return `
      <div class="field"><label>نوع تکرار</label>
        <div class="chip-select" id="${prefix}RepeatType">
          <button type="button" data-t="weekly" class="${type === 'weekly' ? 'active' : ''}">هفتگی</button>
          <button type="button" data-t="monthly" class="${type === 'monthly' ? 'active' : ''}">ماهانه</button>
          <button type="button" data-t="yearly" class="${type === 'yearly' ? 'active' : ''}">سالانه</button>
          <button type="button" data-t="interval" class="${type === 'interval' ? 'active' : ''}">بازه‌ای (هر n روز/هفته/ماه)</button>
        </div>
      </div>
      <div id="${prefix}RepeatBody">${repeatBodyHTML(prefix, type, repeat, t)}</div>`;
  }

  function repeatBodyHTML(prefix, type, repeat, t) {
    if (type === 'weekly') {
      return `<div class="field"><label>روزهای هفته</label><div class="chip-select">${weekdayChipsHTML(repeat?.type === 'weekly' ? repeat.days : [], prefix + 'W')}</div></div>`;
    }
    if (type === 'monthly') {
      return `<div class="field"><label>روزهای ماه</label><div class="multi-day-grid">${monthDaysGridHTML(repeat?.type === 'monthly' ? repeat.days : [], prefix + 'M')}</div></div>`;
    }
    if (type === 'yearly') {
      const dates = repeat?.type === 'yearly' ? repeat.dates : [];
      return `
        <div class="field">
          <label>تاریخ‌های سالانه</label>
          <div class="yearly-date-list" id="${prefix}YearlyList" data-store='${JSON.stringify(dates)}'>
            ${dates.map((d, i) => `<div class="yearly-date-chip" data-idx="${i}"><span>${faNum(d.jd)} ${Cal.JALALI_MONTHS[d.jm - 1]}</span><button type="button" data-remove="${i}">✕</button></div>`).join('')}
          </div>
          <div class="add-date-row">
            <div class="field"><label>روز</label><input type="number" id="${prefix}AddD" min="1" max="31" value="${t.jd}"></div>
            <div class="field"><label>ماه</label><select id="${prefix}AddM">${monthOptionsHTML(t.jm)}</select></div>
            <button type="button" class="add-btn" id="${prefix}AddBtn">+</button>
          </div>
        </div>`;
    }
    // interval
    const iv = repeat?.type === 'interval' ? repeat : { unit: 'day', every: 1 };
    return `
      <div class="field-row">
        <div class="field"><label>هر چند وقت؟</label><input type="number" id="${prefix}IvEvery" min="1" value="${iv.every}"></div>
        <div class="field"><label>واحد</label>
          <select id="${prefix}IvUnit">
            <option value="day" ${iv.unit === 'day' ? 'selected' : ''}>روز</option>
            <option value="week" ${iv.unit === 'week' ? 'selected' : ''}>هفته</option>
            <option value="month" ${iv.unit === 'month' ? 'selected' : ''}>ماه</option>
          </select>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>روز شروع</label><input type="number" id="${prefix}IvD" min="1" max="31" value="${iv.anchorJd || t.jd}"></div>
        <div class="field"><label>ماه شروع</label><select id="${prefix}IvM">${monthOptionsHTML(iv.anchorJm || t.jm)}</select></div>
        <div class="field"><label>سال شروع</label><input type="number" id="${prefix}IvY" value="${iv.anchorJy || t.jy}"></div>
      </div>`;
  }

  function bindRepeatFormEvents(prefix, root) {
    root.querySelectorAll(`#${prefix}RepeatType [data-t]`).forEach((btn) => btn.addEventListener('click', () => {
      root.querySelectorAll(`#${prefix}RepeatType [data-t]`).forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      root.querySelector(`#${prefix}RepeatBody`).innerHTML = repeatBodyHTML(prefix, btn.dataset.t, null, today());
      bindRepeatBodyEvents(prefix, root);
    }));
    bindRepeatBodyEvents(prefix, root);
  }

  function bindRepeatBodyEvents(prefix, root) {
    root.querySelectorAll(`[data-group="${prefix}W"], [data-group="${prefix}M"]`).forEach((btn) => {
      btn.addEventListener('click', () => btn.classList.toggle('active'));
    });
    const addBtn = root.querySelector(`#${prefix}AddBtn`);
    if (addBtn) addBtn.addEventListener('click', () => {
      const list = root.querySelector(`#${prefix}YearlyList`);
      const store = JSON.parse(list.dataset.store || '[]');
      const jd = Number(root.querySelector(`#${prefix}AddD`).value);
      const jm = Number(root.querySelector(`#${prefix}AddM`).value);
      store.push({ jm, jd });
      list.dataset.store = JSON.stringify(store);
      renderYearlyList(prefix, root);
    });
    renderYearlyListEvents(prefix, root);
  }

  function renderYearlyList(prefix, root) {
    const list = root.querySelector(`#${prefix}YearlyList`);
    const store = JSON.parse(list.dataset.store || '[]');
    list.innerHTML = store.map((d, i) => `<div class="yearly-date-chip" data-idx="${i}"><span>${faNum(d.jd)} ${Cal.JALALI_MONTHS[d.jm - 1]}</span><button type="button" data-remove="${i}">✕</button></div>`).join('');
    renderYearlyListEvents(prefix, root);
  }
  function renderYearlyListEvents(prefix, root) {
    const list = root.querySelector(`#${prefix}YearlyList`);
    if (!list) return;
    list.querySelectorAll('[data-remove]').forEach((btn) => btn.addEventListener('click', () => {
      const store = JSON.parse(list.dataset.store || '[]');
      store.splice(Number(btn.dataset.remove), 1);
      list.dataset.store = JSON.stringify(store);
      renderYearlyList(prefix, root);
    }));
  }

  function collectRepeatFromForm(prefix, root) {
    const type = root.querySelector(`#${prefix}RepeatType .active`)?.dataset.t || 'interval';
    if (type === 'weekly') {
      const days = Array.from(root.querySelectorAll(`[data-group="${prefix}W"].active`)).map((b) => Number(b.dataset.day));
      if (!days.length) return null;
      return { type: 'weekly', days };
    }
    if (type === 'monthly') {
      const days = Array.from(root.querySelectorAll(`[data-group="${prefix}M"].active`)).map((b) => Number(b.dataset.mday));
      if (!days.length) return null;
      return { type: 'monthly', days };
    }
    if (type === 'yearly') {
      const list = root.querySelector(`#${prefix}YearlyList`);
      const dates = JSON.parse(list.dataset.store || '[]');
      if (!dates.length) return null;
      return { type: 'yearly', dates };
    }
    // interval
    return {
      type: 'interval',
      unit: root.querySelector(`#${prefix}IvUnit`).value,
      every: Math.max(1, Number(root.querySelector(`#${prefix}IvEvery`).value) || 1),
      anchorJd: Number(root.querySelector(`#${prefix}IvD`).value),
      anchorJm: Number(root.querySelector(`#${prefix}IvM`).value),
      anchorJy: Number(root.querySelector(`#${prefix}IvY`).value),
    };
  }

  // ------------------------------------------------------------------
  // ۱۰) فرم یادآورهای چندتایی (کامپوننت مشترک)
  // ------------------------------------------------------------------
  function remindersEditorHTML(prefix, reminders) {
    const list = reminders || [];
    return `
      <div class="field">
        <label>یادآورها (چند روز قبل)</label>
        <div class="reminders-editor" id="${prefix}RemList" data-store='${JSON.stringify(list)}'>
          ${list.map((r, i) => `<div class="reminder-chip" data-idx="${i}"><span>${faNum(r.daysBefore)} روز قبل</span><button type="button" data-remove="${i}">✕</button></div>`).join('')}
        </div>
        <div class="add-date-row">
          <div class="field"><label>چند روز قبل</label><input type="number" id="${prefix}RemInput" min="0" max="90" value="1"></div>
          <button type="button" class="add-btn" id="${prefix}RemAddBtn">+</button>
        </div>
      </div>`;
  }
  function bindRemindersEditorEvents(prefix, root) {
    const addBtn = root.querySelector(`#${prefix}RemAddBtn`);
    if (!addBtn) return;
    addBtn.addEventListener('click', () => {
      const list = root.querySelector(`#${prefix}RemList`);
      const store = JSON.parse(list.dataset.store || '[]');
      const val = Number(root.querySelector(`#${prefix}RemInput`).value);
      if (Number.isNaN(val) || val < 0) return;
      if (store.some((r) => r.daysBefore === val)) return;
      store.push({ id: uid(), daysBefore: val });
      store.sort((a, b) => b.daysBefore - a.daysBefore);
      list.dataset.store = JSON.stringify(store);
      renderRemindersList(prefix, root);
    });
    renderRemindersListEvents(prefix, root);
  }
  function renderRemindersList(prefix, root) {
    const list = root.querySelector(`#${prefix}RemList`);
    const store = JSON.parse(list.dataset.store || '[]');
    list.innerHTML = store.map((r, i) => `<div class="reminder-chip" data-idx="${i}"><span>${faNum(r.daysBefore)} روز قبل</span><button type="button" data-remove="${i}">✕</button></div>`).join('');
    renderRemindersListEvents(prefix, root);
  }
  function renderRemindersListEvents(prefix, root) {
    const list = root.querySelector(`#${prefix}RemList`);
    if (!list) return;
    list.querySelectorAll('[data-remove]').forEach((btn) => btn.addEventListener('click', () => {
      const store = JSON.parse(list.dataset.store || '[]');
      store.splice(Number(btn.dataset.remove), 1);
      list.dataset.store = JSON.stringify(store);
      renderRemindersList(prefix, root);
    }));
  }
  function collectRemindersFromForm(prefix, root) {
    const list = root.querySelector(`#${prefix}RemList`);
    return JSON.parse(list.dataset.store || '[]');
  }

  // ------------------------------------------------------------------
  // ۱۱) مودال افزودن/ویرایش (وظیفه / روتین / مناسبت)
  // ------------------------------------------------------------------
  const modalState = { type: 'task', editingId: null };

  function buildModalHTML() {
    const t = today();
    const editing = modalState.editingId
      ? DB[modalState.type === 'occasion' ? 'occasions' : modalState.type + 's'].find((x) => x.id === modalState.editingId)
      : null;

    const typeSwitch = `
      <div class="type-switch">
        <button type="button" data-type="task" class="${modalState.type === 'task' ? 'active' : ''}">وظیفه</button>
        <button type="button" data-type="routine" class="${modalState.type === 'routine' ? 'active' : ''}">روتین</button>
        <button type="button" data-type="occasion" class="${modalState.type === 'occasion' ? 'active' : ''}">مناسبت</button>
      </div>`;

    let body = '';
    if (modalState.type === 'task') {
      const hasRepeat = !!editing?.repeat;
      const dueJy = editing?.dueJy || t.jy, dueJm = editing?.dueJm || t.jm, dueJd = editing?.dueJd || t.jd;
      body = `
        <div class="field"><label>عنوان وظیفه</label><input type="text" id="fTitle" value="${editing ? editing.title.replace(/"/g, '&quot;') : ''}" placeholder="مثلاً پرداخت قبض برق"></div>
        <div class="field"><label>یادداشت (اختیاری)</label><textarea id="fNote">${editing?.note || ''}</textarea></div>
        <div class="field switch-row"><label>سررسید مشخص دارد؟</label><button type="button" class="switch ${editing?.dueJy ? 'on' : ''}" id="fHasDue"></button></div>
        <div id="fDueWrap" style="display:${editing?.dueJy ? 'block' : 'none'}">
          <div class="field-row">
            <div class="field"><label>روز</label><input type="number" id="fDueD" min="1" max="31" value="${dueJd}"></div>
            <div class="field"><label>ماه</label><select id="fDueM">${monthOptionsHTML(dueJm)}</select></div>
            <div class="field"><label>سال</label><input type="number" id="fDueY" value="${dueJy}"></div>
          </div>
        </div>
        <div class="field switch-row"><label>تکرارشونده است؟</label><button type="button" class="switch ${hasRepeat ? 'on' : ''}" id="fHasRepeat"></button></div>
        <div id="fRepeatWrap" style="display:${hasRepeat ? 'block' : 'none'}">${repeatFormHTML('t', editing?.repeat)}</div>
        ${remindersEditorHTML('t', editing?.reminders)}`;
    } else if (modalState.type === 'routine') {
      body = `
        <div class="field"><label>عنوان روتین</label><input type="text" id="fTitle" value="${editing ? editing.title.replace(/"/g, '&quot;') : ''}" placeholder="مثلاً ورزش صبحگاهی"></div>
        <div class="field"><label>یادداشت (اختیاری)</label><textarea id="fNote">${editing?.note || ''}</textarea></div>
        ${repeatFormHTML('r', editing?.repeat)}
        ${remindersEditorHTML('r', editing?.reminders)}`;
    } else {
      body = `
        <div class="field"><label>عنوان مناسبت</label><input type="text" id="fTitle" value="${editing ? editing.title.replace(/"/g, '&quot;') : ''}" placeholder="مثلاً تولد مامان"></div>
        <div class="field-row">
          <div class="field"><label>روز</label><input type="number" id="fOccD" min="1" max="31" value="${editing?.jd || t.jd}"></div>
          <div class="field"><label>ماه</label><select id="fOccM">${monthOptionsHTML(editing?.jm || t.jm)}</select></div>
        </div>
        <div class="field"><label>یادداشت (اختیاری)</label><textarea id="fNote">${editing?.note || ''}</textarea></div>
        ${remindersEditorHTML('o', editing?.reminders)}`;
    }

    const actions = `
      <div class="modal-actions">
        <button type="button" class="btn-secondary" id="fCancel">انصراف</button>
        <button type="button" class="btn-primary" id="fSave">${editing ? 'ذخیره تغییرات' : 'افزودن'}</button>
      </div>`;

    return `${typeSwitch}<div class="modal-title">${editing ? 'ویرایش' : 'مورد جدید'}</div>${body}${actions}`;
  }

  function renderModal() {
    const sheet = $('#modalSheet');
    sheet.innerHTML = '<div class="modal-grip"></div>' + buildModalHTML();
    bindModalEvents(sheet);
  }

  function openModal(type, editingId) {
    modalState.type = type || 'task';
    modalState.editingId = editingId || null;
    $('#modalOverlay').hidden = false;
    renderModal();
  }
  function closeModal() { $('#modalOverlay').hidden = true; }

  function openCustomForm(title, bodyHTML, onSave, saveLabel) {
    const sheet = $('#modalSheet');
    sheet.innerHTML = `
      <div class="modal-grip"></div>
      <div class="modal-title">${title}</div>
      ${bodyHTML}
      <div class="modal-actions">
        <button type="button" class="btn-secondary" id="fCancel">انصراف</button>
        <button type="button" class="btn-primary" id="fSave">${saveLabel || 'ذخیره'}</button>
      </div>`;
    $('#modalOverlay').hidden = false;
    sheet.querySelector('#fCancel').addEventListener('click', closeModal);
    sheet.querySelector('#fSave').addEventListener('click', onSave);
  }

  function bindModalEvents(sheet) {
    sheet.querySelectorAll('.type-switch [data-type]').forEach((btn) => btn.addEventListener('click', () => {
      modalState.type = btn.dataset.type; modalState.editingId = null; renderModal();
    }));
    sheet.querySelector('#fCancel')?.addEventListener('click', closeModal);
    sheet.querySelector('#fHasDue')?.addEventListener('click', (e) => {
      e.target.classList.toggle('on');
      sheet.querySelector('#fDueWrap').style.display = e.target.classList.contains('on') ? 'block' : 'none';
    });
    sheet.querySelector('#fHasRepeat')?.addEventListener('click', (e) => {
      e.target.classList.toggle('on');
      sheet.querySelector('#fRepeatWrap').style.display = e.target.classList.contains('on') ? 'block' : 'none';
    });
    if (modalState.type === 'task') bindRepeatFormEvents('t', sheet);
    if (modalState.type === 'routine') bindRepeatFormEvents('r', sheet);
    if (modalState.type === 'task') bindRemindersEditorEvents('t', sheet);
    if (modalState.type === 'routine') bindRemindersEditorEvents('r', sheet);
    if (modalState.type === 'occasion') bindRemindersEditorEvents('o', sheet);
    sheet.querySelector('#fSave')?.addEventListener('click', saveModal);
  }

  function saveModal() {
    const sheet = $('#modalSheet');
    const title = sheet.querySelector('#fTitle').value.trim();
    if (!title) { toast('عنوان را وارد کن'); return; }

    if (modalState.type === 'task') {
      const hasDue = sheet.querySelector('#fHasDue').classList.contains('on');
      const hasRepeat = sheet.querySelector('#fHasRepeat').classList.contains('on');
      const repeat = hasRepeat ? collectRepeatFromForm('t', sheet) : null;
      const item = {
        id: modalState.editingId || uid(),
        type: 'task',
        title,
        note: sheet.querySelector('#fNote').value.trim(),
        dueJy: hasDue ? Number(sheet.querySelector('#fDueY').value) : null,
        dueJm: hasDue ? Number(sheet.querySelector('#fDueM').value) : null,
        dueJd: hasDue ? Number(sheet.querySelector('#fDueD').value) : null,
        repeat,
        completedOnKey: null,
        reminders: collectRemindersFromForm('t', sheet),
        createdAt: Date.now(),
      };
      upsert('tasks', item);
    } else if (modalState.type === 'routine') {
      const repeat = collectRepeatFromForm('r', sheet) || { type: 'weekly', days: [0, 1, 2, 3, 4, 5, 6] };
      const item = {
        id: modalState.editingId || uid(),
        type: 'routine',
        title,
        note: sheet.querySelector('#fNote').value.trim(),
        repeat,
        reminders: collectRemindersFromForm('r', sheet),
        createdAt: Date.now(),
      };
      upsert('routines', item);
    } else {
      const item = {
        id: modalState.editingId || uid(),
        type: 'occasion',
        title,
        jm: Number(sheet.querySelector('#fOccM').value),
        jd: Number(sheet.querySelector('#fOccD').value),
        note: sheet.querySelector('#fNote').value.trim(),
        reminders: collectRemindersFromForm('o', sheet),
        createdAt: Date.now(),
      };
      upsert('occasions', item);
    }
    persist(); closeModal(); refreshAll();
    toast(modalState.editingId ? 'ذخیره شد' : 'اضافه شد');
  }

  function upsert(arrKey, item) {
    const arr = DB[arrKey];
    const idx = arr.findIndex((x) => x.id === item.id);
    if (idx >= 0) arr[idx] = Object.assign({}, arr[idx], item);
    else arr.push(item);
  }

  // ------------------------------------------------------------------
  // ۱۲) toast
  // ------------------------------------------------------------------
  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  // ------------------------------------------------------------------
  // ۱۳) رویدادهای عمومی و ناوبری
  // ------------------------------------------------------------------
  function refreshAll() {
    renderHome();
    if ($('#view-calendar').classList.contains('active')) renderMonth();
    if ($('#view-manage').classList.contains('active')) renderManage();
  }

  function switchView(name) {
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
    if (name === 'calendar') renderMonth();
    if (name === 'manage') renderManage();
    if (name === 'account') renderAccount();
    if (name === 'admin') renderAdmin();
    closeDrawer();
  }

  function openDrawer() { $('#drawerOverlay').hidden = false; }
  function closeDrawer() { $('#drawerOverlay').hidden = true; }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', DB.settings.theme);
    $('#themeSwitch').classList.toggle('on', DB.settings.theme === 'dark');
  }

  function bindStaticEvents() {
    $('#btnMenu').addEventListener('click', openDrawer);
    $('#drawerOverlay').addEventListener('click', closeDrawer);
    $$('.drawer-link[data-view]').forEach((btn) => btn.addEventListener('click', () => switchView(btn.dataset.view)));

    $('#themeSwitch').addEventListener('click', () => {
      DB.settings.theme = DB.settings.theme === 'dark' ? 'light' : 'dark';
      applyTheme(); persist();
    });
    $('#autoLaunchSwitch').addEventListener('click', (e) => {
      DB.settings.autoLaunch = !DB.settings.autoLaunch;
      e.target.classList.toggle('on', DB.settings.autoLaunch);
      persist();
      if (window.dodayDesktop && window.dodayDesktop.setAutoLaunch) {
        window.dodayDesktop.setAutoLaunch(DB.settings.autoLaunch);
      }
    });

    $('#fabAdd').addEventListener('click', () => openModal('task', null));
    $('#modalOverlay').addEventListener('click', (e) => { if (e.target.id === 'modalOverlay') closeModal(); });
    $('#dayDetailOverlay').addEventListener('click', (e) => { if (e.target.id === 'dayDetailOverlay') $('#dayDetailOverlay').hidden = true; });

    $('#tasksList').addEventListener('click', (e) => handleHomeItemClick(e, 'task'));
    $('#routinesList').addEventListener('click', (e) => handleHomeItemClick(e, 'routine'));

    $('#monthPrev').addEventListener('click', () => { shiftMonth(-1); });
    $('#monthNext').addEventListener('click', () => { shiftMonth(1); });
    $('#monthTitle').addEventListener('click', openGoToDate);
    $('#monthBody').addEventListener('click', (e) => {
      const cell = e.target.closest('.month-cell:not(.empty)');
      if (!cell) return;
      openDayDetail(monthState.jy, monthState.jm, Number(cell.dataset.jd));
    });

    $$('#manageTabs .tab').forEach((btn) => btn.addEventListener('click', () => { manageState.tab = btn.dataset.tab; renderManage(); }));
    $('#manageSearch').addEventListener('input', (e) => { manageState.query = e.target.value; renderManage(); });
    $('#manageList').addEventListener('click', async (e) => {
      const card = e.target.closest('.manage-card');
      if (!card) return;
      const kind = card.dataset.kind === 'occasions' ? 'occasion' : card.dataset.kind.slice(0, -1);
      const id = card.dataset.id;
      if (e.target.dataset.action === 'delete') {
        const ok = await askConfirm('این مورد برای همیشه حذف میشه و قابل بازگشت نیست. مطمئنی؟');
        if (!ok) return;
        DB[card.dataset.kind] = DB[card.dataset.kind].filter((x) => x.id !== id);
        persist(); renderManage(); renderHome(); toast('حذف شد');
      } else {
        openModal(kind, id);
      }
    });

    $('#btnExport').addEventListener('click', exportBackup);
    $('#btnImport').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', importBackup);
  }

  function shiftMonth(dir) {
    monthState.jm += dir;
    if (monthState.jm > 12) { monthState.jm = 1; monthState.jy += 1; }
    if (monthState.jm < 1) { monthState.jm = 12; monthState.jy -= 1; }
    renderMonth();
  }

  async function handleHomeItemClick(e, kind) {
    const card = e.target.closest('.item-card');
    if (!card) return;
    const id = card.dataset.id;
    if (e.target.dataset.action !== 'check') return;
    if (kind === 'task') {
      const task = DB.tasks.find((x) => x.id === id);
      const t = today();
      if (task.completedOnKey === keyOf(t.jy, t.jm, t.jd)) uncheckTask(task); else checkTask(task);
      persist(); renderTasks(); renderReminders();
    } else {
      const t = today();
      const dk = keyOf(t.jy, t.jm, t.jd);
      const ck = `${id}|${dk}`;
      DB.routineCompletions[ck] = !DB.routineCompletions[ck];
      persist(); renderRoutines();
    }
  }

  // ------------------------------------------------------------------
  // ۱۴) پشتیبان‌گیری
  // ------------------------------------------------------------------
  function exportBackup() {
    const blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const t = today();
    a.href = url; a.download = `doday-backup-${t.jy}-${t.jm}-${t.jd}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    toast('فایل پشتیبان دانلود شد');
  }

  function importBackup(e) {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || !Array.isArray(data.tasks)) throw new Error('invalid');
        const ok = await askConfirm('بازیابی این فایل، اطلاعات فعلی رو جایگزین می‌کنه. ادامه بدم؟');
        if (!ok) return;
        DB = Object.assign(defaultDB(), data);
        applyTheme(); persist(); refreshAll();
        toast('بازیابی انجام شد');
      } catch (err) { toast('فایل معتبر نیست'); }
      e.target.value = '';
    };
    reader.readAsText(file);
  }

  // ------------------------------------------------------------------
  // ۱۵) حساب کاربری (Sync / Supabase)
  // ------------------------------------------------------------------
  function renderAccount() {
    const area = $('#accountArea');
    if (!window.Sync || !Sync.isConfigured()) {
      area.innerHTML = `
        <div class="empty-state">
          این نسخه هنوز به سرور همگام‌سازی وصل نشده. برنامه به‌صورت کامل و محلی روی همین دستگاه کار می‌کنه.
          برای فعال‌سازی سینک بین دستگاه‌ها، فایل <b>config.js</b> رو با اطلاعات پروژه‌ی Supabase پر کن.
        </div>`;
      return;
    }
    if (Sync.isLoggedIn()) {
      const p = Sync.getProfile();
      area.innerHTML = `
        <div class="auth-status"><span class="dot-status online"></span> وارد شده به‌عنوان <b>${p.display_name || p.username}</b></div>
        <div class="modal-actions" style="margin-top:14px;">
          <button class="btn-secondary" id="btnSyncNow" style="flex:1">همگام‌سازی الان</button>
          <button class="btn-danger" id="btnLogout" style="flex:1">خروج از حساب</button>
        </div>`;
      $('#btnLogout').addEventListener('click', async () => { await Sync.signOut(); renderAccount(); toast('خارج شدی'); });
      $('#btnSyncNow').addEventListener('click', async () => {
        const pull = await Sync.pullData();
        if (pull.ok && pull.data) {
          const ok = await askConfirm('داده‌ی ذخیره‌شده روی سرور جایگزین اطلاعات همین دستگاه بشه؟');
          if (ok) { DB = Object.assign(defaultDB(), pull.data); applyTheme(); persist(true); refreshAll(); }
        }
        await Sync.pushDataSafe(DB);
        toast('همگام‌سازی انجام شد');
      });
      return;
    }
    area.innerHTML = `
      <div class="type-switch" id="authSwitch">
        <button type="button" data-a="login" class="active">ورود</button>
        <button type="button" data-a="signup">ثبت‌نام</button>
      </div>
      <div id="authFormArea"></div>`;
    renderAuthForm('login');
    $$('#authSwitch button').forEach((b) => b.addEventListener('click', () => {
      $$('#authSwitch button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      renderAuthForm(b.dataset.a);
    }));
  }

  function renderAuthForm(mode) {
    const box = $('#authFormArea');
    if (mode === 'login') {
      box.innerHTML = `
        <div class="field auth-form"><label>نام کاربری</label><input type="text" id="authUsername"></div>
        <div class="field auth-form"><label>رمز عبور</label><input type="password" id="authPassword"></div>
        <button class="btn-primary" id="authSubmit" style="width:100%">ورود</button>`;
      $('#authSubmit').addEventListener('click', async () => {
        const username = $('#authUsername').value.trim();
        const password = $('#authPassword').value;
        if (!username || !password) { toast('نام کاربری و رمز عبور رو وارد کن'); return; }
        const res = await Sync.signIn({ username, password });
        if (res.ok) { toast('خوش اومدی!'); renderAccount(); refreshAll(); }
        else toast(res.error || 'ورود ناموفق بود');
      });
    } else {
      box.innerHTML = `
        <div class="field auth-form"><label>نام و نام خانوادگی (انگلیسی) — یوزرنیم</label><input type="text" id="authUsername" placeholder="mortezaX"></div>
        <div class="field auth-form"><label>نام نمایشی (اختیاری)</label><input type="text" id="authDisplay"></div>
        <div class="field auth-form"><label>رمز عبور</label><input type="password" id="authPassword"></div>
        <button class="btn-primary" id="authSubmit" style="width:100%">ثبت‌نام</button>`;
      $('#authSubmit').addEventListener('click', async () => {
        const username = $('#authUsername').value.trim();
        const displayName = $('#authDisplay').value.trim();
        const password = $('#authPassword').value;
        if (!username || !password) { toast('نام کاربری و رمز عبور رو وارد کن'); return; }
        if (!/^[a-zA-Z][a-zA-Z0-9_]{2,20}$/.test(username)) { toast('یوزرنیم باید فقط حروف انگلیسی/عدد باشه'); return; }
        const res = await Sync.signUp({ username, password, displayName });
        if (res.ok) {
          $('#authFormArea').innerHTML = `<div class="pending-box">ثبت‌نام انجام شد ✅<br>حساب شما در انتظار تایید مدیره. بعد از تایید می‌تونی وارد بشی.</div>`;
        } else toast(res.error || 'ثبت‌نام ناموفق بود');
      });
    }
  }

  // ------------------------------------------------------------------
  // ۱۶) پنل ادمین
  // ------------------------------------------------------------------
  async function renderAdmin() {
    if (!window.Sync || !Sync.isConfigured() || !Sync.isAdmin()) {
      switchView('home'); return;
    }
    const pending = await Sync.adminListPending();
    $('#adminPendingList').innerHTML = pending.length
      ? pending.map((u) => `
        <div class="admin-user-row">
          <span>${u.display_name || u.username} (${u.username})</span>
          <button data-approve="${u.id}">تایید</button>
        </div>`).join('')
      : '<div class="empty-state">کسی در انتظار تایید نیست.</div>';
    $$('#adminPendingList [data-approve]').forEach((btn) => btn.addEventListener('click', async () => {
      await Sync.adminApprove(btn.dataset.approve);
      toast('کاربر تایید شد');
      renderAdmin();
    }));
    const all = await Sync.adminListAll();
    $('#adminAllList').innerHTML = all.map((u) => `
      <div class="admin-user-row">
        <span>${u.display_name || u.username} (${u.username}) ${u.is_admin ? '· ادمین' : ''}</span>
        <span class="tag">${u.approved ? 'تایید‌شده' : 'در انتظار'}</span>
      </div>`).join('');
  }

  function updateAdminLinkVisibility() {
    const show = !!(window.Sync && Sync.isConfigured() && Sync.isAdmin());
    $('#linkAdmin').hidden = !show;
  }

  // ------------------------------------------------------------------
  // ۱۷) شروع برنامه
  // ------------------------------------------------------------------
  async function init() {
    applyTheme();
    if (window.dodayDesktop && window.dodayDesktop.getAutoLaunch) {
      try { DB.settings.autoLaunch = await window.dodayDesktop.getAutoLaunch(); } catch (e) { /* noop */ }
    }
    $('#autoLaunchSwitch').classList.toggle('on', DB.settings.autoLaunch);
    $('#autoLaunchRow').hidden = !window.dodayDesktop;
    bindStaticEvents();
    renderHome();
    setInterval(renderHome, 60000);

    if (window.Sync) {
      Sync.setDataProvider(() => DB);
      const ok = await Sync.init();
      if (ok) {
        Sync.onChange(() => { updateAdminLinkVisibility(); });
        updateAdminLinkVisibility();
      }
      window.addEventListener('online', () => {
        if (Sync.isLoggedIn() && Sync.hasPending()) toast('اتصال برقرار شد، در حال هماهنگ‌سازی…');
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
