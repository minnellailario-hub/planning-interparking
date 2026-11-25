'use strict';
const $ = s => document.querySelector(s);
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const OFF = { REPOS: 'Repos', WE: 'Week-end', RTT: 'RTT', RECUP: 'Récup', CONGE: 'Congé', MALADIE: 'Maladie', FORMATION: 'Formation', SS: 'Sans solde', ANC: 'Ancienneté', PC: 'Petit chômage', PATERNITE: 'Paternité', AT: 'Accident travail', AJ: 'Absence justifiée', RJ: 'Récup férié', CS: 'Congé syndical', RS: 'Récup syndicale', FS: 'Form. syndicale', MS: 'Mission syndicale' };
const SHORT = { REPOS: 'R', WE: 'WE', RTT: 'RTT', RECUP: 'Réc', CONGE: 'CG', MALADIE: 'M', FORMATION: 'For', SS: 'SS', ANC: 'ANC', PC: 'PC', PATERNITE: 'Pat', AT: 'AT', AJ: 'AJ', RJ: 'RJ', CS: 'CS', RS: 'RS', FS: 'FS', MS: 'MS' };
// Codes de la fiche salaires (en plus de Congé, Maladie, Formation, RTT, Récup).
const PAY_CODES = ['SS', 'ANC', 'PC', 'PATERNITE', 'AT', 'AJ', 'RJ', 'CS', 'RS', 'FS', 'MS'];

let month = (() => {
  try { const m = localStorage.getItem('month'); if (/^\d{4}-\d{2}$/.test(m)) return m; } catch {}
  const d = new Date(); d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
})();
let data = null;

// Version web : le planning tourne dans la page (window.planningBackend) ; sinon, serveur local.
const backend = window.planningBackend || null;
async function call(path, body, q = {}) {
  if (backend) return (await backend.handle(body ? 'POST' : 'GET', path, q, body || {})).json;
  const qs = new URLSearchParams(q).toString();
  const r = await fetch(path + (qs ? '?' + qs : ''), body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  return r.json();
}
async function api(path, body) {
  const j = await call(path, body ? { month, ...body } : null, body ? {} : { month });
  if (j.needLogin) { showLogin(); throw new Error(j.error); }
  if (j.error) { toast(j.error); throw new Error(j.error); }
  data = j; render(); return j;
}
// Appels de connexion : ne redessinent pas le planning.
async function authCall(path, body) {
  const j = await call(path, body);
  if (j.error) throw new Error(j.error);
  return j;
}
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, 3500);
}
const addMonth = (ym, n) => { const [y, m] = ym.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const fmtDate = d => `${d.slice(8)}/${d.slice(5, 7)}`;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Couleur d'une case : le chef terrain a sa propre couleur, quel que soit son horaire.
const shiftCls = (c, isChef) => c.kind === 'off' ? c.code : isChef ? 'CHEF' : c.shift;
// Durée d'un horaire « 8-16 », « 16-00 »… (affichée sous l'horaire dans le nouveau thème).
const shiftDur = label => { const m = String(label || '').match(/(\d{1,2})\s*-\s*(\d{1,2})/); if (!m) return ''; const h = ((Number(m[2]) || 24) - Number(m[1]) + 24) % 24; return h ? h + 'h' : ''; };
// Initiales pour l'avatar (nouveau thème).
const initials = name => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');
// « 8-16 » → « 08:00 – 16:00 » (vue semaine).
const fullTimes = label => innerWidth < 700 ? String(label || '') : String(label || '').replace(/(\d{1,2})\s*-\s*(\d{1,2})/, (_, a, b) => `${a.padStart(2, '0')}:00 – ${(b === '0' || b === '00' ? '00' : b).padStart(2, '0')}:00`);
function cellHtml(c, isChef, wide = false) {
  if (!c) return '';
  if (c.kind === 'off') return `<span class="c-${c.code}">${wide ? OFF[c.code] || c.code : SHORT[c.code] || c.code}</span>`;
  const dur = shiftDur(c.label);
  // Vue semaine : le ⚽ passe sous les heures (« 8h · Foot ») pour que les heures restent entières.
  const foot = wide && c.shift === 'FOOT';
  const lbl = foot ? c.label.replace('⚽', '').trim() : c.label;
  return `<span class="c-${shiftCls(c, isChef)}"><b class="t">${esc(wide ? fullTimes(lbl) : lbl)}</b>${dur ? `<small class="dur">${dur}${foot ? ' · ⚽ Foot' : ''}</small>` : ''}</span>`;
}
// Heures prévues sur des jours donnés (vue semaine : la semaine affichée).
const hoursOn = (r, dates) => r.isParkChief ? 0 : dates.reduce((n, d) => { const c = r.cells[d]; return n + (c && c.kind === 'work' ? parseInt(shiftDur(c.label)) || 0 : 0); }, 0);
// Couleur douce de l'avatar, toujours la même pour une personne.
const avColor = id => 'av' + ([...String(id)].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 6);
// Heures prévues dans le mois pour une ligne (nouveau thème, sous le nom).
function monthHours(r) {
  if (r.isParkChief) return 0;
  return Object.entries(r.cells).filter(([d, c]) => d.startsWith(month) && c && c.kind === 'work').reduce((n, [, c]) => n + (parseInt(shiftDur(c.label)) || 0), 0);
}

// ----- Parkings liés : Westland et Bordet (sélecteur en haut à gauche) -----
const SITE_HIDDEN = ['zones', 'fixed', 'calendar', 'students']; // pages sans objet à Bordet
function renderSite() {
  const acc = data.account || {}, site = acc.site || 'westland', sites = acc.sites || [];
  document.body.classList.toggle('site-bordet', site === 'bordet');
  $('#sideSub').textContent = site === 'bordet' ? 'Bordet · Planning' : 'Westland Shopping · Planning';
  const sw = $('#siteSwitch');
  sw.hidden = sites.length < 2;
  if (sites.length > 1) sw.innerHTML = sites.map(s => `<button type="button" data-ws="${s.id}" class="${s.id === acc.workspaceId ? 'on' : ''}">${esc(s.name)}</button>`).join('');
  if (site === 'bordet' && SITE_HIDDEN.includes(document.body.dataset.page)) go('planning');
}
$('#siteSwitch').addEventListener('click', async e => {
  const b = e.target.closest('[data-ws]'); if (!b || b.classList.contains('on')) return;
  $('#siteSwitch').querySelectorAll('button').forEach(x => x.disabled = true);
  try {
    await api('/api/workspace/switch', { id: b.dataset.ws });
    access = null;
    if (document.body.dataset.page === 'agenda') loadAgenda();
    if (document.body.dataset.page === 'invoices' && typeof loadInvoices === 'function') loadInvoices();
    toast(`${b.textContent} ouvert`);
  } catch {} finally { $('#siteSwitch').querySelectorAll('button').forEach(x => x.disabled = false); }
});

function render() {
  if (data.account && data.account.role === 'employee') return renderEmployee();
  document.body.classList.remove('employee');
  renderSite();
  const v = data.view;
  const [y, m] = month.split('-').map(Number);
  $('#monthTitle').textContent = `${MONTHS[m - 1]} ${y}`;
  $('#csv').href = `/api/export.xlsx?month=${month}`;
  try { localStorage.setItem('month', month); } catch {}
  $('#syncBar').hidden = !data.syncError;
  $('#syncBar').textContent = data.syncError || '';

  // Semaines complètes (lundi au dimanche) : les jours d'un autre mois sont grisés.
  // Vue « Semaine » : seulement les 7 jours de la semaine choisie, en grand.
  const all = v.allDays || v.days;
  const wide = view === 'week';
  if (wide && !all.some(d => d.date === wkStart)) {
    const today = localDay(), mon = all.find(d => d.dow === 1 && d.date <= today && addDay(d.date, 6) >= today);
    wkStart = (mon || all.find(d => d.dow === 1 && !d.outside) || all[0]).date;
  }
  const gd = wide ? all.filter(d => d.date >= wkStart && d.date <= addDay(wkStart, 6)) : all;
  $('#grid').classList.toggle('week', wide);
  if (wide) {
    const a = new Date(wkStart + 'T12:00:00'), b = new Date(addDay(wkStart, 6) + 'T12:00:00');
    $('#weekTitle').textContent = `Semaine du ${a.getDate()}${a.getMonth() !== b.getMonth() ? ' ' + MONTHS[a.getMonth()].toLowerCase() : ''} au ${b.getDate()} ${MONTHS[b.getMonth()].toLowerCase()}`;
  }
  const colCls = d => [d.dow === 1 ? 'monday' : '', d.closed ? 'closed' : '', d.dow === 6 ? 'sat' : '', d.outside ? 'outside' : '', d.frozen ? 'frozen' : ''].join(' ');
  let h = '<thead><tr><th class="name">Employé</th>';
  for (const d of gd) {
    const title = [d.holiday ? `Férié : ${d.holiday}${d.closed ? '' : ' (rouvert)'}` : d.closed ? 'Fermé' : '', d.weGroup.length ? 'Week-end : ' + d.weGroup.join(', ') : '',
      d.match ? `Anderlecht – ${d.match.opponent} (${d.match.competition}) ${d.match.time}${d.match.confirmed ? '' : ' – heure à confirmer'}` : ''].filter(Boolean).join('\n');
    h += `<th class="${colCls(d)} ${d.date === localDay() ? 'today' : ''}" data-date="${d.date}" title="${esc(title)}"><span class="d">${d.dowLabel}</span>${wide ? ' ' : '<br>'}<span class="n">${d.day}</span>`;
    if (d.openSunday) h += `<span class="o">Ouvert</span>`;
    if (d.holiday) h += `<span class="f">Férié</span>`;
    if (d.match) h += `<span class="m ${d.match.confirmed ? '' : 'tbc'}">⚽ ${d.match.time}</span>`;
    h += '</th>';
  }
  h += '</tr></thead><tbody>';
  const firstEmp = v.rows.findIndex(r => !r.isChef && !r.isParkChief);
  v.rows.forEach((r, k) => {
    h += `<tr class="${r.isChef || r.isParkChief ? 'chef' : k === firstEmp && k > 0 ? 'sep' : ''}"><td class="name"><div class="namebox"><i class="av ${avColor(r.id)}">${initials(r.name)}</i><span>${esc(r.name)}${r.note ? `<small>${esc(r.note)}</small>` : ''}${(wide ? hoursOn(r, gd.map(d => d.date)) : monthHours(r)) ? `<small class="hrs">${wide ? hoursOn(r, gd.map(d => d.date)) + 'h cette semaine' : monthHours(r) + 'h ce mois'}</small>` : ''}</span>${r.isChef || r.isParkChief ? `<button class="edit-chef ghost" title="Modifier le chef terrain et le chef de parc">✎</button>` : `<button class="edit-emp ghost" data-id="${r.id}" title="Modifier ou supprimer ${esc(r.name)}">✎</button>`}</div></td>`;
    for (const d of gd) {
      const c = r.cells[d.date];
      h += `<td class="cell ${colCls(d)} ${c && c.pinned ? 'lock' : ''}" data-emp="${r.id}" data-date="${d.date}">${cellHtml(c, r.isChef, wide)}</td>`;
    }
    h += '</tr>';
  });
  h += `<tr class="addrow"><td class="name"><button class="add-emp">+ Ajouter un employé</button></td><td colspan="${gd.length}"></td></tr>`;
  // Étudiants : une ligne par étudiant ; en pointillé quand l'outil l'a ajouté tout seul.
  v.studentRows.forEach((r, k) => {
    h += `<tr class="student ${k === 0 ? 'sep' : ''}"><td class="name">${esc(r.name)}${k === 0 ? '<small>Étudiants</small>' : ''}</td>`;
    for (const d of gd) {
      const c = r.cells[d.date];
      const inner = !c ? '' : c.kind === 'off' ? '<span class="c-NONE">—</span>' : `<span class="c-STUDENT ${c.auto ? 'auto' : ''}"><b class="t">${esc(wide ? fullTimes(c.label.replace('⚽', '').trim()) : c.label)}</b>${wide && shiftDur(c.label) ? `<small class="dur">${shiftDur(c.label)}${c.shift === 'FOOT' ? ' · ⚽ Foot' : ''}</small>` : ''}</span>`;
      h += `<td class="cell ${colCls(d)} ${c && c.pinned ? 'lock' : ''}" data-emp="${r.id}" data-date="${d.date}">${inner}</td>`;
    }
    h += '</tr>';
  });
  h += '<tr class="sum"><td class="name">Présents</td>';
  for (const d of gd) {
    if (d.closed && !d.present) { h += `<td class="${colCls(d)}"></td>`; continue; }
    const tot = d.present + d.students.length;
    h += `<td class="${colCls(d)} ${d.missing || d.warnings.length ? 'bad' : ''}" title="${esc(d.warnings.join('\n'))}">${tot}${d.need ? '/' + d.need : ''}</td>`;
  }
  h += '</tr></tbody>';
  $('#grid').innerHTML = h;

  $('#legend').innerHTML = (v.site === 'bordet' ? [['7-15', '7-15'], ['11-19', '11-19 (mercredi)'], ['REPOS', 'R = Repos'], ['WE', 'WE = Week-end'], ['CONGE', 'CG = Congé'], ['MALADIE', 'M = Maladie'], ['FORMATION', 'For = Formation']] : [['8-16', '8-16'], ['10-18', '10-18'], ['12-20', '12-20'], ['FOOT', '⚽ Horaire foot'], ['CHEF', 'Chef terrain'],
    ['REPOS', 'R = Repos'], ['WE', 'WE = Week-end'], ['RTT', 'RTT'], ['RECUP', 'Réc = Récup (dimanche ou férié)'], ['CONGE', 'CG = Congé'], ['MALADIE', 'M = Maladie'], ['FORMATION', 'For = Formation']])
    .map(([c, l]) => `<span><span class="sw c-${c}">&nbsp;</span>${l}</span>`).join('');

  $('#warnings').innerHTML = !v.generated ? '<li class="ok">Mois pas encore généré.</li>'
    : v.warnings.length ? v.warnings.map(w => `<li>${esc(w)}</li>`).join('') : '<li class="ok">Aucune alerte, toutes les règles sont respectées.</li>';

  renderStatsPage(v);

  renderDays();
  renderDashboard();
  renderAccount();
  renderAbsences();
  // L'horaire a pu changer (maladie, autre compte…) : les zones du jour affiché se recalculent.
  if (document.body.dataset.page === 'zones') loadZones();
  if (document.body.dataset.page === 'log' && !logForm) loadLog();
  if (data.account.role === 'admin') renderHr();
  renderMatches();
  renderSettings();
  renderPubBar();
  $('#rotBar').hidden = !data.rotationChanged || data.account.role === 'viewer';
  if (document.body.dataset.page === 'team') loadGroups();
  renderOverview();
  $('#alertChip').hidden = !v.warnings.length;
  $('#alertChip').textContent = `⚠ ${v.warnings.length} alerte${v.warnings.length > 1 ? 's' : ''}`;
}

// ----- Tableau de bord -----
// Nombre de personnes (pas de jours) absentes au moins un jour du mois pour ce motif ('ALL' : maladie, formation ou congé),
// chef terrain compris, et chef de parc (qui n'a pas de ligne dans l'horaire) d'après la liste des absences.
function absentPeople(v, code) {
  const codes = code === 'ALL' ? ['MALADIE', 'FORMATION', 'CONGE'] : [code];
  const who = new Set(v.rows.filter(r => Object.values(r.cells).some(c => c && c.kind === 'off' && codes.includes(c.code))).map(r => r.id));
  for (const a of data.absences || []) if (a.empId === 'chef-parc' && codes.includes(a.code) && a.from.slice(0, 7) <= month && a.to.slice(0, 7) >= month) who.add(a.empId);
  return who.size;
}
function renderDashboard() {
  const v = data.view;
  const today = new Date().toISOString().slice(0, 10);
  const nextMatch = (data.matches || []).filter(m => m.date >= today).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0];
  const nextOpen = (data.openings || []).filter(o => !o.ignored && o.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const students = v.days.reduce((n, d) => n + d.studentRows.filter(r => !r.none).length, 0);
  const longDate = d => new Date(d + 'T12:00:00').toLocaleDateString('fr-BE', { weekday: 'long', day: 'numeric', month: 'long' });
  const kpi = (cls, label, value, sub, go) => `<button class="kpi ${cls}" data-go="${go}"><span class="kpi-label">${label}</span><span class="kpi-value">${value}</span><span class="kpi-sub">${sub}</span></button>`;
  $('#dashKpis').innerHTML = [
    kpi(v.warnings.length ? 'bad' : 'good', 'Alertes du mois', v.generated ? v.warnings.length : '—', v.generated ? (v.warnings.length ? "à régler dans l'horaire" : 'tout est en ordre') : 'mois pas encore généré', 'planning'),
    kpi('foot', 'Prochain match', nextMatch ? fmtDate(nextMatch.date) : '—', nextMatch ? `${esc(nextMatch.opponent)} · ${nextMatch.time}` : 'aucun match prévu', 'calendar'),
    kpi('open', 'Prochain dimanche ouvert', nextOpen ? fmtDate(nextOpen.date) : '—', nextOpen ? esc(nextOpen.label) : 'aucun prévu', 'calendar'),
    kpi('abs', 'Absents ce mois', absentPeople(v, 'ALL'), `${absentPeople(v, 'MALADIE')} en maladie · ${absentPeople(v, 'FORMATION')} en formation · ${absentPeople(v, 'CONGE')} en congé`, 'sick'),
    kpi('stud', 'Étudiants ce mois', students, 'jours-étudiant prévus', 'students'),
  ].join('');
  // Aujourd'hui, ou le premier jour ouvert du mois affiché si on regarde un autre mois.
  const shown = v.days.find(d => d.date === today) || v.days.find(d => !d.closed) || v.days[0];
  $('#dashTodayTitle').textContent = shown && shown.date === today ? 'Aujourd\'hui' : 'Premier jour du mois';
  $('#dashTodayDate').textContent = shown ? longDate(shown.date) : '';
  $('#dashToday').innerHTML = shown && dayCards[shown.date] ? dayCards[shown.date].replace('class="daycard', 'class="daycard plain') : '';
  // À venir : matchs et dimanches d'ouverture.
  const events = [
    ...(data.matches || []).filter(m => m.date >= today).map(m => ({ date: m.date, html: `<span class="ev foot">${matchIcon(m)}</span><div><b>${esc(m.opponent)}</b><small>${esc(m.competition || '')} · ${m.time}${m.confirmed === false ? ' · heure à confirmer' : ''}</small></div>` })),
    ...(data.openings || []).filter(o => !o.ignored && o.date >= today).map(o => ({ date: o.date, html: `<span class="ev open">${westIcon()}</span><div><b>Dimanche d'ouverture</b><small>${esc(o.label)}${o.hours ? ' · ' + esc(o.hours) : ''}</small></div>` })),
  ].sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6);
  $('#dashUpcoming').innerHTML = events.length ? '<ul class="events">' + events.map(e => `<li><span class="ev-date">${fmtDate(e.date)}</span>${e.html}</li>`).join('') + '</ul>' : '<p class="muted">Rien de prévu.</p>';
}

