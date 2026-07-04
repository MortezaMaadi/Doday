/* ===================================================================
   jalali.js
   توابع تبدیل تاریخ بین شمسی (جلالی)، میلادی (گرگوری) و قمری (هجری)
   + نام ماه‌ها و روزهای هفته + فهرست مناسبت‌های رسمی ایران
   =================================================================== */

const Cal = (() => {
  // ---------- توابع کمکی ----------
  function div(a, b) { return Math.floor(a / b); }
  function mod(a, b) { return a - div(a, b) * b; }

  // ---------- گرگوری <-> عدد روز ژولیوسی (JDN) ----------
  // فرمول استاندارد Fliegel & Van Flandern
  function g2d(gy, gm, gd) {
    const a = div(14 - gm, 12);
    const y = gy + 4800 - a;
    const m = gm + 12 * a - 3;
    return gd + div(153 * m + 2, 5) + 365 * y + div(y, 4) - div(y, 100) + div(y, 400) - 32045;
  }

  function d2g(jdn) {
    const a = jdn + 32044;
    const b = div(4 * a + 3, 146097);
    const c = a - div(146097 * b, 4);
    const d = div(4 * c + 3, 1461);
    const e = c - div(1461 * d, 4);
    const m = div(5 * e + 2, 153);
    const gd = e - div(153 * m + 2, 5) + 1;
    const gm = m + 3 - 12 * div(m, 10);
    const gy = 100 * b + d - 4800 + div(m, 10);
    return { gy, gm, gd };
  }

  // ---------- محاسبه سال کبیسه شمسی ----------
  function jalCal(jy) {
    const breaks = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210,
      1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];
    const bl = breaks.length;
    const gy = jy + 621;
    let leapJ = -14;
    let jp = breaks[0];
    if (jy < jp || jy >= breaks[bl - 1]) {
      throw new Error('سال شمسی خارج از محدوده پشتیبانی‌شده است: ' + jy);
    }
    let jump = 0;
    let n = 0;
    for (let i = 1; i < bl; i += 1) {
      const jm = breaks[i];
      jump = jm - jp;
      if (jy < jm) break;
      leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
      jp = jm;
    }
    n = jy - jp;
    leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
    if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
    const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
    const march = 20 + leapJ - leapG;
    if (jump - n < 6) n = n - jump + div(jump, 33) * 33;
    let leap = mod(mod(n + 1, 33) - 1, 4);
    if (leap === -1) leap = 4;
    return { leap, gy, march };
  }

  // ---------- شمسی -> JDN ----------
  function j2d(jy, jm, jd) {
    const r = jalCal(jy);
    return g2d(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
  }

  // ---------- JDN -> شمسی ----------
  function d2j(jdn) {
    const gy = d2g(jdn).gy;
    let jy = gy - 621;
    const r = jalCal(jy);
    const jdn1f = g2d(gy, 3, r.march);
    let k = jdn - jdn1f;
    if (k >= 0) {
      if (k <= 185) {
        return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
      }
      k -= 186;
    } else {
      jy -= 1;
      k += 179;
      if (jalCal(jy).leap === 0) k += 1;
    }
    return { jy, jm: 7 + div(k, 30), jd: mod(k, 30) + 1 };
  }

  // ---------- تبدیل مستقیم ----------
  function gregorianToJalali(gy, gm, gd) {
    const j = d2j(g2d(gy, gm, gd));
    return [j.jy, j.jm, j.jd];
  }
  function jalaliToGregorian(jy, jm, jd) {
    const g = d2g(j2d(jy, jm, jd));
    return [g.gy, g.gm, g.gd];
  }

  // ---------- هجری قمری (تقریبی، جدولی) ----------
  const HIJRI_EPOCH_OFFSET = 1948440; // JDN مبدأ تقویم قمری جدولی
  function hijriToJdn(iy, im, id) {
    return id + Math.ceil(29.5 * (im - 1)) + (iy - 1) * 354
      + div(3 + 11 * iy, 30) + HIJRI_EPOCH_OFFSET - 1;
  }
  function jdnToHijri(jdn) {
    let l = jdn - HIJRI_EPOCH_OFFSET + 10632;
    const n = div(l - 1, 10631);
    l = l - 10631 * n + 354;
    const j = div(10985 - l, 5316) * div(50 * l, 17719) + div(l, 5670) * div(43 * l, 15238);
    l = l - div(30 - j, 15) * div(17719 * j, 50) - div(j, 16) * div(15238 * j, 43) + 29;
    const im = div(24 * l, 709);
    const id = l - div(709 * im, 24);
    const iy = 30 * n + j - 30;
    return { iy, im, id };
  }
  function gregorianToHijri(gy, gm, gd) {
    const h = jdnToHijri(g2d(gy, gm, gd));
    return [h.iy, h.im, h.id];
  }

  // ---------- روز هفته (۰=شنبه ... ۶=جمعه) ----------
  function weekdayIndex(gy, gm, gd) {
    const jdn = g2d(gy, gm, gd);
    // jdn برای جمعه‌ای مشخص mod 7 == 0 را طوری تنظیم می‌کنیم که شنبه=۰ باشد
    return mod(jdn + 2, 7);
  }

  // ---------- نام‌ها ----------
  const JALALI_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور',
    'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  const GREGORIAN_MONTHS = ['ژانویه', 'فوریه', 'مارس', 'آوریل', 'مه', 'ژوئن',
    'ژوئیه', 'اوت', 'سپتامبر', 'اکتبر', 'نوامبر', 'دسامبر'];
  const HIJRI_MONTHS = ['محرم', 'صفر', 'ربیع‌الاول', 'ربیع‌الثانی', 'جمادی‌الاول',
    'جمادی‌الثانی', 'رجب', 'شعبان', 'رمضان', 'شوال', 'ذیقعده', 'ذیحجه'];
  const WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
  const WEEKDAYS_SHORT = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

  const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  function toFaDigits(input) {
    return String(input).replace(/[0-9]/g, (d) => FA_DIGITS[d]);
  }

  function isJalaliLeap(jy) {
    return jalCal(jy).leap === 0;
  }
  function jalaliMonthLength(jy, jm) {
    if (jm <= 6) return 31;
    if (jm <= 11) return 30;
    return isJalaliLeap(jy) ? 30 : 29;
  }

  // ---------- کلید تاریخ برای ذخیره‌سازی: همیشه به شکل شمسی YYYY-MM-DD ----------
  function jalaliKey(jy, jm, jd) {
    return `${jy}-${String(jm).padStart(2, '0')}-${String(jd).padStart(2, '0')}`;
  }
  function parseJalaliKey(key) {
    const [jy, jm, jd] = key.split('-').map(Number);
    return { jy, jm, jd };
  }

  function todayJalali() {
    const now = new Date();
    const [jy, jm, jd] = gregorianToJalali(now.getFullYear(), now.getMonth() + 1, now.getDate());
    return { jy, jm, jd };
  }

  function addDaysToJalali(jy, jm, jd, days) {
    const jdn = j2d(jy, jm, jd) + days;
    return d2j(jdn);
  }

  // فاصله (به روز) از تاریخ a تا تاریخ b (b - a)
  function diffDays(ajy, ajm, ajd, bjy, bjm, bjd) {
    return j2d(bjy, bjm, bjd) - j2d(ajy, ajm, ajd);
  }

  return {
    gregorianToJalali, jalaliToGregorian, gregorianToHijri,
    weekdayIndex, JALALI_MONTHS, GREGORIAN_MONTHS, HIJRI_MONTHS,
    WEEKDAYS, WEEKDAYS_SHORT, toFaDigits, isJalaliLeap, jalaliMonthLength,
    jalaliKey, parseJalaliKey, todayJalali, addDaysToJalali, diffDays, j2d, d2j, g2d, d2g,
  };
})();

