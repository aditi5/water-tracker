/* Water reminder — personal PWA. All data in localStorage. */
(function () {
  'use strict';

  var TZ = 'Asia/Kolkata';
  var STORE_KEY = 'water.v1';
  var DEFAULT_TIMES = ['09:00', '11:00', '13:00', '15:00', '17:00', '19:00', '21:00'];
  var NUDGE_MS = 2 * 60 * 60 * 1000;

  // ---------- date helpers (Asia/Kolkata) ----------
  var dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
  var timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
  var niceTimeFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true });
  var longDateFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'short' });
  var wkFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, weekday: 'short' });

  function dayKey(d) { return dayFmt.format(d || new Date()); } // YYYY-MM-DD
  function hhmm(d) { return timeFmt.format(d || new Date()); }  // HH:MM
  function keyToDate(k) { var p = k.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 6, 30)); } // noon IST
  function shiftKey(k, delta) { var d = keyToDate(k); d.setUTCDate(d.getUTCDate() + delta); return dayKey(d); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // ---------- state ----------
  function defaults() {
    return { settings: { glassMl: 250, goalMl: 2000, unit: 'glasses', times: DEFAULT_TIMES.slice() }, days: {} };
  }
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(STORE_KEY));
      if (!s || !s.settings || !s.days) return defaults();
      var d = defaults().settings;
      for (var k in d) if (s.settings[k] === undefined) s.settings[k] = d[k];
      return s;
    } catch (e) { return defaults(); }
  }
  var state = load();
  function save() {
    // keep last ~120 days
    var keys = Object.keys(state.days).sort();
    while (keys.length > 120) delete state.days[keys.shift()];
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  function entries(k) { var d = state.days[k]; return (d && d.entries) || []; }
  function total(k) { return entries(k).reduce(function (a, e) { return a + e.ml; }, 0); }
  function goalFor(k) { var d = state.days[k]; return (d && d.goal) || state.settings.goalMl; }
  function hit(k) { return total(k) >= goalFor(k) && total(k) > 0; }

  function addMl(ml) {
    var k = dayKey();
    if (!state.days[k]) state.days[k] = { entries: [] };
    state.days[k].goal = state.settings.goalMl;
    var wasHit = hit(k);
    state.days[k].entries.push({ t: Date.now(), ml: ml });
    save();
    nudgeDismissedAt = 0;
    render();
    var btn = $('addGlass'); btn.classList.remove('pulse'); void btn.offsetWidth; btn.classList.add('pulse');
    if (!wasHit && hit(k)) toast('Goal reached! 🎉 Well done, Aditi');
    else toast('+' + ml + ' ml 💧');
    if (navigator.vibrate) navigator.vibrate(12);
  }
  function undo() {
    var k = dayKey(), e = entries(k);
    if (!e.length) return;
    var last = e.pop(); save(); render(); toast('Removed ' + last.ml + ' ml');
  }

  function streak() {
    var k = dayKey(), n = 0;
    if (!hit(k)) k = shiftKey(k, -1); // today still in progress doesn't break the streak
    while (hit(k)) { n++; k = shiftKey(k, -1); }
    return n;
  }

  function lastDrinkTime() {
    var best = 0;
    Object.keys(state.days).forEach(function (k) {
      entries(k).forEach(function (e) { if (e.t > best) best = e.t; });
    });
    return best;
  }

  // ---------- DOM ----------
  function $(id) { return document.getElementById(id); }
  var toastTimer;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.classList.remove('hidden');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.classList.add('hidden'); }, 1800);
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

  var R = 94, CIRC = 2 * Math.PI * R;
  var renderedDay = dayKey();

  function renderToday() {
    var k = dayKey(), s = state.settings, tot = total(k), goal = s.goalMl;
    var pct = Math.min(tot / goal, 1);
    var fg = $('ringFg');
    fg.style.strokeDasharray = CIRC;
    fg.style.strokeDashoffset = CIRC * (1 - pct);
    $('mlNow').textContent = tot;
    $('mlGoal').textContent = goal;
    var gl = Math.round((tot / s.glassMl) * 10) / 10, gg = Math.round((goal / s.glassMl) * 10) / 10;
    $('glassesText').textContent = gl + ' / ' + gg + ' glasses';
    $('glassSizeLabel').textContent = '(' + s.glassMl + ' ml)';
    $('dateLabel').textContent = longDateFmt.format(new Date());
    var h = +hhmm().slice(0, 2);
    $('hello').textContent = (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening') + ', Aditi';

    var left = goal - tot, msg;
    if (tot === 0) msg = "Let's get started 🌊";
    else if (left <= 0) msg = 'Goal reached — beautifully hydrated ✨';
    else if (pct >= 0.75) msg = 'Almost there — ' + left + ' ml to go';
    else if (pct >= 0.5) msg = 'Halfway there 💪 ' + left + ' ml to go';
    else msg = left + ' ml to go — keep sipping';
    $('statusText').textContent = msg;

    var e = entries(k);
    $('undoBtn').disabled = !e.length;
    $('logList').innerHTML = e.length
      ? e.slice().reverse().map(function (x) { return '<li><span class="t">' + esc(niceTimeFmt.format(new Date(x.t))) + '</span><span>💧 ' + x.ml + ' ml</span></li>'; }).join('')
      : '<li class="empty">No water logged yet today</li>';
    var st = streak();
    $('streakTop').textContent = st;
  }

  function renderHistory() {
    var today = dayKey(), days = [];
    for (var i = 6; i >= 0; i--) days.push(shiftKey(today, -i));
    var max = Math.max.apply(null, days.map(function (k) { return Math.max(total(k), goalFor(k)); }).concat([state.settings.goalMl]));
    var chartH = 200 - 18 - 20 - 16; // chart height minus padding, label, value
    var html = days.map(function (k) {
      var tot = total(k), h = Math.round((tot / max) * chartH), isT = k === today;
      var lbl = isT ? 'Today' : wkFmt.format(keyToDate(k));
      return '<div class="bar-col"><div class="bar-val">' + (tot ? tot : '') + '</div>' +
        '<div class="bar' + (hit(k) ? ' hit' : '') + (isT ? ' today' : '') + '" style="height:' + Math.max(h, 4) + 'px" title="' + k + ': ' + tot + ' ml"></div>' +
        '<div class="bar-lbl' + (isT ? ' today' : '') + '">' + lbl + '</div></div>';
    }).join('');
    var goalY = Math.round((state.settings.goalMl / max) * chartH);
    html += '<div class="goal-line" style="bottom:' + (goalY + 20) + 'px"></div>';
    $('chart').innerHTML = html;
    $('streakNum').textContent = streak();
    var sum = days.reduce(function (a, k) { return a + total(k); }, 0);
    $('avgNum').textContent = Math.round(sum / 7);
    $('hitNum').textContent = days.filter(hit).length + '/7';
  }

  function renderSettings() {
    var s = state.settings;
    $('unitGlasses').classList.toggle('active', s.unit === 'glasses');
    $('unitMl').classList.toggle('active', s.unit === 'ml');
    var gi = $('goalInput');
    if (document.activeElement !== gi) {
      if (s.unit === 'glasses') { gi.value = Math.round((s.goalMl / s.glassMl) * 10) / 10; gi.step = '0.5'; gi.max = 40; }
      else { gi.value = s.goalMl; gi.step = '50'; gi.max = 10000; }
    }
    $('goalLabel').textContent = s.unit === 'glasses' ? 'Goal (glasses)' : 'Goal (ml)';
    if (document.activeElement !== $('glassInput')) $('glassInput').value = s.glassMl;
    $('goalSummary').textContent = 'Daily goal: ' + s.goalMl + ' ml ≈ ' + (Math.round((s.goalMl / s.glassMl) * 10) / 10) + ' glasses of ' + s.glassMl + ' ml';
    $('timesList').innerHTML = s.times.length
      ? s.times.map(function (t) { return '<li>' + esc(fmt12(t)) + '<button data-time="' + esc(t) + '" aria-label="Remove ' + esc(t) + '">×</button></li>'; }).join('')
      : '<li class="empty">No reminder times</li>';
  }

  function fmt12(t) {
    var h = +t.slice(0, 2), m = t.slice(3, 5);
    return ((h % 12) || 12) + ':' + m + (h < 12 ? ' am' : ' pm');
  }

  function render() { renderToday(); renderHistory(); renderSettings(); checkNudge(); }

  // ---------- nudge ----------
  var nudgeDismissedAt = 0;
  function checkNudge() {
    var now = Date.now(), last = lastDrinkTime(), s = state.settings;
    var times = s.times.slice().sort(), cur = hhmm();
    var awake = times.length ? (cur >= times[0] && cur <= addMinutes(times[times.length - 1], 60)) : (cur >= '08:00' && cur <= '22:00');
    var todayHit = total(dayKey()) >= s.goalMl;
    var since = last ? now - last : Infinity;
    var show = awake && !todayHit && since > NUDGE_MS && (now - nudgeDismissedAt > 30 * 60 * 1000);
    if (show) {
      $('nudgeText').textContent = last && dayKey(new Date(last)) === dayKey()
        ? "It's been " + humanSince(since) + ' since your last glass. Time for a few sips? 💙'
        : 'No water logged yet today. Start with a glass? 💙';
    }
    $('nudge').classList.toggle('hidden', !show);
  }
  function addMinutes(t, m) { var x = +t.slice(0, 2) * 60 + +t.slice(3, 5) + m; x = Math.min(x, 23 * 60 + 59); return pad(Math.floor(x / 60)) + ':' + pad(x % 60); }
  function humanSince(ms) { var mins = Math.floor(ms / 60000), h = Math.floor(mins / 60), m = mins % 60; return h + ' h' + (m ? ' ' + m + ' min' : ''); }

  // ---------- ICS ----------
  function icsEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  function foldLine(line) {
    // RFC 5545: lines max 75 octets (UTF-8), continuation lines start with a space.
    var enc = new TextEncoder(), out = [], cur = '', curBytes = 0, limit = 75;
    for (var ch of line) {
      var b = enc.encode(ch).length;
      if (curBytes + b > limit) { out.push(cur); cur = ' '; curBytes = 1; limit = 75; }
      cur += ch; curBytes += b;
    }
    out.push(cur);
    return out.join('\r\n');
  }
  function utcStamp(d) {
    return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + 'T' + pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + 'Z';
  }
  function buildICS(times) {
    var now = new Date(), stamp = utcStamp(now), today = dayKey(now).replace(/-/g, '');
    var lines = [
      'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Aditi Water Reminder//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
      'X-WR-CALNAME:Water reminders', 'X-WR-TIMEZONE:' + TZ,
      'BEGIN:VTIMEZONE', 'TZID:' + TZ,
      'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0530', 'TZOFFSETTO:+0530', 'TZNAME:IST', 'END:STANDARD',
      'END:VTIMEZONE'
    ];
    times.slice().sort().forEach(function (t) {
      var hm = t.replace(':', '');
      lines.push(
        'BEGIN:VEVENT',
        'UID:water-' + hm + '-' + today + '@aditi-water-reminder',
        'DTSTAMP:' + stamp,
        'DTSTART;TZID=' + TZ + ':' + today + 'T' + hm + '00',
        'DURATION:PT5M',
        'RRULE:FREQ=DAILY',
        'SUMMARY:' + icsEscape('Drink water 💧'),
        'DESCRIPTION:' + icsEscape('Time for a glass of water, Aditi. Stay hydrated!'),
        'TRANSP:TRANSPARENT',
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + icsEscape('Drink water 💧'), 'TRIGGER:PT0M', 'END:VALARM',
        'END:VEVENT'
      );
    });
    lines.push('END:VCALENDAR');
    return lines.map(foldLine).join('\r\n') + '\r\n';
  }
  window.buildWaterICS = function () { return buildICS(state.settings.times); };

  function downloadICS() {
    var times = state.settings.times;
    if (!times.length) { toast('Add at least one reminder time first'); return; }
    var ics = buildICS(times);
    var file = 'water-reminders.ics';
    var blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    var standalone = window.navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
    // In iOS home-screen mode, blob downloads can be ignored; the share sheet handles files reliably.
    if (standalone && navigator.canShare) {
      try {
        var f = new File([blob], file, { type: 'text/calendar' });
        if (navigator.canShare({ files: [f] })) {
          navigator.share({ files: [f], title: 'Water reminders' }).catch(function () {});
          $('icsNote').textContent = 'Choose Calendar (or Save to Files, then open it) to add ' + times.length + ' daily reminders.';
          return;
        }
      } catch (e) {}
    }
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = file; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    $('icsNote').textContent = 'Downloaded ' + times.length + ' daily reminders. Tap "Add All" in Calendar. If you change times later, delete the old events first to avoid duplicates.';
  }

  // ---------- events ----------
  $('addGlass').addEventListener('click', function () { addMl(state.settings.glassMl); });
  $('undoBtn').addEventListener('click', undo);
  $('customToggle').addEventListener('click', function () {
    var f = $('customForm'); f.classList.toggle('hidden');
    if (!f.classList.contains('hidden')) $('customMl').focus();
  });
  $('customForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = Math.round(+$('customMl').value);
    if (!v || v < 10 || v > 3000) { toast('Enter 10–3000 ml'); return; }
    addMl(v); $('customMl').value = ''; $('customForm').classList.add('hidden');
  });
  $('nudgeClose').addEventListener('click', function () { nudgeDismissedAt = Date.now(); $('nudge').classList.add('hidden'); });

  document.querySelectorAll('.tab').forEach(function (b) {
    b.addEventListener('click', function () {
      document.querySelectorAll('.tab').forEach(function (x) { x.classList.toggle('active', x === b); });
      document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('active', v.id === 'view-' + b.dataset.view); });
      window.scrollTo(0, 0);
      render();
    });
  });

  document.querySelectorAll('.seg-btn').forEach(function (b) {
    b.addEventListener('click', function () { state.settings.unit = b.dataset.unit; save(); renderSettings(); });
  });
  function applyGoal() {
    var s = state.settings, v = +$('goalInput').value;
    if (!v || v <= 0) return;
    var ml = s.unit === 'glasses' ? Math.round(v * s.glassMl) : Math.round(v);
    s.goalMl = Math.min(Math.max(ml, 100), 10000);
    var k = dayKey(); if (state.days[k]) state.days[k].goal = s.goalMl;
    save(); renderToday(); renderHistory(); renderSettings();
  }
  $('goalInput').addEventListener('input', applyGoal);
  $('goalInput').addEventListener('change', function () { applyGoal(); $('goalInput').blur(); renderSettings(); });
  $('glassInput').addEventListener('change', function () {
    var v = Math.round(+$('glassInput').value);
    if (v >= 50 && v <= 1000) { state.settings.glassMl = v; save(); }
    render();
  });
  $('timesList').addEventListener('click', function (e) {
    var t = e.target.getAttribute && e.target.getAttribute('data-time');
    if (!t) return;
    state.settings.times = state.settings.times.filter(function (x) { return x !== t; });
    save(); renderSettings(); checkNudge();
  });
  $('addTimeForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var t = $('newTime').value;
    if (!/^\d{2}:\d{2}$/.test(t)) { toast('Pick a time'); return; }
    if (state.settings.times.indexOf(t) !== -1) { toast('Already in the list'); return; }
    state.settings.times.push(t); state.settings.times.sort(); save(); renderSettings(); toast('Added ' + fmt12(t));
  });
  $('resetTimes').addEventListener('click', function () { state.settings.times = DEFAULT_TIMES.slice(); save(); renderSettings(); });
  $('icsBtn').addEventListener('click', downloadICS);
  $('clearToday').addEventListener('click', function () {
    if (!confirm("Clear today's log?")) return;
    delete state.days[dayKey()]; save(); render();
  });

  // Re-render at IST midnight / when returning to app.
  function tick() {
    if (dayKey() !== renderedDay) { renderedDay = dayKey(); render(); } else { renderToday(); checkNudge(); }
  }
  setInterval(tick, 30000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) { state = load(); tick(); render(); } });

  render();

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
  }
})();