// Téléchargement d'un fichier Excel (en ligne : fabriqué dans la page ; en local : par le serveur).
async function downloadXlsx(path, q) {
  if (!backend) { location.href = path + '?' + new URLSearchParams({ month, ...q }); return; }
  const out = await backend.handle('GET', path, { month, ...q }, {});
  if (!out.xlsx) return toast((out.json && out.json.error) || 'Export impossible');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([out.xlsx], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = out.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// ----- RH : le dossier de chaque personne (cartes de l'équipe, puis la fiche) -----
// Ce qui est écrit vite (ou dicté) est remis au propre par l'IA ; « Mon texte » montre ce qui a été écrit.
let hrSel = null, hrPeriod = 'month', hrFilter = 'all', hrMode = 'positive';
let hrEdit = null; // élément en cours de modification : { id, hours, text, type }
const hrOrig = new Set(); // éléments dont on affiche le texte d'origine
// Heures supp / à faire : effet sur le solde (1 h supp = 2 h de récup).
const HOUR_KINDS = { supp: ['Heures supp', 2], afaire: ['Heures à faire', -1], recup: ['Récup prise', -1], rattrape: ['Heures rattrapées', 1] };
const hm = m => `${m < 0 ? '-' : ''}${Math.floor(Math.abs(m) / 60)}h${String(Math.abs(m) % 60).padStart(2, '0')}`;
const hrNotes = () => (data.hr && data.hr.notes) || [];
const hrHours = () => (data.hr && data.hr.hours) || [];
const balanceOf = id => hrHours().filter(h => h.empId === id).reduce((m, h) => m + h.minutes * (HOUR_KINDS[h.kind] || [0, 0])[1], 0);
const balanceText = m => m > 0 ? `+${hm(m)} à récupérer` : m < 0 ? `${hm(-m)} à faire` : 'à jour';
const hrEmps = () => data.config.employees.filter(e => !e.end || e.end >= today());
const hrDateOf = n => (n.late && n.late.date) || (n.field && n.field.date) || localDay(new Date(n.createdAt));
const hrKindOf = n => n.late ? 'late' : n.type === 'positive' ? 'positive' : 'negative';
const hrTyped = n => n.typed !== undefined ? n.typed : (!n.late && !n.field) || String(n.text).includes('\n');
const hrAv = id => 'c' + ([...String(id)].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 6);
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const firstLine = s => String(s || '').split('\n')[0];
const dayLong = d => new Date(d + 'T12:00:00').toLocaleDateString('fr-BE', { weekday: 'short', day: 'numeric', month: 'short' });
const hrWhen = iso => new Date(iso).toLocaleString('fr-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const hrBy = x => x.author ? ' · par ' + esc(String(x.author).split('@')[0]) : '';
function ago(iso) {
  const days = Math.round((new Date(localDay() + 'T12:00:00') - new Date(localDay(new Date(iso)) + 'T12:00:00')) / 864e5);
  return days <= 0 ? "aujourd'hui" : days === 1 ? 'hier' : days < 31 ? `il y a ${days} jours` : days < 365 ? `il y a ${Math.round(days / 30)} mois` : 'il y a plus d\'un an';
}
// Période choisie (cartes, chiffres, historique et bilan).
function hrRange() {
  const t = localDay(), y = t.slice(0, 4), ym = t.slice(0, 7), mn = s => MONTHS[Number(s.slice(5, 7)) - 1];
  if (hrPeriod === 'month') return { from: ym + '-01', label: cap(mn(ym)) + ' ' + y, short: 'ce mois-ci' };
  if (hrPeriod === '3m') { const s = addMonth(ym, -2); return { from: s + '-01', label: `${cap(mn(s))}${s.slice(0, 4) !== y ? ' ' + s.slice(0, 4) : ''} → ${mn(ym)} ${y}`, short: 'sur 3 mois' }; }
  if (hrPeriod === 'year') return { from: y + '-01-01', label: 'Année ' + y, short: 'cette année' };
  return { from: '0000-01-01', label: 'Depuis le début', short: 'depuis le début' };
}
function hrStats(id, r) {
  const notes = hrNotes().filter(n => n.empId === id && hrDateOf(n) >= r.from);
  const lates = notes.filter(n => n.late);
  const all = hrNotes().filter(n => n.empId === id);
  return { notes, pos: notes.filter(n => n.type === 'positive').length, neg: notes.filter(n => n.type !== 'positive' && !n.late).length,
    late: lates.length, lateMin: lates.reduce((m, n) => m + n.late.minutes, 0),
    lastAt: all.reduce((a, n) => n.createdAt > a ? n.createdAt : a, '') };
}

function renderHr() {
  if (!data.hr) return;
  if (hrSel && !hrEmps().some(e => e.id === hrSel)) hrSel = null;
  document.querySelectorAll('#hrPeriod button').forEach(b => b.classList.toggle('on', b.dataset.p === hrPeriod));
  $('#hrPeriodText').textContent = hrRange().label;
  $('#hrTeamWrap').hidden = !!hrSel;
  $('#hrSheet').hidden = !hrSel;
  if (hrSel) renderHrSheet(); else renderHrTeam();
}

// Toute l'équipe : une carte par personne, avec ses chiffres et ses dernières notes.
function renderHrTeam() {
  const r = hrRange(), emps = hrEmps(), all = emps.map(e => ({ e, s: hrStats(e.id, r) }));
  const tot = k => all.reduce((n, x) => n + x.s[k], 0);
  $('#hrTeamSum').innerHTML = `<span><b>${emps.length}</b> personnes</span><span class="pos"><b>${tot('pos')}</b> positives</span>`
    + `<span class="neg"><b>${tot('neg')}</b> négatives</span><span class="late"><b>${tot('late')}</b> retards${tot('lateMin') ? ` · ${tot('lateMin')} min` : ''}</span><span class="muted">${r.short}</span>`;
  $('#hrTeam').innerHTML = all.map(({ e, s }) => {
    const bal = balanceOf(e.id);
    const last = s.notes.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 2);
    return `<button type="button" class="hrx-card" data-emp="${e.id}">
      <span class="hrx-card-top"><i class="hrx-av ${hrAv(e.id)}">${esc(initials(e.name))}</i>
        <span class="who"><b>${esc(e.name)}</b><small>${esc(e.note || 'Agent')}</small></span>
        <span class="hrx-bal ${bal > 0 ? 'pos' : bal < 0 ? 'neg' : ''}" title="Solde d'heures (depuis le début)">⏱ ${bal ? (bal > 0 ? '+' : '−') + hm(Math.abs(bal)) : 'à jour'}</span></span>
      <span class="hrx-pills"><span class="pos ${s.pos ? '' : 'zero'}">👍 ${s.pos}</span><span class="neg ${s.neg ? '' : 'zero'}">👎 ${s.neg}</span><span class="late ${s.late ? '' : 'zero'}">⏰ ${s.late}${s.late ? ` · ${s.lateMin} min` : ''}</span></span>
      <span class="hrx-last">${last.length ? last.map(n => `<span class="${hrKindOf(n)}">${esc(n.late ? `Retard de ${n.late.minutes} min · ${fmtDate(n.late.date)}` : firstLine(n.textPro || n.text))}</span>`).join('') : `<span class="none">Rien de noté ${r.short}.</span>`}</span>
      <span class="hrx-foot"><span>${s.lastAt ? 'Dernière note ' + ago(s.lastAt) : 'Aucune note pour le moment'}</span><span class="go">Ouvrir le dossier →</span></span>
    </button>`;
  }).join('') || '<p class="muted">Aucun employé.</p>';
}

// Fiche d'une personne : en-tête, chiffres, bilan IA, solde d'heures et historique.
function renderHrSheet() {
  const e = hrEmps().find(x => x.id === hrSel); if (!e) return;
  const r = hrRange(), s = hrStats(e.id, r), bal = balanceOf(e.id);
  $('#hrxHead').innerHTML = `<i class="hrx-av xl ${hrAv(e.id)}">${esc(initials(e.name))}</i>
    <div><h2>${esc(e.name)}</h2><p>${esc(e.note || 'Agent')}${e.start ? ` · depuis le ${e.start.split('-').reverse().join('/')}` : ''}</p></div>`;
  $('#hrxStats').innerHTML = `<div class="pos"><span>👍 Positives</span><b>${s.pos}</b><small>${r.short}</small></div>
    <div class="neg"><span>👎 Négatives</span><b>${s.neg}</b><small>${r.short}</small></div>
    <div class="late"><span>⏰ Retards</span><b>${s.late}</b><small>${s.late ? s.lateMin + ' min au total' : r.short}</small></div>
    <div class="${bal > 0 ? 'pos' : bal < 0 ? 'neg' : ''}"><span>⏱ Heures</span><b>${bal ? (bal > 0 ? '+' : '−') + hm(Math.abs(bal)) : '0h'}</b><small>${balanceText(bal)}</small></div>`;
  renderHrBilan(e, r);
  renderHrHours(e);
  renderHrDocs(e);
  renderHrTimeline(e, r, s);
  renderHrPending();
  hrFocusDeep();
}

// ----- Pièces jointes RH : sur une remarque, ou dans les documents du dossier -----
const hrFiles = () => (data.hr && data.hr.files) || [];
let hrPending = [];        // fichiers choisis dans le formulaire, envoyés avec la remarque
let hrDeep = null;         // lien du PDF (#rh=…&note=… ou &fichier=…) à ouvrir après la connexion
const fileSize = s => s >= 1048576 ? (s / 1048576).toFixed(1).replace('.', ',') + ' Mo' : Math.max(1, Math.round(s / 1024)) + ' Ko';
const fileIcon = f => /pdf/.test(f.type) ? '📄' : /^image\//.test(f.type) ? '🖼' : /\.(msg|eml)$/i.test(f.name) || /message|outlook/.test(f.type) ? '✉️' : '📎';
const hrFileChip = f => `<span class="hrx-file"><a href="#" data-hrfile="${f.id}" title="Ouvrir">${fileIcon(f)} ${esc(f.name)}</a><small>${fileSize(f.size)}</small><button class="ghost no-print" data-hrfiledel="${f.id}" title="Retirer ce fichier">✕</button></span>`;
function renderHrDocs(e) {
  const notes = new Set(hrNotes().map(n => n.id));
  const docs = hrFiles().filter(f => f.empId === e.id && (!f.noteId || !notes.has(f.noteId)));
  $('#hrxDocs').innerHTML = `<h3>Documents</h3>
    ${docs.length ? `<div class="hrx-files col">${docs.map(hrFileChip).join('')}</div>` : '<p class="hint">Contrat, avertissement, courrier… Tout type de fichier, 10 Mo maximum.</p>'}
    <label class="btn ghost no-print">📎 Ajouter un document<input type="file" multiple hidden data-hrup="docs"></label>
    <p class="hint no-print">Tu peux aussi glisser un fichier ici.</p>`;
}
function renderHrPending() {
  $('#hrxPending').innerHTML = hrPending.map((f, i) => `<span class="hrx-file pending">${fileIcon(f)} ${esc(f.name)}<small>${fileSize(f.size)}</small><button class="ghost" data-pendel="${i}" title="Enlever">✕</button></span>`).join('');
}
async function uploadHrFiles(files, noteId) {
  let ok = 0;
  for (const f of files) {
    if (f.size > 10 * 1024 * 1024) { toast(`${f.name} : trop lourd (10 Mo maximum)`); continue; }
    try {
      const j = await invApi('/api/hr/file', { month, empId: hrSel, noteId: noteId || null, name: f.name, type: f.type || '', data: await readB64(f) });
      data = j; ok++;
    } catch {}
  }
  render();
  if (ok) toast(ok > 1 ? `${ok} fichiers joints` : 'Fichier joint');
}
async function openHrFile(id) {
  const q = { month, id };
  if (!backend) { window.open('/api/hr/file?' + new URLSearchParams(q), '_blank'); return; }
  const w = window.open('', '_blank');
  const out = await backend.handle('GET', '/api/hr/file', q, {});
  if (!out.file) { if (w) w.close(); return toast((out.json && out.json.error) || 'Ouverture impossible'); }
  const blob = new Blob([out.file], { type: out.type });
  // PDF et images : ouverts dans un onglet ; le reste (mail Outlook, Word…) : téléchargé.
  if (w && /pdf|^image\//.test(out.type)) { const url = URL.createObjectURL(blob); w.location.href = url; setTimeout(() => URL.revokeObjectURL(url), 60000); }
  else { if (w) w.close(); saveFile(new File([out.file], out.filename, { type: out.type })); }
}
// Lien du PDF : ouvre le dossier, met la remarque en avant, ou ouvre le fichier.
function hrFocusDeep() {
  if (!hrDeep || hrDeep.emp !== hrSel) return;
  const d = hrDeep; hrDeep = null;
  if (d.file) { if (hrFiles().some(f => f.id === d.file)) openHrFile(d.file); else toast('Ce fichier n\'existe plus.'); return; }
  if (d.note) setTimeout(() => {
    const li = document.querySelector(`#hrxTimeline [data-note="${CSS.escape(d.note)}"]`);
    if (!li) return toast('Cette remarque n\'est pas dans la période affichée : choisis « Tout ».');
    li.scrollIntoView({ block: 'center' }); li.classList.add('flash'); setTimeout(() => li.classList.remove('flash'), 2500);
  }, 50);
}
function openDeepLink(d) {
  if (!data || !data.hr || data.account.role !== 'admin') return false;
  if (!hrEmps().some(e => e.id === d.emp)) { toast('Personne introuvable dans le dossier RH.'); return false; }
  hrDeep = d; hrSel = d.emp; hrFilter = 'all'; if (d.note) hrPeriod = 'all';
  go('hr'); renderHr(); return true;
}
// Glisser-déposer : sur une remarque, dans le formulaire, ou dans les documents.
function dropTarget(e) { return e.target.closest && e.target.closest('#hrSheet [data-drop]'); }
// Effet de dépôt accepté par ce qu'on glisse : Outlook ne propose souvent que « déplacer » ; si on demande « copier »,
// le navigateur refuse le dépôt sans rien dire.
const dropEffectFor = dt => { const a = String(dt.effectAllowed || 'all').toLowerCase(); return /copy|all|uninitialized/.test(a) ? 'copy' : /move/.test(a) ? 'move' : /link/.test(a) ? 'link' : 'copy'; };
// Message affiché quelques secondes dans la zone de dépôt (en plus du petit message en bas).
function dropMsg(t, text, bad) {
  let p = t.querySelector(':scope > .drop-msg');
  if (!p) { p = document.createElement('p'); p.className = 'drop-msg'; t.appendChild(p); }
  p.textContent = text; p.classList.toggle('bad', !!bad);
  clearTimeout(p._t); p._t = setTimeout(() => p.remove(), bad ? 12000 : 5000);
}
document.addEventListener('dragover', e => { const t = dropTarget(e); if (!t) return; e.preventDefault(); e.dataTransfer.dropEffect = dropEffectFor(e.dataTransfer); t.classList.add('drop-on'); });
document.addEventListener('dragleave', e => { const t = dropTarget(e); if (t && !t.contains(e.relatedTarget)) t.classList.remove('drop-on'); });
document.addEventListener('drop', e => {
  const t = dropTarget(e); if (!t) return;
  e.preventDefault(); t.classList.remove('drop-on');
  const dt = e.dataTransfer;
  let files = [...(dt.files || [])];
  // Certains navigateurs ne donnent le fichier que par la liste des éléments glissés.
  if (!files.length) files = [...(dt.items || [])].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
  // Outlook (nouveau) ou Outlook sur le web : pas de fichier, mais le contenu du mail en HTML → joint comme page .html.
  if (!files.length) {
    const html = dt.getData('text/html');
    if (html && html.replace(/<[^>]+>/g, '').trim().length > 20) {
      const title = ((/<title>([^<]{1,80})/i.exec(html) || [])[1] || 'mail').replace(/[^\wÀ-ÿ -]+/g, ' ').trim() || 'mail';
      files = [new File([html], `${title} - ${localDay()}.html`, { type: 'text/html' })];
    }
  }
  // Détail de ce qui est arrivé (pour comprendre si Outlook ne donne rien).
  const got = [...(dt.types || [])].join(', ') + (files.length ? ` · ${files.map(f => `${f.name || 'sans nom'} ${f.size} o`).join(', ')}` : '')
    + ` · éléments : ${[...(dt.items || [])].map(i => i.kind + ':' + (i.type || '?')).join(', ') || 'aucun'}`;
  dropFinish(t, files, got);
});
// Un fichier annoncé vide (fichier « virtuel » d'Outlook) peut parfois se lire quand même : on essaie.
async function dropFinish(t, files, got) {
  const ok = [];
  for (const f of files) {
    if (f.size > 0) { ok.push(f); continue; }
    try { const buf = await f.arrayBuffer(); if (buf.byteLength) ok.push(new File([buf], f.name || 'mail.msg', { type: f.type || 'application/vnd.ms-outlook' })); } catch {}
  }
  files = ok;
  if (!files.length) {
    const msg = "Outlook n'a pas donné le fichier du mail. Glisse d'abord le mail sur le Bureau (ou dans Outlook : Fichier › Enregistrer sous), puis glisse ce fichier ici ou utilise « Joindre ».";
    dropMsg(t, msg + ` (détail : ${got || 'rien'})`, true); return toast("Le mail n'a pas pu être joint : voir le message dans la zone.");
  }
  if (t.dataset.drop === 'compose') { hrPending.push(...files); renderHrPending(); dropMsg(t, `${files.length > 1 ? files.length + ' fichiers prêts' : 'Fichier prêt'} : il sera joint quand tu enregistres la remarque.`); return; }
  dropMsg(t, 'Envoi en cours…');
  uploadHrFiles(files, t.dataset.drop === 'docs' ? null : t.dataset.drop);
}
$('#hrxFiles').addEventListener('change', e => { hrPending.push(...e.target.files); e.target.value = ''; renderHrPending(); });
$('#hrxPending').addEventListener('click', e => { const b = e.target.closest('[data-pendel]'); if (b) { hrPending.splice(Number(b.dataset.pendel), 1); renderHrPending(); } });
$('#hrSheet').addEventListener('change', e => {
  const up = e.target.closest('input[data-hrup]'); if (!up || !up.files.length) return;
  const files = [...up.files]; up.value = '';
  uploadHrFiles(files, up.dataset.hrup === 'docs' ? null : up.dataset.hrup);
});
$('#hrSheet').addEventListener('click', async e => {
  const o = e.target.closest('[data-hrfile]');
  if (o) { e.preventDefault(); return openHrFile(o.dataset.hrfile); }
  const d = e.target.closest('[data-hrfiledel]');
  if (d && confirm('Retirer ce fichier du dossier ? Il sera supprimé.')) {
    const j = await invApi('/api/hr/file/delete', { month, id: d.dataset.hrfiledel }).catch(() => null);
    if (j) { data = j; render(); toast('Fichier retiré'); }
  }
});

function renderHrBilan(e, r) {
  const b = data.hr.bilans && data.hr.bilans[e.id];
  const btn = label => `<button class="${b ? 'ghost' : 'primary'} no-print" id="hrBilanGo">${label}</button>`;
  const list = (cls, title, items) => items && items.length ? `<h4 class="${cls}">${title}</h4><ul class="${cls}">${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  $('#hrxBilan').classList.toggle('no-print', !b);
  $('#hrxBilan').innerHTML = b ? `<div class="hrx-bilan-head"><h3>✨ Bilan</h3><small>${esc(b.label || '')} · ${b.count} note(s) · écrit le ${new Date(b.createdAt).toLocaleDateString('fr-BE')}</small></div>
      <p class="resume">${esc(b.resume)}</p>
      ${list('ok', 'Points forts', b.forts)}${list('warn', 'À améliorer', b.ameliorer)}${list('', "Pistes pour l'entretien", b.pistes)}
      <p class="hint">Écrit par l'IA à partir du dossier : à relire avant l'entretien.</p>
      ${btn(`↻ Refaire · ${esc(r.label)}`)}`
    : `<div class="hrx-bilan-head"><h3>✨ Bilan pour un entretien</h3></div>
      <p class="hint">L'IA lit les remarques de la période et écrit un résumé : points forts, points à améliorer et pistes à proposer.</p>
      ${btn(`✨ Écrire le bilan · ${esc(r.label)}`)}`;
}

function renderHrHours(e) {
  const list = hrHours().filter(h => h.empId === e.id);
  const sum = k => list.filter(h => h.kind === k).reduce((m, h) => m + h.minutes, 0), bal = balanceOf(e.id);
  $('#hrxHours').innerHTML = `<h3>Solde d'heures</h3>
    <div class="hrx-balbig ${bal > 0 ? 'pos' : bal < 0 ? 'neg' : ''}"><b>${bal ? (bal > 0 ? '+' : '−') + hm(Math.abs(bal)) : '0h00'}</b><span>${balanceText(bal)}</span></div>
    <dl><dt>Heures supp</dt><dd>${hm(sum('supp'))} <small>= ${hm(sum('supp') * 2)} de récup</small></dd>
    <dt>Récup prise</dt><dd>${hm(sum('recup'))}</dd><dt>Heures à faire</dt><dd>${hm(sum('afaire'))}</dd><dt>Rattrapées</dt><dd>${hm(sum('rattrape'))}</dd></dl>
    <p class="hint">Depuis le début. 1 h supp = 2 h de récup.</p>`;
}

function renderHrTimeline(e, r, s) {
  const hours = hrHours().filter(h => h.empId === e.id && h.date >= r.from);
  const items = [...s.notes.map(n => ({ kind: hrKindOf(n), date: hrDateOf(n), at: n.createdAt, n })), ...hours.map(h => ({ kind: 'hours', date: h.date, at: h.createdAt, h }))]
    .sort((a, b) => b.date.localeCompare(a.date) || b.at.localeCompare(a.at));
  const count = k => items.filter(it => k === 'all' || it.kind === k).length;
  $('#hrxFilter').innerHTML = [['all', 'Tout'], ['positive', '👍'], ['negative', '👎'], ['late', '⏰'], ['hours', '⏱']]
    .map(([k, l]) => `<button data-f="${k}" class="${hrFilter === k ? 'on' : ''}">${l} <small>${count(k)}</small></button>`).join('');
  const todo = hrNotes().filter(n => n.empId === e.id && !n.textPro && hrTyped(n)).length + hrHours().filter(h => h.empId === e.id && !h.commentPro && String(h.comment || '').trim()).length;
  $('#hrxTodo').innerHTML = todo ? `<div class="hrx-todo no-print"><span>✨ ${todo} texte${todo > 1 ? 's' : ''} pas encore mis au propre (écrits avant l'IA).</span><button id="hrReform" class="ghost">Mettre au propre</button></div>` : '';
  const shown = items.filter(it => hrFilter === 'all' || it.kind === hrFilter);
  if (!shown.length) { $('#hrxTimeline').innerHTML = `<div class="hrx-empty"><span>🗂</span><p>Rien ${hrFilter === 'all' ? '' : 'de ce type '}${r.short}.</p><small>Ajoute une remarque juste au-dessus.</small></div>`; return; }
  let h = '', cur = '';
  for (const it of shown) {
    const m = it.date.slice(0, 7);
    if (m !== cur) { if (cur) h += '</ol>'; cur = m; h += `<h4 class="hrx-month">${cap(MONTHS[Number(m.slice(5)) - 1])} ${m.slice(0, 4)}</h4><ol class="hrx-tl">`; }
    h += it.h ? hourItem(it.h) : noteItem(it.n);
  }
  $('#hrxTimeline').innerHTML = h + '</ol>';
}
// Texte remis au propre, avec « Mon texte » pour revoir ce qui a été écrit.
function proText(id, pro, orig) {
  const show = pro && pro !== orig;
  return `<p class="txt">${esc(show && !hrOrig.has(id) ? pro : orig).replace(/\n/g, '<br>')}</p>`
    + (show ? `<button class="hrx-orig no-print" data-orig="${id}">${hrOrig.has(id) ? '✨ Version au propre' : '✎ Mon texte'}</button>` : '');
}
// Éditeur d'une remarque ou d'un commentaire d'heures (dans l'historique).
function editorHtml(canType) {
  return `<div class="hrx-edit">
    ${canType ? `<div class="hrx-edit-type"><button data-etype="positive" class="pos ${hrEdit.type === 'positive' ? 'on' : ''}">👍 Positif</button><button data-etype="negative" class="neg ${hrEdit.type === 'negative' ? 'on' : ''}">👎 Négatif</button></div>` : ''}
    <textarea id="hrxEditText" rows="3" placeholder="${hrEdit.hours ? 'Commentaire' : 'Remarque'}">${esc(hrEdit.text)}</textarea>
    <div class="hrx-edit-btns"><button class="primary" data-esave="ai">✨ Enregistrer et mettre au propre</button><button data-esave="raw">Enregistrer tel quel</button><button class="ghost" data-ecancel>Annuler</button></div>
  </div>`;
}
function noteItem(n) {
  const k = hrKindOf(n);
  const tag = n.late ? `⏰ Retard · ${n.late.minutes} min` : n.field ? '📍 Terrain' : k === 'positive' ? '👍 Positif' : '👎 Négatif';
  const files = hrFiles().filter(f => f.noteId === n.id);
  return `<li class="hrx-item ${k}" data-note="${n.id}" data-drop="${n.id}"><span class="dot"></span><div class="b">
    <div class="meta"><span class="tag">${tag}</span><span class="when">${dayLong(hrDateOf(n))}</span>${n.textPro && n.textPro !== n.text ? '<span class="ai" title="Mis au propre par l\'IA">✨</span>' : ''}
      <span class="acts no-print"><button class="ghost" data-edit="${n.id}" title="Modifier">✎ Modifier</button><button class="ghost del" data-del="${n.id}" title="Supprimer">✕</button></span></div>
    ${hrEdit && hrEdit.id === n.id ? editorHtml(!n.late && !n.field) : proText(n.id, n.textPro, n.text)}
    <div class="hrx-files">${files.map(hrFileChip).join('')}<label class="hrx-addfile no-print" title="Joindre un fichier (ou glisse-le sur la remarque)">📎 Joindre<input type="file" multiple hidden data-hrup="${n.id}"></label></div>
    <small class="by">Noté le ${hrWhen(n.createdAt)}${hrBy(n)}${n.editedAt ? ' · modifié le ' + hrWhen(n.editedAt) : ''}</small></div></li>`;
}
function hourItem(h) {
  const [label, f] = HOUR_KINDS[h.kind] || [h.kind, 0], eff = h.minutes * f;
  return `<li class="hrx-item hours"><span class="dot"></span><div class="b">
    <div class="meta"><span class="tag">⏱ ${label} · ${hm(h.minutes)}</span><span class="eff ${eff > 0 ? 'pos' : 'neg'}">${eff > 0 ? '+' : '−'}${hm(Math.abs(eff))} sur le solde</span><span class="when">${dayLong(h.date)}</span>
      ${h.commentPro && h.commentPro !== h.comment ? '<span class="ai" title="Mis au propre par l\'IA">✨</span>' : ''}<span class="acts no-print"><button class="ghost" data-hedit="${h.id}" title="Modifier le commentaire">✎ Modifier</button><button class="ghost del" data-hdel="${h.id}" title="Supprimer">✕</button></span></div>
    ${hrEdit && hrEdit.id === h.id ? editorHtml(false) : h.comment ? proText(h.id, h.commentPro, h.comment) : ''}
    <small class="by">Noté le ${hrWhen(h.createdAt)}${hrBy(h)}${h.editedAt ? ' · modifié le ' + hrWhen(h.editedAt) : ''}</small></div></li>`;
}

// Période, ouverture d'une fiche, retour à l'équipe.
$('#hrPeriod').addEventListener('click', e => { const b = e.target.closest('[data-p]'); if (b) { hrPeriod = b.dataset.p; renderHr(); } });
$('#hrTeam').addEventListener('click', e => {
  const b = e.target.closest('[data-emp]'); if (!b) return;
  hrSel = b.dataset.emp; hrFilter = 'all'; hrOrig.clear(); hrEdit = null; hrPending = [];
  $('#hrxText').value = ''; $('#lateTime').value = '';
  renderHr(); hrSetMode(hrMode); scrollTo(0, 0);
});
$('#hrBack').onclick = () => { hrSel = null; hrEdit = null; renderHr(); scrollTo(0, 0); };
$('#hrxFilter').addEventListener('click', e => { const b = e.target.closest('[data-f]'); if (b) { hrFilter = b.dataset.f; renderHr(); } });
// Historique : supprimer, voir « Mon texte », remettre au propre les anciens textes.
$('#hrxTimeline').addEventListener('input', e => { if (e.target.id === 'hrxEditText' && hrEdit) hrEdit.text = e.target.value; });
$('#hrxTimeline').addEventListener('click', async e => {
  const ed = e.target.closest('[data-edit]'), hed = e.target.closest('[data-hedit]');
  if (ed || hed) {
    const n = ed && hrNotes().find(x => x.id === ed.dataset.edit), h = hed && hrHours().find(x => x.id === hed.dataset.hedit);
    hrEdit = n ? { id: n.id, hours: false, text: n.textPro || n.text, type: n.type } : h ? { id: h.id, hours: true, text: h.commentPro || h.comment || '' } : null;
    renderHr();
    const ta = $('#hrxEditText'); if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    return;
  }
  const et = e.target.closest('[data-etype]');
  if (et && hrEdit) { hrEdit.type = et.dataset.etype; return renderHr(); }
  if (e.target.closest('[data-ecancel]')) { hrEdit = null; return renderHr(); }
  const sv = e.target.closest('[data-esave]');
  if (sv && hrEdit) {
    const ai = sv.dataset.esave === 'ai', cur = hrEdit;
    if (!cur.hours && !cur.text.trim()) return toast('Écris la remarque');
    sv.disabled = true; sv.textContent = ai ? '✨ Mise au propre…' : 'Enregistrement…';
    try {
      const j = await api(cur.hours ? '/api/hr/hours/edit' : '/api/hr/edit', cur.hours ? { id: cur.id, comment: cur.text, ai } : { id: cur.id, text: cur.text, type: cur.type, ai });
      if (hrEdit === cur) { hrEdit = null; renderHr(); }
      toast(j.reformError ? 'Modifié (texte gardé tel quel : ' + j.reformError + ')' : 'Modifié');
    } catch { if (sv.isConnected) { sv.disabled = false; sv.textContent = ai ? '✨ Enregistrer et mettre au propre' : 'Enregistrer tel quel'; } }
    return;
  }
  const o = e.target.closest('[data-orig]');
  if (o) { hrOrig.has(o.dataset.orig) ? hrOrig.delete(o.dataset.orig) : hrOrig.add(o.dataset.orig); return renderHr(); }
  const d = e.target.closest('[data-del]');
  if (d && confirm('Supprimer cette remarque du dossier ?')) api('/api/hr/delete', { id: d.dataset.del }).catch(() => {});
  const h = e.target.closest('[data-hdel]');
  if (h && confirm('Supprimer cette ligne d\'heures ?')) api('/api/hr/hours/delete', { id: h.dataset.hdel }).catch(() => {});
});
$('#hrxTodo').addEventListener('click', async e => {
  const b = e.target.closest('#hrReform'); if (!b) return;
  b.disabled = true; b.textContent = '✨ En cours…';
  try {
    const j = await api('/api/hr/reformulate', { empId: hrSel });
    toast(j.reformError ? 'Mise au propre interrompue : ' + j.reformError : `${j.reformDone} texte(s) mis au propre`);
  } catch {} finally { if (b.isConnected) { b.disabled = false; b.textContent = 'Mettre au propre'; } }
});
// Bilan IA de la période choisie.
$('#hrxBilan').addEventListener('click', async e => {
  const b = e.target.closest('#hrBilanGo'); if (!b) return;
  const r = hrRange();
  b.disabled = true; b.textContent = "✨ L'IA lit le dossier…";
  try { await api('/api/hr/bilan', { empId: hrSel, from: r.from, to: localDay(), label: r.label }); toast('Bilan écrit'); }
  catch {} finally { if (b.isConnected) { b.disabled = false; } }
});

// Ajouter au dossier : positif, négatif, retard ou heures (le texte passe par l'IA).
const HR_PLACEHOLDER = {
  positive: 'Ex. : a très bien géré la sortie du match, poli et efficace avec les clients',
  negative: 'Ex. : encore au téléphone en zone 2 au lieu de surveiller les caisses',
  late: 'Commentaire (facultatif), ex. : bouchons sur le ring, a prévenu à 11h50',
  hours: 'Commentaire (facultatif), ex. : resté jusqu\'à 21h pour la sortie du match',
};
function hrSetMode(m) {
  hrMode = m;
  document.querySelectorAll('#hrxModes [data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  $('#hrxLateF').hidden = m !== 'late';
  $('#hrxHoursF').hidden = m !== 'hours';
  $('#hrxText').placeholder = HR_PLACEHOLDER[m];
  if (m === 'late') { if (!$('#lateDate').value) $('#lateDate').value = localDay(); checkLate(); }
  if (m === 'hours') { if (!$('#hoursDate').value) $('#hoursDate').value = localDay(); showHoursPreview(); }
}
$('#hrxModes').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) hrSetMode(b.dataset.mode); });
hrSetMode('positive');
function hoursMinutes() { const m = $('#hoursDur').value.match(/^(\d{1,2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; }
function showHoursPreview() {
  const k = HOUR_KINDS[$('#hoursKind').value], min = hoursMinutes();
  $('#hoursPreview').textContent = !min ? 'Indique la durée.' : k[1] === 2 ? `${hm(min)} supp → +${hm(min * 2)} de récup sur le solde.`
    : `${k[0]} : ${k[1] > 0 ? '+' : '−'}${hm(min)} sur le solde.`;
}
$('#hoursKind').onchange = showHoursPreview;
$('#hoursDur').oninput = showHoursPreview;
// Retard : heure prévue lue dans l'horaire, minutes de retard calculées en direct.
let latePlanned = null;
async function checkLate() {
  latePlanned = null;
  const date = $('#lateDate').value;
  if (!date || !hrSel) { $('#latePlanned').textContent = 'Choisis le jour : l\'outil retrouve l\'heure prévue dans l\'horaire.'; $('#latePlanned').className = 'late-planned'; return; }
  const j = await call('/api/hr/late-check', { month, empId: hrSel, date });
  if (j.error) { $('#latePlanned').textContent = j.error; $('#latePlanned').className = 'late-planned bad'; return; }
  latePlanned = j.planned;
  showLateDelay();
}
function showLateDelay() {
  if (!latePlanned) return;
  let txt = `Devait commencer à ${latePlanned.startLabel} (${latePlanned.label}).`, cls = 'late-planned ok';
  const m = $('#lateTime').value.match(/^(\d{2}):(\d{2})$/);
  if (m) {
    const min = Number(m[1]) * 60 + Number(m[2]) - latePlanned.start * 60;
    if (min > 0) { txt += ` Arrivé à ${$('#lateTime').value} → ${min >= 60 ? Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0') : min + ' min'} de retard.`; cls = 'late-planned bad'; }
    else txt += ' Arrivé à l\'heure : pas de retard.';
  }
  $('#latePlanned').textContent = txt; $('#latePlanned').className = cls;
}
$('#lateDate').onchange = checkLate;
$('#lateTime').oninput = showLateDelay;
$('#hrxSave').onclick = async () => {
  const b = $('#hrxSave'), text = $('#hrxText').value.trim();
  let path, body;
  if (hrMode === 'positive' || hrMode === 'negative') {
    if (!text) return toast('Écris la remarque');
    path = '/api/hr/add'; body = { empId: hrSel, type: hrMode, text };
  } else if (hrMode === 'late') {
    if (!$('#lateDate').value || !$('#lateTime').value) return toast('Indique le jour et l\'heure d\'arrivée');
    path = '/api/hr/late'; body = { empId: hrSel, date: $('#lateDate').value, time: $('#lateTime').value, comment: text };
  } else {
    if (!$('#hoursDate').value) return toast('Choisis le jour');
    if (!hoursMinutes()) return toast('Indique la durée');
    path = '/api/hr/hours/add'; body = { empId: hrSel, kind: $('#hoursKind').value, date: $('#hoursDate').value, minutes: hoursMinutes(), comment: text };
  }
  b.disabled = true; b.textContent = text ? '✨ Mise au propre…' : 'Enregistrement…';
  try {
    const j = await api(path, body);
    if (hrPending.length) { const files = hrPending; hrPending = []; renderHrPending(); await uploadHrFiles(files, j.noteId || null); }
    $('#hrxText').value = '';
    if (hrMode === 'late') { $('#lateTime').value = ''; checkLate(); }
    hrFilter = 'all'; renderHr();
    toast(j.reformError ? 'Enregistré (texte gardé tel quel : ' + j.reformError + ')' : 'Ajouté au dossier');
  } catch {} finally { b.disabled = false; b.textContent = 'Enregistrer'; }
};
// PDF du dossier (même style que le rapport du Reporting) : fabriqué dans la page (en ligne) ou par le serveur local.
async function hrPdfFile() {
  const r = hrRange(), q = { month, emp: hrSel, from: r.from, label: r.label, app: location.origin + location.pathname };
  if (backend) {
    const out = await backend.handle('GET', '/api/hr-report.pdf', q, {});
    if (!out.pdf) throw new Error((out.json && out.json.error) || 'PDF impossible');
    return new File([out.pdf], out.filename, { type: 'application/pdf' });
  }
  const res = await fetch('/api/hr-report.pdf?' + new URLSearchParams(q));
  if (!res.ok || !(res.headers.get('Content-Type') || '').includes('pdf')) throw new Error('PDF impossible');
  const name = (/filename="?([^";]+)/.exec(res.headers.get('Content-Disposition') || '') || [])[1] || 'dossier-rh.pdf';
  return new File([await res.arrayBuffer()], name, { type: 'application/pdf' });
}
$('#hrPdf').onclick = async () => { try { saveFile(await hrPdfFile()); } catch (e) { toast(e.message); } };
$('#hrShare').onclick = async () => {
  try {
    const file = await hrPdfFile();
    const emp = hrEmps().find(x => x.id === hrSel), title = `Dossier RH · ${emp ? emp.name : ''} · ${hrRange().label}`;
    // Menu « Partager » du téléphone (mail, WhatsApp, Teams…) ; sinon le PDF est téléchargé.
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title });
    else { saveFile(file); toast('Partage non disponible ici : le PDF est téléchargé.'); }
  } catch (e) { if (e.name !== 'AbortError') toast(e.message); }
};
// Excel : toute l'équipe, ou seulement la personne ouverte.
$('#hrExportNotes').onclick = () => downloadXlsx('/api/export-hr.xlsx', hrSel ? { emp: hrSel } : {});
$('#hrExportHours').onclick = () => downloadXlsx('/api/export-hours.xlsx', hrSel ? { emp: hrSel } : {});

// ----- Espace employé : son horaire publié, l'équipe, ses zones du jour et ses heures -----
let meTab = 'mine', meWeek = null;
// Vue de l'horaire dans l'espace employé : la semaine ou tout le mois (par défaut). Gardée sur l'appareil.
let meScope = (() => { try { return localStorage.getItem('meScope') === 'week' ? 'week' : 'month'; } catch { return 'month'; } })(), meYm = null;
const ME_OFF = OFF;
const ME_SHORT = SHORT;
const DOW_FR = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
const DOW_LONG = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const mondayOf = d => addDay(d, -((new Date(d + 'T12:00:00').getDay() + 6) % 7));
const meMonth = date => data.me.months.find(m => m.ym === date.slice(0, 7));
const meDay = date => { const m = meMonth(date); return m && m.days.find(d => d.date === date); };
// Case d'une personne un jour donné : undefined si le mois n'est pas publié, null si rien ce jour-là.
const meCell = (date, id = data.me.id) => { const m = meMonth(date); if (!m) return undefined; const r = m.rows.find(x => x.id === id); return (r && r.cells[date]) || null; };
const cellHours = c => c && c.w ? parseInt(shiftDur(c.w)) || 0 : 0;
const shiftKey = c => ({ '8-16': '8-16', '10-18': '10-18', '12-20': '12-20', FOOT: 'FOOT' })[c.s] || 'OTHER';
// « 8-16 » → « 08:00 – 16:00 », même sur téléphone (il y a la place dans l'espace employé).
const niceTimes = w => String(w).replace('⚽', '').trim().replace(/(\d{1,2})\s*-\s*(\d{1,2})/, (_, a, b) => `${a.padStart(2, '0')}:00 – ${(b === '0' ? '00' : b).padStart(2, '0')}:00`);

function renderEmployee() {
  document.body.classList.add('employee');
  document.body.classList.remove('readonly');
  $('#accountBtn').hidden = data.account.mode !== 'cloud';
  if (!EMP_PAGES.includes(document.body.dataset.page)) go('me');
  renderMe();
  if (document.body.dataset.page === 'stats') renderStatsPage(data.stats ? { stats: data.stats.rows, month: data.stats.month } : null);
}
// Zone de la personne maintenant (ou la prochaine aujourd'hui).
function myZoneNow() {
  const z = data.me.zones; if (!z || z.closed) return '';
  const p = z.people.find(x => x.id === data.me.id); if (!p) return '';
  const h = new Date().getHours(), i = z.slots.findIndex(s => s.start <= h && h < s.end);
  const k = i >= 0 && p.cells[i] ? i : p.cells.findIndex((c, j) => c && z.slots[j].start > h);
  if (k < 0) return '';
  return `${k === i ? 'maintenant' : 'à ' + z.slots[k].start + 'h'} : <b>${esc(zoneName(p.cells[k], z))}</b>`;
}
const zoneName = (code, z) => code === 'D' ? 'Dispatch' : code === 'T' ? 'Toutes les zones' : ((z.zones.find(x => x.code === code) || {}).name || code) + (((z.zones.find(x => x.code === code) || {}).place) ? ' · ' + z.zones.find(x => x.code === code).place : '');

function renderMe() {
  const me = data.me; if (!me) return;
  if (!meWeek) meWeek = mondayOf(me.today);
  if (!meYm) meYm = me.today.slice(0, 7);
  document.querySelectorAll('#meTabs [data-t]').forEach(b => b.classList.toggle('on', b.dataset.t === meTab));
  const c = meCell(me.today), zone = myZoneNow();
  // Prochain jour de travail après aujourd'hui (dans les mois publiés).
  let next = null;
  for (let d = addDay(me.today, 1), k = 0; k < 40 && !next; d = addDay(d, 1), k++) { const x = meCell(d); if (x === undefined) break; if (x && x.w) next = { d, c: x }; }
  const nd = next && new Date(next.d + 'T12:00:00');
  $('#meHero').innerHTML = `<i class="hrx-av xl ${hrAv(me.id)}">${esc(initials(me.name))}</i>
    <div class="me-hello"><h2>Bonjour ${esc(me.name.split(' ')[0] || '')} 👋</h2>
      <p>${c === undefined ? "L'horaire de ce mois n'est pas encore publié."
        : c && c.w ? `Aujourd'hui : <b>${esc(niceTimes(c.w))}</b>${zone ? ` · ${zone}` : ''}`
        : `Aujourd'hui : <b>${c ? esc(ME_OFF[c.o] || c.o) : 'pas de travail'}</b>`}</p>
      ${next ? `<p class="muted">Prochain travail : ${DOW_FR[nd.getDay()]} ${nd.getDate()} ${MONTHS[nd.getMonth()]} · ${esc(niceTimes(next.c.w))}</p>` : ''}</div>`;
  $('#meBody').innerHTML = meTab === 'mine' ? meMine() : meTab === 'team' ? meTeam() : meTab === 'zones' ? meZones() : meHoursHtml();
}
function meWeekNav() {
  const sw = `<div class="me-scope"><button class="${meScope === 'week' ? 'on' : ''}" data-ms="week">Semaine</button><button class="${meScope === 'month' ? 'on' : ''}" data-ms="month">Mois</button></div>`;
  if (meScope === 'month') {
    const [y, m] = meYm.split('-').map(Number);
    return `${sw}<div class="me-weeknav"><button class="icon-btn" data-mm="-1" aria-label="Mois précédent">‹</button>
      <span>${MONTHS[m - 1]} ${y}</span>
      <button class="icon-btn" data-mm="1" aria-label="Mois suivant">›</button>${meYm !== data.me.today.slice(0, 7) ? '<button class="ghost" data-mm="0">Ce mois</button>' : ''}</div>`;
  }
  const a = new Date(meWeek + 'T12:00:00'), b = new Date(addDay(meWeek, 6) + 'T12:00:00');
  return `${sw}<div class="me-weeknav"><button class="icon-btn" data-mw="-7" aria-label="Semaine précédente">‹</button>
    <span>Semaine du ${a.getDate()}${a.getMonth() !== b.getMonth() ? ' ' + MONTHS[a.getMonth()] : ''} au ${b.getDate()} ${MONTHS[b.getMonth()]}</span>
    <button class="icon-btn" data-mw="7" aria-label="Semaine suivante">›</button>${meWeek !== mondayOf(data.me.today) ? '<button class="ghost" data-mw="0">Cette semaine</button>' : ''}</div>`;
}
// Jours affichés : les 7 jours de la semaine, ou tous les jours du mois choisi.
const weekDates = () => {
  if (meScope !== 'month') return [...Array(7)].map((_, i) => addDay(meWeek, i));
  const out = []; for (let d = meYm + '-01'; d.slice(0, 7) === meYm; d = addDay(d, 1)) out.push(d);
  return out;
};
function meMine() {
  let total = 0;
  const rows = weekDates().map(d => {
    const c = meCell(d), info = meDay(d), dt = new Date(d + 'T12:00:00');
    let what;
    if (c === undefined) what = '<span class="me-np">Pas encore publié</span>';
    else if (c && c.w) { total += cellHours(c); what = `<span class="me-shift c-${shiftKey(c)}"><b>${esc(niceTimes(c.w))}</b><small>${shiftDur(c.w)}${c.s === 'FOOT' ? ' · ⚽ Foot' : ''}</small></span>`; }
    else what = `<span class="me-off">${c ? esc(ME_OFF[c.o] || c.o) : 'Pas de travail'}</span>`;
    const tags = [info && info.holiday ? `🎉 ${esc(info.holiday)}` : '', info && info.match ? `⚽ ${esc(info.match.opponent)}${info.match.time ? ' · ' + esc(info.match.time) : ''}` : '', info && info.open ? '🛍 Dimanche d\'ouverture' : '']
      .filter(Boolean).map(x => `<span class="tag">${x}</span>`).join('');
    const mo = new Date(mondayOf(d) + 'T12:00:00');
    const sep = meScope === 'month' && (dt.getDay() === 1 || dt.getDate() === 1) ? `<div class="me-wsep">Semaine du ${mo.getDate()} ${MONTHS[mo.getMonth()].toLowerCase()}</div>` : '';
    return `${sep}<div class="me-day ${d === data.me.today ? 'today' : ''}"><div class="me-date"><span>${DOW_LONG[dt.getDay()]}</span><b>${dt.getDate()}</b></div>
      <div class="me-what">${what}${tags ? `<div class="me-tags">${tags}</div>` : ''}</div></div>`;
  }).join('');
  return `${meWeekNav()}<div class="card me-week">${rows}</div><p class="me-total"><b>${total}h</b> ${meScope === 'month' ? 'ce mois-ci' : 'cette semaine'}</p>`;
}
// L'équipe de la semaine, comme la feuille affichée au bureau.
function meTeam() {
  const days = weekDates(), ms = [...new Set(days.map(d => d.slice(0, 7)))].map(ym => data.me.months.find(m => m.ym === ym)).filter(Boolean);
  if (!ms.length) return `${meWeekNav()}<div class="card hrx-empty"><span>🗓</span><p>Pas encore publié</p><small>L'horaire ${meScope === 'month' ? 'de ce mois' : 'de cette semaine'} apparaîtra ici quand il sera publié.</small></div>`;
  const people = [];
  for (const m of ms) for (const r of m.rows) if (!people.some(p => p.id === r.id)) people.push({ id: r.id, name: r.name, chef: r.chef });
  const cellAt = (id, d) => { const m = meMonth(d); const r = m && m.rows.find(x => x.id === id); return m ? (r && r.cells[d]) || null : undefined; };
  const td = c => c === undefined ? '<td class="np">·</td>' : c && c.w ? `<td><span class="c-${shiftKey(c)}">${esc(c.w.replace('⚽', '').trim())}</span></td>` : `<td class="off">${c ? esc(ME_SHORT[c.o] || c.o) : ''}</td>`;
  const head = days.map(d => { const dt = new Date(d + 'T12:00:00'); return `<th class="${d === data.me.today ? 'today' : ''}">${DOW_FR[dt.getDay()]}<br><b>${dt.getDate()}</b></th>`; }).join('');
  const body = people.map(p => `<tr class="${p.id === data.me.id ? 'mine' : ''}"><th>${esc(p.name)}${p.chef ? '<small>Chef terrain</small>' : ''}</th>${days.map(d => td(cellAt(p.id, d))).join('')}</tr>`).join('');
  const stud = [];
  for (const m of ms) for (const s of m.students) { const ex = stud.find(x => x.name === s.name); if (ex) Object.assign(ex.cells, s.cells); else stud.push({ name: s.name, cells: { ...s.cells } }); }
  const sbody = stud.filter(s => days.some(d => s.cells[d] && s.cells[d].w)).map(s => `<tr class="stud"><th>${esc(s.name)}</th>${days.map(d => { const c = s.cells[d]; return c && c.w ? `<td><span class="c-STUDENT">${esc(c.w.replace('⚽', '').trim())}</span></td>` : '<td></td>'; }).join('')}</tr>`).join('');
  return `${meWeekNav()}<div class="card me-teamcard"><table class="me-team${meScope === 'month' ? ' month' : ''}"><thead><tr><th></th>${head}</tr></thead><tbody>${body}${sbody}</tbody></table></div>`;
}
// Zones du jour : son parcours heure par heure, puis toute l'équipe.
function meZones() {
  const z = data.me.zones;
  if (!z) return `<div class="card hrx-empty"><span>📍</span><p>Pas de zones pour aujourd'hui</p><small>Elles apparaissent quand l'horaire du mois est publié.</small></div>`;
  if (z.closed) return `<div class="card hrx-empty"><span>🔒</span><p>Parking fermé aujourd'hui</p></div>`;
  const p = z.people.find(x => x.id === data.me.id), h = new Date().getHours();
  const zc = code => code === 'D' ? 'zD' : code === 'T' ? 'zT' : 'z' + String(code).slice(1);
  const mine = p ? z.slots.map((s, i) => p.cells[i] ? `<li class="${s.start <= h && h < s.end ? 'now' : s.end <= h ? 'past' : ''}"><span class="t">${s.start}h – ${s.end}h</span>
      <span class="zn ${zc(p.cells[i])}">${esc(zoneName(p.cells[i], z))}</span>${p.pause && p.pause.slot === i ? `<span class="tag">☕ Pause ${esc(p.pause.start)} – ${esc(p.pause.end)}</span>` : ''}</li>` : '').join('') : '';
  const team = `<table class="me-zt"><thead><tr><th></th>${z.people.map(x => `<th class="${x.id === data.me.id ? 'mine' : ''}">${esc(x.name)}</th>`).join('')}</tr></thead><tbody>`
    + z.slots.map((s, i) => `<tr class="${s.start <= h && h < s.end ? 'now' : ''}"><th>${s.start}h</th>${z.people.map(x => `<td>${x.cells[i] ? `<span class="${zc(x.cells[i])}">${x.cells[i] === 'D' ? 'Disp.' : x.cells[i] === 'T' ? 'Tout' : 'Z' + String(x.cells[i]).slice(1)}</span>` : ''}${x.pause && x.pause.slot === i ? ' ☕' : ''}</td>`).join('')}</tr>`).join('') + '</tbody></table>';
  return `${p ? `<div class="card"><h3>Ton parcours aujourd'hui</h3><ol class="me-path">${mine}</ol></div>` : '<div class="card hrx-empty"><span>🙂</span><p>Tu ne travailles pas aujourd\'hui</p></div>'}
    <div class="card me-teamcard"><h3>Toute l'équipe</h3>${team}</div>`;
}
// Compteur d'heures : 40 h par semaine (8 h de moins par jour de RTT) ; congé, maladie et formation comptent 8 h.
function meHoursHtml() {
  const me = data.me, ym = me.today.slice(0, 7);
  const first = mondayOf(ym + '-01'), weeks = [];
  for (let w = first; w.slice(0, 7) <= ym; w = addDay(w, 7)) weeks.push(w);
  let sumPlan = 0, sumDone = 0, sumTarget = 0;
  const rows = weeks.map(w => {
    let plan = 0, done = 0, rtt = 0, just = 0, missing = false;
    for (let i = 0; i < 7; i++) {
      const d = addDay(w, i), c = meCell(d);
      if (c === undefined) { missing = true; continue; }
      if (c && c.w) { plan += cellHours(c); if (d < me.today) done += cellHours(c); }
      if (c && c.o === 'RTT') rtt++;
      if (c && ['CONGE', 'MALADIE', 'FORMATION', 'ANC', 'PC', 'PATERNITE', 'AT', 'AJ', 'CS', 'FS', 'MS'].includes(c.o)) just += 8;
    }
    const target = 40 - 8 * rtt, diff = plan + just - target;
    if (!missing) { sumPlan += plan + just; sumDone += done; sumTarget += target; }
    const a = new Date(w + 'T12:00:00'), b = new Date(addDay(w, 6) + 'T12:00:00');
    return `<tr class="${w === mondayOf(me.today) ? 'cur' : ''}"><td>${a.getDate()}/${a.getMonth() + 1} → ${b.getDate()}/${b.getMonth() + 1}</td>
      <td>${missing ? '<span class="muted">pas publié</span>' : plan + 'h' + (just ? ` <small>+${just}h justifiées</small>` : '')}</td>
      <td>${target}h${rtt ? ` <small>(${rtt} RTT)</small>` : ''}</td>
      <td>${missing ? '' : `<span class="me-diff ${diff > 0 ? 'pos' : diff < 0 ? 'neg' : ''}">${diff > 0 ? '+' : ''}${diff}h</span>`}</td></tr>`;
  }).join('');
  const bal = me.hours.reduce((m, h) => m + h.minutes * (HOUR_KINDS[h.kind] || [0, 0])[1], 0);
  const list = me.hours.slice().reverse().slice(0, 12).map(h => { const [l, f] = HOUR_KINDS[h.kind] || [h.kind, 0]; return `<li><span>${fmtDate(h.date)}</span><span>${l} · ${hm(h.minutes)}</span><b class="${f > 0 ? 'pos' : 'neg'}">${f > 0 ? '+' : '−'}${hm(Math.abs(h.minutes * f))}</b></li>`; }).join('');
  return `<div class="hrx-stats me-kpis"><div><span>Prévu ce mois</span><b>${sumPlan}h</b><small>semaines publiées</small></div>
      <div><span>Déjà fait</span><b>${sumDone}h</b><small>jusqu'à hier</small></div>
      <div><span>Objectif</span><b>${sumTarget}h</b><small>40 h / semaine, moins les RTT</small></div>
      <div class="${bal > 0 ? 'pos' : bal < 0 ? 'neg' : ''}"><span>Heures supp</span><b>${bal ? (bal > 0 ? '+' : '−') + hm(Math.abs(bal)) : '0h'}</b><small>${balanceText(bal)}</small></div></div>
    <div class="card"><h3>Semaine par semaine · ${MONTHS[Number(ym.slice(5)) - 1]} ${ym.slice(0, 4)}</h3>
      <table class="list me-hours"><tr><th>Semaine</th><th>Prévu</th><th>Objectif</th><th>Écart</th></tr>${rows}</table>
      <p class="hint">Les semaines vont du lundi au dimanche. Congé, maladie et formation comptent 8 h ; une récup compte 0 h (elle rattrape des heures déjà faites).</p></div>
    <div class="card"><h3>Heures supp et heures à faire</h3>${list ? `<ul class="me-hlist">${list}</ul>` : '<p class="muted">Rien pour le moment.</p>'}<p class="hint">1 h supp = 2 h de récup.</p></div>`;
}
$('#meTabs').addEventListener('click', e => { const b = e.target.closest('[data-t]'); if (b) { meTab = b.dataset.t; renderMe(); } });
$('#meBody').addEventListener('click', e => {
  const s = e.target.closest('[data-ms]');
  if (s) { meScope = s.dataset.ms; try { localStorage.setItem('meScope', meScope); } catch {} return renderMe(); }
  const mm = e.target.closest('[data-mm]');
  if (mm) {
    if (mm.dataset.mm === '0') meYm = data.me.today.slice(0, 7);
    else { const [y, m] = meYm.split('-').map(Number), x = new Date(y, m - 1 + Number(mm.dataset.mm), 1); meYm = `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; }
    return renderMe();
  }
  const b = e.target.closest('[data-mw]'); if (!b) return;
  meWeek = b.dataset.mw === '0' ? mondayOf(data.me.today) : addDay(meWeek, Number(b.dataset.mw)); renderMe();
});

// ----- Cloche : notifications (employé : les siennes ; direction : celles de la direction) -----
let bellList = [];
async function loadBell() {
  if (!data) return;
  const j = await call('/api/notifications', { month }).catch(() => null);
  if (!j || j.error) return;
  bellList = j.notifications || []; renderBell();
}
function renderBell() {
  const n = bellList.filter(x => !x.read_at).length;
  $('#bellCount').hidden = !n; $('#bellCount').textContent = n > 9 ? '9+' : n;
  if (!$('#bellPanel').hidden) renderBellPanel();
}
function renderBellPanel() {
  $('#bellPanel').innerHTML = '<div class="bell-head">Notifications</div>' + (bellList.length ? bellList.map(x => `<div class="bell-item ${x.read_at ? '' : 'new'}">
      <b>${esc(x.title)}</b>${x.body ? `<p>${esc(x.body).replace(/\n/g, '<br>')}</p>` : ''}<small>${hrWhen(x.created_at)}</small></div>`).join('')
    : '<div class="bell-empty">🔔<p>Rien de neuf pour le moment.</p></div>');
}
$('#bellBtn').onclick = async e => {
  e.stopPropagation();
  const p = $('#bellPanel'); p.hidden = !p.hidden;
  if (p.hidden) return;
  renderBellPanel();
  if (bellList.some(x => !x.read_at)) {
    await call('/api/notifications/read', { month }).catch(() => null);
    setTimeout(() => { const now = new Date().toISOString(); bellList.forEach(x => { x.read_at = x.read_at || now; }); renderBell(); }, 2500);
  }
};
document.addEventListener('click', e => { if (!e.target.closest('#bellPanel, #bellBtn')) $('#bellPanel').hidden = true; });
setInterval(loadBell, 5 * 60e3);

// ----- Publication du mois (Horaire) : l'équipe voit le mois quand il est publié -----
function renderPubBar() {
  const p = data.publish, el = $('#pubBar');
  if (!p || data.account.role === 'viewer') { el.hidden = true; return; }
  el.hidden = false;
  const name = `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
  if (!p.published) {
    el.className = 'pub-bar draft';
    el.innerHTML = `<span class="ic">👁</span><span><b>L'équipe ne voit pas encore ${name}.</b> Publie-le quand il est prêt : chacun le verra dans son espace et sera prévenu.</span><button class="primary" id="pubGo">Publier ${MONTHS[Number(month.slice(5)) - 1]}</button>`;
  } else if (!p.people.length && !p.students) {
    el.className = 'pub-bar ok';
    el.innerHTML = `<span class="ic">✓</span><span><b>Publié</b> le ${hrWhen(p.at)} : l'équipe voit ce mois à jour.</span><button class="ghost" id="pubUndo">Retirer la publication</button>`;
  } else {
    el.className = 'pub-bar changed';
    const who = p.people.map(x => `<span title="${esc(x.list.map(c => `${fmtDate(c.date)} : ${c.before} → ${c.after}`).join('\n'))}">${esc(x.name)} (${x.count} jour${x.count > 1 ? 's' : ''})</span>`).join(', ');
    el.innerHTML = `<span class="ic">✎</span><span><b>Changements pas encore envoyés à l'équipe :</b> ${who || 'lignes étudiants'}.</span><button class="ghost" id="pubUndo">Retirer la publication</button><button class="primary" id="pubGo">Envoyer les changements</button>`;
  }
}
$('#pubBar').addEventListener('click', async e => {
  const u = e.target.closest('#pubUndo');
  if (u) {
    const name = `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
    if (!confirm(`Retirer la publication de ${name} ? L'équipe ne verra plus ce mois dans son espace jusqu'à ce que tu le publies à nouveau. L'horaire lui-même ne change pas.`)) return;
    u.disabled = true;
    try { await api('/api/unpublish', {}); toast(`${cap(name)} n'est plus visible par l'équipe`); } catch { u.disabled = false; }
    return;
  }
  const b = e.target.closest('#pubGo'); if (!b) return;
  const name = `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
  if (!data.publish.published && !confirm(`Publier ${name} ? Toute l'équipe le verra dans son espace et sera prévenue.`)) return;
  b.disabled = true;
  try {
    const j = await api('/api/publish', {});
    const r = j.publishResult;
    toast(r.notifError ? `Publié, mais les notifications n'ont pas pu partir : ${r.notifError}` : r.first ? `${cap(name)} publié : ${r.notified} personne(s) prévenue(s)` : `Changements envoyés à ${r.notified} personne(s)`);
  } catch {} finally { b.disabled = false; }
});

// ----- Équipe : accès de chacun à son espace (invitation par lien) -----
function renderTeamAccess() {
  const card = $('#teamAccessCard');
  card.hidden = !(data && data.account && data.account.mode === 'cloud' && data.account.role === 'admin');
  if (card.hidden) return;
  if (!access) { $('#teamAccess').innerHTML = '<tr><td class="muted">Chargement…</td></tr>'; return; }
  const emps = data.config.employees.filter(e => !e.end || e.end >= today());
  $('#teamAccess').innerHTML = '<tr><th>Personne</th><th>Adresse e-mail</th><th>État</th><th></th></tr>' + emps.map(e => {
    const m = access.members.find(x => x.role === 'employee' && x.employee_id === e.id);
    const st = !m ? '<span class="muted">Pas encore invité</span>' : m.last_sign_in ? `<span class="tag positive">✓ Connecté le ${hrWhen(m.last_sign_in)}</span>` : '<span class="tag warn">Invité, pas encore connecté</span>';
    return `<tr><td><b>${esc(e.name)}</b></td><td>${m ? esc(m.email) : ''}</td><td>${st}</td>
      <td class="acts">${m ? `<button data-inv="${e.id}" data-email="${esc(m.email)}">Nouveau lien</button><button class="danger" data-rmuser="${m.user_id}">Retirer l'accès</button>` : `<button class="primary" data-inv="${e.id}">Inviter</button>`}</td></tr>`;
  }).join('');
}
$('#teamAccess').addEventListener('click', async e => {
  const inv = e.target.closest('[data-inv]');
  if (inv) {
    const emp = data.config.employees.find(x => x.id === inv.dataset.inv);
    const email = inv.dataset.email || (prompt(`Adresse e-mail de ${emp.name} (celle qu'il utilisera pour se connecter) :`) || '').trim();
    if (!email) return;
    inv.disabled = true; inv.textContent = 'Création du lien…';
    const j = await call('/api/access/invite', { month, employeeId: emp.id, email }).catch(err => ({ error: err.message }));
    if (j.error) { inv.disabled = false; inv.textContent = inv.dataset.email ? 'Nouveau lien' : 'Inviter'; return toast(j.error); }
    data = j; access = j.access; render(); showInvite(j.invite);
    return;
  }
  const rm = e.target.closest('[data-rmuser]');
  if (rm && confirm("Retirer l'accès ? La personne ne pourra plus ouvrir son espace (son compte n'est pas supprimé).")) accessCall('/api/access/remove', { userId: rm.dataset.rmuser }, 'Accès retiré');
});
let inviteMsg = '';
function showInvite(inv) {
  const first = inv.name.split(' ')[0];
  inviteMsg = `Bonjour ${first}, voici ton accès à l'horaire Interparking (Westland). Ouvre ce lien, choisis ton mot de passe, puis ajoute la page à l'écran d'accueil de ton téléphone : ${inv.link}`;
  $('#invDlgTitle').textContent = `Lien pour ${inv.name}`;
  $('#invDlgLink').value = inv.link;
  $('#invDlgEmail').textContent = inv.email;
  $('#inviteDlg').showModal();
}
$('#invDlgWa').onclick = () => window.open('https://wa.me/?text=' + encodeURIComponent(inviteMsg), '_blank', 'noopener');
$('#invDlgCopy').onclick = async () => { try { await navigator.clipboard.writeText(inviteMsg); toast('Message copié avec le lien'); } catch { $('#invDlgLink').select(); toast('Sélectionne le lien et copie-le'); } };
$('#invDlgClose').onclick = () => $('#inviteDlg').close();

// ----- Droits, annuler, historique, accès et sauvegardes -----
let access = null;
const ROLE_LABEL = { admin: 'Administrateur', editor: 'Éditeur', viewer: 'Lecteur' };
const ROLE_ALL = { ...ROLE_LABEL, employee: 'Employé' };
function renderAccount() {
  const acc = data.account, role = acc.role || 'admin';
  document.body.classList.toggle('readonly', role === 'viewer');
  document.body.classList.toggle('not-admin', role !== 'admin');
  $('#roBar').hidden = role !== 'viewer';
  // Annuler : la dernière étape de l'historique.
  const last = (data.history || [])[0];
  $('#undoBtn').hidden = !last || role === 'viewer';
  if (last) $('#undoBtn').title = `Annuler : ${last.label} (${hrWhen(last.at)})`;
  $('#undoBtn2').disabled = !last || role === 'viewer';
  $('#historyList').innerHTML = (data.history || []).length ? '<tr><th>Quand</th><th>Modification</th><th>Par</th><th></th></tr>' + data.history.map((h, k) =>
    `<tr><td>${hrWhen(h.at)}</td><td>${esc(h.label)}</td><td class="muted">${esc(h.author || '')}</td>
      <td>${role === 'viewer' ? '' : `<button data-hist="${h.id}">${k === 0 ? 'Annuler' : 'Revenir avant'}</button>`}</td></tr>`).join('')
    : '<tr><td class="muted">Aucune modification enregistrée pour le moment.</td></tr>';
  // Plusieurs espaces : choix de l'espace.
  $('#wsCard').hidden = !(acc.workspaces && acc.workspaces.length > 1);
  if (acc.workspaces) $('#wsSelect').innerHTML = acc.workspaces.map((w, i) => `<option value="${w.id}" ${w.id === acc.workspaceId ? 'selected' : ''}>${esc(w.name)} ${i + 1} · ${ROLE_LABEL[w.role]}</option>`).join('');
  $('#accessCard').hidden = acc.mode !== 'cloud';
  $('#backupCard').hidden = acc.mode !== 'cloud' || role !== 'admin';
  renderAccess();
}
function renderAccess() {
  renderTeamAccess();
  if (!access) { $('#membersList').innerHTML = '<tr><td class="muted">Chargement…</td></tr>'; $('#backupList').innerHTML = ''; return; }
  const me = data.account.email, admin = data.account.role === 'admin';
  $('#membersList').innerHTML = '<tr><th>Compte</th><th>Rôle</th><th></th></tr>' + access.members.map(m => `<tr><td>${esc(m.email)}${m.email === me ? ' <span class="tag">toi</span>' : ''}</td>
    <td>${m.role === 'employee' ? 'Employé' + ((data.config.employees.find(e => e.id === m.employee_id) || {}).name ? ' · ' + esc(data.config.employees.find(e => e.id === m.employee_id).name) : '') : admin && m.email !== me ? `<select data-role="${esc(m.email)}">${Object.entries(ROLE_LABEL).map(([v, l]) => `<option value="${v}" ${v === m.role ? 'selected' : ''}>${l}</option>`).join('')}</select>` : ROLE_ALL[m.role] || m.role}</td>
    <td>${admin && m.email !== me ? `<button class="danger" data-rmuser="${m.user_id}">Retirer</button>` : ''}</td></tr>`).join('');
  $('#backupList').innerHTML = access.backups.length ? '<tr><th>Date</th><th>Type</th><th></th></tr>' + access.backups.map(b => `<tr><td>${hrWhen(b.created_at)}</td>
    <td>${b.kind === 'hebdo' ? 'Automatique (lundi)' : 'Manuelle'}</td><td><button data-restore="${b.id}">Restaurer</button></td></tr>`).join('') : '<tr><td class="muted">Aucune sauvegarde pour le moment.</td></tr>';
}
async function loadAccess() {
  if (!data || data.account.mode !== 'cloud') return;
  const j = await call('/api/access/list', { month });
  if (j.error) return toast(j.error);
  access = j.access; renderAccess();
}
async function accessCall(path, body, msg) {
  const j = await call(path, { month, ...body });
  if (j.error) return toast(j.error);
  data = j; access = j.access; render(); toast(msg);
}
async function undo(id) {
  const j = await api('/api/undo', id ? { id } : {});
  toast(`Annulé : ${j.undone}`);
}
$('#undoBtn').onclick = () => { const last = data.history[0]; if (last && confirm(`Annuler « ${last.label} » ?`)) undo(); };
$('#undoBtn2').onclick = () => $('#undoBtn').onclick();
$('#historyList').addEventListener('click', e => {
  const b = e.target.closest('[data-hist]'); if (!b) return;
  const h = data.history.find(x => x.id === b.dataset.hist);
  if (confirm(`Revenir à l'état d'avant « ${h.label} » (${hrWhen(h.at)}) ? Les modifications faites après seront aussi annulées.`)) undo(h.id);
});
$('#memberAdd').onclick = () => accessCall('/api/access/add', { email: $('#memberEmail').value, role: $('#memberRole').value }, 'Accès donné');
$('#membersList').addEventListener('change', e => {
  const s = e.target.closest('[data-role]'); if (s) accessCall('/api/access/add', { email: s.dataset.role, role: s.value }, 'Rôle modifié');
});
$('#membersList').addEventListener('click', e => {
  const b = e.target.closest('[data-rmuser]'); if (b && confirm('Retirer l\'accès de ce compte ?')) accessCall('/api/access/remove', { userId: b.dataset.rmuser }, 'Accès retiré');
});
$('#backupNow').onclick = () => accessCall('/api/backup/now', {}, 'Sauvegarde faite');
$('#backupList').addEventListener('click', e => {
  const b = e.target.closest('[data-restore]');
  if (b && confirm('Restaurer cette sauvegarde ? Le planning actuel est d\'abord sauvegardé, puis remplacé.')) accessCall('/api/backup/restore', { id: b.dataset.restore }, 'Sauvegarde restaurée');
});
$('#wsSwitch').onclick = () => api('/api/workspace/switch', { id: $('#wsSelect').value }).then(() => { access = null; loadAccess(); toast('Espace ouvert'); });

// ----- Planning partagé : afficher les modifications faites par l'autre compte -----
// Toutes les 30 secondes (page visible, rien en cours de saisie), on vérifie s'il y a du nouveau.
setInterval(async () => {
  if (!backend || !data || document.visibilityState !== 'visible') return;
  if (!pop.hidden || document.querySelector('dialog[open]')) return;
  const a = document.activeElement;
  if (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
  const before = data.reloaded;
  const j = await call('/api/state', null, { month });
  if (j.error || j.reloaded === before) return;
  data = j; render();
  toast('Planning mis à jour : modifications faites par un autre compte');
}, 30000);

// ----- Navigation entre les pages -----
const PAGES = [...document.querySelectorAll('.page')];
// Compte employé (front office) : textes de présentation, sans les consignes du chef terrain.
const isEmpView = () => document.body.classList.contains('employee');
// Auteur d'un élément : un nom (compte employé) ou une adresse e-mail, dont on garde la partie avant @.
const personLabel = s => String(s || '').includes('@') ? String(s).split('@')[0] : String(s || '');
// Pages ouvertes à un compte employé.
const EMP_PAGES = ['me', 'stats', 'zones', 'agenda', 'log'];
function go(page) {
  const emp = document.body.classList.contains('employee');
  if (emp && !EMP_PAGES.includes(page)) page = 'me';
  else if (!emp && page === 'me') page = 'dashboard';
  // Employé : Statistiques et Zones en lecture seule ; Agenda et Reporting modifiables.
  if (emp) document.body.classList.toggle('readonly', ['zones', 'stats'].includes(page));
  if (emp && page === 'stats' && data && data.me) renderStatsPage(data.stats ? { stats: data.stats.rows, month: data.stats.month } : null);
  const el = PAGES.find(p => p.dataset.page === page) || PAGES[0];
  if (rfOn() && el.dataset.page === 'dashboard') return openTab(rfTab);
  if (rfOn() && el.dataset.page !== 'me') rfOpen(el);
  document.body.dataset.page = el.dataset.page;
  if (!rfOn() || el.dataset.page === 'me') PAGES.forEach(p => { p.hidden = p !== el; });
  $('#pageTitle').textContent = el.dataset.title;
  // Espace employé : sous-titres de présentation (pas les consignes destinées au chef terrain).
  $('#pageSub').textContent = (emp && el.dataset.subEmp) || el.dataset.sub || '';
  document.querySelectorAll('.nav[data-go]').forEach(b => b.classList.toggle('on', b.dataset.go === el.dataset.page));
  document.body.classList.remove('menu-open');
  try { localStorage.setItem('page', el.dataset.page); } catch {}
  if (el.dataset.page === 'settings' || el.dataset.page === 'team') loadAccess();
  if (!rfOn() || el.dataset.page === 'me') window.scrollTo(0, 0);
}
// ----- Refonte : en-tête (logo, parking, menu en pilules), pages « Overview » d'encadrés, grande fenêtre -----
// Chaque onglet du menu montre des encadrés ; un clic sur un encadré ouvre la page dans une grande fenêtre
// (85 % de l'écran, fond flouté ; plein écran sur téléphone). Les pages d'avant sont rangées dans #rfStore.
const rfOn = () => document.documentElement.classList.contains('refonte');
const RF_TABS = [
  { id: 'accueil', label: 'Accueil', title: 'Overview' },
  { id: 'horaire', label: 'Horaire', title: 'Horaire' },
  { id: 'terrain', label: 'Terrain', title: 'Terrain' },
  { id: 'absences', label: 'Absences', title: 'Absences' },
  { id: 'organisation', label: 'Organisation', title: 'Organisation' },
  { id: 'pointage', label: 'Pointage', title: 'Pointage' },
];
// Encadrés de chaque onglet (dans l'ordre d'affichage).
const RF_LAYOUT = {
  accueil: ['horaire', 'couverture', 'jour', 'avenir', 'absences', 'alertes', 'reporting', 'agenda'],
  horaire: ['horaire', 'publication', 'couverture', 'alertes', 'matchs', 'stats'],
  terrain: ['zones', 'jour', 'fixe', 'reporting', 'agenda'],
  absences: ['maladie', 'formation', 'demandes', 'absences'],
  organisation: ['equipe', 'rh', 'factures', 'etudiants', 'matchs', 'stats', 'parametres'],
  pointage: ['pointage'],
};
let rfTab = (() => { try { return localStorage.getItem('rfTab') || 'accueil'; } catch { return 'accueil'; } })();
if (!RF_TABS.some(t => t.id === rfTab)) rfTab = 'accueil';
const rfMonthNav = document.querySelector('.topbar .monthnav'), rfActions = document.querySelector('.topbar .actions');

// Mise en place : menu, cloche / annuler / compte dans l'en-tête, pages rangées.
(function rfSetup() {
  if (!rfOn()) return;
  $('#rfTabs').innerHTML = RF_TABS.map(t => `<button type="button" data-tab="${t.id}">${t.label}</button>`).join('');
  $('#rfRight').append($('#undoBtn'), document.querySelector('.bell-wrap'), $('#accountBtn'));
  PAGES.forEach(p => { if (p.dataset.page !== 'me') { p.hidden = true; $('#rfStore').appendChild(p); } });
})();
$('#rfTabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) openTab(b.dataset.tab); });
function openTab(id) {
  rfTab = id;
  try { localStorage.setItem('rfTab', id); localStorage.setItem('page', 'dashboard'); } catch {}
  rfClose(true);
  PAGES.forEach(p => { p.hidden = true; });
  document.body.dataset.page = 'overview';
  renderOverview(true);
  window.scrollTo(0, 0);
}
// Ouvre une page dans la grande fenêtre.
function rfOpen(el) {
  const body = $('#rfSheetBody');
  [...body.children].forEach(c => { if (c !== el) { c.hidden = true; $('#rfStore').appendChild(c); } });
  body.appendChild(el); el.hidden = false;
  $('#rfSheetTitle').textContent = el.dataset.title || '';
  $('#rfSheetSub').textContent = el.dataset.sub || '';
  // Mois et boutons « Générer, Excel, Imprimer » pour l'horaire et les statistiques.
  const tools = $('#rfSheetTools');
  if (['planning', 'stats'].includes(el.dataset.page)) tools.append(rfMonthNav, rfActions);
  else { const top = document.querySelector('.topbar'); top.insertBefore(rfMonthNav, top.querySelector('#undoBtn') || null); top.appendChild(rfActions); }
  $('#rfModal').hidden = false;
  document.body.classList.add('rf-open');
  document.querySelector('.app').inert = true;
  body.scrollTop = 0;
}
function rfClose(quiet) {
  if ($('#rfModal').hidden) return;
  const body = $('#rfSheetBody');
  [...body.children].forEach(c => { c.hidden = true; $('#rfStore').appendChild(c); });
  const top = document.querySelector('.topbar'); top.appendChild(rfMonthNav); top.appendChild(rfActions);
  $('#rfModal').hidden = true;
  document.body.classList.remove('rf-open');
  document.querySelector('.app').inert = false;
  document.body.dataset.page = 'overview';
  try { localStorage.setItem('page', 'dashboard'); } catch {}
  if (!quiet || rfDirty) renderOverview();
}
$('#rfClose').onclick = () => rfClose();
$('#rfModal').addEventListener('mousedown', e => { if (e.target === e.currentTarget) rfClose(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#rfModal').hidden && !document.querySelector('dialog[open]')) rfClose(); });
$('#rfPrev').onclick = () => { month = addMonth(month, -1); api('/api/state'); };
$('#rfNext').onclick = () => { month = addMonth(month, 1); api('/api/state'); };

// Choix du parking (Bordet arrive à l'étape suivante).
$('#rfSite').onclick = e => { e.stopPropagation(); $('#rfSiteMenu').hidden = !$('#rfSiteMenu').hidden; };
$('#rfSiteMenu').addEventListener('click', e => {
  const b = e.target.closest('[data-site]'); if (!b) return;
  $('#rfSiteMenu').hidden = true;
  if (b.dataset.site !== 'westland') toast('Bordet arrive à la prochaine étape.');
});
document.addEventListener('click', e => { if (!e.target.closest('#rfSiteMenu, #rfSite')) $('#rfSiteMenu').hidden = true; });

// Logos : club adverse et compétition (ESPN), Westland pour les dimanches d'ouverture.
// Copie du logo du Westland (son site interdit de l'afficher ailleurs), avec l'accord de l'utilisateur.
const WESTLAND_LOGO = 'westland-logo.png';
const logoImg = (src, alt, fallback, cls = '') => src ? `<img class="lg ${cls}" src="${esc(src)}" alt="${esc(alt)}" title="${esc(alt)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(document.createTextNode('${fallback}'))">` : fallback;
const matchIcon = m => logoImg(m.oppLogo, m.opponent, '⚽');
const compIcon = m => m.compLogo ? logoImg(m.compLogo, m.competition || '', '', 'comp') : '';
const westIcon = () => logoImg(WESTLAND_LOGO, 'Westland Shopping', '🛍');
// ----- Encadrés -----
const rfTile = (go, title, body, cls = '') => `<button type="button" class="rf-tile ${cls}" ${go ? `data-go="${go}"` : ''}><span class="rf-tile-head"><b class="rf-t">${title}</b><span class="rf-more">⋯</span></span>${body}</button>`;
const rfMonthLabel = () => `${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
const rfIsAdmin = () => data.account.role === 'admin';
function rfMonthStats() {
  const v = data.view, open = v.days.filter(d => !d.closed && d.need);
  const full = open.filter(d => !d.missing && d.present + d.students.length >= d.need).length;
  const studs = v.days.reduce((n, d) => n + d.studentRows.filter(r => !r.none).length, 0);
  return { v, open, full, studs, pct: open.length ? Math.round(full / open.length * 100) : 0 };
}
const RF_TILES = {
  horaire() {
    const { v, open, full, studs } = rfMonthStats(), td = localDay();
    const max = Math.max(1, ...v.days.map(d => Math.max(d.need || 0, d.present + d.students.length)));
    const bars = v.days.map((d, i) => {
      const val = d.present + d.students.length, cls = d.closed ? 'off' : d.missing ? 'miss' : '';
      return `<span class="b ${cls} ${d.date === td ? 'today' : ''}" data-l="${d.day} · ${val}/${d.need || 0} pers."><i style="height:${Math.max(4, val / max * 100)}%;animation-delay:${i * 14}ms"></i>${d.need ? `<em style="bottom:calc(${d.need / max * 100}% - 2px)"></em>` : ''}</span>`;
    }).join('');
    const last = v.days.length ? v.days[v.days.length - 1].day : 30;
    const body = `<span class="rf-funnel"><span><span>Jours ouverts</span><b>${open.length}</b></span><span class="hl"><span>Jours complets</span><b>${full}</b></span>
        <span><span>À compléter</span><b>${open.length - full}</b></span><span><span>Alertes</span><b>${v.generated ? v.warnings.length : '—'}</b></span><span><span>Jours étudiants</span><b>${studs}</b></span></span>
      ${v.generated ? `<span class="rf-bars">${bars}</span><span class="rf-axis"><span>1</span><span>8</span><span>15</span><span>22</span><span>${last}</span></span>`
        : '<span class="rf-muted">Le mois n\'est pas encore généré : ouvre l\'horaire pour le générer.</span>'}`;
    return rfTile('planning', `Horaire · ${rfMonthLabel()}`, body, 'span3');
  },
  couverture() {
    const { pct, open, full } = rfMonthStats();
    return rfTile('planning', '<span class="rf-tag">✦ Couverture</span>', `<span class="rf-big">${data.view.generated ? pct + '%' : '—'}</span>
      <span class="rf-muted">${data.view.generated ? `des jours ouverts ont assez de monde en ${rfMonthLabel()} (${full} sur ${open.length}).` : 'Génère le mois pour voir la couverture.'}</span>`, 'grad');
  },
  jour() {
    const v = data.view, td = localDay(), d = v.days.find(x => x.date === td);
    let body;
    if (!d) body = '<span class="rf-muted">Aujourd\'hui n\'est pas dans le mois affiché.</span>';
    else if (d.closed) body = '<span class="rf-muted">Parking fermé aujourd\'hui.</span>';
    else {
      const w = v.rows.filter(r => !r.isParkChief).map(r => ({ r, c: r.cells[td] })).filter(x => x.c && x.c.kind === 'work');
      body = `<span class="rf-big">${w.length + d.students.length}<small>personnes</small></span>
        <span class="rf-chips">${w.map(x => `<span><b>${esc(x.c.label)}</b>${esc(x.r.name)}</span>`).join('')}${d.students.length ? `<span><b>${d.students.length}</b>étudiant(s)</span>` : ''}</span>`;
    }
    return rfTile('zones', "Aujourd'hui", body, 'span2');
  },
  avenir() {
    const td = localDay();
    const ev = [...(data.matches || []).filter(m => m.date >= td).map(m => ({ date: m.date, ic: matchIcon(m), t: m.opponent, sub: m.competition || 'Match', comp: compIcon(m), s: m.time })),
      ...(data.openings || []).filter(o => !o.ignored && o.date >= td).map(o => ({ date: o.date, ic: westIcon(), t: "Dimanche d'ouverture", sub: o.label, comp: '', s: o.hours || '' }))]
      .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4);
    return rfTile('calendar', 'À venir', ev.length ? `<ul class="rf-list rf-events">${ev.map(e => `<li><span class="rf-ic logo">${e.ic}</span><span class="t"><b>${esc(e.t)}</b><small>${esc(e.sub)}</small></span>${e.comp ? `<span class="rf-comp">${e.comp}</span>` : ''}<span>${fmtDate(e.date)}${e.s ? ' · ' + esc(e.s) : ''}</span></li>`).join('')}</ul>` : '<span class="rf-muted">Rien de prévu.</span>', 'span2');
  },
  absences() {
    const v = data.view, n = v.rows.filter(r => !r.isParkChief).length || 1;
    const row = (l, k, c) => { const x = absentPeople(v, k); return `<span class="r"><span><span>${l}</span><b>${x}</b></span><span class="rf-track"><i style="width:${Math.max(x ? 6 : 0, x / n * 100)}%;--c:${c}"></i></span></span>`; };
    return rfTile('sick', 'Absences du mois', `<span class="rf-big">${absentPeople(v, 'ALL')}<small>personne(s)</small></span>
      <span class="rf-prog">${row('Maladie', 'MALADIE', 'var(--pink)')}${row('Formation', 'FORMATION', 'var(--blue)')}${row('Congé', 'CONGE', 'var(--green)')}</span>`);
  },
  alertes() {
    const v = data.view;
    return rfTile('planning', 'Alertes', !v.generated ? '<span class="rf-muted">Mois pas encore généré.</span>'
      : `<span class="rf-big">${v.warnings.length}<small>${v.warnings.length ? 'à régler' : 'tout est en ordre'}</small></span>
        <ul class="rf-list">${v.warnings.slice(0, 3).map(w => `<li><span class="rf-ic">⚠</span><span class="t">${esc(w)}</span></li>`).join('')}</ul>`);
  },
  reporting: () => rfTile('log', 'Reporting', `<span class="rf-ic" style="width:44px;height:44px;font-size:22px">📝</span>
    <span class="rf-muted">Les événements du jour (accident, client difficile, objet trouvé…), remis au propre par l'IA, et le rapport PDF du soir.</span>`),
  agenda: () => rfTile('agenda', 'Agenda', `<span class="rf-ic" style="width:44px;height:44px;font-size:22px">🗓</span>
    <span class="rf-muted">Tickets PLANON, livraisons, matchs… à ajouter dans l'agenda Outlook EXPLOITATION.</span>`),
  publication() {
    const p = data.publish;
    const body = !p ? '' : !p.published ? `<span class="rf-big">Brouillon</span><span class="rf-muted">L'équipe ne voit pas encore ${rfMonthLabel()}.</span>`
      : p.people.length ? `<span class="rf-big">${p.people.length}<small>à prévenir</small></span><span class="rf-muted">Changements pas encore envoyés : ${esc(p.people.map(x => x.name).join(', '))}.</span>`
        : `<span class="rf-big">Publié</span><span class="rf-muted">Le ${hrWhen(p.at)} : l'équipe voit ce mois à jour.</span>`;
    return rfTile('planning', 'Publication', body, p && p.published && !p.people.length ? '' : 'dark');
  },
  matchs() {
    const ms = (data.allMatches || []).length, os = (data.openings || []).filter(o => !o.ignored && o.date.startsWith(month)).length;
    const dots = [...Array(14)].map((_, i) => `<span class="c ${i % 5 === 2 ? 'hi' : ''}">${'<i></i>'.repeat(1 + ((i * 7) % 4))}</span>`).join('');
    return rfTile('calendar', 'Matchs & dimanches', `<span class="rf-big">${ms}<small>match(s) · ${os} ouverture(s)</small></span><span class="rf-dots">${dots}</span>`);
  },
  stats: () => rfTile('stats', 'Statistiques', `<span class="rf-muted">Roulement des matchs et des dimanches, compteurs de la saison, heures et jours par personne.</span>
    <span class="rf-dots">${[...Array(16)].map((_, i) => `<span class="c ${i === 9 ? 'hi' : ''}">${'<i></i>'.repeat(1 + (i * 3) % 5)}</span>`).join('')}</span>`),
  zones: () => rfTile('zones', 'Zones & dispatch', `<span class="rf-muted">Qui est où maintenant, la journée heure par heure, les imprévus (absent, retard) et les remarques terrain.</span>
    <span class="rf-chips"><span style="background:#e0eaff">Zone 1 · Total-Delhaize</span><span style="background:#dcfae6">Zone 2 · City-Crélan</span><span style="background:#fdead7">Zone 3 · Toit</span><span style="background:#f4ebff">Dispatch</span></span>`, 'span2'),
  fixe: () => rfTile('fixed', 'Horaire fixe', `<span class="rf-ic" style="width:44px;height:44px;font-size:22px">🖨</span><span class="rf-muted">Les feuilles par horaire (8-16, 12-20 A…) à imprimer et plastifier.</span>`),
  maladie() {
    const v = data.view, who = v.rows.filter(r => Object.values(r.cells).some(c => c && c.code === 'MALADIE'));
    return rfTile('sick', 'Maladie', `<span class="rf-big">${who.length}<small>personne(s) ce mois</small></span>${who.length ? `<span class="rf-chips">${who.map(r => `<span>${esc(r.name)}</span>`).join('')}</span>` : '<span class="rf-muted">Personne en maladie ce mois-ci.</span>'}`, 'span2');
  },
  formation() {
    const n = absentPeople(data.view, 'FORMATION');
    return rfTile('formation', 'Formation', `<span class="rf-big">${n}<small>personne(s) ce mois</small></span><span class="rf-muted">La personne n'est pas au parking ce jour-là.</span>`);
  },
  demandes: () => rfTile('requests', 'Demandes', `<span class="rf-ic" style="width:44px;height:44px;font-size:22px">✉️</span><span class="rf-muted">Horaire voulu, congé, repos, RTT… pour un jour précis.</span>`),
  equipe() {
    const emps = data.config.employees.filter(e => !e.end || e.end >= today());
    return rfTile('team', 'Équipe', `<span class="rf-big">${emps.length}<small>employés</small></span>
      <span class="rf-avs">${emps.map(e => `<i class="hrx-av ${hrAv(e.id)}">${esc(initials(e.name))}</i>`).join('')}</span>`, 'span2');
  },
  rh() {
    if (!rfIsAdmin()) return '';
    const notes = (data.hr && data.hr.notes || []).filter(n => (n.createdAt || '').slice(0, 7) === localDay().slice(0, 7));
    const pos = notes.filter(n => n.type === 'positive').length, late = notes.filter(n => n.late).length;
    return rfTile('hr', 'RH', `<span class="rf-big">${notes.length}<small>note(s) ce mois</small></span>
      <span class="rf-prog"><span class="r"><span><span>Positives</span><b>${pos}</b></span><span class="rf-track"><i style="width:${notes.length ? pos / notes.length * 100 : 0}%;--c:var(--green)"></i></span></span>
      <span class="r"><span><span>Retards</span><b>${late}</b></span><span class="rf-track"><i style="width:${notes.length ? late / notes.length * 100 : 0}%;--c:var(--orange)"></i></span></span></span>`);
  },
  factures: () => rfIsAdmin() ? rfTile('invoices', 'Factures', `<span class="rf-ic" style="width:44px;height:44px;font-size:22px">🧾</span><span class="rf-muted">Westland (Delhaize, Big C, Superwash…) et Bordet (Pfizer) : les factures du mois.</span>`) : '',
  etudiants: () => rfTile('students', 'Étudiants', `<span class="rf-big">${rfMonthStats().studs}<small>jours étudiants</small></span><span class="rf-muted">Disponibilités par jour et exceptions.</span>`),
  parametres: () => rfTile('settings', 'Paramètres', `<span class="rf-muted">Roulement des week-ends, semaine du chef terrain, accès, historique et sauvegardes.</span>`),
  pointage: () => `<div class="rf-tile span4 dark rf-soon"><span class="rf-tile-head"><b class="rf-t">Pointage</b><span class="rf-more">⋯</span></span>
    <span class="rf-big">Bientôt</span><span class="rf-muted">La liste des pointages de l'équipe, les alertes (retard, oubli, heures supp), les corrections, les horaires de référence et l'export Excel pour la RH et la paie arrivent à une prochaine étape.</span></div>`,
};
let rfDirty = false;
function renderOverview(animate = false) {
  if (!rfOn() || !data || !data.view || (data.account && data.account.role === 'employee')) return;
  if (!$('#rfModal').hidden) { rfDirty = true; return; }
  rfDirty = false;
  $('#rfGrid').classList.toggle('anim', animate);
  document.querySelectorAll('#rfTabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === rfTab));
  const tab = RF_TABS.find(t => t.id === rfTab);
  $('#rfTitle').textContent = tab.title;
  $('#rfMonth').textContent = cap(rfMonthLabel());
  $('#rfGrid').innerHTML = RF_LAYOUT[rfTab].map(k => RF_TILES[k] ? RF_TILES[k]() : '').join('');
  if (data.account.email) $('#accountLabel').textContent = initials(data.account.email.split('@')[0].replace(/[._-]+/g, ' ')) || '?';
}

// Compteurs du mois, roulement foot / dimanches et matchs de la saison (page Statistiques ; aussi pour l'espace employé).
function renderStatsPage(v) {
  if (!v || !v.stats || !v.stats.length) { $('#stats').innerHTML = '<tr><td class="muted">Pas encore de chiffres ce mois-ci.</td></tr>'; $('#footStats').innerHTML = ''; renderDuty(); return; }
  const cols = v.statCols || [['8-16', '8-16'], ['10-18', '10-18'], ['12-20', '12-20'], ['foot', '⚽ mois'], ['footSeason', '⚽ saison'], ['sat8', 'Sam. 8h saison'], ['REPOS', 'Repos'], ['RTT', 'RTT'], ['worked', 'Jours trav.']];
  const spread = k => { const xs = v.stats.map(s => s[k]); return Math.max(...xs) - Math.min(...xs); };
  let s = '<tr><th></th>' + cols.map(c => `<th>${c[1]}</th>`).join('') + '</tr>';
  for (const st of v.stats) {
    s += `<tr><td>${esc(st.name)}</td>` + cols.map(([k]) => {
      const xs = v.stats.map(x => x[k]);
      const hi = ['8-16', '10-18', '12-20'].includes(k) && spread(k) > 1 && st[k] === Math.max(...xs);
      return `<td class="${hi ? 'hi' : ''}">${st[k]}</td>`;
    }).join('') + '</tr>';
  }
  $('#stats').innerHTML = s;
  // Écart du mois d'avant : ce que « Générer le mois » rattrape (+ = en a fait trop, − = pas assez).
  const gq = v.stats.filter(st => st.gapPrev);
  // Pour chaque horaire : nombre le mois d'avant, écart exact avec la moyenne (au prorata des jours), puis ce mois-ci.
  const cur = v.month || month || '';
  const prevYm = cur ? (() => { const [y, m] = cur.split('-').map(Number), d = new Date(y, m - 2, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; })() : '';
  // Une phrase par personne : seulement les horaires où elle était nettement au-dessus ou en dessous des autres.
  const full = ym => ym ? MONTHS[Number(ym.slice(5)) - 1].toLowerCase() : '';
  const line = st => {
    const out = ['8-16', '10-18', '12-20'].filter(k => Math.abs(st.gapPrev.gap[k] || 0) >= 1).map(k => {
      const more = st.gapPrev.gap[k] > 0;
      return `<span class="gap ${more ? 'plus' : 'minus'}">${more ? 'Trop' : 'Pas assez'} de ${k}</span> ${st.gapPrev.count[k]} en ${full(prevYm)} → ${more ? 'moins' : 'plus'} en ${full(cur)} : <b>${st[k]}</b>`;
    });
    return out.length ? out.join('<br>') : '<span class="gap even">✓ Comme les autres</span>';
  };
  $('#gapStats').innerHTML = gq.length ? gq.map(st => `<tr><td>${esc(st.name)}</td><td class="gaps">${line(st)}</td></tr>`).join('')
    : "<tr><td class='muted'>Pas de mois d'avant à comparer.</td></tr>";

  renderDuty();
  // Matchs de la saison, par personne.
  const rot = v.stats.slice().sort((a, b) => a.footSeason - b.footSeason || (a.lastFoot || '').localeCompare(b.lastFoot || ''));
  $('#footStats').innerHTML = '<tr><th>Employé</th><th>Ce mois</th><th>Saison</th><th>Matchs de la saison</th></tr>'
    + rot.map(st => `<tr><td>${esc(st.name)}</td><td>${st.foot}</td><td>${st.footSeason}</td>
      <td class="footlist">${st.footList.length ? st.footList.map(m => `<span>${fmtDate(m.date)}${m.opponent ? ' · ' + esc(m.opponent) : ''}</span>`).join('') : '—'}</td></tr>`).join('');
}

// Les anciennes fenêtres sont devenues des pages : « ouvrir » = aller à la page.
PAGES.forEach(p => { p.showModal = () => go(p.dataset.page); p.close = () => {}; });
document.addEventListener('click', e => {
  const b = e.target.closest('[data-go]'); if (!b) return;
  // Un raccourci (carte, action rapide) passe par le bouton du menu, qui prépare la page.
  const nav = document.querySelector(`.nav[data-go="${b.dataset.go}"]`);
  if (b !== nav && nav && nav.onclick) return nav.click();
  if (!b.onclick) go(b.dataset.go);
});
$('#menuBtn').onclick = () => document.body.classList.toggle('menu-open');
$('#scrim').onclick = () => document.body.classList.remove('menu-open');
go('dashboard');

// ----- Vue « jour par jour » (pratique sur téléphone) -----
const DOW_FULL = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const SHIFT_ORDER = ['7-15', '8-16', '10-18', '11-19', '12-20', 'FOOT', 'CHEF'];
function renderDays() {
  const v = data.view;
  const today = new Date().toISOString().slice(0, 10);
  const chip = (r, c, date) => `<button class="chip c-${shiftCls(c, r.isChef)}" data-emp="${r.id}" data-date="${date}">${esc(r.name)}${c.kind === 'off' ? ` · ${SHORT[c.code] || c.code}` : ''}</button>`;
  let h = '';
  for (const d of v.days) {
    const work = {}, off = [], empty = [];
    for (const r of v.rows) {
      const c = r.cells[d.date];
      if (c && c.kind === 'work') { const k = r.isChef ? 'CHEF' : c.shift; (work[k] = work[k] || []).push(chip(r, c, d.date)); }
      else if (c) off.push(chip(r, c, d.date));
      else if (!r.isChef && !r.isParkChief && !d.closed) empty.push(`<button class="chip empty" data-emp="${r.id}" data-date="${d.date}">${esc(r.name)}</button>`);
    }
    const badges = [
      d.openSunday ? '<span class="badge open">Ouvert</span>' : '',
      d.holiday ? `<span class="badge holiday">Férié : ${esc(d.holiday)}${d.closed ? '' : ' (rouvert)'}</span>` : '',
      d.closed && !d.openSunday ? '<span class="badge">Fermé</span>' : '',
      d.match ? `<span class="badge foot">⚽ ${d.match.time} ${esc(d.match.opponent)}</span>` : '',
      d.weGroup.length ? `<span class="badge">Week-end : ${esc(d.weGroup.join(', '))}</span>` : '',
    ].join('');
    const bad = d.missing || d.warnings.length;
    const count = d.need ? `<span class="count ${bad ? 'bad' : ''}">${d.present + d.students.length}/${d.need}</span>` : '';
    const lines = SHIFT_ORDER.filter(t => work[t]).map(t => {
      const label = t === 'FOOT' ? `⚽ ${d.match ? d.match.shift : ''}` : t === 'CHEF' ? `Chef ${esc(data.config.chef.shift)}` : t;
      return `<div class="line"><span class="lbl c-${t}">${label}</span><div>${work[t].join('')}</div></div>`;
    });
    const studs = d.studentRows.filter(r => !r.none).sort((a, b) => a.k - b.k);
    if (studs.length) lines.push(`<div class="line"><span class="lbl">Étudiants</span><div>${studs.map(r =>
      `<button class="chip c-STUDENT ${r.manual ? '' : 'auto'}" data-emp="student-${r.k}" data-date="${d.date}">Student ${r.k} · ${r.shift === 'FOOT' ? '⚽ ' + (d.match ? d.match.shift : '') : r.shift}</button>`).join('')}</div></div>`);
    if (off.length) lines.push(`<div class="line"><span class="lbl">Absents</span><div>${off.join('')}</div></div>`);
    if (empty.length) lines.push(`<div class="line"><span class="lbl">À placer</span><div>${empty.join('')}</div></div>`);
    const quiet = d.closed && !Object.keys(work).length && !off.length;
    const card = `<section class="daycard ${quiet ? 'quiet' : ''} ${d.date === today ? 'today' : ''} ${bad ? 'bad' : ''}" id="day-${d.date}">
      <header><b>${DOW_FULL[d.dow]} ${d.day}</b>${badges}${count}</header>
      ${quiet ? '' : lines.join('')}
      ${d.warnings.length ? `<p class="warn">${d.warnings.map(esc).join(' · ')}</p>` : ''}
    </section>`;
    dayCards[d.date] = card;
    h += card;
  }
  $('#dayView').innerHTML = h;
}
const dayCards = {};

// Tableau ou jour par jour : par défaut « jour par jour » sur téléphone ; le choix est retenu.
let view = (() => { try { if (!localStorage.getItem('viewV2')) { localStorage.setItem('viewV2', '1'); return null; } return localStorage.getItem('view'); } catch { return null; } })() || (innerWidth < 700 ? 'days' : 'week');
let wkStart = null; // lundi de la semaine affichée (vue Semaine)
function applyView(scroll) {
  $('#tableView').hidden = view !== 'table' && view !== 'week';
  $('#dayView').hidden = view !== 'days';
  $('#weekNav').hidden = view !== 'week';
  $('#vWeek').classList.toggle('on', view === 'week');
  $('#vTable').classList.toggle('on', view === 'table');
  $('#vDays').classList.toggle('on', view === 'days');
  try { localStorage.setItem('view', view); } catch {}
  const t = document.getElementById('day-' + new Date().toISOString().slice(0, 10));
  if (scroll && view === 'days' && t) t.scrollIntoView({ block: 'start' });
}
$('#vTable').onclick = () => { view = 'table'; applyView(); if (data) render(); };
$('#vWeek').onclick = () => { view = 'week'; applyView(); if (data) render(); };
// Semaine précédente / suivante (on change de mois quand la semaine en sort).
function weekGo(start) {
  wkStart = start;
  const all = data.view.allDays || data.view.days;
  if (all.some(d => d.date === start)) return render();
  month = addDay(start, 3).slice(0, 7); // le mois du jeudi de la semaine
  api('/api/state');
}
$('#wPrev').onclick = () => weekGo(addDay(wkStart, -7));
$('#wNext').onclick = () => weekGo(addDay(wkStart, 7));
$('#wToday').onclick = () => { const t = localDay(); const mon = addDay(t, -((new Date(t + 'T12:00:00').getDay() + 6) % 7)); month = t.slice(0, 7); wkStart = mon; api('/api/state'); };
$('#vDays').onclick = () => { view = 'days'; applyView(true); };
applyView();

// ----- Édition d'une case -----
const pop = $('#popover');
document.addEventListener('click', e => {
  const th = e.target.closest('#grid thead th[data-date]');
  if (th) {
    const d = (data.view.allDays || data.view.days).find(x => x.date === th.dataset.date);
    if (d.dow === 0) return;
    const what = d.holiday ? ` (férié : ${d.holiday})` : '';
    if (confirm(d.closed ? `Rouvrir le ${fmtDate(d.date)}${what} ?` : `Marquer le ${fmtDate(d.date)}${what} comme jour de fermeture ?`))
      api('/api/config', { toggleClosed: d.date });
    return;
  }
  if (e.target.closest('#grid .add-emp')) { openEmp(null); return; }
  if (e.target.closest('#grid .edit-chef')) { openChef(); return; }
  const ed = e.target.closest('#grid .edit-emp');
  if (ed) { openEmp(ed.dataset.id); return; }
  const td = e.target.closest('#grid td.cell, #dayView .chip');
  if (td) { openPop(td); return; }
  if (!e.target.closest('#popover')) pop.hidden = true;
});
function openPop(td) {
  if (document.body.classList.contains('readonly')) return; // lecteur : consultation seulement
  const { emp, date } = td.dataset;
  const day = (data.view.allDays || data.view.days).find(x => x.date === date);
  const row = data.view.rows.find(r => r.id === emp) || data.view.studentRows.find(r => r.id === emp);
  if (row.isParkChief) {
    // Chef de parc : CP (automatique) du lundi au vendredi, ou une absence.
    let hp = `<div class="ttl">${esc(row.name)} – ${day.dowLabel} ${fmtDate(date)}</div>`;
    for (const k of ['CONGE', 'MALADIE', 'FORMATION', 'REPOS', 'RTT', ...PAY_CODES]) hp += `<button data-v="${k}" class="c-${k}">${OFF[k]}</button>`;
    hp += '<button data-v="auto" class="auto">CP (automatique)</button>';
    return showPop(td, hp, emp, date);
  }
  const opts = data.view.shiftChoices ? data.view.shiftChoices.slice() : row.isChef ? [data.config.chef.shift] : day.openSunday ? ['11-19'] : ['8-16', '10-18', '12-20'];
  if (day.match && !row.isChef) opts.push('FOOT');
  let h = `<div class="ttl">${esc(row.name)} – ${day.dowLabel} ${fmtDate(date)}</div>`;
  if (row.isStudent) {
    for (const o of opts) h += `<button data-v="${o}" class="c-${o === 'FOOT' ? 'FOOT' : 'STUDENT'}">${o === 'FOOT' ? '⚽ ' + day.match.shift : o}</button>`;
    h += `<button data-v="NONE" class="c-NONE">Aucun étudiant</button>`;
    h += `<button data-v="auto" class="auto">Automatique (déverrouiller)</button>`;
    return showPop(td, h, emp, date);
  }
  for (const o of opts) h += `<button data-v="${o}" class="c-${row.isChef ? 'CHEF' : o}">${o === 'FOOT' ? '⚽ ' + day.match.shift : o}</button>`;
  for (const k of Object.keys(OFF)) if (!row.isChef || ['REPOS', 'CONGE', 'MALADIE', 'FORMATION', 'RTT', ...PAY_CODES].includes(k)) h += `<button data-v="${k}" class="c-${k}">${OFF[k]}</button>`;
  const cur = row.cells[date];
  if (cur && !row.isChef) h += cur.pinned ? `<button data-v="unlock" class="auto">🔓 Déverrouiller</button>` : `<button data-v="lock" class="auto">🔒 Verrouiller (garder en régénérant)</button>`;
  h += `<button data-v="auto" class="auto">Automatique (vider la case)</button>`;
  showPop(td, h, emp, date);
}
function showPop(td, h, emp, date) {
  pop.innerHTML = h;
  pop.hidden = false;
  const r = td.getBoundingClientRect();
  const w = pop.offsetWidth;
  pop.style.left = Math.max(8, Math.min(window.scrollX + r.left, window.scrollX + document.documentElement.clientWidth - w - 8)) + 'px';
  pop.style.top = (window.scrollY + r.bottom + 4) + 'px';
  pop.onclick = ev => {
    const b = ev.target.closest('button'); if (!b) return;
    pop.hidden = true;
    api('/api/cell', { empId: emp, date, value: b.dataset.v });
  };
}

// ----- Glisser-déposer par appui long (horaire et zones) -----
// Appui long (0,4 s) sur un élément, puis on le lâche sur une cible permise. Un petit déplacement avant = défilement.
// opts : { root, source(el) → élément à déplacer ou null, targets(src) → cibles permises, drop(src, target) }
// Souris : événements « pointer ». Doigt (téléphone) : événements « touch », car Android et l'iPhone coupent les
// événements « pointer » pendant un appui long (menu, défilement), ce qui annulait le glisser.
const drag = { timer: null, on: false, src: null, opts: null, ghost: null, over: null, x: 0, y: 0, touch: false, justDropped: false };
function dragEnd() {
  clearTimeout(drag.timer); drag.timer = null;
  if (drag.ghost) drag.ghost.remove();
  document.querySelectorAll('.drag-src, .drag-ok, .drag-over').forEach(x => x.classList.remove('drag-src', 'drag-ok', 'drag-over'));
  document.body.classList.remove('dragging');
  Object.assign(drag, { on: false, src: null, opts: null, ghost: null, over: null, touch: false });
}
function dragStart(opts, target, x, y, touch) {
  if (document.body.classList.contains('readonly') || drag.src) return;
  const src = opts.source(target);
  if (!src) return;
  Object.assign(drag, { src, opts, x, y, touch });
  drag.timer = setTimeout(() => {
    drag.on = true; pop.hidden = true; document.querySelector('.zmenu')?.remove();
    document.body.classList.add('dragging');
    src.classList.add('drag-src');
    opts.targets(src).forEach(el => { if (el !== src) el.classList.add('drag-ok'); });
    drag.ghost = (src.firstElementChild || src).cloneNode(true);
    drag.ghost.classList.add('drag-ghost');
    document.body.appendChild(drag.ghost);
    moveGhost(drag.x, drag.y);
    if (navigator.vibrate) try { navigator.vibrate(30); } catch {}
  }, 400);
}
function dragMove(x, y) {
  if (!drag.on) { if (Math.hypot(x - drag.x, y - drag.y) > 8) dragEnd(); return; } // c'est un défilement
  drag.x = x; drag.y = y;
  moveGhost(x, y);
  // La cible la plus précise sous le doigt (une personne dans une case de zone avant la case elle-même).
  const t = document.elementFromPoint(x, y)?.closest('.drag-ok') || null;
  if (t !== drag.over) { drag.over?.classList.remove('drag-over'); t?.classList.add('drag-over'); drag.over = t; }
}
function dragDrop() {
  const { on, src, over, opts } = drag;
  dragEnd();
  if (!on) return;
  drag.justDropped = true; setTimeout(() => { drag.justDropped = false; }, 400);
  if (over) opts.drop(src, over);
}
function longPressDrag(opts) {
  opts.root.addEventListener('pointerdown', e => {
    if (e.pointerType === 'touch' || e.button > 0) return; // le doigt passe par touchstart
    dragStart(opts, e.target, e.clientX, e.clientY, false);
  });
  opts.root.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) { if (drag.src) dragEnd(); return; }
    const t = e.touches[0];
    dragStart(opts, e.target, t.clientX, t.clientY, true);
  }, { passive: true });
}
function moveGhost(x, y) { if (drag.ghost) { drag.ghost.style.left = x + 'px'; drag.ghost.style.top = y + 'px'; } }
document.addEventListener('pointermove', e => { if (drag.src && !drag.touch) dragMove(e.clientX, e.clientY); });
document.addEventListener('pointerup', () => { if (drag.src && !drag.touch) dragDrop(); });
document.addEventListener('pointercancel', () => { if (drag.src && !drag.touch) dragEnd(); });
// Doigt : une fois le glisser lancé, la page ne défile plus (preventDefault), et on suit le doigt.
document.addEventListener('touchmove', e => {
  if (!drag.src || !drag.touch) return;
  const t = e.touches[0];
  if (drag.on) e.preventDefault();
  dragMove(t.clientX, t.clientY);
}, { passive: false });
document.addEventListener('touchend', e => { if (drag.src && drag.touch) { if (drag.on) e.preventDefault(); dragDrop(); } }, { passive: false });
document.addEventListener('touchcancel', () => { if (drag.src && drag.touch) dragEnd(); });
// Appui long sur téléphone : pas de menu du navigateur ni de sélection de texte pendant le glisser.
document.addEventListener('contextmenu', e => { if (drag.src) e.preventDefault(); });
document.addEventListener('selectstart', e => { if (drag.src) e.preventDefault(); });
// Le clic qui suit un dépôt n'ouvre pas le menu de la case.
document.addEventListener('click', e => { if (drag.justDropped) { e.stopPropagation(); e.preventDefault(); } }, true);

// Horaire : échange de deux horaires le même jour, seulement entre deux employés (ou deux étudiants) ;
// les jours suivants ne sont pas recalculés.
const swapGroup = td => td.closest('tr.student') ? 'student' : td.closest('tr.chef') ? null : 'emp';
const swappable = td => td && td.matches('#grid td.cell') && swapGroup(td) && !td.querySelector('.c-MALADIE, .c-FORMATION');
longPressDrag({
  root: $('#grid'),
  source: el => { const td = el.closest('td.cell'); return swappable(td) && td.textContent.trim() ? td : null; },
  targets: td => [...document.querySelectorAll(`#grid td.cell[data-date="${td.dataset.date}"]`)].filter(x => swapGroup(x) === swapGroup(td) && swappable(x)),
  drop: (src, over) => api('/api/swap', { date: src.dataset.date, a: src.dataset.emp, b: over.dataset.emp })
    .then(() => toast('Horaires échangés. « Annuler » pour revenir en arrière.')).catch(() => {}),
});

// ----- Matchs -----
function renderOpenings() {
  const info = data.openingsInfo;
  $('#openingsInfo').textContent = (info.lastFetch ? `Lu sur westlandshopping.be le ${new Date(info.lastFetch).toLocaleString('fr-BE')}.` : 'Pas encore lu sur le site.')
    + (info.lastError ? ` Erreur : ${info.lastError}` : '');
  const list = data.openings;
  $('#openList').innerHTML = list.length ? '<tr><th>Dimanche</th><th>Raison</th><th>Heures du centre</th><th></th></tr>' + list.map(o => `
    <tr class="${o.ignored ? 'ign' : ''}">
      <td>${fmtDate(o.date)}/${o.date.slice(0, 4)}</td><td>${esc(o.label)}</td><td>${esc(o.hours || '—')}</td>
      <td>${o.source === 'manuel' ? `<button data-odel="${o.id}">Supprimer</button>` : `<button data-oign="${o.id}" data-val="${o.ignored ? '' : '1'}">${o.ignored ? 'Réactiver' : 'Ignorer'}</button>`}</td>
    </tr>`).join('') : '<tr><td class="muted">Aucun dimanche d\'ouverture à venir.</td></tr>';
}
$('#openList').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.odel) api('/api/openings/delete', { id: b.dataset.odel });
  if (b.dataset.oign) api('/api/openings/override', { id: b.dataset.oign, ignored: !!b.dataset.val });
});
$('#addOpening').onclick = () => {
  const date = $('#oDate').value;
  if (!date) return toast('Choisis un dimanche');
  api('/api/openings/add', { date, label: $('#oLabel').value });
};

function renderMatches() {
  renderOpenings();
  const info = data.matchesInfo;
  $('#matchesInfo').textContent = (info.lastFetch ? `Dernière mise à jour : ${new Date(info.lastFetch).toLocaleString('fr-BE')}.` : 'Jamais mis à jour.')
    + (info.lastError ? ` Erreur : ${info.lastError}` : '') + ` Matchs de ${$('#monthTitle').textContent}.`;
  const list = data.allMatches;
  $('#matchList').innerHTML = list.length ? '<tr><th>Date</th><th>Adversaire</th><th>Compétition</th><th>Heure</th><th></th></tr>' + list.map(m => `
    <tr class="${m.ignored ? 'ign' : ''}">
      <td>${fmtDate(m.date)}</td><td>${esc(m.opponent)}</td>
      <td>${esc(m.competition)} ${m.confirmed === false ? '<span class="tag warn">heure à confirmer</span>' : ''}</td>
      <td><input type="time" value="${m.time}" data-id="${m.id}" class="mtime"></td>
      <td>${m.source === 'manuel' ? `<button data-del="${m.id}">Supprimer</button>` : `<button data-ign="${m.id}" data-val="${m.ignored ? '' : '1'}">${m.ignored ? 'Réactiver' : 'Ignorer'}</button>`}</td>
    </tr>`).join('') : '<tr><td class="muted">Aucun match à domicile ce mois-ci.</td></tr>';
}
$('#openMatches').onclick = () => $('#matchesDlg').showModal();
$('#refreshMatches').onclick = async e => {
  e.target.disabled = true;
  try { await api('/api/matches/refresh', {}); toast('Calendrier mis à jour'); } finally { e.target.disabled = false; }
};
$('#matchList').addEventListener('change', e => {
  if (e.target.matches('.mtime')) api('/api/matches/override', { id: e.target.dataset.id, time: e.target.value });
});
$('#matchList').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.del) api('/api/matches/delete', { id: b.dataset.del });
  if (b.dataset.ign) api('/api/matches/override', { id: b.dataset.ign, ignored: !!b.dataset.val });
});
$('#addMatch').onclick = () => {
  const date = $('#mDate').value, time = $('#mTime').value;
  if (!date || !time) return toast('Indique la date et l\'heure');
  api('/api/matches/add', { date, time, opponent: $('#mOpp').value });
};