/* ===================================================================
   مناسبت‌های رسمی ایران
   - رسمی‌های ثابت شمسی: هر سال در همان روز و ماه شمسی تکرار می‌شوند
   - رسمی‌های قمری: بر اساس تقویم هجری قمری (تقریبی) محاسبه و به شمسی
     تبدیل می‌شوند. دقت این تبدیل جدولی است و ممکن است با رؤیت هلال
     واقعی یک روز اختلاف داشته باشد
   =================================================================== */
const OFFICIAL_HOLIDAYS = {
  fixedSolar: [
    { jm: 1, jd: 1, title: 'نوروز', holiday: true },
    { jm: 1, jd: 2, title: 'نوروز', holiday: true },
    { jm: 1, jd: 3, title: 'نوروز', holiday: true },
    { jm: 1, jd: 4, title: 'نوروز', holiday: true },
    { jm: 1, jd: 12, title: 'روز جمهوری اسلامی ایران', holiday: true },
    { jm: 1, jd: 13, title: 'روز طبیعت (سیزده‌به‌در)', holiday: true },
    { jm: 3, jd: 14, title: 'رحلت امام خمینی (ره)', holiday: true },
    { jm: 3, jd: 15, title: 'قیام ۱۵ خرداد', holiday: true },
    { jm: 11, jd: 22, title: 'پیروزی انقلاب اسلامی', holiday: true },
    { jm: 12, jd: 29, title: 'روز ملی شدن صنعت نفت', holiday: true },
  ],
  lunar: [
    { im: 1, id: 9, title: 'تاسوعای حسینی', holiday: true },
    { im: 1, id: 10, title: 'عاشورای حسینی', holiday: true },
    { im: 2, id: 20, title: 'اربعین حسینی', holiday: true },
    { im: 2, id: 28, title: 'رحلت پیامبر اکرم و شهادت امام حسن مجتبی (ع)', holiday: true },
    { im: 2, id: 30, title: 'شهادت امام رضا (ع)', holiday: true },
    { im: 3, id: 8, title: 'شهادت امام حسن عسکری (ع)', holiday: true },
    { im: 3, id: 17, title: 'میلاد پیامبر اکرم و امام جعفر صادق (ع)', holiday: true },
    { im: 7, id: 13, title: 'میلاد امام علی (ع)', holiday: true },
    { im: 7, id: 27, title: 'مبعث پیامبر اکرم', holiday: true },
    { im: 8, id: 15, title: 'میلاد امام زمان (عج)', holiday: true },
    { im: 9, id: 21, title: 'شهادت امام علی (ع)', holiday: true },
    { im: 10, id: 1, title: 'عید سعید فطر', holiday: true },
    { im: 10, id: 2, title: 'تعطیل به مناسبت عید فطر', holiday: true },
    { im: 10, id: 25, title: 'شهادت امام جعفر صادق (ع)', holiday: true },
    { im: 12, id: 10, title: 'عید سعید قربان', holiday: true },
    { im: 12, id: 18, title: 'عید سعید غدیر خم', holiday: true },
  ],
};

// برمی‌گرداند: آرایه‌ای از { title, holiday } برای یک تاریخ شمسی مشخص
function getOfficialOccasions(jy, jm, jd) {
  const result = [];
  OFFICIAL_HOLIDAYS.fixedSolar.forEach((item) => {
    if (item.jm === jm && item.jd === jd) result.push({ title: item.title, holiday: !!item.holiday });
  });
  try {
    const [gy, gm, gd] = Cal.jalaliToGregorian(jy, jm, jd);
    const [iy, im, id] = Cal.gregorianToHijri(gy, gm, gd);
    OFFICIAL_HOLIDAYS.lunar.forEach((item) => {
      if (item.im === im && item.id === id) result.push({ title: item.title, holiday: !!item.holiday });
    });
  } catch (e) { /* خارج از محدوده - نادیده گرفته می‌شود */ }
  return result;
}