// ----- Paramètres -----
// Disponibilités des étudiants (index 0 = dimanche), avec les mêmes valeurs par défaut que le moteur.
function studentAvailConfig() {
  const s = data.config.students || {};
  const a = s.avail || {};
  return {
    normal: a.normal || [0, 1, 2, 3, 4, 5, 6].map(d => (s.days || [3, 5, 6]).includes(d) ? (s.max ?? 3) : 0),
    match: a.match || [2, 2, 2, 2, 2, 2, 4],
    openSunday: a.openSunday ?? 3,
    dates: a.dates || {},
  };
}
function renderAvail() {
  const a = studentAvailConfig();
  const order = [1, 2, 3, 4, 5, 6, 0], lbl = ['Di', 'Lu', 'Ma', 'Me', 'Je', 'Ve', 'Sa'];
  const line = (key, title) => `<tr><td>${title}</td>${order.map(d => `<td><input type="number" min="0" max="10" data-k="${key}" data-d="${d}" value="${a[key][d]}"></td>`).join('')}</tr>`;
  $('#availTable').innerHTML = `<tr><th></th>${order.map(d => `<th>${lbl[d]}</th>`).join('')}</tr>` + line('normal', 'Jour normal') + line('match', 'Jour de match');
  $('#footTeamIn').value = (data.config.foot && data.config.foot.team) || 3;
  $('#openSunIn').value = a.openSunday;
  const dates = Object.entries(a.dates).sort();
  $('#availDates').innerHTML = dates.length ? dates.map(([d, n]) => `<li>${fmtDate(d)}/${d.slice(0, 4)} : ${n} étudiant(s) <button class="ghost" data-del="${d}" title="Supprimer">✕</button></li>`).join('') : '';
}
$('#saveAvail').onclick = async () => {
  const get = k => { const arr = Array(7).fill(0); document.querySelectorAll(`#availTable input[data-k="${k}"]`).forEach(i => { arr[+i.dataset.d] = Number(i.value) || 0; }); return arr; };
  await api('/api/config', { students: { normal: get('normal'), match: get('match'), openSunday: $('#openSunIn').value }, footTeam: $('#footTeamIn').value });
  toast('Disponibilités enregistrées');
};
$('#addAvail').onclick = () => {
  if (!$('#availDate').value || $('#availN').value === '') return toast('Indique la date et le nombre d\'étudiants');
  api('/api/config', { studentDate: { date: $('#availDate').value, n: $('#availN').value } });
};
$('#availDates').addEventListener('click', e => {
  const b = e.target.closest('button[data-del]'); if (b) api('/api/config', { studentDate: { date: b.dataset.del, n: null } });
});

function renderSettings() {
  renderAvail();
  $('#accountBtn').hidden = data.account.mode !== 'cloud';
  $('#accEmail').textContent = data.account.email || '';
  $('#accountLabel').textContent = data.account.email || 'Mon compte';
  const c = data.config;
  const ch = c.chef, days = (ch.days || [2, 3, 4, 5, 6]).map(d => DOW_SHORT[d].slice(0, 3).toLowerCase()).join(', ');
  $('#teamChefInfo').innerHTML = `<p><b>${esc(ch.name)}</b> · chef terrain · ${esc(ch.shift)} · ${days}${ch.monthlyWeek === false ? '' : ' (une semaine par mois du lundi au vendredi)'}</p>`
    + `<p>Chef de parc : <b>${c.parkChief && c.parkChief.name ? esc(c.parkChief.name) : 'non renseigné'}</b> (affiché dans l'export Excel)</p>`;
  if (document.body.dataset.page === 'team') loadTeam();
  const name = id => (c.employees.find(e => e.id === id) || {}).name || id;
  $('#refSat').value = c.rotation.refSaturday;
  $('#refGroup').innerHTML = c.rotation.groups.map((g, i) => `<option value="${i}" ${i === c.rotation.refGroup ? 'selected' : ''}>${g.map(name).join(' et ')}</option>`).join('');
  $('#chefName').textContent = c.chef.name;
  $('#chefWeek').innerHTML = data.view.chefWeekOptions.map(mo => {
    const fri = new Date(mo + 'T12:00:00'); fri.setDate(fri.getDate() + 4);
    return `<option value="${mo}" ${mo === data.view.chefWeek ? 'selected' : ''}>Du lundi ${fmtDate(mo)} au vendredi ${String(fri.getDate()).padStart(2, '0')}/${String(fri.getMonth() + 1).padStart(2, '0')}</option>`;
  }).join('');
}
$('#openSettings').onclick = () => $('#settingsDlg').showModal();
$('#saveRotation').onclick = () => api('/api/config', { rotation: { refSaturday: $('#refSat').value, refGroup: $('#refGroup').value } }).then(() => toast('Roulement enregistré'));
$('#saveChef').onclick = () => api('/api/config', { chefWeek: { month, monday: $('#chefWeek').value } }).then(() => toast('Semaine enregistrée'));
$('#unlock').onclick = () => api('/api/unlock', {}).then(() => toast('Cases déverrouillées'));
$('#clear').onclick = () => confirm('Vider le mois (les cases verrouillées sont gardées) ?') && api('/api/clear', {});

// ----- Maladie et demandes (même fenêtre, plusieurs lignes) -----
const today = () => new Date().toISOString().slice(0, 10);
const REQUEST_CHOICES = [['8-16', '8-16'], ['10-18', '10-18'], ['12-20', '12-20'], ['REPOS', 'X · Repos'], ['CONGE', 'C · Congé légal payé'], ['RTT', 'RTT'],
  ['SS', 'SS · Congé sans solde'], ['ANC', "ANC · Congé d'ancienneté"], ['PC', 'PC · Petit chômage'], ['PATERNITE', 'CP · Congé de paternité'], ['AT', 'AT · Accident de travail'],
  ['AJ', 'AJ · Absence justifiée'], ['RJ', 'RJ · Récup jour férié'], ['CS', 'CS · Congé syndical'], ['RS', 'RS · Récup syndicale'], ['FS', 'FS · Formation syndicale'], ['MS', 'MS · Mission syndicale']];
const activeEmps = () => data.config.employees.filter(e => !e.end || e.end >= today());
// Maladie / formation : aussi le chef terrain et le chef de parc (identifiant fixe « chef-parc »).
const chiefs = () => [{ id: data.config.chef.id, name: `${data.config.chef.name} (chef terrain)` },
  ...(data.config.parkChief && data.config.parkChief.name ? [{ id: 'chef-parc', name: `${data.config.parkChief.name} (chef de parc)` }] : [])];
const personName = id => (activeEmps().concat(data.config.employees, chiefs()).find(e => e.id === id) || {}).name || id;

function entriesDialog({ prefix, endpoint, withValue, describe, withChiefs }) {
  let rows = [];
  const el = id => $('#' + prefix + id);
  function render() {
    const opts = withChiefs ? [...activeEmps(), ...chiefs()] : activeEmps();
    // Formulaire vide au départ : on ajoute une ligne et on choisit l'employé (personne n'est pré-sélectionné).
    if (!rows.length) { el('Rows').innerHTML = '<p class="muted empty-rows">Aucun employé pour le moment. Clique sur le bouton ci-dessous pour en ajouter un.</p>'; return; }
    el('Rows').innerHTML = rows.map((s, i) => `
      <div class="row">
        <label>Employé <select data-i="${i}" data-k="empId"><option value="" ${s.empId ? '' : 'selected'} disabled>— Choisir —</option>${opts.map(e => `<option value="${e.id}" ${e.id === s.empId ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></label>
        ${withValue ? `<label>Quoi <select data-i="${i}" data-k="value">${REQUEST_CHOICES.map(([v, l]) => `<option value="${v}" ${v === s.value ? 'selected' : ''}>${l}</option>`).join('')}</select></label>` : ''}
        <label>Du <input type="date" data-i="${i}" data-k="from" value="${s.from}"></label>
        <label>Au <input type="date" data-i="${i}" data-k="to" value="${s.to}"></label>
        ${prefix === 'sick' && data.account.role === 'admin' ? `<label class="cert-pick">Certificat (facultatif) ${s.file ? `<span class="cert-name">📎 ${esc(s.file.name)} <button type="button" class="ghost" data-nofile="${i}" title="Retirer le certificat">✕</button></span>` : `<input type="file" accept="image/*,application/pdf" data-i="${i}" data-k="file">`}</label>` : ''}
        <button data-rm="${i}" class="ghost" title="Retirer cette ligne">✕</button>
      </div>`).join('');
  }
  const blank = from => ({ empId: '', value: '8-16', from, to: from });
  el('Open').onclick = () => {
    rows = [];
    render(); el('Result').innerHTML = ''; el('Dlg').showModal();
  };
  el('Add').onclick = () => {
    const last = rows[rows.length - 1];
    rows.push(last ? { ...last, empId: '' } : blank(today()));
    render();
  };
  el('Rows').addEventListener('change', e => {
    const { i, k } = e.target.dataset; if (i === undefined) return;
    if (k === 'file') { rows[i].file = e.target.files[0] || null; return render(); }
    rows[i][k] = e.target.value;
    if (k === 'from' && rows[i].to < rows[i].from) { rows[i].to = rows[i].from; render(); }
  });
  el('Rows').addEventListener('click', e => {
    const nf = e.target.closest('button[data-nofile]'); if (nf) { rows[Number(nf.dataset.nofile)].file = null; return render(); }
    const b = e.target.closest('button[data-rm]'); if (!b) return;
    rows.splice(Number(b.dataset.rm), 1); render();
  });
  el('Save').onclick = async e => {
    if (!rows.length) return toast('Ajoute au moins un employé');
    if (rows.some(s => !s.empId)) return toast("Choisis l'employé sur chaque ligne");
    if (rows.some(s => !s.from || !s.to)) return toast('Indique les dates');
    e.target.disabled = true; e.target.textContent = 'Calcul en cours…';
    try {
      month = rows.map(s => s.from).sort()[0].slice(0, 7);
      const r = await api(endpoint, { entries: rows.map(({ file, ...s }) => s), regenerate: el('Regen').checked });
      // Certificats choisis sur les lignes : envoyés une fois la maladie enregistrée.
      for (const s of rows.filter(s => s.file)) {
        try { await sendCertificate(s.empId, s.from, s.to, s.file); }
        catch (err) { toast(`Maladie enregistrée, mais certificat non envoyé : ${err.message}`); }
      }
      const { regenerated, changes } = r.result;
      const nameOf = personName;
      const period = s => s.from === s.to ? `le ${fmtDate(s.from)}` : `du ${fmtDate(s.from)} au ${fmtDate(s.to)}`;
      let h = `<div class="ok-box">${rows.map(s => esc(describe(nameOf(s.empId), s, period(s)))).join('<br>')}`;
      h += regenerated.length ? '<br>Horaire recalculé.' : '<br>Horaire non recalculé (mois pas encore généré ou option décochée).';
      h += '</div>';
      el('Result').innerHTML = changesHtml(h, { regenerated, changes });
    } finally { e.target.disabled = false; e.target.textContent = 'Valider'; }
  };
}
// ----- Compteur des maladies (administrateurs) : jours, absences, certificats -----
let sickOpen = null; // personne dont on voit le détail
async function sendCertificate(empId, from, to, file) {
  if (file.size > 10 * 1024 * 1024) throw new Error('fichier trop lourd (10 Mo maximum)');
  const type = file.type || (/\.pdf$/i.test(file.name) ? 'application/pdf' : '');
  const j = await invApi('/api/hr/certificate', { month, empId, from, to, name: file.name, type, data: await readB64(file) });
  data = j; render();
}
function renderSickCounter() {
  const s = data.sick, card = $('#sickCounterCard');
  card.hidden = !s; if (!s) return;
  const people = s.people;
  const tot = people.reduce((n, p) => n + p.yearDays, 0), alerts = people.filter(p => p.alert).length;
  $('#sickCounterInfo').textContent = `${tot} jour${tot > 1 ? 's' : ''} de maladie cette année${alerts ? ` · ${alerts} alerte${alerts > 1 ? 's' : ''}` : ''}`;
  const dd = d => d.split('-').reverse().slice(0, 2).join('/');
  $('#sickCounter').innerHTML = '<div class="scroll-x"><table class="list sick-count"><tr><th>Personne</th><th>Ce mois</th><th>Cette année</th><th>Absences (année)</th><th>6 derniers mois</th><th>Certificats</th><th></th></tr>'
    + people.map(p => `<tr class="${p.alert ? 'alert' : ''}" data-person="${p.id}"><td><b>${esc(p.name)}</b></td>
      <td>${p.monthDays ? p.monthDays + ' j' : '—'}</td><td>${p.yearDays ? '<b>' + p.yearDays + ' j</b>' : '—'}</td><td>${p.yearCount || '—'}</td>
      <td>${p.last6 ? p.last6 : '—'}${p.alert ? ` <span class="tag warn">⚠ ${p.last6} absences en 6 mois</span>` : ''}</td>
      <td>${!p.periods.length ? '—' : p.missing ? `<span class="tag negative">⚠ ${p.missing} manquant${p.missing > 1 ? 's' : ''}</span>` : '<span class="tag positive">✓ tous reçus</span>'}</td>
      <td>${p.periods.length ? `<button class="ghost">${sickOpen === p.id ? 'Fermer' : 'Détail'}</button>` : ''}</td></tr>`
      + (sickOpen === p.id ? `<tr class="sick-detail"><td colspan="7"><ul>${p.periods.map(a => `<li><span class="when">${a.from === a.to ? 'le ' + dd(a.from) : `du ${dd(a.from)} au ${dd(a.to)}`} · ${a.days} jour${a.days > 1 ? 's' : ''}</span>
          ${a.certs.length ? a.certs.map(c => `<span class="cert ok">📎 <a href="#" data-cert="${c.id}">${esc(c.name)}</a> <button class="ghost" data-certdel="${c.id}" title="Retirer ce certificat">✕</button></span>`).join('') : '<span class="cert missing">⚠ certificat manquant</span>'}
          <label class="btn cert-add">+ Certificat<input type="file" accept="image/*,application/pdf" hidden data-certup="${p.id}|${a.from}|${a.to}"></label></li>`).join('')}</ul></td></tr>` : '')).join('')
    + `</table></div><p class="muted small">Alerte à partir de ${s.alertAt} absences sur les 6 derniers mois. Les certificats sont rangés dans le stockage privé (administrateurs seulement).</p>`;
}
$('#sickCounter').addEventListener('click', async e => {
  const cert = e.target.closest('[data-cert]');
  if (cert) {
    e.preventDefault();
    const q = { month, id: cert.dataset.cert };
    if (!backend) { window.open('/api/hr/certificate/file?' + new URLSearchParams(q), '_blank'); return; }
    const w = window.open('', '_blank');
    const out = await backend.handle('GET', '/api/hr/certificate/file', q, {});
    if (!out.file) { if (w) w.close(); return toast((out.json && out.json.error) || 'Ouverture impossible'); }
    const url = URL.createObjectURL(new Blob([out.file], { type: out.type }));
    if (w) w.location.href = url; else saveFile(new File([out.file], out.filename, { type: out.type }));
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return;
  }
  const del = e.target.closest('[data-certdel]');
  if (del) { if (confirm('Retirer ce certificat ? Le fichier sera supprimé.')) { const j = await invApi('/api/hr/certificate/delete', { month, id: del.dataset.certdel }).catch(() => null); if (j) { data = j; render(); toast('Certificat retiré'); } } return; }
  if (e.target.closest('label, input')) return;
  const tr = e.target.closest('tr[data-person]');
  if (tr) { sickOpen = sickOpen === tr.dataset.person ? null : tr.dataset.person; renderSickCounter(); }
});
$('#sickCounter').addEventListener('change', async e => {
  const up = e.target.closest('input[data-certup]'); if (!up || !up.files.length) return;
  const [empId, from, to] = up.dataset.certup.split('|');
  try { await sendCertificate(empId, from, to, up.files[0]); toast('Certificat ajouté'); } catch (err) { toast(err.message); }
});
// Maladies / formations déjà dans l'horaire : on peut changer les dates ou les supprimer (l'horaire est recalculé).
const ABSENCE_LISTS = [{ code: 'MALADIE', prefix: 'sick', word: 'maladie' }, { code: 'FORMATION', prefix: 'form', word: 'formation' }];
let absEdit = null; // période en cours de modification : `${code}|${empId}|${from}`
function renderAbsences() {
  renderSickCounter();
  const nameOf = personName;
  for (const { code, prefix, word } of ABSENCE_LISTS) {
    const list = (data.absences || []).filter(a => a.code === code);
    const el = $('#' + prefix + 'List');
    if (!list.length) { el.innerHTML = `<p class="muted">Aucune ${word} en cours ou à venir.</p>`; continue; }
    el.innerHTML = `<div class="abs-wrap"><table class="list"><tr><th>Employé</th><th>Du</th><th>Au</th><th>État</th><th></th></tr>` + list.map(a => {
      const key = `${a.code}|${a.empId}|${a.from}`;
      const state = a.to < today() ? 'Terminée' : a.from > today() ? 'À venir' : 'En cours';
      const past = a.to < today();
      const attrs = `data-code="${a.code}" data-emp="${a.empId}" data-from="${a.from}" data-to="${a.to}"`;
      if (absEdit === key) return `<tr ${attrs}><td>${esc(nameOf(a.empId))}</td>
        <td><input type="date" class="abs-from" value="${a.from}"></td><td><input type="date" class="abs-to" value="${a.to}"></td><td>${state}</td>
        <td class="abs-actions"><button class="primary abs-save">Enregistrer</button> <button class="ghost abs-cancel">Annuler</button></td></tr>`;
      return `<tr ${attrs}><td>${esc(nameOf(a.empId))}</td><td>${fmtDate(a.from)}</td><td>${fmtDate(a.to)}</td><td>${state}</td>
        <td class="abs-actions">${past ? '' : `<button class="abs-edit">Modifier</button> <button class="ghost danger abs-del">Supprimer</button>`}</td></tr>`;
    }).join('') + '</table></div><p class="muted small">Les jours déjà passés ne sont pas modifiés. Après un changement, l\'horaire des autres est recalculé.</p>';
  }
}
for (const { prefix, word } of ABSENCE_LISTS) $('#' + prefix + 'List').addEventListener('click', async e => {
  const tr = e.target.closest('tr[data-code]'); if (!tr) return;
  const a = { code: tr.dataset.code, empId: tr.dataset.emp, from: tr.dataset.from, to: tr.dataset.to };
  const name = personName(a.empId);
  const send = async (body, msg) => {
    e.target.disabled = true;
    try {
      const r = await api('/api/absence/edit', { ...a, ...body, regenerate: true });
      absEdit = null; renderAbsences(); toast(msg);
      $('#' + prefix + 'Result').innerHTML = changesHtml(`<div class="ok-box">${esc(msg)}</div>`, r.result);
    } finally { e.target.disabled = false; }
  };
  if (e.target.closest('.abs-edit')) { absEdit = `${a.code}|${a.empId}|${a.from}`; renderAbsences(); }
  else if (e.target.closest('.abs-cancel')) { absEdit = null; renderAbsences(); }
  else if (e.target.closest('.abs-del')) {
    if (confirm(`Supprimer la ${word} de ${name} (${fmtDate(a.from)} → ${fmtDate(a.to)}) ? Son horaire sera recalculé.`))
      await send({ remove: true }, `${word[0].toUpperCase() + word.slice(1)} de ${name} supprimée.`);
  } else if (e.target.closest('.abs-save')) {
    const newFrom = tr.querySelector('.abs-from').value, newTo = tr.querySelector('.abs-to').value;
    if (!newFrom || !newTo || newTo < newFrom) return toast('Dates invalides');
    await send({ newFrom, newTo }, `${word[0].toUpperCase() + word.slice(1)} de ${name} : du ${fmtDate(newFrom)} au ${fmtDate(newTo)}.`);
  }
});
function changesHtml(head, { regenerated, changes }) {
  let h = head;
  if (changes.length) {
    h += `<h4>Changements à prévenir (${changes.length})</h4><div class="changes"><table class="list"><tr><th>Date</th><th>Qui</th><th>Avant</th><th>Après</th></tr>`
      + changes.map(c => `<tr><td>${fmtDate(c.date)}</td><td>${esc(c.name)}</td><td>${esc(c.before)}</td><td><b>${esc(c.after)}</b></td></tr>`).join('')
      + '</table></div>';
  } else if (regenerated.length) h += '<p class="muted">Aucun autre horaire ne change.</p>';
  return h;
}

entriesDialog({ prefix: 'sick', endpoint: '/api/sick', withValue: false, withChiefs: true,
  describe: (name, s, period) => `${name} est en maladie ${period}.` });
entriesDialog({ prefix: 'form', endpoint: '/api/formation', withValue: false, withChiefs: true,
  describe: (name, s, period) => `${name} est en formation ${period}.` });
entriesDialog({ prefix: 'req', endpoint: '/api/requests', withValue: true,
  describe: (name, s, period) => `${name} : ${(REQUEST_CHOICES.find(c => c[0] === s.value) || [, s.value])[1]} ${period}.` });

// ----- Zones & dispatch : tournantes d'un jour (calculées par le serveur à partir de l'horaire) -----
const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDay = (date, n) => { const d = new Date(date + 'T12:00:00'); d.setDate(d.getDate() + n); return localDay(d); };
const Z_LABEL = { Z1: 'Zone 1', Z2: 'Zone 2', Z3: 'Zone 3', D: 'Dispatch', T: 'Toutes les zones' };
const Z_PLACE = { Z1: 'Total-Delhaize', Z2: 'City-Crélan', Z3: 'Toit & sous-terrain', D: 'Bureau', T: 'Seul sur le terrain' };
const DAY_NAMES = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
let zDate = localDay(), zView = 'people', zData = null, zTab = 'now', zCounts = null;
// Onglet « Maintenant » : créneau choisi avec ‹ › (n'importe quel jour) ; null = créneau en cours (ou le premier).
let zPick = null;
try { zView = localStorage.getItem('zView') || zView; } catch {}

async function loadZones() {
  const j = await call('/api/zones', null, { month: zDate.slice(0, 7), date: zDate });
  if (j.error) return toast(j.error);
  zData = j.zones; zCounts = j.fieldCounts || null; syncZTeam(); renderZones();
}
function renderZones() {
  setZTab(zTab);
  const d = new Date(zDate + 'T12:00:00');
  $('#zTitle').textContent = `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  $('#zDate').value = zDate;
  $('#zvPeople').classList.toggle('on', zView === 'people');
  $('#zvZones').classList.toggle('on', zView === 'zones');
  if (data) renderZTeam();
  if (zTab === 'now') renderNow();
  if (zTab === 'me') renderMyDay();
  $('#zLegend').innerHTML = ['Z1', 'Z2', 'Z3', 'D', 'T'].map(z => `<span><i class="z-${z}"></i>${Z_LABEL[z]} · ${Z_PLACE[z]}</span>`).join('') + '<span>☕ Pause 30 min</span>' + (isEmpView() ? '' : '<span>🔒 Changé à la main</span>');
  const z = zData;
  if (!z || z.date !== zDate) { $('#zBox').innerHTML = '<p class="muted pad">Chargement…</p>'; return; }
  if (z.closed) { $('#zBox').innerHTML = "<p class=\"muted pad\">Westland fermé ce jour-là. Si vous travaillez quand même, ajoute les personnes dans « Équipe du jour » ci-dessus.</p>"; return; }
  if (!z.people.length) { $('#zBox').innerHTML = isEmpView() ? "<p class='muted pad'>Pas d'équipe prévue ce jour-là.</p>" : "<p class=\"muted pad\">Pas encore d'équipe pour ce jour. Ajoute les personnes et leur horaire dans « Équipe du jour » ci-dessus, puis enregistre.</p>"; return; }
  if (isPhone()) { $('#zBox').innerHTML = zonesCards(z); return; }
  const head = `<tr><th class="name">${zView === 'people' ? 'Personne' : 'Zone'}</th>${zView === 'people' ? '<th>Horaire</th>' : ''}${z.slots.map(s => `<th>${s.label}</th>`).join('')}${zView === 'people' ? '<th>Pause</th>' : ''}</tr>`;
  let body = '';
  if (zView === 'people') {
    for (const p of z.people) {
      body += `<tr><td class="name"><b>${esc(p.name)}</b></td><td class="muted">${esc((z.plan && z.plan.roleOf[p.id]) || p.shift)}</td>`;
      p.cells.forEach((c, s) => {
        const pause = p.pause && p.pause.slot === s ? `<small class="z-pause">☕ ${p.pause.start}</small>` : '';
        if (!c) { body += `<td class="zcell off">${pause}</td>`; return; }
        body += `<td class="zcell ${c.manual ? 'lock' : ''}" data-person="${p.id}" data-slot="${s}">`
          + (c.code ? `<span class="z-${c.code}"><b>${c.code === 'D' ? 'Dispatch' : c.code === 'T' ? 'Toutes zones' : c.code}</b><small>${Z_PLACE[c.code]}</small></span>` : '') + pause + '</td>';
      });
      body += `<td>${p.pause ? `${p.pause.start}-${p.pause.end}` : '<span class="muted">—</span>'}</td></tr>`;
    }
  } else {
    // Une personne seule sur le terrain : une seule case sur les 3 zones, elle choisit où aller.
    // Chaque nom peut être glissé (appui long) sur un collègue du même créneau (échange) ou dans une autre zone.
    const inZone = (code, s) => z.people.filter(p => p.cells[s] && p.cells[s].code === code);
    const who = (p, s) => `<div class="zp ${p.cells[s].manual ? 'lock' : ''}" data-person="${p.id}" data-slot="${s}"><span>${esc(p.name)}</span></div>`;
    const list = (code, s) => { const ps = inZone(code, s); return ps.length ? ps.map(p => who(p, s)).join('') : '<span class="muted">—</span>'; };
    for (const code of ['Z1', 'Z2', 'Z3', 'D'])
      body += `<tr><td class="name"><span class="zname z-${code}"><b>${Z_LABEL[code]}</b><small>${Z_PLACE[code]}</small></span></td>`
        + z.byZone.map((b, s) => {
          if (code === 'D' || !b.T.length) return `<td class="zlist" data-zone="${code}" data-slot="${s}">${list(code, s)}</td>`;
          if (code !== 'Z1') return '';
          return `<td class="zlist zalone" rowspan="3"><span class="z-T">${inZone('T', s).map(p => `<div class="zp" data-person="${p.id}" data-slot="${s}"><b>${esc(p.name)}</b></div>`).join('')}<small>Seul sur le terrain : couvre les 3 zones, il choisit où aller</small></span></td>`;
        }).join('') + '</tr>';
    body += '<tr><td class="name"><b>Pauses</b></td>' + z.slots.map((_, s) => `<td class="zlist">${z.people.filter(p => p.pause && p.pause.slot === s)
      .sort((a, b) => a.pause.start.localeCompare(b.pause.start)).map(p => `<div>☕ ${p.pause.start} ${esc(p.name)}</div>`).join('') || '<span class="muted">—</span>'}</td>`).join('') + '</tr>';
  }
  $('#zBox').innerHTML = `<table class="ztable">${head}${body}</table>`;
}
// Téléphone : des cartes au lieu du grand tableau (une par personne, ou une par créneau).
const isPhone = () => matchMedia('(max-width: 700px)').matches;
matchMedia('(max-width: 700px)').addEventListener('change', () => { if (zData) renderZones(); });
const zCode = c => `<span class="zs-code z-${c}"><b>${c === 'D' ? 'Dispatch' : c === 'T' ? 'Toutes zones' : Z_LABEL[c]}</b><small>${Z_PLACE[c]}</small></span>`;
function zonesCards(z) {
  if (zView === 'people') return '<div class="zcards">' + z.people.map(p => `
    <div class="zcard">
      <div class="zcard-head"><b>${esc(p.name)}</b><span class="muted">${esc(p.shift)}${p.pause ? ` · ☕ ${p.pause.start}-${p.pause.end}` : ''}</span></div>
      ${p.cells.map((c, s) => c ? `<div class="zslot zcell ${c.manual ? 'lock' : ''}" data-person="${p.id}" data-slot="${s}">
        <span class="zs-time">${z.slots[s].label}</span>${c.code ? zCode(c.code) : ''}</div>` : '').join('')}
    </div>`).join('') + '</div>';
  const names = list => list.length ? list.map(esc).join(', ') : '<span class="muted">—</span>';
  return '<div class="zcards">' + z.slots.map((sl, s) => {
    const b = z.byZone[s];
    const pauses = z.people.filter(p => p.pause && p.pause.slot === s).map(p => `☕ ${p.pause.start} ${esc(p.name)}`);
    const zones = b.T.length
      ? `<div class="zline">${zCode('T')}<span>${names(b.T)}</span></div>`
      : ['Z1', 'Z2', 'Z3'].map(c => `<div class="zline">${zCode(c)}<span>${names(b[c])}</span></div>`).join('');
    return `<div class="zcard"><div class="zcard-head"><b>${sl.label}</b></div>${zones}
      <div class="zline">${zCode('D')}<span>${names(b.D)}</span></div>
      ${pauses.length ? `<p class="muted small">${pauses.join(' · ')}</p>` : ''}</div>`;
  }).join('') + '</div>';
}
// Équipe du jour : modifiable avant d'enregistrer (zTeamDirty) ; sinon recopiée de ce que le serveur utilise.
const Z_SHIFTS = [['8-16', '8-16'], ['10-18', '10-18'], ['12-20', '12-20'], ['11-19', '11-19'], ['FOOT', 'Horaire foot']];
let zTeam = [], zTeamDirty = false;
function syncZTeam() {
  if (zTeamDirty || !zData) return;
  zTeam = zData.people.map(p => ({ id: p.id, name: p.name, shift: p.raw }));
}
function renderZTeam() {
  const z = zData;
  $('#zTeamSrc').textContent = !z ? '' : z.custom ? 'Enregistrée' : z.people.length ? 'Horaire du jour' : 'À faire';
  $('#zTeamSrc').className = 'chip ' + (z && z.custom ? 'z-D' : 'empty');
  $('#zTeamCount').textContent = zTeam.length ? `· ${zTeam.length} personne${zTeam.length > 1 ? 's' : ''}` : '';
  // Repliée par défaut ; ouverte s'il n'y a personne ou si une modification n'est pas enregistrée.
  if (zTeamDirty || (z && !z.people.length)) $('#zTeamCard').open = true;
  $('#zTeamUse').hidden = !(z && z.custom);
  $('#zTeamSave').classList.toggle('pulse', zTeamDirty);
  const emps = data.config.employees.filter(e => !e.end || e.end >= zDate);
  const studs = Array.from({ length: 6 }, (_, k) => `student-${k + 1}`);
  const taken = zTeam.map(t => t.id);
  if (!zTeam.length) { $('#zTeamRows').innerHTML = '<p class="muted empty-rows">Personne pour le moment. Clique sur « + Ajouter une personne ».</p>'; return; }
  $('#zTeamRows').innerHTML = zTeam.map((t, i) => {
    // id '' : pas encore choisi ; 'x-…' : renfort avec un nom libre.
    const other = t.id.startsWith('x-');
    const opt = (v, l) => `<option value="${v}" ${t.id === v ? 'selected' : ''} ${t.id !== v && taken.includes(v) ? 'disabled' : ''}>${esc(l)}</option>`;
    const shifts = Z_SHIFTS.some(s => s[0] === t.shift) ? Z_SHIFTS : [...Z_SHIFTS, [t.shift, t.shift]];
    return `<div class="row">
      <label>Personne <select data-i="${i}" data-k="who">${t.id ? '' : '<option value="" selected disabled>— Choisir —</option>'}
        <optgroup label="Employés">${emps.map(e => opt(e.id, e.name)).join('')}</optgroup>
        <optgroup label="Chef terrain">${opt(data.config.chef.id, data.config.chef.name)}</optgroup>
        <optgroup label="Étudiants">${studs.map(s => opt(s, 'Student ' + s.slice(8))).join('')}</optgroup>
        <option value="__other" ${other ? 'selected' : ''}>Autre (renfort)…</option></select></label>
      ${other ? `<label>Nom <input data-i="${i}" data-k="name" value="${esc(t.name || '')}" placeholder="Nom et prénom" maxlength="40"></label>` : ''}
      <label>Horaire <select data-i="${i}" data-k="shift">${shifts.map(([v, l]) => `<option value="${v}" ${v === t.shift ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <button data-rm="${i}" class="ghost" title="Retirer de l'équipe du jour">✕</button>
    </div>`;
  }).join('');
}
$('#zTeamRows').addEventListener('change', e => {
  const { i, k } = e.target.dataset; if (i === undefined) return;
  const t = zTeam[i];
  if (k === 'who') {
    if (e.target.value === '__other') { t.id = 'x-'; t.name = ''; }
    else {
      t.id = e.target.value; delete t.name;
      // Chef terrain : son horaire habituel par défaut.
      if (t.id === data.config.chef.id && Z_SHIFTS.some(s => s[0] === data.config.chef.shift)) t.shift = data.config.chef.shift;
    }
  } else t[k] = e.target.value;
  zTeamDirty = true; renderZTeam();
  if (k === 'who' && t.id === 'x-') document.querySelector(`#zTeamRows input[data-i="${i}"]`)?.focus();
});
$('#zTeamRows').addEventListener('input', e => { if (e.target.dataset.k === 'name') { zTeam[e.target.dataset.i].name = e.target.value; zTeamDirty = true; } });
$('#zTeamRows').addEventListener('click', e => {
  const b = e.target.closest('button[data-rm]'); if (!b) return;
  zTeam.splice(Number(b.dataset.rm), 1); zTeamDirty = true; renderZTeam();
});
$('#zTeamAdd').onclick = () => { zTeam.push({ id: '', shift: '12-20' }); zTeamDirty = true; renderZTeam(); };
$('#zTeamSave').onclick = async () => {
  if (zTeam.some(t => !t.id)) return toast('Choisis la personne sur chaque ligne');
  if (zTeam.some(t => t.id.startsWith('x-') && !(t.name || '').trim())) return toast('Indique le nom de chaque renfort');
  const team = zTeam.map(t => t.id.startsWith('x-') ? { id: t.id === 'x-' ? '' : t.id, name: t.name.trim(), shift: t.shift } : { id: t.id, shift: t.shift });
  const j = await api('/api/zones/team', { date: zDate, team });
  zTeamDirty = false; zData = j.zones; syncZTeam(); renderZones(); toast('Équipe du jour enregistrée');
};
$('#zTeamUse').onclick = async () => {
  if (!confirm("Effacer l'équipe enregistrée et reprendre l'horaire du jour de l'outil ?")) return;
  const j = await api('/api/zones/team', { date: zDate, team: null });
  zTeamDirty = false; zData = j.zones; syncZTeam(); renderZones(); toast("Horaire du jour repris");
};
// Reprend les personnes et les horaires de la veille (à enregistrer ensuite, après d'éventuels changements).
$('#zTeamCopy').onclick = async () => {
  const prev = addDay(zDate, -1);
  const j = await call('/api/zones', null, { month: prev.slice(0, 7), date: prev });
  if (j.error) return toast(j.error);
  if (!j.zones.people.length) return toast("Personne au travail la veille");
  if (zTeam.length && !confirm("Remplacer l'équipe actuelle par celle de la veille ?")) return;
  zTeam = j.zones.people.map(p => ({ id: p.id, name: p.name, shift: p.raw }));
  zTeamDirty = true; renderZTeam(); toast("Équipe de la veille copiée : vérifie puis enregistre");
};

async function zonesCell(body) {
  const j = await api('/api/zones/cell', { date: zDate, ...body });
  zData = j.zones; renderZones();
}
function zGo(date) {
  if (!date) return;
  if (zTeamDirty && !confirm("L'équipe du jour n'est pas enregistrée. Changer de jour quand même ?")) return renderZones();
  zTeamDirty = false; zTeam = []; zDate = date; zData = null; renderZones(); loadZones();
}
$('#zonesOpen').onclick = () => { go('zones'); if (zDate === localDay()) zTab = 'now'; renderZones(); loadZones(); };
$('#zPrev').onclick = () => zGo(addDay(zDate, -1));
$('#zNext').onclick = () => zGo(addDay(zDate, 1));
$('#zToday').onclick = () => { zTab = 'now'; zGo(localDay()); };
$('#zDate').onchange = e => zGo(e.target.value);
$('#zvPeople').onclick = () => { zView = 'people'; try { localStorage.setItem('zView', zView); } catch {} renderZones(); };
$('#zvZones').onclick = () => { zView = 'zones'; try { localStorage.setItem('zView', zView); } catch {} renderZones(); };
$('#zExport').onclick = () => downloadXlsx('/api/export-zones.xlsx', { month: zDate.slice(0, 7), date: zDate });
$('#zReset').onclick = async () => {
  if (!confirm('Enlever tous les changements faits à la main ce jour-là et tout recalculer ?')) return;
  const j = await api('/api/zones/reset', { date: zDate });
  zData = j.zones; renderZones(); toast('Zones remises en automatique');
};
// Clic sur une case : petit menu pour choisir la zone (ou revenir en automatique).
$('#zBox').addEventListener('click', e => {
  const td = e.target.closest('.zcell[data-person], .zp[data-person]');
  if (!td || document.body.classList.contains('readonly')) return;
  document.querySelector('.zmenu')?.remove();
  const m = document.createElement('div');
  m.className = 'zmenu';
  m.innerHTML = ['Z1', 'Z2', 'Z3', 'D', 'T'].map(z => `<button data-z="${z}"><i class="z-${z}"></i>${Z_LABEL[z]} <small>${Z_PLACE[z]}</small></button>`).join('')
    + '<button data-z="">↺ Automatique</button>';
  const r = td.getBoundingClientRect();
  m.style.left = Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - 230) + 'px';
  m.style.top = (r.bottom + window.scrollY + 4) + 'px';
  document.body.appendChild(m);
  m.onclick = ev => {
    const b = ev.target.closest('button'); if (!b) return;
    m.remove();
    zonesCell({ personId: td.dataset.person, slot: Number(td.dataset.slot), code: b.dataset.z || null });
  };
  setTimeout(() => document.addEventListener('click', function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('click', off); } }), 0);
});

// Glisser-déposer dans les zones (appui long), dans le même créneau :
// sur un collègue = les deux échangent leur place ; sur une zone (vue « Par zone ») = la personne y va.
longPressDrag({
  root: $('#zBox'),
  source: el => el.closest('.zcell[data-person], .zp[data-person]'),
  targets: src => [...document.querySelectorAll(`#zBox [data-person][data-slot="${src.dataset.slot}"], #zBox td.zlist[data-zone][data-slot="${src.dataset.slot}"]`)]
    .filter(x => x.dataset.person !== src.dataset.person && !(x.dataset.zone && x.contains(src))),
  drop: async (src, over) => {
    const body = { date: zDate, slot: Number(src.dataset.slot), a: src.dataset.person };
    if (over.dataset.person) body.b = over.dataset.person; else body.zone = over.dataset.zone;
    const j = await api('/api/zones/swap', body).catch(() => null);
    if (j) { zData = j.zones; renderZones(); toast(body.b ? 'Places échangées.' : 'Personne déplacée.'); }
  },
});

// ----- Zones : onglet « Maintenant » (le créneau en cours, sur le terrain) -----
// Heure du téléphone / du PC (en Belgique) : créneau en cours, rotation, pauses, zones vides.
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const toMin = s => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const isAdmin = () => data && data.account && data.account.role === 'admin';
const canRemark = id => isAdmin() && data.config.employees.some(e => e.id === id);
function setZTab(t) {
  if (t === 'team' && document.body.classList.contains('employee')) t = 'now'; // pas d'onglet « Équipe » pour un employé
  zTab = t;
  for (const [k, pane] of [['now', '#zNowPane'], ['day', '#zDayPane'], ['team', '#zTeamPane'], ['me', '#zMePane']]) {
    $(pane).hidden = k !== t;
    document.querySelector(`.ztabs [data-ztab="${k}"]`).classList.toggle('on', k === t);
  }
}
document.querySelector('.ztabs').addEventListener('click', e => {
  const b = e.target.closest('[data-ztab]'); if (!b) return;
  setZTab(b.dataset.ztab); renderZones();
});

// « Ma journée » : la journée d'une seule personne. Un employé ne voit que lui ; le chef choisit la personne.
let zMeWho = (() => { try { return localStorage.getItem('zMeWho') || ''; } catch { return ''; } })();
function renderMyDay() {
  const z = zData, box = $('#zMe');
  if (!z || z.date !== zDate) { box.innerHTML = '<p class="muted pad">Chargement…</p>'; return; }
  const emp = document.body.classList.contains('employee');
  const myId = emp ? data.me.id : (z.people.some(p => p.id === zMeWho) ? zMeWho : (data && data.config && data.config.chef.id));
  const p = z.people.find(x => x.id === myId);
  const pick = emp ? '' : `<div class="row zme-pick"><label>Personne <select id="zMeSel">${z.people.map(x => `<option value="${x.id}" ${x.id === myId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}${p ? '' : '<option selected>—</option>'}</select></label></div>`;
  if (z.closed) { box.innerHTML = pick + '<div class="card hrx-empty"><span>🔒</span><p>Westland fermé ce jour-là</p></div>'; return; }
  if (!p) { box.innerHTML = pick + `<div class="card hrx-empty"><span>🙂</span><p>${emp ? 'Tu ne travailles pas ce jour-là' : 'Personne choisie absente ce jour-là'}</p></div>`; return; }
  const today = zDate === localDay(), m = nowMin();
  const zc = code => code === 'D' ? 'zD' : code === 'T' ? 'zT' : 'z' + String(code).slice(1);
  const name = code => (Z_LABEL[code] || code) + (Z_PLACE[code] ? ' · ' + Z_PLACE[code] : '');
  const rows = z.slots.map((s, i) => {
    const c = p.cells[i]; if (!c || !c.code) return '';
    const cls = today && m >= s.start * 60 && m < s.end * 60 ? 'now' : today && m >= s.end * 60 ? 'past' : '';
    return `<li class="${cls}"><span class="t">${s.start}h – ${s.end}h</span><span class="zn ${zc(c.code)}">${esc(name(c.code))}</span>${p.pause && p.pause.slot === i ? `<span class="tag">☕ Pause ${esc(p.pause.start)} – ${esc(p.pause.end)}</span>` : ''}</li>`;
  }).join('');
  const count = code => p.cells.filter(c => c && c.code === code).length;
  const sum = ['Z1', 'Z2', 'Z3', 'D', 'T'].filter(k => count(k)).map(k => `<span class="zn ${zc(k)}">${Z_LABEL[k]} : ${count(k)} h</span>`).join('');
  box.innerHTML = `${pick}<div class="card zme">
      <div class="zme-head"><i class="hrx-av ${hrAv(p.id)}">${esc(initials(p.name))}</i>
        <div><h3>${esc(p.name)}</h3><p class="muted">${esc($('#zTitle').textContent)} · ${esc(p.raw || p.shift || '')}${p.arrive ? ` · arrive à ${esc(p.arrive)}` : ''}${p.pause ? ` · pause ${esc(p.pause.start)} – ${esc(p.pause.end)}` : ''}</p></div></div>
      ${sum ? `<div class="zme-sum">${sum}</div>` : ''}
      <ol class="me-path">${rows}</ol></div>`;
}
$('#zMe').addEventListener('change', e => {
  if (e.target.id !== 'zMeSel') return;
  zMeWho = e.target.value; try { localStorage.setItem('zMeWho', zMeWho); } catch {}
  renderMyDay();
});

function renderNow() {
  const z = zData, box = $('#zNow');
  if (!z || z.date !== zDate) { box.innerHTML = '<p class="muted pad">Chargement…</p>'; return; }
  const today = zDate === localDay();
  const absents = (z.absent || []).map(a => `<span class="znow-chip">🚫 ${esc(a.name)} absent <button class="link" data-clear="${a.id}">annuler</button></span>`);
  const lates = z.people.filter(p => p.arrive).map(p => `<span class="znow-chip">⏰ ${esc(p.name)} arrive à ${p.arrive} <button class="link" data-clear="${p.id}">annuler</button></span>`);
  const tools = `<div class="znow-tools">
      <button class="primary" id="znEvent">⚠️ Imprévu (absent, retard)</button>
      ${isAdmin() ? '<button id="znRemark">✍️ Faire une remarque</button>' : ''}
      <button id="znMsg">💬 Message du jour</button>
    </div>${absents.length || lates.length ? `<div class="znow-events">${[...absents, ...lates].join('')}</div>` : ''}`;
  if (z.closed || !z.people.length) {
    box.innerHTML = `<div class="card"><p class="muted">${z.closed ? 'Westland fermé ce jour-là.' : isEmpView() ? "Pas d'équipe prévue ce jour-là." : "Personne dans l'équipe de ce jour."}${isEmpView() ? '' : " Regarde l'onglet « Équipe » pour ajouter du monde."}</p></div>` + (z.people.length || (z.absent || []).length ? tools : '');
    return;
  }
  // Créneau affiché : celui en cours aujourd'hui ; avant l'ouverture le premier ; un autre jour, le premier aussi.
  const m = nowMin(), slots = z.slots;
  let k = today ? slots.findIndex(s => m >= s.start * 60 && m < s.end * 60) : 0;
  const before = today && m < slots[0].start * 60, after = today && m >= slots[slots.length - 1].end * 60;
  if (k < 0) k = after ? slots.length - 1 : 0;
  const picked = zPick && zPick.date === zDate && zPick.k < slots.length ? zPick.k : null;
  if (picked !== null) k = picked;
  const sl = slots[k], end = sl.end * 60;
  // Flèches pour voir les autres créneaux de la journée (aujourd'hui comme un autre jour).
  const slotNav = `<span class="zslot-nav"><button class="icon-btn" data-zk="-1" ${k ? '' : 'disabled'} aria-label="Créneau précédent">‹</button><b>${sl.label}</b><button class="icon-btn" data-zk="1" ${k < slots.length - 1 ? '' : 'disabled'} aria-label="Créneau suivant">›</button>${picked !== null && today ? '<button class="ghost" data-zk="0">Maintenant</button>' : ''}</span>`;
  let head;
  if (!today || picked !== null) head = `${today ? '' : `<b>${esc($('#zTitle').textContent)}</b> · `}Créneau ${slotNav}`;
  else if (before) head = `Pas encore commencé · premier créneau <b>${sl.label}</b> dans <b>${fmtDelay(slots[0].start * 60 - m)}</b>`;
  else if (after) head = 'Journée terminée · dernier créneau affiché.';
  else head = `Créneau <b>${sl.label}</b> · ${k < slots.length - 1 ? 'rotation' : 'fermeture'} dans <b class="${end - m <= 10 ? 'soon' : ''}">${fmtDelay(end - m)}</b>`;
  if (today && picked === null) head += ` ${slotNav.replace(`<b>${sl.label}</b>`, '')}`;

  const inSlot = code => z.people.filter(p => p.cells[k] && p.cells[k].code === code);
  const fieldCount = z.people.filter(p => p.cells[k] && p.cells[k].code && p.cells[k].code !== 'D').length;
  const onPause = p => today && !before && !after && p.pause && m >= toMin(p.pause.start) && m < toMin(p.pause.end);
  const person = p => {
    const pause = onPause(p);
    const role = z.plan && z.plan.roleOf[p.id];
    return `<button class="znow-person ${pause ? 'pause' : ''}" data-person="${p.id}">${esc(p.name)}${role ? ` <i class="znow-role">${esc(role)}</i>` : ''}${pause ? ` <small>☕ pause jusqu'à ${p.pause.end}</small>` : ''}</button>`;
  };
  const card = (code, people) => {
    const there = people.filter(p => !onPause(p));
    // Zone vide parce qu'il n'y a pas assez de monde dans ce créneau : en orange ; sinon (absent, pause) : en rouge.
    const short = !people.length && code !== 'D' && fieldCount < 3;
    const state = short ? 'short' : !people.length ? 'empty' : !there.length ? 'pauseonly' : '';
    const warn = short ? '<p class="znow-warn">Pas assez de monde : zone pas couverte</p>' : !people.length ? '<p class="znow-warn">⚠️ Personne dans cette zone</p>' : !there.length ? '<p class="znow-warn">⚠️ Zone vide pendant la pause</p>' : '';
    return `<div class="znow-card z-${code} ${state}"><div class="znow-zone"><b>${Z_LABEL[code]}</b><small>${Z_PLACE[code]}</small></div>
      <div class="znow-people">${people.map(person).join('')}</div>${warn}</div>`;
  };
  const alone = inSlot('T');
  const cards = (alone.length ? [card('T', alone)] : ['Z1', 'Z2', 'Z3'].map(c => card(c, inSlot(c)))).concat(card('D', inSlot('D'))).join('');

  // Prochain créneau : qui change de place, qui arrive, qui part.
  let next = '';
  if (k < slots.length - 1) {
    const n = k + 1, place = c => c ? (c.code === 'D' ? 'Dispatch' : c.code === 'T' ? 'Toutes zones' : Z_LABEL[c.code]) : null;
    const rows = z.people.map(p => {
      const a = place(p.cells[k]), b = place(p.cells[n]);
      if (!a && !b) return '';
      if (a && !b) return `<li><b>${esc(p.name)}</b> : termine</li>`;
      if (!a && b) return `<li><b>${esc(p.name)}</b> : arrive → <b>${b}</b></li>`;
      return a === b ? `<li class="muted">${esc(p.name)} : reste ${a}</li>` : `<li><b>${esc(p.name)}</b> : ${a} → <b>${b}</b></li>`;
    }).filter(Boolean);
    next = `<div class="card znow-next"><h3>À ${slots[n].start}h (${slots[n].label})</h3><ul>${rows.join('')}</ul></div>`;
  }
  // Pauses : en cours, puis les suivantes de la journée.
  const pauses = z.people.filter(p => p.pause).sort((a, b) => a.pause.start.localeCompare(b.pause.start));
  const pNow = pauses.filter(onPause), pNext = pauses.filter(p => !today || toMin(p.pause.start) > m);
  const pauseCard = `<div class="card znow-pauses"><h3>☕ Pauses</h3>
    ${pNow.length ? `<p><b>En pause :</b> ${pNow.map(p => `${esc(p.name)} jusqu'à ${p.pause.end}`).join(', ')}</p>` : ''}
    ${pNext.length ? `<p><b>${today ? 'Ensuite' : 'Pauses du jour'} :</b> ${pNext.map(p => `${p.pause.start} ${esc(p.name)}`).join(' · ')}</p>` : (pNow.length ? '' : '<p class="muted">Plus de pause aujourd\'hui.</p>')}
  </div>`;
  const sheetInfo = isEmpView() ? '' : z.plan ? `<p class="znow-plan">📋 Feuille <b>« ${esc(z.plan.title)} »</b> de l'horaire fixe</p>` : '<p class="znow-plan muted">Pas de feuille de l\'horaire fixe pour cette équipe : tournantes calculées pour le jour.</p>';
  box.innerHTML = `<div class="znow-head">${head}</div>${sheetInfo}${tools}<div class="znow-grid ${alone.length ? 'alone' : ''}">${cards}</div>
    <div class="znow-side">${next}${pauseCard}</div>
    ${isAdmin() ? '<p class="muted small">Touche un nom pour faire une remarque.</p>' : ''}`;
}
const fmtDelay = n => n >= 60 ? `${Math.floor(n / 60)} h ${String(n % 60).padStart(2, '0')}` : `${n} min`;
// Mise à jour de l'heure toutes les 20 secondes quand l'onglet « Maintenant » est ouvert.
setInterval(() => { if (document.body.dataset.page === 'zones' && zTab === 'now' && zData && !$('#zSheet').open) renderNow(); }, 20000);

$('#zNow').addEventListener('click', e => {
  const zk = e.target.closest('[data-zk]');
  if (zk && zData) {
    const d = Number(zk.dataset.zk);
    if (!d) zPick = null;
    else {
      const m = nowMin(), slots = zData.slots, today = zDate === localDay();
      let k = zPick && zPick.date === zDate ? zPick.k : today ? slots.findIndex(s => m >= s.start * 60 && m < s.end * 60) : 0;
      if (k < 0) k = today && m >= slots[slots.length - 1].end * 60 ? slots.length - 1 : 0;
      zPick = { date: zDate, k: Math.max(0, Math.min(slots.length - 1, k + d)) };
    }
    return renderNow();
  }
  const c = e.target.closest('[data-clear]');
  if (c) return clearEvent(c.dataset.clear);
  if (e.target.closest('#znEvent')) return openEventSheet();
  if (e.target.closest('#znRemark')) return openRemarkSheet(null);
  if (e.target.closest('#znMsg')) return shareDayMessage();
  const p = e.target.closest('.znow-person');
  if (p) openRemarkSheet(p.dataset.person);
});
async function clearEvent(id) {
  const name = (zData.absent || []).concat(zData.people).find(p => p.id === id)?.name || id;
  if (!confirm(`Annuler l'imprévu de ${name} ? Les créneaux pas encore passés seront recalculés.`)) return;
  const j = await api('/api/zones/event', { date: zDate, personId: id, kind: 'clear' }).catch(() => null);
  if (j) { zData = j.zones; zCounts = j.fieldCounts; renderZones(); toast('Imprévu annulé'); }
}

// ----- Message du jour : qui suit quelle ligne de la feuille (ou la journée de chacun), à envoyer au groupe -----
function dayMessage() {
  const z = zData, d = new Date(zDate + 'T12:00:00');
  const place = c => c.code === 'D' ? 'Dispatch' : c.code === 'T' ? 'Toutes zones' : Z_LABEL[c.code];
  const lines = [`📍 Zones & dispatch · ${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].toLowerCase()}`];
  if (z.plan) {
    lines.push(`Feuille : « ${z.plan.title} » (horaire fixe)`, '');
    const order = Object.entries(z.plan.roleOf).sort((a, b) => a[1].localeCompare(b[1], 'fr', { numeric: true }));
    for (const [id, role] of order) {
      const p = z.people.find(x => x.id === id);
      if (p) lines.push(`• ${role} : ${p.name}${p.arrive ? ` (arrive à ${p.arrive})` : ''}`);
    }
  } else {
    lines.push('');
    for (const p of z.people) {
      const route = p.cells.map((c, s) => c && c.code ? `${z.slots[s].start}h ${place(c)}` : null).filter(Boolean).join(' · ');
      if (route) lines.push(`• ${p.name} (${p.shift}) : ${route}`);
    }
  }
  const pauses = z.people.filter(p => p.pause).sort((a, b) => a.pause.start.localeCompare(b.pause.start));
  if (pauses.length) lines.push('', '☕ Pauses : ' + pauses.map(p => `${p.pause.start} ${p.name}`).join(' · '));
  if ((z.absent || []).length) lines.push('', '🚫 Absent : ' + z.absent.map(p => p.name).join(', '));
  // Changements par rapport à la feuille (cases changées à la main, retards) : à suivre en priorité.
  const changed = z.plan ? z.people.filter(p => p.cells.some(c => c && c.manual)) : [];
  if (changed.length) lines.push('', '⚠️ Changé aujourd\'hui : ' + changed.map(p => p.name + ' (' + p.cells.map((c, s) => c && c.manual ? `${z.slots[s].start}h ${place(c)}` : null).filter(Boolean).join(', ') + ')').join(' · '));
  return lines.join('\n');
}
async function shareDayMessage() {
  if (!zData || !zData.people.length) return toast("Pas d'équipe ce jour-là");
  const text = dayMessage();
  if (navigator.share && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(text); toast('Message copié : colle-le dans le groupe WhatsApp'); }
  catch { prompt('Copie ce message :', text); }
}

// ----- Remarque terrain : motif en 2 touches, texte libre (ou dicté), « dit oralement », récidive -----
const sheet = $('#zSheet');
let remark = null; // { personId, motif, colleague, text, told, time, slot }
function currentSlot() {
  if (zDate !== localDay()) return null;
  const m = nowMin(), k = zData.slots.findIndex(s => m >= s.start * 60 && m < s.end * 60);
  return k < 0 ? null : k;
}
function openRemarkSheet(personId, motif = null, time = null) {
  if (!isAdmin()) return toast('Les remarques sont réservées aux administrateurs.');
  if (personId && !canRemark(personId)) return toast('Remarque possible seulement pour un employé (pas un étudiant ni un renfort).');
  remark = { personId, motif, colleague: '', text: '', told: false, time: time || hhmm(nowMin()), slot: currentSlot() };
  renderRemark(); sheet.showModal();
}
function renderRemark() {
  const r = remark, z = zData;
  const emps = z.people.filter(p => canRemark(p.id));
  const p = z.people.find(x => x.id === r.personId);
  const cnt = r.personId && zCounts ? zCounts[r.personId] : null;
  const cell = p && r.slot !== null ? p.cells[r.slot] : null;
  const motifs = [['zone', 'Pas à sa place / mauvaise zone'], ['talk', "Dans la zone d'un collègue à discuter (pas visible des clients)"], ['late', 'Retard']];
  const others = z.people.filter(x => x.id !== r.personId && (r.slot === null || x.cells[r.slot]));
  $('#zSheetBody').innerHTML = `
    <div class="dlg-head"><h3>✍️ Remarque terrain</h3><button class="ghost" data-close>✕</button></div>
    <label class="zs-field">Personne <select data-r="personId"><option value="">— Choisir —</option>${emps.map(e => `<option value="${e.id}" ${e.id === r.personId ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select></label>
    ${p ? `<p class="muted small">${cell && cell.code ? `Prévu maintenant : <b>${cell.code === 'D' ? 'Dispatch' : Z_LABEL[cell.code]}</b> (${z.slots[r.slot].label})` : 'Pas dans un créneau en ce moment.'}</p>` : ''}
    ${cnt && (cnt.week || cnt.month) ? `<p class="zs-recid">🔁 Déjà <b>${cnt.week}</b> fois cette semaine, <b>${cnt.month}</b> fois ce mois-ci</p>` : ''}
    <div class="zs-motifs">${motifs.map(([v, l]) => `<button type="button" data-motif="${v}" class="${r.motif === v ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${r.motif === 'talk' ? `<label class="zs-field">Avec qui ? <select data-r="colleague"><option value="">— Un collègue —</option>${others.map(o => `<option value="${o.id}" ${o.id === r.colleague ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select></label>
      <p class="muted small">La remarque ne concerne que la personne qui a quitté sa zone.</p>` : ''}
    ${r.motif === 'late' ? `<label class="zs-field">Arrivé à <input type="time" data-r="time" value="${r.time}"></label>` : ''}
    <label class="zs-field">Détail (facultatif) <textarea data-r="text" rows="3" placeholder="Ce que tu as vu…">${esc(r.text)}</textarea></label>
    <div class="row"><button type="button" class="mic" id="zsMic">${zDict ? '■ Arrêter' : '🎤 Dicter'}</button>
      <label class="check"><input type="checkbox" data-r="told" ${r.told ? 'checked' : ''}> Dit oralement à la personne</label></div>
    <div class="row zs-actions"><button class="primary" id="zsSave" ${r.personId && r.motif ? '' : 'disabled'}>Enregistrer la remarque</button><button class="ghost" data-close>Annuler</button></div>
    <p class="muted small">Elle va dans la RH de la personne et dans le Reporting du jour. Seuls les administrateurs la voient.</p>`;
}
// Dictée pour le détail de la remarque.
let zDict = null;
function zDictate() {
  if (zDict) { try { zDict.stop(); } catch {} return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('Dictée pas disponible ici : utilise le micro 🎤 du clavier du téléphone.');
  const rec = new SR(); rec.lang = 'fr-BE'; rec.continuous = true; rec.interimResults = true;
  const before = remark.text.trim(); let done = '';
  rec.onresult = e2 => {
    let live = '';
    for (let i = e2.resultIndex; i < e2.results.length; i++) { if (e2.results[i].isFinal) done += e2.results[i][0].transcript + ' '; else live += e2.results[i][0].transcript; }
    remark.text = [before, (done + live).replace(/\s+/g, ' ').trim()].filter(Boolean).join(' ');
    const ta = document.querySelector('#zSheetBody textarea[data-r="text"]'); if (ta) ta.value = remark.text;
  };
  rec.onerror = e2 => { if (e2.error === 'not-allowed') toast('Autorise le micro pour dicter, ou utilise le micro 🎤 du clavier.'); };
  rec.onend = () => { zDict = null; const b = $('#zsMic'); if (b) b.textContent = '🎤 Dicter'; };
  zDict = rec;
  try { rec.start(); $('#zsMic').textContent = '■ Arrêter'; } catch { zDict = null; }
}
sheet.addEventListener('close', () => { if (zDict) try { zDict.stop(); } catch {} remark = null; zEv = null; });
$('#zSheetBody').addEventListener('input', e => {
  const k = e.target.dataset.r;
  if (remark && k === 'text') remark.text = e.target.value;
  if (zEv && e.target.dataset.e === 'time') zEv.time = e.target.value;
});
$('#zSheetBody').addEventListener('change', e => {
  const k = e.target.dataset.r;
  if (remark && k) {
    remark[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (k === 'personId') renderRemark();
  }
  const ke = e.target.dataset.e;
  if (zEv && ke) { zEv[ke] = e.target.value; zEv.preview = null; renderEvent(); }
});
$('#zSheetBody').addEventListener('click', async e => {
  if (e.target.closest('[data-close]')) return sheet.close();
  if (remark) {
    const mo = e.target.closest('[data-motif]');
    if (mo) { remark.motif = mo.dataset.motif; return renderRemark(); }
    if (e.target.closest('#zsMic')) return zDictate();
    if (e.target.closest('#zsSave')) {
      const r = remark;
      if (r.motif === 'talk' && !r.colleague && !confirm('Aucun collègue choisi. Enregistrer quand même ?')) return;
      const j = await api('/api/hr/field', { date: zDate, personId: r.personId, motif: r.motif, colleague: r.colleague, text: r.text, told: r.told, time: r.time, slot: r.slot }).catch(() => null);
      if (j) { zData = j.zones; zCounts = j.fieldCounts; sheet.close(); renderZones(); toast('Remarque enregistrée (RH et Reporting du jour)'); }
    }
    return;
  }
  if (zEv) {
    const k = e.target.closest('[data-kind]');
    if (k) { zEv.kind = k.dataset.kind; zEv.preview = null; return renderEvent(); }
    if (e.target.closest('#zeSee')) return previewEvent();
    if (e.target.closest('#zeApply')) return applyEvent();
  }
});

// ----- Imprévu : absent ou arrive en retard → avant / après, puis on valide -----
let zEv = null; // { personId, kind, time, preview }
function openEventSheet() {
  zEv = { personId: '', kind: 'absent', time: hhmm(nowMin()), preview: null };
  renderEvent(); sheet.showModal();
}
function eventDiff(before, after) {
  const today = zDate === localDay(), m = nowMin(), out = [];
  const place = c => c && c.code ? (c.code === 'D' ? 'Dispatch' : c.code === 'T' ? 'Toutes zones' : Z_LABEL[c.code]) : '—';
  before.slots.forEach((s, k) => {
    if (today && s.end * 60 <= m) return; // créneau déjà passé : il ne bouge pas
    const lines = [];
    for (const p of before.people) {
      const q = after.people.find(x => x.id === p.id);
      const a = place(p.cells[k]), b = place(q ? q.cells[k] : null);
      if (a !== b) lines.push(`${esc(p.name)} : ${a} → <b>${b}</b>`);
    }
    for (const q of after.people) if (!before.people.some(p => p.id === q.id) && q.cells[k]) lines.push(`${esc(q.name)} : — → <b>${place(q.cells[k])}</b>`);
    const empty = ['Z1', 'Z2', 'Z3'].filter(c => !after.people.some(q => q.cells[k] && (q.cells[k].code === c || q.cells[k].code === 'T')));
    if (lines.length || empty.length) out.push(`<li><b>${s.label}</b>${lines.length ? ' · ' + lines.join(' · ') : ''}${empty.length ? ` <span class="znow-warn-inline">⚠️ ${empty.map(c => Z_LABEL[c]).join(', ')} sans personne</span>` : ''}</li>`);
  });
  return out.length ? `<ul class="ze-diff">${out.join('')}</ul>` : '<p class="muted">Aucun changement dans les créneaux à venir.</p>';
}
function renderEvent() {
  const z = zData, e = zEv;
  const team = z.people.filter(p => !p.arrive);
  $('#zSheetBody').innerHTML = `
    <div class="dlg-head"><h3>⚠️ Imprévu</h3><button class="ghost" data-close>✕</button></div>
    <label class="zs-field">Qui ? <select data-e="personId"><option value="">— Choisir —</option>${team.map(p => `<option value="${p.id}" ${p.id === e.personId ? 'selected' : ''}>${esc(p.name)} (${esc(p.shift)})</option>`).join('')}</select></label>
    <div class="zs-motifs two"><button type="button" data-kind="absent" class="${e.kind === 'absent' ? 'on' : ''}">🚫 Absent / pas venu</button><button type="button" data-kind="late" class="${e.kind === 'late' ? 'on' : ''}">⏰ Arrive en retard</button></div>
    ${e.kind === 'late' ? `<label class="zs-field">Arrive (ou est arrivé) à <input type="time" data-e="time" value="${e.time}"></label>` : ''}
    ${e.preview ? `<h4>Ce qui change</h4>${e.preview}<p class="muted small">Les créneaux déjà passés ne bougent pas.</p>` : ''}
    <div class="row zs-actions">${e.preview
      ? '<button class="primary" id="zeApply">Valider le changement</button>'
      : `<button class="primary" id="zeSee" ${e.personId ? '' : 'disabled'}>Voir ce qui change</button>`}<button class="ghost" data-close>Annuler</button></div>`;
}
async function previewEvent() {
  const j = await call('/api/zones/event/preview', { month: zDate.slice(0, 7), date: zDate, personId: zEv.personId, kind: zEv.kind, time: zEv.time });
  if (j.error) return toast(j.error);
  zEv.preview = eventDiff(j.before, j.after); renderEvent();
}
async function applyEvent() {
  const e = zEv;
  const j = await api('/api/zones/event', { date: zDate, personId: e.personId, kind: e.kind, time: e.time }).catch(() => null);
  if (!j) return;
  zData = j.zones; zCounts = j.fieldCounts; sheet.close(); renderZones();
  toast(e.kind === 'absent' ? 'Absent enregistré : tournantes mises à jour' : 'Retard enregistré : tournantes mises à jour');
  // Retard d'un employé : proposer la remarque « Retard » (avec l'heure d'arrivée).
  if (e.kind === 'late' && canRemark(e.personId) && confirm('Faire aussi une remarque « Retard » (RH et Reporting) ?')) openRemarkSheet(e.personId, 'late', e.time);
}

// ----- Horaire fixe : un tableau par type de journée, par horaire (8-16, 10-18, 12-20 A…), à imprimer -----
let fxType = 'jour4', fxData = null;
try { fxType = localStorage.getItem('fxType') || fxType; } catch {}
async function loadFixed() {
  const j = await call('/api/fixed', null, { month });
  if (j.error) return toast(j.error);
  fxData = j.fixed; renderFixed();
}
function renderFixed() {
  if (!fxData) { $('#fxBox').innerHTML = '<p class="muted pad">Chargement…</p>'; return; }
  const z = fxData.find(p => p.id === fxType) || fxData[0];
  fxType = z.id;
  $('#fxTypes').innerHTML = fxData.map(p => `<button role="tab" data-fx="${p.id}" class="${p.id === z.id ? 'on' : ''}">${p.custom ? '✏️ ' : ''}${esc(p.title.split(' (')[0])}</button>`).join('');
  $('#fxCustomBar').hidden = !z.custom || !!fxForm;
  renderFxForm();
  $('#fxLegend').innerHTML = ['Z1', 'Z2', 'Z3', 'D', 'T'].map(c => `<span><i class="z-${c}"></i>${Z_LABEL[c]} · ${Z_PLACE[c]}</span>`).join('') + '<span>☕ Pause 30 min</span><span>🔒 Changé à la main</span>';
  $('#fxNote').textContent = z.roles.some(r => / [A-C]$/.test(r)) ? "Même horaire à plusieurs (A, B, C) : ils se mettent d'accord en arrivant sur qui prend quelle ligne." : '';
  let h = `<h3 class="fx-title">${esc(z.title)}</h3><table class="ztable"><tr><th class="name">Horaire</th>${z.slots.map(s => `<th>${s.label}</th>`).join('')}<th>Pause</th></tr>`;
  z.people.forEach((p, k) => {
    h += `<tr><td class="name"><b>${esc(p.name)}</b></td>`;
    p.cells.forEach((c, s) => {
      const pause = p.pause && p.pause.slot === s ? `<small class="z-pause">☕ ${p.pause.start}</small>` : '';
      if (!c) { h += `<td class="zcell off">${pause}</td>`; return; }
      h += `<td class="zcell ${c.manual ? 'lock' : ''}" data-role="${k}" data-slot="${s}">`
        + (c.code ? `<span class="z-${c.code}"><b>${c.code === 'D' ? 'Dispatch' : c.code === 'T' ? 'Toutes zones' : c.code}</b><small>${Z_PLACE[c.code]}</small></span>` : '') + pause + '</td>';
    });
    h += `<td>${p.pause ? `${p.pause.start}-${p.pause.end}` : '<span class="muted">—</span>'}</td></tr>`;
  });
  $('#fxBox').innerHTML = h + '</table>';
}
async function fixedCell(body) {
  const j = await api('/api/fixed/cell', { plan: fxType, ...body });
  fxData = j.fixed; renderFixed();
}
$('#fixedOpen').onclick = () => { go('fixed'); renderFixed(); loadFixed(); };
$('#fxTypes').addEventListener('click', e => {
  const b = e.target.closest('[data-fx]'); if (!b) return;
  fxType = b.dataset.fx; try { localStorage.setItem('fxType', fxType); } catch {}
  renderFixed();
});
$('#fxReset').onclick = async () => {
  if (!confirm('Enlever les changements faits à la main sur ce tableau et tout recalculer ?')) return;
  const j = await api('/api/fixed/reset', { plan: fxType });
  fxData = j.fixed; renderFixed(); toast('Tableau remis en automatique');
};
$('#fxExport').onclick = () => downloadXlsx('/api/export-fixed.xlsx', {});

// Jour créé à la main : nom, nombre de personnes par horaire (horaires connus, ou écrits à la main comme 9-17),
// dimanche d'ouverture, ligne du chef terrain.
const FX_SHIFTS = [['8-16', '8-16'], ['10-18', '10-18'], ['12-20', '12-20'], ['11-19', '11-19'], ['FOOT', 'Horaire foot (16h-fermeture)']];
let fxForm = null; // { id, title, counts: {…}, extra: [{ shift, n }], sunday, chef }
function openFxForm(plan) {
  const counts = { ...((plan && plan.counts) || {}) };
  const known = FX_SHIFTS.map(s => s[0]);
  fxForm = {
    id: plan ? plan.id : null, title: plan ? plan.title : '', sunday: plan ? plan.sunday : false, chef: plan ? plan.chef : true,
    counts: Object.fromEntries(known.map(s => [s, counts[s] || 0])),
    extra: Object.keys(counts).filter(s => !known.includes(s)).map(s => ({ shift: s, n: counts[s] })),
  };
  renderFixed();
  $('#fxForm').scrollIntoView({ block: 'start', behavior: 'smooth' });
}
function renderFxForm() {
  const f = fxForm, box = $('#fxForm');
  box.hidden = !f;
  if (!f) return;
  const num = (k, v, i) => `<input type="number" min="0" max="8" value="${v}" data-fx-n="${k}" ${i !== undefined ? `data-i="${i}"` : ''}>`;
  const total = Object.values(f.counts).reduce((a, x) => a + Number(x || 0), 0) + f.extra.reduce((a, x) => a + Number(x.n || 0), 0);
  box.innerHTML = `<div class="card-head"><h3>${f.id ? 'Modifier le jour' : 'Créer un jour'}</h3><span class="chip">${total} personne${total > 1 ? 's' : ''}</span></div>
    <label class="zs-field">Nom du jour <input data-fx-k="title" value="${esc(f.title)}" placeholder="ex. Samedi chargé" maxlength="50"></label>
    <div class="fx-counts">${FX_SHIFTS.map(([s, l]) => `<label><span>${l}</span>${num(s, f.counts[s])}</label>`).join('')}
      ${f.extra.map((x, i) => `<label class="fx-extra"><input data-fx-x="${i}" value="${esc(x.shift)}" placeholder="ex. 9-17" maxlength="5">${num('x', x.n, i)}<button class="ghost" data-fx-rm="${i}" title="Retirer">✕</button></label>`).join('')}
    </div>
    <button class="ghost" id="fxAddShift">+ Autre horaire (écrit à la main)</button>
    <div class="row">
      <label class="check"><input type="checkbox" data-fx-k="sunday" ${f.sunday ? 'checked' : ''}> Dimanche d'ouverture (11h-19h)</label>
      <label class="check"><input type="checkbox" data-fx-k="chef" ${f.chef && !f.sunday ? 'checked' : ''} ${f.sunday ? 'disabled' : ''}> Ligne chef terrain (un bloc de dispatch)</label>
    </div>
    ${f.id ? '<p class="muted small">Si tu changes les horaires, les cases changées à la main sur ce tableau repartent en automatique.</p>' : ''}
    <div class="row"><button class="primary" id="fxSave">Enregistrer</button><button class="ghost" id="fxCancel">Annuler</button></div>
    <p class="muted small">Un vrai jour qui a exactement cette équipe suivra ce tableau dans « Zones & dispatch ».</p>`;
}
$('#fxNew').onclick = () => openFxForm(null);
$('#fxEdit').onclick = () => openFxForm(fxData.find(p => p.id === fxType));
$('#fxDelete').onclick = async () => {
  const p = fxData.find(x => x.id === fxType);
  if (!p || !confirm(`Supprimer le jour « ${p.title} » ? (« Annuler » en haut permet de revenir en arrière)`)) return;
  const j = await api('/api/fixed/custom/delete', { id: p.id });
  fxData = j.fixed; fxType = 'jour4'; renderFixed(); toast('Jour supprimé');
};
$('#fxForm').addEventListener('input', e => {
  const f = fxForm; if (!f) return;
  const t = e.target;
  if (t.dataset.fxK === 'title') f.title = t.value;
  if (t.dataset.fxN) { const v = Math.max(0, Math.min(8, Number(t.value) || 0)); if (t.dataset.fxN === 'x') f.extra[t.dataset.i].n = v; else f.counts[t.dataset.fxN] = v; }
  if (t.dataset.fxX !== undefined) f.extra[t.dataset.fxX].shift = t.value.trim();
});
$('#fxForm').addEventListener('change', e => {
  const f = fxForm; if (!f) return;
  const k = e.target.dataset.fxK;
  if (k === 'sunday' || k === 'chef') { f[k] = e.target.checked; renderFxForm(); }
  if (e.target.dataset.fxN) renderFxForm();
});
$('#fxForm').addEventListener('click', async e => {
  const f = fxForm; if (!f) return;
  if (e.target.closest('#fxAddShift')) { f.extra.push({ shift: '', n: 1 }); renderFxForm(); return document.querySelector(`#fxForm [data-fx-x="${f.extra.length - 1}"]`)?.focus(); }
  const rm = e.target.closest('[data-fx-rm]');
  if (rm) { f.extra.splice(Number(rm.dataset.fxRm), 1); return renderFxForm(); }
  if (e.target.closest('#fxCancel')) { fxForm = null; return renderFixed(); }
  if (e.target.closest('#fxSave')) {
    const counts = { ...f.counts };
    for (const x of f.extra) if (x.shift && x.n) counts[x.shift] = (counts[x.shift] || 0) + Number(x.n);
    const j = await api('/api/fixed/custom', { id: f.id, title: f.title, counts, sunday: f.sunday, chef: f.chef && !f.sunday }).catch(() => null);
    if (!j) return;
    fxForm = null; fxData = j.fixed; fxType = j.planId; try { localStorage.setItem('fxType', fxType); } catch {}
    renderFixed(); toast(f.id ? 'Jour modifié' : 'Jour créé');
  }
});
// Clic sur une case : choisir la zone (ou revenir en automatique).
$('#fxBox').addEventListener('click', e => {
  const td = e.target.closest('.zcell[data-role]');
  if (!td || document.body.classList.contains('readonly')) return;
  document.querySelector('.zmenu')?.remove();
  const m = document.createElement('div');
  m.className = 'zmenu';
  m.innerHTML = ['Z1', 'Z2', 'Z3', 'D', 'T'].map(c => `<button data-z="${c}"><i class="z-${c}"></i>${Z_LABEL[c]} <small>${Z_PLACE[c]}</small></button>`).join('')
    + '<button data-z="">↺ Automatique</button>';
  const r = td.getBoundingClientRect();
  m.style.left = Math.min(r.left + window.scrollX, window.scrollX + document.documentElement.clientWidth - 230) + 'px';
  m.style.top = (r.bottom + window.scrollY + 4) + 'px';
  document.body.appendChild(m);
  m.onclick = ev => {
    const b = ev.target.closest('button'); if (!b) return;
    m.remove();
    fixedCell({ role: Number(td.dataset.role), slot: Number(td.dataset.slot), code: b.dataset.z || null });
  };
  setTimeout(() => document.addEventListener('click', function off(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener('click', off); } }), 0);
});
// Appui long puis lâcher sur un autre horaire du même créneau : les deux échangent leur place.
longPressDrag({
  root: $('#fxBox'),
  source: el => el.closest('.zcell[data-role]'),
  targets: src => [...document.querySelectorAll(`#fxBox .zcell[data-role][data-slot="${src.dataset.slot}"]`)].filter(x => x !== src),
  drop: (src, over) => fixedCell({ role: Number(src.dataset.role), slot: Number(src.dataset.slot), swap: Number(over.dataset.role) })
    .then(() => toast('Places échangées.')).catch(() => {}),
});

// ----- Reporting : événements du jour et rapport PDF de fin de journée -----
const LOG_ICONS = { accident: '🚗', client: '🗣️', panne: '🔧', objet: '🔑', securite: '🚓', proprete: '🧹', autre: '📝' };
let logDate = localDay(), logData = null, logForm = null; // logForm : événement en cours d'écriture (id = null si nouveau)
const nowHM = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const lbl = (list, id) => (list.find(x => x.id === id) || {}).label || id;

async function loadLog() {
  const j = await call('/api/log', null, { month: logDate.slice(0, 7), date: logDate });
  if (j.error) return toast(j.error);
  logData = j.log; renderLog();
}
async function logCall(path, body) {
  const j = await call(path, { month: logDate.slice(0, 7), date: logDate, ...body });
  if (j.error) { toast(j.error); throw new Error(j.error); }
  logData = j.log; renderLog(); return j;
}
function renderLog() {
  const d = new Date(logDate + 'T12:00:00');
  $('#lTitle').textContent = `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  try { if (!$('#logChief').value) $('#logChief').value = localStorage.getItem('logChief') || (data && data.config.chef.name) || ''; } catch {}
  const L = logData;
  if (!L || L.date !== logDate) { $('#logList').innerHTML = '<p class="muted">Chargement…</p>'; return; }
  const ro = document.body.classList.contains('readonly');
  const edit = L.editable && !ro;
  $('#lState').textContent = L.editable ? "Aujourd'hui · modifiable" : 'Journée figée';
  $('#lState').className = 'chip ' + (L.editable ? 'z-Z2' : 'empty');
  $('#logNew').hidden = !edit;
  $('#logTypes').innerHTML = L.types.map(t => `<button data-type="${t.id}" class="${logForm && logForm.type === t.id ? 'on' : ''}"><span>${LOG_ICONS[t.id] || '📝'}</span>${esc(t.label)}</button>`).join('');
  renderLogForm();
  $('#logReformRow').hidden = document.body.classList.contains('readonly') || !L.entries.some(e => !e.textPro);
  $('#logCount').textContent = L.entries.length ? `${L.entries.length} événement${L.entries.length > 1 ? 's' : ''}` : '';
  $('#logList').innerHTML = L.entries.length ? L.entries.map(e => {
    const sev = L.severities.find(s => s.id === e.severity) || {};
    return `<div class="log-item sev-${e.severity}" data-id="${e.id}">
      <div class="log-head"><b class="log-time">${esc(e.time)}</b><b>${LOG_ICONS[e.type] || ''} ${esc(lbl(L.types, e.type))}</b>
        <span class="log-sev" style="background:#${sev.fill};color:#${sev.ink}">${esc(sev.label || '')}</span></div>
      <div class="muted small">${esc(lbl(L.places, e.place))}${e.plate ? ' · Plaque ' + esc(e.plate) : ''}</div>
      ${(() => {
        // Version reformulée (celle du rapport) ; « Mon texte » montre ce qui a été écrit ou dicté.
        const br = s => esc(s).replace(/\n/g, '<br>');
        const block = (t, a) => `<p>${br(t)}</p>${a ? `<p class="log-action"><b>Action prise :</b> ${br(a)}</p>` : ''}`;
        if (!e.textPro) return block(e.text, e.action);
        return `<div class="log-pro">${block(e.textPro, e.actionPro || e.action)}</div>
          <details class="log-orig"><summary>✨ Reformulé pour le rapport · voir mon texte</summary>${block(e.text, e.action)}</details>`;
      })()}
      ${e.followUp ? '<p class="log-follow">► Suivi nécessaire</p>' : ''}
      ${e.author || e.updatedBy ? `<p class="muted small log-by">${e.author ? 'Noté par ' + esc(personLabel(e.author)) : ''}${e.updatedBy && e.updatedBy !== e.author ? (e.author ? ' · ' : '') + 'modifié par ' + esc(personLabel(e.updatedBy)) + (e.updatedAt ? ' à ' + new Date(e.updatedAt).toLocaleTimeString('fr-BE', { hour: '2-digit', minute: '2-digit' }) : '') : ''}</p>` : ''}
      ${edit ? `<div class="row"><button class="log-edit">Modifier</button> <button class="ghost danger log-del">Supprimer</button></div>` : ''}
    </div>`;
  }).join('') : `<p class="muted">${L.editable ? 'Aucun événement pour le moment. Choisis un type ci-dessus pour en noter un.' : 'Aucun événement ce jour-là.'}</p>`;
}
// Dictée : on parle, le texte s'écrit dans le champ (reconnaissance vocale du navigateur, en français).
let dict = null, dictK = null;
const micButton = k => `<button type="button" class="mic ${dictK === k ? 'on' : ''}" data-mic="${k}">${dictK === k ? '■ Arrêter' : '🎤 Dicter'}</button>`;
const refreshMics = () => document.querySelectorAll('#logForm .mic').forEach(b => { b.outerHTML = micButton(b.dataset.mic); });
function stopDictation() { if (dict) try { dict.stop(); } catch {} }
function startDictation(k) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast("Dictée pas disponible ici : utilise le micro 🎤 du clavier du téléphone.");
  stopDictation();
  const rec = new SR();
  rec.lang = 'fr-BE'; rec.continuous = true; rec.interimResults = true;
  const before = (logForm[k] || '').trim();
  let done = '';
  rec.onresult = ev => {
    let live = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      if (ev.results[i].isFinal) done += ev.results[i][0].transcript + ' '; else live += ev.results[i][0].transcript;
    }
    let said = (done + live).replace(/\s+/g, ' ').trim();
    if (said && !before) said = said[0].toUpperCase() + said.slice(1);
    const value = [before, said].filter(Boolean).join(' ');
    if (!logForm) return;
    logForm[k] = value;
    const ta = document.querySelector(`#logForm textarea[data-k="${k}"]`);
    if (ta) { ta.value = value; ta.scrollTop = ta.scrollHeight; }
  };
  rec.onerror = ev => {
    if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') toast('Autorise le micro pour dicter (Réglages › Safari › Microphone), ou utilise le micro 🎤 du clavier.');
    else if (ev.error !== 'aborted' && ev.error !== 'no-speech') toast('Dictée interrompue (' + ev.error + ')');
  };
  rec.onend = () => { if (dict === rec) { dict = null; dictK = null; refreshMics(); } };
  dict = rec; dictK = k;
  try { rec.start(); } catch { dict = null; dictK = null; toast('Impossible de lancer la dictée'); }
  refreshMics();
}
function renderLogForm() {
  const L = logData, f = logForm;
  $('#logForm').hidden = !f;
  if (!f) { $('#logForm').innerHTML = ''; return; }
  const chips = (k, list, styled) => `<div class="log-chips">${list.map(x => `<button data-k="${k}" data-v="${x.id}" class="${f[k] === x.id ? 'on' : ''}"${styled && f[k] === x.id ? ` style="background:#${x.fill};color:#${x.ink};border-color:#${x.ink}"` : ''}>${esc(x.label)}</button>`).join('')}</div>`;
  $('#logForm').innerHTML = `
    <h4>${f.id ? 'Modifier' : 'Nouveau'} : ${LOG_ICONS[f.type] || ''} ${esc(lbl(L.types, f.type))}</h4>
    <div class="row"><label>Heure <input type="time" data-k="time" value="${esc(f.time)}"></label>
      <label>Plaque <input data-k="plate" value="${esc(f.plate)}" placeholder="1-ABC-234" maxlength="20" autocapitalize="characters"></label></div>
    <label class="block">Lieu</label>${chips('place', L.places)}
    <label class="block">Gravité</label>${chips('severity', L.severities, true)}
    <div class="log-field"><div class="log-field-head"><span>Ce qui s'est passé</span>${micButton('text')}</div>
      <textarea data-k="text" rows="3" maxlength="3000" placeholder="Écris ou touche « Dicter » et parle. Ex. accrochage entre deux voitures près de l'ascenseur, pas de blessé">${esc(f.text)}</textarea></div>
    <div class="log-field"><div class="log-field-head"><span>Action prise</span>${micButton('action')}</div>
      <textarea data-k="action" rows="2" maxlength="2000" placeholder="Ex. constat amiable, zone balisée, technicien appelé">${esc(f.action)}</textarea></div>
    <label class="check"><input type="checkbox" data-k="followUp" ${f.followUp ? 'checked' : ''}> Suivi nécessaire (à régler plus tard)</label>
    <div class="row"><button id="logSave" class="primary">Enregistrer</button> <button id="logCancel" class="ghost">Annuler</button></div>`;
}
$('#logTypes').addEventListener('click', e => {
  const b = e.target.closest('button[data-type]'); if (!b) return;
  if (logForm && !logForm.id) logForm.type = b.dataset.type;
  else logForm = { id: null, type: b.dataset.type, time: nowHM(), place: '', severity: 'faible', plate: '', text: '', action: '', followUp: false };
  renderLog();
  $('#logForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('#logForm').addEventListener('input', e => {
  const k = e.target.dataset.k; if (!k || !logForm) return;
  logForm[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
});
$('#logForm').addEventListener('click', async e => {
  const mic = e.target.closest('button[data-mic]');
  if (mic) { if (dictK === mic.dataset.mic) stopDictation(); else startDictation(mic.dataset.mic); return; }
  const chip = e.target.closest('button[data-k]');
  if (chip) { logForm[chip.dataset.k] = chip.dataset.v; renderLogForm(); return; }
  if (e.target.id === 'logCancel') { stopDictation(); logForm = null; renderLog(); return; }
  if (e.target.id !== 'logSave') return;
  stopDictation();
  const f = logForm;
  if (!f.place) return toast('Choisis le lieu');
  if (!f.text.trim()) return toast("Décris ce qui s'est passé");
  e.target.disabled = true;
  try {
    e.target.textContent = 'Enregistrement…';
    const j = await logCall('/api/log/save', { id: f.id, entry: f });
    logForm = null; renderLog();
    toast(j.reformError ? `Événement enregistré (texte gardé tel quel : ${j.reformError})` : 'Événement enregistré');
  } catch { e.target.disabled = false; e.target.textContent = 'Enregistrer'; }
});
$('#logList').addEventListener('click', async e => {
  const item = e.target.closest('.log-item'); if (!item) return;
  const entry = logData.entries.find(x => x.id === item.dataset.id); if (!entry) return;
  if (e.target.closest('.log-edit')) {
    logForm = { ...entry };
    renderLog(); $('#logForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } else if (e.target.closest('.log-del') && confirm(`Supprimer l'événement de ${entry.time} (${lbl(logData.types, entry.type)}) ?`)) {
    await logCall('/api/log/delete', { id: entry.id }); toast('Événement supprimé');
  }
});
function logGo(date) {
  if (!date) return;
  if (logForm && !confirm("L'événement en cours n'est pas enregistré. Changer de jour quand même ?")) return;
  logForm = null; logDate = date; logData = null; renderLog(); loadLog();
}
$('#logOpen').onclick = () => { go('log'); renderLog(); loadLog(); };
$('#lPrev').onclick = () => logGo(addDay(logDate, -1));
$('#lNext').onclick = () => logGo(addDay(logDate, 1));
$('#lToday').onclick = () => logGo(localDay());
$('#logChief').onchange = e => { try { localStorage.setItem('logChief', e.target.value.trim()); } catch {} };
// Rapport PDF : fabriqué dans la page (en ligne) ou par le serveur local.
async function logPdf() {
  const q = { month: logDate.slice(0, 7), date: logDate, chief: $('#logChief').value.trim() };
  if (backend) {
    const out = await backend.handle('GET', '/api/log-report.pdf', q, {});
    if (!out.pdf) throw new Error((out.json && out.json.error) || 'Rapport impossible');
    return new File([out.pdf], out.filename, { type: 'application/pdf' });
  }
  const r = await fetch('/api/log-report.pdf?' + new URLSearchParams(q));
  if (!r.ok) throw new Error('Rapport impossible');
  return new File([await r.arrayBuffer()], `reporting-${logDate}.pdf`, { type: 'application/pdf' });
}
function saveFile(file) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = file.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
$('#logReform').onclick = async e => {
  const b = e.target; b.disabled = true; b.textContent = 'Reformulation en cours…';
  try {
    const j = await logCall('/api/log/reformulate', {});
    toast(j.reformError ? 'Reformulation impossible : ' + j.reformError : 'Événements reformulés');
  } catch {} finally { b.disabled = false; b.textContent = '✨ Reformuler les événements pas encore reformulés'; }
};
$('#logDownload').onclick = async () => { try { saveFile(await logPdf()); } catch (e) { toast(e.message); } };
$('#logShare').onclick = async () => {
  try {
    const file = await logPdf();
    const d = new Date(logDate + 'T12:00:00');
    const title = `Reporting du ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
    // Menu « Partager » du téléphone (mail, WhatsApp, Teams…) ; sinon le PDF est téléchargé.
    if (navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file], title, text: `${title} — Interparking Westland` });
    else { saveFile(file); toast('Partage non disponible ici : le PDF est téléchargé.'); }
  } catch (e) { if (e.name !== 'AbortError') toast(e.message); }
};

// ----- Chef terrain : nom, horaire, jours -----
const DOW_SHORT = ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
function openChef() {
  const ch = data.config.chef;
  const days = ch.days || [2, 3, 4, 5, 6];
  $('#chefNameIn').value = ch.name;
  $('#chefNoteIn').value = ch.note || '';
  $('#chefShiftIn').value = ch.shift;
  $('#chefDaysIn').innerHTML = [1, 2, 3, 4, 5, 6].map(d => `<label class="check"><input type="checkbox" value="${d}" ${days.includes(d) ? 'checked' : ''}> ${DOW_SHORT[d]}</label>`).join('');
  $('#chefMonthlyIn').checked = ch.monthlyWeek !== false;
  $('#parkChiefIn').value = (data.config.parkChief && data.config.parkChief.name) || '';
  $('#chefDlg').showModal();
}
$('#chefSave').onclick = async () => {
  const days = [...document.querySelectorAll('#chefDaysIn input:checked')].map(i => Number(i.value));
  await api('/api/chef', { name: $('#chefNameIn').value, note: $('#chefNoteIn').value, shift: $('#chefShiftIn').value, days, monthlyWeek: $('#chefMonthlyIn').checked, parkChief: $('#parkChiefIn').value });
  $('#chefDlg').close(); toast('Chef terrain enregistré');
};

// ----- Une personne : ajouter / modifier / départ / supprimer -----
let empId = null;
function openEmp(id) {
  const c = data.config;
  const e = id && c.employees.find(x => x.id === id);
  empId = id;
  const label = g => c.rotation.groups[g].map(x => (c.employees.find(y => y.id === x) || {}).name).filter(Boolean).join(', ');
  $('#empGroup').innerHTML = c.rotation.groups.map((_, g) => `<option value="${g}">Groupe ${g + 1}${label(g) ? ' (' + esc(label(g)) + ')' : ''}</option>`).join('') + `<option value="${c.rotation.groups.length}">+ Nouveau groupe</option>`;
  $('#empGroup').value = e ? Math.max(0, c.rotation.groups.findIndex(g => g.includes(id))) : 0;
  $('#empTitle').textContent = e ? `Modifier ${e.name}` : 'Ajouter un employé';
  $('#empName').value = e ? e.name : '';
  $('#empNote').value = e ? (e.note || '') : '';
  $('#empStartRow').hidden = !!e;
  $('#empStart').value = today();
  $('#empLeaveBox').hidden = !e;
  $('#empEnd').value = e && e.end ? e.end : today();
  $('#empRejoin').hidden = !(e && e.end);
  $('#empDlg').showModal();
  $('#empName').focus();
}
async function empAction(body, msg) {
  await api('/api/employee', { ...body, id: empId, regenerate: $('#empRegen').checked });
  $('#empDlg').close(); toast(msg);
}
$('#empSave').onclick = () => {
  const name = $('#empName').value.trim();
  if (!name) return toast('Indique un nom');
  const body = { name, note: $('#empNote').value, group: $('#empGroup').value };
  if (empId) empAction({ action: 'update', ...body }, 'Modifications enregistrées');
  else empAction({ action: 'add', start: $('#empStart').value, ...body }, `${name} ajouté à l'équipe`);
};
$('#empLeave').onclick = () => {
  const end = $('#empEnd').value;
  if (!end) return toast('Indique le dernier jour de travail');
  if (confirm(`${$('#empName').value} ne sera plus dans le planning après le ${fmtDate(end)}. Continuer ?`))
    empAction({ action: 'leave', end }, 'Départ enregistré');
};
$('#empRejoin').onclick = () => empAction({ action: 'rejoin' }, 'Départ annulé');
$('#empDelete').onclick = () => {
  if (confirm(`Supprimer définitivement ${$('#empName').value} et tout son historique ? Cette action est irréversible.`))
    empAction({ action: 'delete' }, 'Employé supprimé');
};

// ----- Agenda : éléments pour l'agenda partagé Outlook (titre composé automatiquement, bouton « Ajouter à Outlook ») -----
let agMonth = localDay().slice(0, 7), agData = null, agForm = null; // agForm : élément en cours (id = null si nouveau)
async function loadAgenda() {
  const j = await call('/api/agenda', null, { month: agMonth });
  if (j.error) { $('#agBox').innerHTML = `<p class="muted pad">${esc(j.error)}</p>`; return; }
  agData = j.agenda; renderAgenda();
}
async function agApi(path, body) {
  const j = await call(path, { month: agMonth, ...body });
  if (j.needLogin) { showLogin(); throw new Error(j.error); }
  if (j.error) { toast(j.error); throw new Error(j.error); }
  agData = j.agenda; return j;
}
const agTitle = (type, fields) => {
  const T = { planon: f => ['PLANON ' + (f.numero || ''), f.equipement, '2411 ' + agData.place], materiel: f => ['MATERIEL', 'FOURNISSEUR', '2411', f.detail],
    livraison: f => ['LIVRAISON', '2411', f.detail], evenement: f => ['EVENEMENT', '2411', f.detail], foot: f => ['FOOT', 'RSCA', f.detail], tache: f => [f.detail] }[type];
  return T ? T(fields || {}).map(x => String(x || '').trim()).filter(Boolean).join(' - ').toUpperCase() : '';
};
const agWhen = it => it.allDay ? 'Toute la journée' : `${it.start} – ${it.end}`;
// Lien Outlook (web) qui ouvre un nouveau rendez-vous déjà rempli ; il reste à choisir l'agenda EXPLOITATION et enregistrer.
// Outlook sur le web est à l'adresse outlook.cloud.microsoft (celle du compte Interparking) ; outlook.office365.com
// reste en lien de secours.
function outlookLink(it, host = 'outlook.cloud.microsoft') {
  const p = new URLSearchParams({ subject: it.title, location: it.location || '', body: it.notes || '' });
  if (it.allDay) { p.set('startdt', it.date); p.set('enddt', addDay(it.date, 1)); p.set('allday', 'true'); }
  else { p.set('startdt', new Date(`${it.date}T${it.start}:00`).toISOString()); p.set('enddt', new Date(`${it.date}T${it.end}:00`).toISOString()); p.set('allday', 'false'); }
  return `https://${host}/calendar/deeplink/compose?` + p.toString();
}
// Fichier .ics (Outlook sur PC, iPhone…) : même rendez-vous, à ouvrir puis enregistrer dans l'agenda partagé.
function icsFile(it) {
  const z = d => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const txt = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);
  const when = it.allDay ? [`DTSTART;VALUE=DATE:${it.date.replace(/-/g, '')}`, `DTEND;VALUE=DATE:${addDay(it.date, 1).replace(/-/g, '')}`]
    : [`DTSTART:${z(new Date(`${it.date}T${it.start}:00`))}`, `DTEND:${z(new Date(`${it.date}T${it.end}:00`))}`];
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Planning Interparking//FR', 'BEGIN:VEVENT', `UID:${it.id}@planning-interparking`,
    `DTSTAMP:${z(new Date())}`, ...when, `SUMMARY:${txt(it.title)}`, `LOCATION:${txt(it.location)}`, `DESCRIPTION:${txt(it.notes)}`, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  return new File([ics], `${it.title.slice(0, 40).replace(/[^\w-]+/g, '_')}.ics`, { type: 'text/calendar' });
}
function renderAgenda() {
  const [y, m] = agMonth.split('-').map(Number);
  $('#agTitle').textContent = `${MONTHS[m - 1]} ${y}`;
  const d = agData;
  if (!d || d.month !== agMonth) { $('#agBox').innerHTML = '<p class="muted pad">Chargement…</p>'; return; }
  const ro = document.body.classList.contains('readonly');
  const typeOf = id => d.types.find(t => t.id === id) || { icon: '•', label: id };
  // Une ligne : type, titre, quand, statut, bouton Outlook ; le reste dans le menu « ⋯ ».
  const row = it => `<li class="ag-item ${it.sentAt ? 'sent' : ''}">
      <span class="ag-ico t-${it.type}" title="${esc(typeOf(it.type).label)}">${typeOf(it.type).icon}</span>
      <div class="ag-main">
        <b>${esc(it.title)}</b>
        <span class="ag-meta"><span>${agWhen(it)}</span>${it.location ? `<span>${esc(it.location)}</span>` : ''}${it.notes ? `<span>${esc(it.notes.split('\n')[0]).slice(0, 70)}</span>` : ''}</span>
        ${it.by || it.updatedBy ? `<small class="ag-by">${it.by ? 'Ajouté par ' + esc(personLabel(it.by)) : ''}${it.updatedBy && it.updatedBy !== it.by ? (it.by ? ' · ' : '') + 'modifié par ' + esc(personLabel(it.updatedBy)) + (it.updatedAt ? ' le ' + hrWhen(it.updatedAt) : '') : ''}</small>` : ''}
      </div>
      <span class="ag-status ${it.sentAt ? 'ok' : ''}">${it.sentAt ? '✓ Dans Outlook' : 'À ajouter'}</span>
      <button class="${it.sentAt ? 'ghost' : 'primary'} ag-out" data-ag-out="${it.id}">📅 ${it.sentAt ? 'Rouvrir' : 'Ajouter à Outlook'}</button>
      <details class="ag-more"><summary title="Plus d'actions">⋯</summary><div class="ag-menu">
        <button data-ag-ics="${it.id}">⬇️ Fichier .ics</button>
        <button data-ag-out2="${it.id}">🔗 Autre lien Outlook</button>
        ${ro ? '' : `<button data-ag-edit="${it.id}">✏️ Modifier</button>`}
        ${it.sentAt && !ro ? `<button data-ag-unsent="${it.id}">↩️ Remettre « À ajouter »</button>` : ''}
        ${ro ? '' : `<button class="danger" data-ag-del="${it.id}">🗑️ Supprimer</button>`}
      </div></details></li>`;
  const todo = d.upcoming.filter(it => !it.sentAt);
  const dayHead = date => { const dd = new Date(date + 'T12:00:00'); return `${date === d.today ? "Aujourd'hui · " : ''}${DAY_NAMES[dd.getDay()]} ${dd.getDate()} ${MONTHS[dd.getMonth()].toLowerCase()}`; };
  let h = agForm ? agFormHtml() : '';
  if (todo.length) h += `<div class="card ag-todo"><div class="card-head"><h3>À mettre dans Outlook</h3><span class="chip empty">${todo.length} en attente</span></div>
    <ul class="ag-list">${todo.map(it => row(it).replace('<div class="ag-main">', `<div class="ag-main"><small class="ag-date">${dayHead(it.date)}</small>`)).join('')}</ul></div>`;
  const byDay = {};
  for (const it of d.items) (byDay[it.date] = byDay[it.date] || []).push(it);
  h += `<div class="card"><div class="card-head"><h3>${esc($('#agTitle').textContent)}</h3><span class="chip">${d.items.length} élément${d.items.length > 1 ? 's' : ''}</span></div>
    ${d.items.length ? Object.entries(byDay).map(([date, its]) => `<div class="ag-day ${date === d.today ? 'today' : ''}">${dayHead(date)}</div><ul class="ag-list">${its.map(row).join('')}</ul>`).join('')
      : `<div class="ag-empty"><span>📅</span><p>Rien dans l'agenda ce mois-ci.</p>${ro ? '' : '<button class="primary" data-ag-new="1">+ Nouvel élément</button>'}</div>`}</div>`;
  $('#agBox').innerHTML = h;
}
function agFormHtml() {
  const f = agForm, d = agData, t = d.types.find(x => x.id === f.type);
  const field = (label, input, cls = '') => `<label class="ag-f ${cls}"><span>${label}</span>${input}</label>`;
  return `<div class="card ag-form">
    <div class="card-head"><h3>${f.id ? "Modifier l'élément" : 'Nouvel élément'}</h3><button class="ghost ag-x" id="agCancel" title="Fermer">✕</button></div>
    <div class="log-types ag-types">${d.types.map(x => `<button type="button" data-ag-type="${x.id}" class="${x.id === f.type ? 'on' : ''}"><span>${x.icon}</span>${x.label}</button>`).join('')}</div>
    <div class="ag-fields">
      ${field('Date', `<input type="date" data-ag="date" value="${f.date}">`)}
      <div class="ag-f"><span>Horaire</span><div class="viewswitch ag-when">
        <button type="button" data-ag-allday="1" class="${f.allDay ? 'on' : ''}">Toute la journée</button>
        <button type="button" data-ag-allday="0" class="${f.allDay ? '' : 'on'}">Avec heures</button></div></div>
      ${f.allDay ? '' : field('De', `<input type="time" data-ag="start" value="${f.start}">`) + field('À', `<input type="time" data-ag="end" value="${f.end}">`)}
      ${t.fields.map(([k, l, ph]) => field(esc(l), `<input data-ag-f="${k}" value="${esc(f.fields[k] || '')}" placeholder="${esc(ph)}" maxlength="120">`, t.fields.length === 1 ? 'ag-wide' : '')).join('')}
      ${field('Lieu', `<input data-ag="location" value="${esc(f.location)}" maxlength="120">`, 'ag-wide')}
      ${field('Commentaire <i>(facultatif)</i>', `<textarea data-ag="notes" rows="3" placeholder="Commentaire">${esc(f.notes)}</textarea>`, 'ag-full')}
    </div>
    <div class="ag-foot">
      <div class="ag-preview"><span>Titre dans Outlook</span><b id="agPreview">${esc(agTitle(f.type, f.fields)) || '—'}</b></div>
      <div class="ag-btns"><button class="ghost" id="agCancel2">Annuler</button><button class="primary" id="agSave">${f.id ? 'Enregistrer' : 'Ajouter'}</button></div>
    </div></div>`;
}
function openAgForm(it) {
  const type = it ? it.type : 'planon';
  agForm = it ? { id: it.id, type, date: it.date, allDay: it.allDay, start: it.start || '09:00', end: it.end || '10:00', fields: { ...it.fields }, location: it.location || '', notes: it.notes || '' }
    : { id: null, type, date: agMonth === localDay().slice(0, 7) ? localDay() : agMonth + '-01', allDay: true, start: '09:00', end: '10:00', fields: {}, location: agData.place, notes: '' };
  renderAgenda(); $('#agBox').scrollIntoView({ block: 'start', behavior: 'smooth' });
}
$('#agBox').addEventListener('input', e => {
  const f = agForm; if (!f) return;
  const k = e.target.dataset.ag, kf = e.target.dataset.agF;
  if (kf) f.fields[kf] = e.target.value;
  else if (k && k !== 'allDay') f[k] = e.target.value;
  const p = $('#agPreview'); if (p) p.textContent = agTitle(f.type, f.fields) || '—';
});
$('#agBox').addEventListener('change', e => { if (agForm && e.target.dataset.ag === 'allDay') { agForm.allDay = e.target.checked; renderAgenda(); } });
$('#agBox').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  const find = id => [...agData.items, ...agData.upcoming].find(x => x.id === id);
  b.closest('details.ag-more')?.removeAttribute('open');
  if (b.dataset.agType) { agForm.type = b.dataset.agType; return renderAgenda(); }
  if (b.dataset.agAllday) { agForm.allDay = b.dataset.agAllday === '1'; return renderAgenda(); }
  if (b.dataset.agNew) return openAgForm(null);
  if (b.id === 'agCancel' || b.id === 'agCancel2') { agForm = null; return renderAgenda(); }
  if (b.id === 'agSave') {
    const { id, type, date, allDay, start, end, fields, location, notes } = agForm;
    const j = await agApi('/api/agenda/save', { item: { id, type, date, allDay, start, end, fields, location, notes } }).catch(() => null);
    if (j) { agForm = null; renderAgenda(); toast(id ? 'Modifié' : 'Ajouté : clique sur « Ajouter à Outlook »'); }
    return;
  }
  if (b.dataset.agEdit) return openAgForm(find(b.dataset.agEdit));
  if (b.dataset.agDel) {
    const it = find(b.dataset.agDel);
    if (!confirm(`Supprimer « ${it.title} » de l'outil ?${it.sentAt ? " (Il reste dans l'agenda Outlook : supprime-le aussi là-bas.)" : ''}`)) return;
    await agApi('/api/agenda/delete', { id: it.id }).catch(() => null); return renderAgenda();
  }
  if (b.dataset.agOut) {
    const it = find(b.dataset.agOut);
    window.open(outlookLink(it), '_blank');
    if (!it.sentAt && !document.body.classList.contains('readonly')) { await agApi('/api/agenda/sent', { id: it.id }).catch(() => null); renderAgenda(); }
    toast("Outlook s'ouvre : choisis l'agenda EXPLOITATION puis « Enregistrer »");
    return;
  }
  if (b.dataset.agIcs) { saveFile(icsFile(find(b.dataset.agIcs))); return; }
  if (b.dataset.agOut2) { window.open(outlookLink(find(b.dataset.agOut2), 'outlook.office365.com'), '_blank'); return; }
  if (b.dataset.agUnsent) { await agApi('/api/agenda/sent', { id: b.dataset.agUnsent, undo: true }).catch(() => null); return renderAgenda(); }
});
function agGo(m) { agMonth = m; agData = null; agForm = null; renderAgenda(); loadAgenda(); }
$('#agOpen').onclick = () => { go('agenda'); renderAgenda(); loadAgenda(); };
$('#agPrev').onclick = () => agGo(addMonth(agMonth, -1));
$('#agNext').onclick = () => agGo(addMonth(agMonth, 1));
$('#agNew').onclick = () => { if (agData) openAgForm(null); };

// ----- Factures (administrateurs) : stockage des factures envoyées chaque mois, par site et par magasin -----
let invMonth = addMonth(localDay().slice(0, 7), -1), invData = null, invMemoOpen = null;
async function loadInvoices() {
  const j = await call('/api/invoices', null, { month: invMonth });
  if (j.error) { $('#invBox').innerHTML = `<p class="muted pad">${esc(j.error)}</p>`; return; }
  invData = j.invoices; renderInvoices();
}
const invIcon = f => f.type === 'application/pdf' ? '📄' : '🖼️';
const kb = n => n >= 1048576 ? `${(n / 1048576).toFixed(1)} Mo` : `${Math.max(1, Math.round(n / 1024))} Ko`;
function renderInvoices() {
  const [y, m] = invMonth.split('-').map(Number);
  $('#invTitle').textContent = `${MONTHS[m - 1]} ${y}`;
  const d = invData;
  if (!d || d.month !== invMonth) { $('#invBox').innerHTML = '<p class="muted pad">Chargement…</p>'; return; }
  $('#invBox').innerHTML = d.sites.map(site => {
    const done = site.stores.filter(st => (d.files[st.id] || []).length).length;
    return `<div class="card inv-site"><div class="card-head"><h3>${esc(site.name)}</h3><span class="chip">${done} / ${site.stores.length} magasins</span></div>
      ${site.stores.map(st => {
        const files = d.files[st.id] || [];
        // Modèle du magasin (numéros SAP, règles…) et fiche du mois, pré-remplie avec le modèle : on complète les chiffres.
        const memo = d.memos[st.id] || '', note = (d.notes || {})[st.id] || '';
        const open = invMemoOpen && invMemoOpen.split('|')[0] === st.id ? invMemoOpen.split('|')[1] : null;
        const lines = s => s.split('\n').filter(x => x.trim());
        return `<div class="inv-store ${files.length ? 'done' : ''}">
          <div class="inv-head">
            <b>${esc(st.name)}</b>
            <span class="chip ${files.length ? 'z-D' : 'empty'}">${files.length ? `✓ ${files.length} fichier${files.length > 1 ? 's' : ''}` : 'À faire'}</span>
            ${note ? '<span class="chip z-Z2">📝 fiche remplie</span>' : ''}
            <span class="inv-actions">
              <button class="ghost" data-memo="${st.id}|note">${open === 'note' ? 'Fermer' : note ? '📝 Fiche du mois' : '📝 Remplir la fiche'}</button>
              <button class="ghost" data-memo="${st.id}|tpl" title="Le modèle repris chaque mois">${open === 'tpl' ? 'Fermer' : memo ? '⚙️ Modèle' : '⚙️ Créer le modèle'}</button>
              <label class="btn primary inv-add">+ Ajouter<input type="file" accept="image/*,application/pdf" multiple data-up="${st.id}" ${st.other ? 'data-other="1"' : ''} hidden></label>
            </span>
          </div>
          ${open === 'note' ? `<div class="inv-memo"><p class="muted small">Fiche de ${esc(st.name)} pour ${esc($('#invTitle').textContent)}${note ? '' : memo ? ' : pré-remplie avec le modèle, complète les chiffres' : ''}.</p>
              <textarea data-memo-text="${st.id}" rows="12" placeholder="Validations, réductions, montant à facturer…">${esc(note || memo)}</textarea>
              <div class="row"><button class="primary" data-note-save="${st.id}">Enregistrer la fiche du mois</button></div></div>`
            : open === 'tpl' ? `<div class="inv-memo"><p class="muted small">Modèle de ${esc(st.name)} : repris automatiquement dans la fiche de chaque mois.</p>
              <textarea data-memo-text="${st.id}" rows="12" placeholder="Numéros SAP, règles de facturation, à qui envoyer…">${esc(memo)}</textarea>
              <div class="row"><button class="primary" data-memo-save="${st.id}">Enregistrer le modèle</button></div></div>`
            : note ? `<p class="inv-memo-preview muted small">📝 ${esc(lines(note).slice(0, 2).join(' · '))}${lines(note).length > 2 ? '…' : ''}</p>` : ''}
          ${files.length ? `<ul class="inv-files">${files.map(f => `<li>
              <button class="link" data-open="${st.id}|${f.id}">${invIcon(f)} ${esc(f.label ? f.label + ' · ' : '')}${esc(f.name)}</button>
              <span class="muted small">${kb(f.size)} · ${new Date(f.at).toLocaleDateString('fr-BE')}${f.by ? ' · ' + esc(f.by) : ''}</span>
              <button class="ghost danger" data-del="${st.id}|${f.id}" title="Supprimer ce fichier">✕</button></li>`).join('')}</ul>` : ''}
        </div>`;
      }).join('')}</div>`;
  }).join('');
}
// Appels des factures : ne redessinent pas le planning (réponse = les factures du mois seulement).
async function invApi(path, body) {
  const j = await call(path, body);
  if (j.needLogin) { showLogin(); throw new Error(j.error); }
  if (j.error) { toast(j.error); throw new Error(j.error); }
  return j;
}
// Lecture d'un fichier choisi : en base64 pour l'envoyer.
const readB64 = file => new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.onerror = () => ko(new Error('Lecture du fichier impossible')); r.readAsDataURL(file); });
$('#invBox').addEventListener('change', async e => {
  const input = e.target.closest('input[data-up]'); if (!input || !input.files.length) return;
  const store = input.dataset.up, files = [...input.files];
  let label = '';
  if (input.dataset.other) { label = (prompt('Facture pour qui ? (ex. nom du client)') || '').trim(); if (!label) { input.value = ''; return; } }
  for (const [k, f] of files.entries()) {
    if (f.size > 10 * 1024 * 1024) { toast(`${f.name} : trop lourd (10 Mo maximum)`); continue; }
    toast(`Envoi ${files.length > 1 ? `${k + 1}/${files.length} ` : ''}: ${f.name}…`);
    try {
      const j = await invApi('/api/invoices/upload', { month: invMonth, store, name: f.name, type: f.type || (/\.pdf$/i.test(f.name) ? 'application/pdf' : ''), data: await readB64(f), label });
      invData = j.invoices; renderInvoices();
    } catch { input.value = ''; return; }
  }
  input.value = '';
  toast(files.length > 1 ? 'Fichiers ajoutés' : 'Fichier ajouté');
});
$('#invBox').addEventListener('click', async e => {
  const memo = e.target.closest('[data-memo]');
  if (memo) { invMemoOpen = invMemoOpen === memo.dataset.memo ? null : memo.dataset.memo; renderInvoices(); return; }
  const save = e.target.closest('[data-memo-save]');
  if (save) {
    const id = save.dataset.memoSave, text = document.querySelector(`[data-memo-text="${id}"]`).value;
    const j = await invApi('/api/invoices/memo', { month: invMonth, store: id, text }).catch(() => null);
    if (j) { invData = j.invoices; invMemoOpen = null; renderInvoices(); toast('Modèle enregistré'); }
    return;
  }
  const noteSave = e.target.closest('[data-note-save]');
  if (noteSave) {
    const id = noteSave.dataset.noteSave, text = document.querySelector(`[data-memo-text="${id}"]`).value;
    const j = await invApi('/api/invoices/note', { month: invMonth, store: id, text }).catch(() => null);
    if (j) { invData = j.invoices; invMemoOpen = null; renderInvoices(); toast('Fiche du mois enregistrée'); }
    return;
  }
  const del = e.target.closest('[data-del]');
  if (del) {
    const [store, id] = del.dataset.del.split('|');
    const f = (invData.files[store] || []).find(x => x.id === id);
    if (!confirm(`Supprimer définitivement « ${f ? f.name : 'ce fichier'} » ? Il ne pourra pas être récupéré.`)) return;
    const j = await invApi('/api/invoices/delete', { month: invMonth, store, id }).catch(() => null);
    if (j) { invData = j.invoices; renderInvoices(); toast('Fichier supprimé'); }
    return;
  }
  const open = e.target.closest('[data-open]');
  if (open) {
    const [store, id] = open.dataset.open.split('|');
    const q = { month: invMonth, store, id };
    if (!backend) { window.open('/api/invoices/file?' + new URLSearchParams(q), '_blank'); return; }
    const w = window.open('', '_blank'); // ouverte tout de suite (sinon le navigateur bloque la fenêtre)
    const out = await backend.handle('GET', '/api/invoices/file', q, {});
    if (!out.file) { if (w) w.close(); return toast((out.json && out.json.error) || 'Ouverture impossible'); }
    const url = URL.createObjectURL(new Blob([out.file], { type: out.type }));
    if (w) w.location.href = url; else saveFile(new File([out.file], out.filename, { type: out.type }));
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
});
function invGo(m) { invMonth = m; invData = null; invMemoOpen = null; renderInvoices(); loadInvoices(); }
$('#invOpen').onclick = () => { go('invoices'); renderInvoices(); loadInvoices(); };
$('#invPrev').onclick = () => invGo(addMonth(invMonth, -1));
$('#invNext').onclick = () => invGo(addMonth(invMonth, 1));

// ----- Roulement foot et dimanches d'ouverture (tour de rôle fixe, compteurs de la saison) -----
function renderDuty() {
  const du = data.duty;
  if (!du) return;
  $('#dutySeason').textContent = `· saison ${du.season}`;
  const row = id => du.rows.find(r => r.id === id) || { name: id, foot: 0, sunday: 0, holiday: 0 };
  const ro = document.body.classList.contains('readonly') || document.body.classList.contains('employee');
  const table = (kind, head, cells) => `<tr><th>#</th><th>${head}</th>${cells.map(c => `<th>${c[0]}</th>`).join('')}${ro ? '' : '<th></th>'}</tr>`
    + du.order[kind].map((id, k) => `<tr class="${du.next[kind] === id ? 'next' : ''}"><td>${k + 1}</td><td>${esc(row(id).name)}${du.next[kind] === id ? ' <span class="badge foot">prochain</span>' : ''}</td>
      ${cells.map(c => `<td>${row(id)[c[1]]}</td>`).join('')}
      ${ro ? '' : `<td class="duty-move"><button class="ghost" data-duty="${kind}" data-i="${k}" data-d="-1" ${k ? '' : 'disabled'} title="Monter">↑</button><button class="ghost" data-duty="${kind}" data-i="${k}" data-d="1" ${k < du.order[kind].length - 1 ? '' : 'disabled'} title="Descendre">↓</button></td>`}</tr>`).join('');
  $('#dutyFoot').innerHTML = table('foot', 'Ordre foot ⚽', [['Matchs', 'foot']]);
  $('#dutySunday').innerHTML = table('sunday', 'Ordre dimanches', [['Dim. ouverture', 'sunday'], ['Fériés travaillés', 'holiday']]);
}
for (const id of ['#dutyFoot', '#dutySunday']) $(id).addEventListener('click', e => {
  const b = e.target.closest('button[data-duty]'); if (!b) return;
  const kind = b.dataset.duty, i = Number(b.dataset.i), j = i + Number(b.dataset.d);
  const order = data.duty.order[kind].slice();
  [order[i], order[j]] = [order[j], order[i]];
  api('/api/config', { dutyOrder: { [kind]: order } }).then(() => toast('Ordre enregistré : régénère le mois pour l\'appliquer')).catch(() => {});
});

// ----- Apparence : nouveau thème (inspiré de Shyfter) ou classique, gardé sur cet appareil -----
function renderThemePick() {
  const cur = document.documentElement.classList.contains('theme-new') ? 'new' : 'classic';
  document.querySelectorAll('#themePick [data-theme]').forEach(b => b.classList.toggle('on', b.dataset.theme === cur));
}
$('#themePick').addEventListener('click', e => {
  const b = e.target.closest('[data-theme]'); if (!b) return;
  document.documentElement.classList.toggle('theme-new', b.dataset.theme === 'new');
  try { localStorage.setItem('theme', b.dataset.theme); } catch {}
  renderThemePick();
});
renderThemePick();

// ----- Équipe -----
let team = [];
// Groupes de week-end : 2 personnes (encore en poste) maximum ; « Nouveau groupe » en crée un.
const activeMember = t => !t.end || t.end >= today();
function groupCount() { return Math.max(data.config.rotation.groups.length, ...team.map(t => Number(t.group) + 1)); }
function groupOptions(i) {
  const n = groupCount(), me = team[i];
  let h = '';
  for (let g = 0; g < n; g++) {
    const others = team.filter((t, k) => k !== i && Number(t.group) === g && activeMember(t));
    const names = team.filter(t => Number(t.group) === g && activeMember(t)).map(t => t.name || '…');
    const full = others.length >= 2 && activeMember(me);
    h += `<option value="${g}" ${Number(me.group) === g ? 'selected' : ''} ${full && Number(me.group) !== g ? 'disabled' : ''}>Groupe ${g + 1}${names.length ? ' (' + esc(names.join(', ')) + ')' : ' (vide)'}${full && Number(me.group) !== g ? ' — complet' : ''}</option>`;
  }
  return h + `<option value="${n}">+ Nouveau groupe</option>`;
}
// Prénom et nom séparés à l'écran ; l'outil garde « Prénom Nom ».
const firstOf = n => String(n || '').trim().split(/\s+/)[0] || '';
const lastOf = n => String(n || '').trim().split(/\s+/).slice(1).join(' ');
let teamRemove = null; // ligne dont on choisit comment la retirer
function renderTeam() {
  const gone = t => t.end && t.end < today();
  const order = team.map((t, i) => i).sort((a, b) => (gone(team[a]) ? 1 : 0) - (gone(team[b]) ? 1 : 0));
  $('#teamList').innerHTML = order.map(i => {
    const t = team[i], f = t.first !== undefined ? t.first : firstOf(t.name), l = t.last !== undefined ? t.last : lastOf(t.name);
    const ask = teamRemove === i && t.id;
    return `<div class="emp-row ${gone(t) ? 'gone' : ''}">
      <i class="hrx-av ${t.id ? hrAv(t.id) : 'c0'}">${esc(initials(`${f} ${l}`) || '+')}</i>
      <label>Prénom<input type="text" data-i="${i}" data-k="first" value="${esc(f)}" placeholder="Prénom"></label>
      <label>Nom<input type="text" data-i="${i}" data-k="last" value="${esc(l)}" placeholder="Nom de famille"></label>
      <div class="emp-act">${gone(t) ? `<span class="tag">Parti le ${fmtDate(t.end)}</span>` : ''}<button type="button" class="ghost emp-rm" data-rm="${i}" title="Retirer ${esc(f)} de l'équipe">Retirer</button></div>
      ${ask ? `<div class="emp-ask">
        <b>Retirer ${esc(f)} de l'équipe ?</b>
        <div class="row"><label>Dernier jour de travail <input type="date" id="empLastDay" value="${t.end || today()}"></label>
          <button type="button" class="primary" data-leave="${i}">Il part (garde son historique)</button></div>
        <div class="row"><button type="button" class="danger" data-del="${i}">Supprimer définitivement (efface aussi son historique)</button>
          <button type="button" class="ghost" data-cancel="1">Annuler</button></div>
      </div>` : ''}
    </div>`;
  }).join('') || '<p class="muted">Personne dans l\'équipe pour le moment.</p>';
}
// Modifications pas encore enregistrées : on ne les écrase pas quand la page se redessine.
let teamDirty = false;
function loadTeam(force) {
  if (teamDirty && !force) return;
  const c = data.config;
  team = c.employees.map(e => ({ ...e, group: c.rotation.groups.findIndex(g => g.includes(e.id)) }));
  $('#chefNameInput').value = c.chef.name;
  teamDirty = false; $('#teamErr').hidden = true;
  renderTeam();
}
$('#openTeam').onclick = () => { loadTeam(true); loadGroups(true); renderPay(); $('#teamDlg').showModal(); };
$('#teamChefBtn').onclick = () => openChef();
$('#teamList').addEventListener('change', e => {
  const { i, k } = e.target.dataset; if (i === undefined) return;
  const t = team[i]; teamDirty = true;
  if (k === 'first' || k === 'last') {
    if (t.first === undefined) { t.first = firstOf(t.name); t.last = lastOf(t.name); }
    t[k] = e.target.value.trim();
    t.name = `${t.first} ${t.last}`.trim();
  } else t[k] = e.target.value;
  renderTeam();
});
$('#teamList').addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.cancel) { teamRemove = null; return renderTeam(); }
  if (b.dataset.rm !== undefined) {
    const i = Number(b.dataset.rm);
    // Pas encore enregistré : on enlève simplement la ligne ; sinon on demande comment.
    if (!team[i].id) { team.splice(i, 1); teamRemove = null; return renderTeam(); }
    teamRemove = teamRemove === i ? null : i; return renderTeam();
  }
  const leave = b.dataset.leave, del = b.dataset.del;
  if (leave === undefined && del === undefined) return;
  const t = team[Number(leave !== undefined ? leave : del)];
  const body = leave !== undefined ? { action: 'leave', end: $('#empLastDay').value } : { action: 'delete' };
  if (leave !== undefined && !body.end) return toast('Indique le dernier jour de travail');
  if (del !== undefined && !confirm(`Supprimer définitivement ${t.name} et tout son historique ? C'est irréversible.`)) return;
  b.disabled = true;
  try {
    await api('/api/employee', { ...body, id: t.id, regenerate: true });
    teamRemove = null; teamDirty = false; loadTeam(true); loadGroups(true);
    toast(leave !== undefined ? `${firstOf(t.name)} ne sera plus dans le planning après le ${fmtDate(body.end)}.` : `${t.name} supprimé.`);
  } catch { b.disabled = false; }
});
// Nouvelle personne : dans le premier groupe qui a encore de la place, sinon dans un nouveau groupe.
$('#teamAdd').onclick = () => {
  const n = groupCount();
  let g = 0;
  while (g < n && team.filter(t => Number(t.group) === g && activeMember(t)).length >= 2) g++;
  team.push({ name: '', note: '', group: g, start: today() }); teamDirty = true;
  renderTeam(); $('#teamList tr:last-child input').focus();
};
$('#teamSave').onclick = async () => {
  $('#teamErr').hidden = true;
  try {
    if (team.some(t => !String(t.name || '').trim())) throw new Error('il manque un prénom');
    await api('/api/team', { employees: team.map(({ first, last, ...t }) => t), chefName: $('#chefNameInput').value });
  } catch (err) {
    $('#teamErr').textContent = `Pas enregistré : ${err.message}`; $('#teamErr').hidden = false;
    return;
  }
  loadTeam(true); loadGroups(true); toast('Équipe enregistrée');
};

// ----- Fiche salaires : infos par personne (nom de famille, statut, catégorie, heures) et téléchargement -----
function renderPay() {
  if (!data || data.account.role !== 'admin') return;
  const pi = data.config.payInfo || {};
  const people = [...(data.config.parkChief && data.config.parkChief.name ? [{ id: 'chef-parc', name: data.config.parkChief.name, role: 'Chef de parc' }] : []),
    { id: data.config.chef.id, name: data.config.chef.name, role: 'Chef terrain' }, ...activeEmps().map(e => ({ id: e.id, name: e.name, role: e.note || '' }))];
  $('#payList').innerHTML = '<tr><th>Prénom</th><th>Nom de famille</th><th>Statut</th><th>Catégorie</th><th>Heures</th></tr>' + people.map(p => {
    const x = pi[p.id] || {};
    return `<tr data-pid="${p.id}"><td><b>${esc(p.name.split(' ')[0])}</b> <small class="muted">${esc(p.role)}</small></td>
      <td><input data-k="lastName" value="${esc(x.lastName || p.name.split(' ').slice(1).join(' ').toUpperCase())}"></td>
      <td><select data-k="statut">${[['E', 'E · Employé'], ['O', 'O · Ouvrier']].map(([v, l]) => `<option value="${v}" ${(x.statut || 'E') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
      <td><input data-k="categorie" value="${esc(x.categorie || '')}" style="width:70px"></td>
      <td><input data-k="heures" value="${esc(x.heures || '40h')}" style="width:70px"></td></tr>`;
  }).join('');
}
$('#paySave').onclick = async () => {
  const people = {};
  document.querySelectorAll('#payList tr[data-pid]').forEach(tr => { people[tr.dataset.pid] = Object.fromEntries([...tr.querySelectorAll('[data-k]')].map(i => [i.dataset.k, i.value])); });
  await api('/api/hr/payinfo', { people }).then(() => toast('Infos de la fiche salaires enregistrées')).catch(() => {});
};
const payDownload = () => downloadXlsx('/api/export-salaires.xlsx', {});
$('#payDownload').onclick = payDownload;
$('#payXlsx').onclick = payDownload;

// ----- Groupes de week-end : une colonne par groupe, on déplace les prénoms -----
let grp = null, grpSel = null, grpDirty = false;
const grpName = id => (data.config.employees.find(e => e.id === id) || {}).name || id;
const grpActive = id => { const e = data.config.employees.find(x => x.id === id); return !!e && (!e.end || e.end >= today()); };
function loadGroups(force) {
  if (grpDirty && !force) return;
  const c = data.config;
  grp = c.rotation.groups.map(g => g.slice());
  // Une personne active sans groupe va dans le premier groupe qui a de la place.
  for (const e of c.employees) if (grpActive(e.id) && !grp.some(g => g.includes(e.id))) {
    let k = grp.findIndex(g => g.filter(grpActive).length < 2); if (k < 0) { grp.push([]); k = grp.length - 1; }
    grp[k].push(e.id);
  }
  grpDirty = false; grpSel = null; renderGroups();
}
// Prochain samedi de week-end obligatoire de chaque groupe (roulement actuel).
function grpNextWeekend(k) {
  const r = data.config.rotation, n = grp.length; if (!n) return null;
  let sat = localDay(); while (new Date(sat + 'T12:00:00').getDay() !== 6) sat = addDay(sat, 1);
  for (let w = 0; w < n * 2; w++) {
    const d = addDay(sat, 7 * w), weeks = Math.round((new Date(d + 'T12:00:00') - new Date(r.refSaturday + 'T12:00:00')) / 6048e5);
    if ((((r.refGroup + weeks) % n) + n) % n === k) return d;
  }
  return null;
}
function renderGroups() {
  if (!grp) return;
  const actives = data.config.employees.filter(e => grpActive(e.id));
  const groupOf = id => grp.findIndex(g => g.includes(id));
  const rows = grp.map((g, k) => {
    const people = g.filter(grpActive), nw = grpNextWeekend(k), nd = nw && new Date(nw + 'T12:00:00');
    const sel = s => `<select data-g="${k}" data-s="${s}" class="${s >= people.length ? 'grp-add' : ''}"><option value="">${s >= people.length ? '+ ajouter une personne' : '— retirer —'}</option>${actives.map(e => {
      const o = groupOf(e.id);
      return `<option value="${e.id}" ${people[s] === e.id ? 'selected' : ''}>${esc(e.name)}${o >= 0 && o !== k ? ` (Groupe ${o + 1})` : ''}</option>`;
    }).join('')}</select>`;
    return `<div class="grp-row"><div class="grp-name"><b>Groupe ${k + 1}</b>${nd ? `<small>week-end le ${nd.getDate()}/${nd.getMonth() + 1}</small>` : ''}</div>
      <div class="grp-people">${people.map((_, s) => sel(s)).join('')}${sel(people.length)}</div><button type="button" class="ghost grp-del" data-del="${k}" title="Supprimer le Groupe ${k + 1}">✕</button></div>`;
  }).join('');
  const alone = actives.filter(e => groupOf(e.id) < 0);
  $('#grpBoard').innerHTML = rows + `<button type="button" id="grpAdd">+ Créer un groupe</button>`
    + (alone.length ? `<p class="grp-warn">Sans groupe : ${alone.map(e => esc(e.name)).join(', ')}. Choisis-leur un groupe avant d'enregistrer.</p>` : '');
  const used = grp.filter(g => g.some(grpActive)).length;
  $('#grpInfo').textContent = `${used} groupe${used > 1 ? 's' : ''} : week-end obligatoire toutes les ${used} semaines`;
  $('#grpSave').disabled = !grpDirty; $('#grpReset').hidden = !grpDirty;
}
// Choisir une personne pour un groupe : elle quitte son ancien groupe.
$('#grpBoard').addEventListener('change', e => {
  const s = e.target.closest('select[data-g]'); if (!s) return;
  const k = Number(s.dataset.g), slot = Number(s.dataset.s), id = s.value;
  const people = grp[k].filter(grpActive), gone = grp[k].filter(x => !grpActive(x));
  if (id) grp.forEach(g => { const i = g.indexOf(id); if (i >= 0) g.splice(i, 1); });
  const now = people.filter(x => x !== id);
  if (id) now.splice(Math.min(slot, now.length), 0, id); else now.splice(slot, 1);
  grp[k] = [...gone, ...now];
  grpDirty = true; $('#grpErr').hidden = true; renderGroups();
});
$('#grpBoard').addEventListener('click', e => {
  if (e.target.closest('#grpAdd')) { grp.push([]); grpDirty = true; return renderGroups(); }
  const d = e.target.closest('[data-del]'); if (!d) return;
  const k = Number(d.dataset.del), names = grp[k].filter(grpActive).map(grpName);
  if (names.length && !confirm(`Supprimer le Groupe ${k + 1} ? ${names.join(' et ')} n'auront plus de groupe.`)) return;
  grp.splice(k, 1); grpDirty = true; renderGroups();
});
$('#grpReset').onclick = () => loadGroups(true);
$('#grpSave').onclick = async () => {
  $('#grpErr').hidden = true;
  const alone = data.config.employees.filter(e => grpActive(e.id) && !grp.some(g => g.includes(e.id)));
  if (alone.length) { $('#grpErr').textContent = 'Sans groupe : ' + alone.map(e => e.name).join(', '); $('#grpErr').hidden = false; return; }
  if (grp.some(g => g.filter(grpActive).length === 0)) grp = grp.filter(g => g.some(grpActive) || g.length);
  try { await api('/api/groups', { groups: grp }); }
  catch (err) { $('#grpErr').textContent = 'Pas enregistré : ' + err.message; $('#grpErr').hidden = false; return; }
  grpDirty = false; loadGroups(true); loadTeam(true);
  toast("Groupes enregistrés. L'horaire déjà fait ne change pas : ils s'appliqueront au prochain « Générer le mois ».");
};

// Semaine figée : un clic dans l'horaire ne fait que prévenir.
$('#grid').addEventListener('click', e => {
  const c = e.target.closest('td.frozen, th.frozen'); if (!c) return;
  e.stopImmediatePropagation(); e.preventDefault();
  toast('Semaine figée (horaire reçu) : impossible de la modifier.');
}, true);
// ----- Actions -----
$('#prev').onclick = () => { month = addMonth(month, -1); api('/api/state'); };
$('#next').onclick = () => { month = addMonth(month, 1); api('/api/state'); };
$('#print').onclick = () => window.print();
$('#generate').onclick = async e => {
  if (data.view.generated && !confirm('Régénérer le mois ? Les cases non verrouillées seront remplacées.')) return;
  const b = $('#generate');
  b.disabled = true; b.textContent = 'Calcul en cours…';
  try { await api('/api/generate', {}); toast('Planning généré'); } finally { b.disabled = false; b.innerHTML = 'Générer<span class="long"> le mois</span>'; }
};

// ----- Connexion -----
const loginMsg = (text, ok) => { $('#lMsg').textContent = text || ''; $('#lMsg').classList.toggle('ok', !!ok); };
function showLogin() {
  document.querySelectorAll('dialog[open]').forEach(d => d.close());
  $('#login').hidden = false;
  $('#loginForm').hidden = false; $('#forgotForm').hidden = true; $('#resetForm').hidden = true;
  $('#lPass').value = '';
  $('#lEmail').focus();
}
async function busy(btn, fn) {
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = 'Un instant…';
  try { await fn(); } catch (e) { loginMsg(e.message); } finally { btn.disabled = false; btn.textContent = label; }
}
$('#loginForm').onsubmit = e => {
  e.preventDefault(); loginMsg('');
  busy($('#lSubmit'), async () => {
    await authCall('/api/auth/login', { email: $('#lEmail').value, password: $('#lPass').value });
    $('#login').hidden = true;
    await api('/api/state');
    // Lien du PDF RH ouvert avant la connexion : on y va maintenant.
    try { if (sessionStorage.getItem('deepLink')) restorePage(); } catch {}
  });
};
$('#lForgot').onclick = () => {
  loginMsg('');
  $('#loginForm').hidden = true; $('#forgotForm').hidden = false;
  $('#fEmail').value = $('#lEmail').value;
  $('#fEmail').focus();
};
$('#fBack').onclick = () => { loginMsg(''); $('#forgotForm').hidden = true; $('#loginForm').hidden = false; };
$('#forgotForm').onsubmit = e => {
  e.preventDefault(); loginMsg('');
  busy($('#fSend'), async () => {
    await authCall('/api/auth/forgot', { email: $('#fEmail').value });
    loginMsg('Si cette adresse a un compte, un email vient d\'être envoyé (regarde aussi dans les spams). Clique sur « Reset password » dans l\'email.', true);
  });
};
// Arrivée depuis le lien de l'email : choisir le nouveau mot de passe.
let activation = null; // lien d'invitation en attente : { token, type }
$('#resetForm').onsubmit = e => {
  e.preventDefault(); loginMsg('');
  if ($('#rPass').value !== $('#rPass2').value) return loginMsg('Les deux mots de passe ne sont pas identiques.');
  busy($('#rSave'), async () => {
    if (activation) { await authCall('/api/auth/activate', { ...activation, password: $('#rPass').value }); activation = null; }
    else await authCall('/api/auth/password', { password: $('#rPass').value });
    history.replaceState(null, '', location.pathname);
    $('#login').hidden = true;
    await api('/api/state');
    toast('Mot de passe changé');
  });
};
$('#accountBtn').onclick = () => { $('#accPass').value = ''; $('#accountDlg').showModal(); };
$('#accSave').onclick = async () => {
  try {
    await authCall('/api/auth/password', { password: $('#accPass').value });
    $('#accPass').value = ''; $('#accountDlg').close(); toast('Mot de passe changé');
  } catch (e) { toast(e.message); }
};
$('#accLogout').onclick = async () => {
  await authCall('/api/auth/logout', {});
  data = null;
  showLogin();
};

// ----- Mises à jour (seulement dans l'application Windows) -----
if (window.planningApp) {
  window.planningApp.version().then(v => { $('#appVersion').hidden = false; $('#appVersion').textContent = `Planning Interparking, version ${v}`; });
  window.planningApp.onUpdateReady(v => {
    $('#updateText').textContent = `Une nouvelle version (${v}) est prête.`;
    $('#updateBar').hidden = false;
  });
  $('#updateNow').onclick = () => window.planningApp.installUpdate();
  $('#updateLater').onclick = () => { $('#updateBar').hidden = true; toast('La mise à jour s\'installera à la fermeture du planning'); };
}

// Version web : export Excel fabriqué dans la page.
if (backend) $('#csv').addEventListener('click', async e => {
  e.preventDefault();
  const out = await backend.handle('GET', '/api/export.xlsx', { month }, {});
  if (!out.xlsx) return toast((out.json && out.json.error) || 'Export impossible');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([out.xlsx], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  a.download = out.filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
// Version web : icône installable (application sur le bureau).
if (backend && 'serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

(async () => {
  const params = new URLSearchParams(location.search);
  const here = location.pathname;
  // Version web : retour du lien « mot de passe oublié » (#access_token=…&type=recovery, ou #error=…).
  const hash = location.hash.slice(1);
  // Lien du PDF du dossier RH (#rh=<personne>&note=… ou &fichier=…) : gardé le temps de se connecter.
  if (/(^|&)rh=/.test(hash)) {
    const p = new URLSearchParams(hash);
    try { sessionStorage.setItem('deepLink', JSON.stringify({ emp: p.get('rh'), note: p.get('note') || null, file: p.get('fichier') || null })); } catch {}
    history.replaceState(null, '', here + location.search);
  }
  // Lien d'invitation de l'outil : on garde le code, la personne choisit son mot de passe (le code sert à ce moment-là).
  if (backend && /(^|&)activer=/.test(hash)) {
    const p = new URLSearchParams(hash);
    activation = { token: p.get('activer'), type: p.get('type') || 'invite' };
    history.replaceState(null, '', here);
    showLogin();
    $('#loginForm').hidden = true; $('#resetForm').hidden = false;
    $('#resetForm p.muted').textContent = 'Bienvenue ! Choisis ton mot de passe (6 caractères minimum). Tu te connecteras ensuite avec ton adresse e-mail et ce mot de passe.';
    $('#rSave').textContent = 'Enregistrer et ouvrir mon espace';
    $('#rPass').focus();
    return;
  }
  if (backend && /type=(recovery|invite)|error_description=/.test(hash)) {
    history.replaceState(null, '', here);
    if (/type=invite/.test(hash)) params.set('invite', '1');
    try { await backend.recoverFromLink(hash); params.set('reset', '1'); } catch (e) { params.set('resetError', e.message); }
  }
  const s = await authCall('/api/auth/status');
  if (params.has('reset') && s.loggedIn) {
    showLogin();
    $('#loginForm').hidden = true; $('#resetForm').hidden = false;
    if (params.has('invite')) {
      $('#resetForm p.muted').textContent = 'Bienvenue ! Choisis ton mot de passe (6 caractères minimum). Tu te connecteras ensuite avec ton adresse e-mail et ce mot de passe.';
      $('#rSave').textContent = 'Enregistrer et ouvrir mon espace';
    }
    $('#rPass').focus();
  } else if (s.mode === 'cloud' && !s.loggedIn) {
    showLogin();
    if (params.has('resetError')) loginMsg(params.get('resetError'));
    history.replaceState(null, '', here);
  } else api('/api/state').then(restorePage).then(loadBell);
})();
function restorePage() {
  if (data && data.account.role === 'employee') return go('me');
  let deep = null;
  try { deep = JSON.parse(sessionStorage.getItem('deepLink') || 'null'); sessionStorage.removeItem('deepLink'); } catch {}
  if (deep && openDeepLink(deep)) return;
  if (rfOn()) return openTab(rfTab);
  let p = 'dashboard';
  try { p = localStorage.getItem('page') || p; } catch {}
  const nav = document.querySelector(`.nav[data-go="${p}"]`);
  if (nav && nav.onclick) nav.click(); else go(p);
}
