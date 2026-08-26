(function () {
  'use strict';

  var $ = function (sel) { return document.querySelector(sel); };
  var $$ = function (sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); };
  var pad = function (n) { return (n < 10 ? '0' : '') + n; };
  var now = function () {
    var d = new Date();
    return '[' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) + ']';
  };

  var DEFAULT_ENDPOINT = 'http://localhost:1234';
  var STORAGE_KEY = 'lmbench.history.v1';

  var TASKS = [
    {
      id: 'code',
      name: 'Code generation',
      desc: 'Merge intervals in TypeScript',
      system: 'You are a senior TypeScript engineer. Answer with a single code block and no commentary.',
      prompt: 'Write a TypeScript function that takes an array of numeric intervals, where each interval is a tuple [start, end], and returns the merged set of intervals as a new array. Example: [[1,3],[2,6],[8,10],[15,18]] becomes [[1,6],[8,10],[15,18]]. Include a short type alias for the interval and handle an empty input.',
      rubric: function (c) {
        var fences = (c.match(/```/g) || []).length;
        if (fences >= 2) return 'strong';
        if (/function|=>|interface|const\s+\w+.*=/i.test(c)) return 'pass';
        return 'partial';
      }
    },
    {
      id: 'reason',
      name: 'Constrained reasoning',
      desc: 'Four-digit palindromes and divisibility',
      system: 'Think step by step, then put the final answer on its own line.',
      prompt: 'Every four-digit palindrome reads the same forwards and backwards, such as 1221 or 8558. Prove that every four-digit palindrome is divisible by 11. Give the general argument, then state the conclusion on its own line.',
      rubric: function (c) {
        var lc = c.toLowerCase();
        if (/divisib/.test(lc) && /(^|[^0-9])11([^0-9]|$)/.test(c)) return 'strong';
        if (/divisib/.test(lc) || c.indexOf('11') !== -1) return 'pass';
        return 'miss';
      }
    },
    {
      id: 'prose',
      name: 'Long-form writing',
      desc: 'A 300-word field note',
      system: 'You are a working writer. Plain sentences, concrete detail, no flourish.',
      prompt: 'Write a field note of roughly 300 words describing a small hardware store at dawn. Anchor it in one specific object on a shelf, one sound, and one person behind the counter. Do not summarize; show the room.',
      rubric: function (c) {
        var words = (c.trim().match(/\S+/g) || []).length;
        if (words >= 180 && words <= 420) return 'strong';
        if (words >= 90 && words <= 900) return 'pass';
        return 'partial';
      }
    },
    {
      id: 'json',
      name: 'Structured extraction',
      desc: 'JSON record from a job post',
      system: 'Return valid JSON only. No markdown, no prose.',
      prompt: 'Extract these fields from the job description below and return a JSON object with exactly the keys "role", "company", "years", "remote": the role title, the company name, the years of experience required as a number, and whether the role is remote as a boolean. Job description: "We are hiring a Staff Platform Engineer at Northbeam to own the local development toolchain. Candidates need at least 7 years of backend experience. This position is fully remote."',
      rubric: function (c) {
        try { JSON.parse(c.trim()); return 'strong'; } catch (e) {}
        if (c.indexOf('{') !== -1) return 'pass';
        return 'miss';
      }
    }
  ];

  var QUALITY_LABEL = { strong: 'Strong', pass: 'Pass', partial: 'Partial', miss: 'Miss', failed: 'Failed' };
  var QUALITY_CLASS = { strong: 'green', pass: 'blue', partial: 'yellow', miss: 'red', failed: 'red' };
  var QUALITY_SCORE = { strong: 3, pass: 2, partial: 1, miss: 0, failed: 0 };

  var state = {
    endpoint: DEFAULT_ENDPOINT,
    models: [],
    tasks: [],
    running: false,
    aborted: false,
    controller: null,
    results: [],
    archive: [],
    windowSort: 'speed',
    windowExpanded: false,
    modelColWidth: 200
  };

  var els = {
    navDot: $('#nav-dot'),
    navStatusText: $('#nav-status-text'),
    serverStatus: $('#server-status'),
    endpoint: $('#endpoint'),
    btnCheck: $('#btn-check'),
    modelList: $('#model-list'),
    modelEmpty: $('#model-empty'),
    btnModelToggle: $('#btn-model-toggle'),
    taskList: $('#task-list'),
    repeats: $('#repeats'),
    maxTokens: $('#max-tokens'),
    btnRun: $('#btn-run'),
    btnStop: $('#btn-stop'),
    progressWrap: $('#progress-wrap'),
    progressBar: $('#progress-bar'),
    progressText: $('#progress-text'),
    log: $('#log'),
    logCount: $('#log-count'),
    chartState: $('#chart-state'),
    chartValue: $('#chart-value'),
    results: $('#results'),
    statFast: $('#stat-fast'),
    statFastSub: $('#stat-fast-sub'),
    statQuality: $('#stat-quality'),
    statQualitySub: $('#stat-quality-sub'),
    statCells: $('#stat-cells'),
    statCellsSub: $('#stat-cells-sub'),
    board: $('#board tbody'),
    runTable: $('#runtable tbody'),
    historyList: $('#history-list'),
    historyEmpty: $('#history-empty'),
    btnClear: $('#btn-clear'),
    btnTheme: $('#btn-theme'),
    winRows: $('#win-rows'),
    winTable: $('#win-table'),
    winSummary: $('#win-summary'),
    winCaption: $('#win-caption'),
    winEmpty: $('#win-empty'),
    winExpand: $('#win-expand'),
    btnDownload: $('#btn-download')
  };

  var THEME_KEY = 'lmbench.theme';

  function currentTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (e) {}
    if (saved === 'dark' || saved === 'light') return saved;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(THEME_KEY, t); } catch (e) {}
  }

  function isDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  function chartColors() {
    if (isDark()) {
      return {
        ink: '#ECEAE6',
        faint: '#6E6960',
        grid: 'rgba(255,255,255,0.07)',
        gridSoft: 'rgba(255,255,255,0.05)',
        fillTop: 'rgba(236,234,230,0.07)',
        fillBottom: 'rgba(236,234,230,0)',
        surface: '#201D1A'
      };
    }
    return {
      ink: '#111111',
      faint: '#A8A5A0',
      grid: 'rgba(0,0,0,0.06)',
      gridSoft: 'rgba(0,0,0,0.04)',
      fillTop: 'rgba(17,17,17,0.07)',
      fillBottom: 'rgba(17,17,17,0)',
      surface: '#FFFFFF'
    };
  }

  function loadArchive() {
    loadModelColWidth();
    try {
      state.archive = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
    } catch (e) {
      state.archive = [];
    }
    renderHistory();
    renderWindow();
  }

  function saveArchive() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.archive));
    } catch (e) {}
  }

  var COL_WIDTH_KEY = 'lmbench.modelColWidth';

  function loadModelColWidth() {
    try {
      var saved = localStorage.getItem(COL_WIDTH_KEY);
      if (saved) {
        var w = parseInt(saved, 10);
        if (!isNaN(w) && w >= 100 && w <= 800) {
          state.modelColWidth = w;
        }
      }
    } catch (e) {}
  }

  function saveModelColWidth(w) {
    try {
      localStorage.setItem(COL_WIDTH_KEY, String(w));
    } catch (e) {}
  }

  function applyModelColWidth() {
    var modelCells = els.winRows.querySelectorAll('.win-model');
    var modelHeader = els.winTable.querySelector('th.resizable');
    if (modelHeader) {
      modelHeader.style.width = state.modelColWidth + 'px';
    }
    modelCells.forEach(function (cell) {
      cell.style.maxWidth = state.modelColWidth + 'px';
    });
  }

  function initModelColResize() {
    var handle = els.winTable.querySelector('.resize-handle');
    var header = els.winTable.querySelector('th.resizable');
    if (!handle || !header) return;

    var startX = 0;
    var startWidth = 0;

    function onMouseMove(e) {
      var dx = e.clientX - startX;
      var newWidth = Math.max(100, Math.min(800, startWidth + dx));
      header.style.width = newWidth + 'px';
      var modelCells = els.winRows.querySelectorAll('.win-model');
      modelCells.forEach(function (cell) {
        cell.style.maxWidth = newWidth + 'px';
      });
    }

    function onMouseUp() {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      header.classList.remove('resizing');
      handle.classList.remove('dragging');
      saveModelColWidth(state.modelColWidth);
      state.modelColWidth = header.offsetWidth;
    }

    handle.addEventListener('mousedown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      startX = e.clientX;
      startWidth = header.offsetWidth;
      header.classList.add('resizing');
      handle.classList.add('dragging');
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
    });
  }

  function renderHistory() {
    els.historyEmpty.hidden = state.archive.length > 0;
    els.btnClear.hidden = state.archive.length === 0;
    els.historyList.innerHTML = '';
    state.archive.forEach(function (entry) {
      var d = new Date(entry.ts);
      var stamp = pad(d.getMonth() + 1) + '.' + pad(d.getDate()) + '.' + d.getFullYear() + '  ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
      var item = document.createElement('article');
      item.className = 'history-item';
      item.innerHTML =
        '<span class="h-ts">' + stamp + '</span>' +
        '<div class="h-fast">' + entry.fastest + '</div>' +
        '<div class="h-meta">' +
        'mean ' + entry.meanTps.toFixed(1) + ' tok/s across ' + entry.models + ' models<br>' +
        entry.cells + ' cells · ' + entry.workloads + ' workloads</div>';
      els.historyList.appendChild(item);
    });
  }

  var WINDOW_SHOWN = 4;

  function modelRowsFromArchive() {
    var latest = {};
    state.archive.forEach(function (entry) {
      if (!entry.rows) return;
      entry.rows.forEach(function (r) {
        if (!latest[r.model]) latest[r.model] = { model: r.model, tps: r.tps, latencyMs: r.latencyMs, quality: r.quality, ts: entry.ts };
      });
    });
    return Object.keys(latest).map(function (id) { return latest[id]; });
  }

  function sortedModelRows() {
    var rows = modelRowsFromArchive();
    if (state.windowSort === 'recent') {
      rows.sort(function (a, b) { return b.ts - a.ts; });
    } else {
      rows.sort(function (a, b) { return b.tps - a.tps; });
    }
    return rows;
  }

  function recomputeEntry(entry) {
    var fastest = entry.rows.slice().sort(function (a, b) { return b.tps - a.tps; })[0];
    entry.models = entry.rows.length;
    entry.fastest = fastest ? fastest.model.split('/').pop() : '\u2014';
    entry.meanTps = fastest ? fastest.tps : 0;
  }

  function deleteModel(modelId) {
    var removed = false;
    state.archive = state.archive.filter(function (entry) {
      if (!entry.rows) return true;
      var before = entry.rows.length;
      entry.rows = entry.rows.filter(function (r) { return r.model !== modelId; });
      if (entry.rows.length === before) return true;
      removed = true;
      if (entry.rows.length === 0) return false;
      recomputeEntry(entry);
      return true;
    });
    if (!removed) return;
    saveArchive();
    renderHistory();
    renderWindow();
  }

  function renderWindow() {
    var rows = sortedModelRows();
    var hasRows = rows.length > 0;

    els.winTable.hidden = !hasRows;
    els.winEmpty.hidden = hasRows;
    els.winExpand.hidden = true;
    els.winSummary.textContent = 'benchmark archive \u00b7 ' + rows.length + ' model' + (rows.length === 1 ? '' : 's');

    if (!hasRows) {
      els.winCaption.textContent = '';
      return;
    }

    var show = state.windowExpanded ? rows.length : Math.min(WINDOW_SHOWN, rows.length);
    var html = '';
    rows.forEach(function (r, i) {
      html += '<tr' + (i >= show ? ' hidden' : '') + '>' +
        '<td class="rank">' + (i + 1) + '</td>' +
        '<td class="mono win-model">' + r.model + '</td>' +
        '<td class="num mono">' + fmtTps(r.tps) + '</td>' +
        '<td class="num mono">' + fmtTime(r.latencyMs) + '</td>' +
        '<td>' + qualityBadge(r.quality) + '</td>' +
        '<td class="num"><button class="win-del" type="button" title="Remove from archive" data-del="' + r.model.replace(/"/g, '&quot;') + '">&times;</button></td>' +
        '</tr>';
    });
    els.winRows.innerHTML = html;

    applyModelColWidth();
    initModelColResize();

    if (state.windowExpanded) {
      els.winExpand.hidden = false;
      els.winExpand.textContent = 'Show less';
    } else {
      var more = rows.length - show;
      els.winExpand.hidden = more <= 0;
      els.winExpand.textContent = more > 0 ? 'Show ' + more + ' more' : 'Show less';
    }

    els.winCaption.textContent = state.windowSort === 'recent'
      ? 'Ranked by most recent run \u00b7 stored in localStorage \u00b7 delete removes the model from your archive.'
      : 'Ranked by latest-run tok/s \u00b7 stored in localStorage \u00b7 delete removes the model from your archive.';
  }

  function log(line, cls) {
    var div = document.createElement('div');
    div.className = cls ? 'line-' + cls : '';
    div.textContent = line;
    els.log.appendChild(div);
    els.log.scrollTop = els.log.scrollHeight;
  }

  function setNav(status, text) {
    els.navDot.className = 'status-dot ' + status;
    els.navStatusText.textContent = text;
  }

  function setServer(text, cls) {
    els.serverStatus.textContent = text;
    if (cls === 'ok') {
      els.serverStatus.style.color = 'var(--green-tx)';
    } else if (cls === 'err') {
      els.serverStatus.style.color = 'var(--red-tx)';
    } else {
      els.serverStatus.style.color = '';
    }
  }

  function endpoint() {
    var raw = els.endpoint.value.trim().replace(/\/+$/, '');
    return raw || DEFAULT_ENDPOINT;
  }

  function timeoutSignal(ms) {
    var ctrl = new AbortController();
    setTimeout(function () { ctrl.abort(); }, ms);
    return ctrl.signal;
  }

  function checkStatus() {
    var btn = els.btnCheck;
    var previous = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Checking';
    setNav('checking', 'Checking server');
    setServer('Checking server\u2026', 'idle');
    fetch(endpoint() + '/v1/models', { signal: timeoutSignal(4000) })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        var raw = (data && data.data) || [];
        state.models = raw.map(function (m) {
          var ctx = m.context_length || (m.meta && m.meta.context_length) || null;
          return { id: m.id, context: ctx ? ctx : null };
        });
        renderModels();
        setNav('online', state.models.length + ' model' + (state.models.length === 1 ? '' : 's') + ' loaded');
        setServer('Online \u2014 ' + state.models.length + ' model' + (state.models.length === 1 ? '' : 's') + ' discovered via /v1/models', 'ok');
      })
      .catch(function () {
        state.models = [];
        renderModels();
        setNav('offline', 'Server offline');
        setServer('Offline \u2014 start the LM Studio server, then check again.', 'err');
      })
      .then(function () {
        btn.disabled = false;
        btn.textContent = previous;
        updateRunButton();
      });
  }

  function renderModels() {
    els.modelList.innerHTML = '';
    var count = state.models.length;
    state.models.forEach(function (m) {
      var label = document.createElement('label');
      label.className = 'check';
      var ctx = m.context ? '<span class="model-ctx">' + Math.round(m.context / 1024) + 'k context</span>' : '';
      label.innerHTML =
        '<input type="checkbox" value="' + m.id.replace(/"/g, '&quot;') + '" checked>' +
        '<span class="check-box"></span>' +
        '<span class="check-text"><span class="model-id">' + m.id + '</span>' + ctx + '</span>';
      els.modelList.appendChild(label);
    });
    els.modelEmpty.hidden = count > 0;
    updateModelToggle();
    updateRunButton();
  }

  function updateModelToggle() {
    var total = state.models.length;
    if (total === 0) {
      els.btnModelToggle.disabled = true;
      els.btnModelToggle.textContent = 'Select all';
      return;
    }
    var checked = els.modelList.querySelectorAll('input:checked').length;
    var allOn = checked === total;
    els.btnModelToggle.disabled = false;
    els.btnModelToggle.textContent = allOn ? 'Unselect all' : 'Select all';
  }

  function renderTasks() {
    els.taskList.innerHTML = '';
    TASKS.forEach(function (t) {
      var label = document.createElement('label');
      label.className = 'check';
      label.innerHTML =
        '<input type="checkbox" value="' + t.id + '" checked>' +
        '<span class="check-box"></span>' +
        '<span class="check-text"><span class="task-name">' + t.name + '</span><span class="task-desc">' + t.desc + '</span></span>';
      els.taskList.appendChild(label);
    });
    updateRunButton();
  }

  function selectedModels() {
    return state.models.filter(function (m) {
      var input = els.modelList.querySelector('input[value="' + m.id.replace(/"/g, '&quot;') + '"]');
      return input && input.checked;
    });
  }

  function selectedTasks() {
    return TASKS.filter(function (t) {
      var input = els.taskList.querySelector('input[value="' + t.id + '"]');
      return input && input.checked;
    });
  }

  function updateRunButton() {
    var ok = !state.running && state.models.length > 0 && selectedModels().length > 0 && selectedTasks().length > 0;
    els.btnRun.disabled = !ok;
    els.btnRun.textContent = state.running ? 'Running\u2026' : 'Run benchmark';
  }

  function estimateTokens(content) {
    var words = (content.trim().match(/\S+/g) || []).length;
    return Math.max(1, Math.round(words * 1.35));
  }

  function abortError() {
    if (typeof DOMException === 'function') return new DOMException('aborted', 'AbortError');
    var e = new Error('aborted');
    e.name = 'AbortError';
    return e;
  }

  var CHART_WINDOW = 30;

  var chart = {
    canvas: null,
    ctx: null,
    dpr: 1,
    cssW: 0,
    cssH: 220,
    points: [],
    startTs: 0,
    lastTs: 0,
    lastTokens: 0,
    active: false,
    label: '',
    windowStart: 0
  };

  function niceCeil(v) {
    if (v <= 0) return 10;
    var exp = Math.floor(Math.log10(v));
    var base = Math.pow(10, exp);
    var f = v / base;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * base;
  }

  function rollingMean(i) {
    var p = chart.points[i];
    var sum = 0, n = 0;
    for (var j = i; j >= 0; j--) {
      var q = chart.points[j];
      if (p.t - q.t > 2) break;
      sum += q.v;
      n += 1;
    }
    return n ? sum / n : p.v;
  }

  function chartRender() {
    var c = chart;
    if (!c.ctx) return;
    var col = chartColors();
    var W = c.cssW, H = c.cssH;
    var padL = 40, padR = 14, padT = 18, padB = 26;
    var pw = W - padL - padR, ph = H - padT - padB;
    var ctx = c.ctx;
    ctx.clearRect(0, 0, W, H);
    ctx.font = '11px "JetBrains Mono", monospace';

    if (c.points.length < 2) {
      ctx.fillStyle = col.faint;
      ctx.textAlign = 'center';
      ctx.fillText(c.active ? 'streaming\u2026' : 'awaiting a run', W / 2, H / 2);
      return;
    }

    var lastT = c.points[c.points.length - 1].t;
    var xMax = Math.max(lastT, 5);
    var viewStart = c.active && xMax > CHART_WINDOW ? xMax - CHART_WINDOW : 0;
    var viewW = xMax - viewStart;

    var dataMax = 0;
    for (var di = 0; di < c.points.length; di++) {
      var dp = c.points[di];
      if (dp.t < viewStart) continue;
      if (dp.v > dataMax) dataMax = dp.v;
      var rv = rollingMean(di);
      if (rv > dataMax) dataMax = rv;
    }
    var yMax = niceCeil(dataMax);

    function X(t) { return padL + ((t - viewStart) / viewW) * pw; }
    function Y(v) { return padT + ph - (v / yMax) * ph; }

    ctx.textAlign = 'right';
    [0, 0.25, 0.5, 0.75, 1].forEach(function (f) {
      var y = Y(yMax * f);
      ctx.strokeStyle = col.grid;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(W - padR, y);
      ctx.stroke();
      ctx.fillStyle = col.faint;
      ctx.fillText(String(Math.round(yMax * f)), padL - 8, y + 3);
    });
    ctx.fillStyle = col.faint;
    ctx.textAlign = 'left';
    ctx.fillText('tok/s', padL, padT - 7);

    var tickStep = viewW > 20 ? 5 : 2;
    for (var s = Math.ceil(viewStart / tickStep) * tickStep; s <= xMax; s += tickStep) {
      var gx = X(s);
      ctx.strokeStyle = col.gridSoft;
      ctx.beginPath();
      ctx.moveTo(gx, padT);
      ctx.lineTo(gx, padT + ph);
      ctx.stroke();
      ctx.fillStyle = col.faint;
      ctx.fillText((s - viewStart) + 's', gx - 4, H - 6);
    }

    var firstVisible = 0;
    for (var fi = 0; fi < c.points.length; fi++) {
      if (c.points[fi].t >= viewStart) { firstVisible = fi; break; }
    }
    if (firstVisible > 0) firstVisible--;

    var last = c.points[c.points.length - 1];

    var grad = ctx.createLinearGradient(0, padT, 0, padT + ph);
    grad.addColorStop(0, col.fillTop);
    grad.addColorStop(1, col.fillBottom);
    ctx.beginPath();
    ctx.moveTo(X(c.points[firstVisible].t), Y(c.points[firstVisible].v));
    for (var i = firstVisible + 1; i < c.points.length; i++) {
      ctx.lineTo(X(c.points[i].t), Y(c.points[i].v));
    }
    ctx.lineTo(X(last.t), padT + ph);
    ctx.lineTo(X(c.points[firstVisible].t), padT + ph);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(X(c.points[firstVisible].t), Y(c.points[firstVisible].v));
    for (var j = firstVisible + 1; j < c.points.length; j++) {
      ctx.lineTo(X(c.points[j].t), Y(c.points[j].v));
    }
    ctx.strokeStyle = col.faint;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(X(c.points[firstVisible].t), Y(rollingMean(firstVisible)));
    for (var k = firstVisible + 1; k < c.points.length; k++) {
      var v = rollingMean(k);
      ctx.lineTo(X(c.points[k].t), Y(v));
    }
    ctx.strokeStyle = col.ink;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(X(last.t), Y(rollingMean(c.points.length - 1)), 3.2, 0, Math.PI * 2);
    ctx.fillStyle = col.surface;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = col.ink;
    ctx.stroke();
  }

  function resizeChart() {
    var wrap = chart.canvas ? chart.canvas.parentElement : null;
    if (!wrap) return;
    chart.cssW = wrap.clientWidth || 600;
    chart.canvas.width = Math.round(chart.cssW * chart.dpr);
    chart.canvas.height = Math.round(chart.cssH * chart.dpr);
    chart.ctx.setTransform(chart.dpr, 0, 0, chart.dpr, 0, 0);
    chartRender();
  }

  function initChart() {
    var canvas = $('#chart');
    if (!canvas) return;
    chart.canvas = canvas;
    chart.ctx = canvas.getContext('2d');
    chart.dpr = window.devicePixelRatio || 1;
    resizeChart();
    window.addEventListener('resize', resizeChart);
  }

  function chartReset() {
    chart.active = false;
    chart.points = [];
    els.chartValue.textContent = '0.0';
    els.chartState.textContent = 'idle \u2014 waiting for a run';
    chartRender();
  }

  function chartStart(modelId, taskName) {
    chart.active = true;
    chart.points = [];
    chart.startTs = performance.now();
    chart.lastTs = chart.startTs;
    chart.lastTokens = 0;
    chart.windowStart = 0;
    chart.label = modelId.split('/').pop() + ' \u00b7 ' + taskName;
    els.chartValue.textContent = '0.0';
    els.chartState.textContent = 'streaming \u00b7 ' + chart.label;
    chartRender();
  }

  function chartPush(now, tokens) {
    if (!chart.active) return;
    var dt = (now - chart.lastTs) / 1000;
    if (dt < 0.15) return;
    var dT = tokens - chart.lastTokens;
    chart.lastTokens = tokens;
    chart.lastTs = now;
    chart.points.push({
      t: (now - chart.startTs) / 1000,
      v: dT > 0 && dt > 0 ? dT / dt : 0
    });
    var roll = rollingMean(chart.points.length - 1);
    els.chartValue.textContent = roll.toFixed(1);
    els.chartState.textContent = 'streaming \u00b7 ' + chart.label + ' \u00b7 ' + Math.round(tokens) + ' tok';
    chartRender();
  }

  function chartStop(tps) {
    if (!chart.active) return;
    chart.active = false;
    els.chartState.textContent = 'done \u00b7 ' + chart.label + (tps ? ' \u00b7 ' + tps.toFixed(1) + ' tok/s' : '');
    chartRender();
  }

  function streamOne(model, task, maxTokens) {
    return new Promise(function (resolve, reject) {
      var t0 = null;
      var wallStart = performance.now();
      var acc = '';
      var chars = 0;
      var usageTokens = null;
      var finished = false;
      var ttftMs = 0;

      function finish() {
        if (finished) return;
        finished = true;
        var now = performance.now();
        var tokens = usageTokens || estimateTokens(acc);
        var dt = t0 !== null ? now - t0 : now - wallStart;
        var tps = dt > 0 && tokens > 0 ? tokens / (dt / 1000) : 0;
        chartStop(tps);
        resolve({
          model: model.id,
          workload: task.id,
          tokens: tokens,
          latencyMs: now - wallStart,
          ttftMs: ttftMs,
          tps: tps,
          quality: task.rubric(acc)
        });
      }

      chartStart(model.id, task.name);

      fetch(endpoint() + '/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: state.controller.signal,
        body: JSON.stringify({
          model: model.id,
          messages: [
            { role: 'system', content: task.system },
            { role: 'user', content: task.prompt }
          ],
          temperature: 0.2,
          top_p: 0.9,
          max_tokens: maxTokens,
          stream: true,
          stream_options: { include_usage: true }
        })
      }).then(function (res) {
        if (!res.ok) {
          return res.text().then(function (txt) {
            throw new Error('HTTP ' + res.status + (txt ? ' \u2014 ' + txt.slice(0, 140) : ''));
          });
        }
        if (!res.body) throw new Error('Streaming is not supported by this server');
        var reader = res.body.getReader();
        var decoder = new TextDecoder();
        var buf = '';

        function pump() {
          return reader.read().then(function (chunk) {
            if (state.aborted) {
              try { reader.cancel(); } catch (e) {}
              throw abortError();
            }
            if (chunk.done) {
              finish();
              return;
            }
            buf += decoder.decode(chunk.value, { stream: true });
            var lines = buf.split('\n');
            buf = lines.pop();
            lines.forEach(function (line) {
              var l = line.trim();
              if (l.indexOf('data:') !== 0) return;
              var payload = l.slice(5).trim();
              if (!payload || payload === '[DONE]') return;
              try {
                var json = JSON.parse(payload);
                var delta = json.choices && json.choices[0] && json.choices[0].delta;
                var text = (delta && delta.content) || '';
                if (text) {
                  if (t0 === null) {
                    t0 = performance.now();
                    ttftMs = t0 - wallStart;
                  }
                  acc += text;
                  chars += text.length;
                  chartPush(performance.now(), chars / 4);
                }
                if (json.usage && typeof json.usage.completion_tokens === 'number') {
                  usageTokens = json.usage.completion_tokens;
                }
              } catch (e) {}
            });
            return pump();
          });
        }

        return pump();
      }).then(finish).catch(function (err) {
        if (finished) return;
        finished = true;
        chartStop(null);
        reject(err);
      });
    });
  }

  function qualityBadge(q) {
    return '<span class="badge badge-' + QUALITY_CLASS[q] + '">' + QUALITY_LABEL[q] + '</span>';
  }

  function fmtTps(v) { return v.toFixed(1); }
  function fmtTime(ms) { return (ms / 1000).toFixed(2) + 's'; }

  function cellLabel(w) {
    var t = TASKS.filter(function (x) { return x.id === w; })[0];
    return t ? t.name : w;
  }

  function renderResults() {
    if (state.results.length === 0) return;
    els.results.hidden = false;

    var models = {};
    state.results.forEach(function (r) {
      if (!models[r.model]) models[r.model] = [];
      models[r.model].push(r);
    });
    var boardRows = Object.keys(models).map(function (id) {
      var rows = models[id];
      var mean = rows.reduce(function (a, r) { return a + r.tps; }, 0) / rows.length;
      var best = rows.reduce(function (a, r) { return QUALITY_SCORE[a.quality] >= QUALITY_SCORE[r.quality] ? a : r; });
      return { id: id, mean: mean, best: best.quality, runs: rows.length };
    });
    boardRows.sort(function (a, b) { return b.mean - a.mean; });

    var boardHtml = '';
    boardRows.forEach(function (r, i) {
      boardHtml += '<tr><td class="rank">' + (i + 1) + '</td><td class="mono">' + r.id + '</td>' +
        '<td class="num mono">' + fmtTps(r.mean) + '</td><td class="num">' + qualityBadge(r.best) + '</td>' +
        '<td class="num mono">' + r.runs + '</td></tr>';
    });
    els.board.innerHTML = boardHtml;

    var rows = state.results.slice().sort(function (a, b) { return b.tps - a.tps; });
    var runHtml = '';
    rows.forEach(function (r) {
      runHtml += '<tr><td class="mono">' + r.model + '</td><td>' + cellLabel(r.workload) + '</td>' +
        '<td class="num mono">' + r.tokens + '</td><td class="num mono">' + fmtTime(r.ttftMs) + '</td>' +
        '<td class="num mono">' + fmtTime(r.latencyMs) + '</td><td class="num mono">' + fmtTps(r.tps) + '</td>' +
        '<td>' + qualityBadge(r.quality) + '</td></tr>';
    });
    els.runTable.innerHTML = runHtml;

    var fastest = boardRows[0];
    els.statFast.textContent = fastest ? fastest.id.split('/').pop() : '\u2014';
    els.statFastSub.textContent = fastest ? fmtTps(fastest.mean) + ' tok/s mean across ' + fastest.runs + ' runs' : '';

    var byScore = state.results.slice().sort(function (a, b) {
      return QUALITY_SCORE[b.quality] - QUALITY_SCORE[a.quality] || b.tps - a.tps;
    })[0];
    if (byScore) {
      els.statQuality.textContent = QUALITY_LABEL[byScore.quality];
      els.statQualitySub.textContent = byScore.model.split('/').pop() + ' \u00b7 ' + cellLabel(byScore.workload);
    }

    els.statCells.textContent = state.results.length;
    els.statCellsSub.textContent = new Set(state.results.map(function (r) { return r.model; })).size + ' models \u00b7 ' + new Set(state.results.map(function (r) { return r.workload; })).size + ' workloads';
  }


  function downloadResults() {
    if (state.results.length === 0) return;

    var d = new Date();
    var dateStr = d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());

    var lines = [];
    lines.push('lmbench — Benchmark Results');
    lines.push('Date: ' + dateStr);
    lines.push('Endpoint: ' + endpoint());
    lines.push('');

    // summary
    var models = {};
    state.results.forEach(function (r) {
      if (!models[r.model]) models[r.model] = [];
      models[r.model].push(r);
    });

    var boardRows = Object.keys(models).map(function (id) {
      var rows = models[id];
      var mean = rows.reduce(function (a, r) { return a + r.tps; }, 0) / rows.length;
      var best = rows.reduce(function (a, r) { return QUALITY_SCORE[a.quality] >= QUALITY_SCORE[r.quality] ? a : r; });
      return { id: id, mean: mean, best: best.quality, runs: rows.length };
    });
    boardRows.sort(function (a, b) { return b.mean - a.mean; });

    var fastest = boardRows[0];
    lines.push('=== Summary ===');
    lines.push('Fastest model: ' + (fastest ? fastest.id.split('/').pop() + ' — ' + fmtTps(fastest.mean) + ' tok/s mean' : '—'));

    var byScore = state.results.slice().sort(function (a, b) {
      return QUALITY_SCORE[b.quality] - QUALITY_SCORE[a.quality] || b.tps - a.tps;
    })[0];
    if (byScore) {
      lines.push('Top quality: ' + QUALITY_LABEL[byScore.quality] + ' — ' + byScore.model.split('/').pop() + ' · ' + cellLabel(byScore.workload));
    }
    lines.push('Cells run: ' + state.results.length);
    lines.push('Models: ' + new Set(state.results.map(function(r){return r.model;})).size);
    lines.push('Workloads: ' + new Set(state.results.map(function(r){return r.workload;})).size);
    lines.push('');

    // leaderboard
    lines.push('=== Leaderboard ===');
    var rankLines = [];
    boardRows.forEach(function (r, i) {
      rankLines.push(
        String(i+1).padStart(3) + '  ' +
        r.id.padEnd(35) +
        fmtTps(r.mean).padStart(10) + ' tok/s' +
        '  ' + QUALITY_LABEL[r.best].padEnd(10) +
        r.runs + ' run' + (r.runs === 1 ? '' : 's')
      );
    });
    lines.push('#    Model' + ' '.repeat(28) + '    tok/s     Quality    Runs');
    lines.push('---  ' + '-'.repeat(35) + '  ----------  ----------  -----');
    rankLines.forEach(function (l) { lines.push(l); });
    lines.push('');

    // all cells
    lines.push('=== All Cells ===');
    lines.push('Model' + ' '.repeat(30) + 'Workload' + ' '.repeat(14) + 'Tokens  TTFT      Total     tok/s     Quality');
    lines.push('-'.repeat(95));

    var sorted = state.results.slice().sort(function (a, b) { return b.tps - a.tps; });
    sorted.forEach(function (r) {
      lines.push(
        r.model.padEnd(35) +
        cellLabel(r.workload).padEnd(22) +
        String(r.tokens).padStart(6) + '  ' +
        fmtTime(r.ttftMs).padStart(8) + '  ' +
        fmtTime(r.latencyMs).padStart(8) + '  ' +
        fmtTps(r.tps).padStart(8) + '  ' +
        QUALITY_LABEL[r.quality]
      );
    });
    lines.push('');
    lines.push('Generated by lmbench · ' + dateStr);

    var blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var ts = d.getFullYear() + pad(d.getMonth()+1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    a.href = url;
    a.download = 'lmbench-results-' + ts + '.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }


  function finishRun() {
    state.running = false;
    state.aborted = false;
    els.btnStop.hidden = true;
    updateRunButton();
    els.progressBar.style.width = '0%';
    els.progressText.textContent = '';
    els.logCount.textContent = state.results.length + ' cells completed';
    renderResults();
    if (state.results.length > 0) {
      archiveRun();
      els.btnDownload.hidden = false;
    }
  }

  function archiveRun() {
    var models = {};
    state.results.forEach(function (r) {
      if (!models[r.model]) models[r.model] = [];
      models[r.model].push(r);
    });
    var fastest = Object.keys(models).map(function (id) {
      var cells = models[id];
      return { id: id, mean: cells.reduce(function (a, r) { return a + r.tps; }, 0) / cells.length };
    }).sort(function (a, b) { return b.mean - a.mean; })[0];

    var rows = Object.keys(models).map(function (id) {
      var cells = models[id];
      var last = cells[cells.length - 1];
      return { model: id, tps: last.tps, latencyMs: last.latencyMs, quality: last.quality };
    });

    var entry = {
      ts: Date.now(),
      endpoint: endpoint(),
      models: Object.keys(models).length,
      workloads: new Set(state.results.map(function (r) { return r.workload; })).size,
      cells: state.results.length,
      fastest: fastest ? fastest.id.split('/').pop() : '\u2014',
      meanTps: fastest ? fastest.mean : 0,
      rows: rows
    };
    state.archive.unshift(entry);
    if (state.archive.length > 12) state.archive.length = 12;
    saveArchive();
    renderHistory();
    renderWindow();
  }

  function runBenchmark() {
    if (state.running) return;
    var models = selectedModels();
    var tasks = selectedTasks();
    if (models.length === 0 || tasks.length === 0) return;

    var repeats = Math.min(5, Math.max(1, parseInt(els.repeats.value, 10) || 1));
    var maxTokens = parseInt(els.maxTokens.value, 10) || 1024;
    var cells = models.length * tasks.length * repeats;

    state.results = [];
    state.controller = new AbortController();
    state.running = true;
    state.aborted = false;

    els.results.hidden = true;
    els.btnDownload.hidden = true;
    els.btnRun.disabled = true;
    els.btnRun.textContent = 'Running\u2026';
    els.btnStop.hidden = false;
    els.btnCheck.disabled = true;
    els.progressWrap.hidden = false;
    els.log.innerHTML = '';
    els.logCount.textContent = '0 / ' + cells;
    chartReset();

    log('Starting run \u00b7 ' + models.length + ' models \u00d7 ' + tasks.length + ' workloads \u00d7 ' + repeats + ' repeat' + (repeats === 1 ? '' : 's'));
    log('Endpoint ' + endpoint() + ' \u00b7 temp 0.2 \u00b7 top_p 0.9 \u00b7 max_tokens ' + maxTokens, 'dim');

    var completed = 0;
    var p = Promise.resolve();

    var plan = [];
    tasks.forEach(function (task) {
      plan.push({ kind: 'header', task: task });
      models.forEach(function (model) {
        for (var r = 1; r <= repeats; r++) {
          plan.push({ kind: 'cell', task: task, model: model });
        }
      });
    });

    plan.forEach(function (item) {
      p = p.then(function () {
        if (state.aborted) return;
        if (item.kind === 'header') {
          log('Workload: ' + item.task.name);
          return;
        }
        var model = item.model;
        var task = item.task;
        els.progressBar.style.width = (completed / cells * 100) + '%';
        els.progressText.textContent = completed + ' / ' + cells + ' \u00b7 ' + model.id.split('/').pop() + ' \u00b7 ' + task.name;
        return streamOne(model, task, maxTokens).then(function (row) {
          completed += 1;
          state.results.push(row);
          els.progressBar.style.width = (completed / cells * 100) + '%';
          els.logCount.textContent = completed + ' / ' + cells;
          log(row.model.split('/').pop() + ' \u00b7 ' + task.name + ' \u00b7 ' + fmtTps(row.tps) + ' tok/s \u00b7 ' + QUALITY_LABEL[row.quality], 'ok');
        }).catch(function (err) {
          if (err && err.name === 'AbortError') throw err;
          completed += 1;
          state.results.push({ model: model.id, workload: task.id, tokens: 0, latencyMs: 0, tps: 0, quality: 'failed' });
          els.logCount.textContent = completed + ' / ' + cells;
          log(model.id.split('/').pop() + ' \u00b7 ' + task.name + ' \u00b7 failed \u2014 ' + (err && err.message ? err.message : err), 'err');
        });
      });
    });

    p.then(function () {
      if (state.aborted) {
        log('Stopped by operator', 'dim');
      } else {
        log('Run complete \u00b7 ' + completed + ' cells', 'ok');
      }
    }).catch(function (err) {
      if (err && err.name === 'AbortError') {
        log('Stopped by operator', 'dim');
      } else {
        log('Run interrupted \u2014 ' + err.message, 'err');
      }
    }).then(function () {
      state.controller = null;
      els.btnStop.hidden = true;
      els.btnCheck.disabled = false;
      els.progressWrap.hidden = true;
      finishRun();
    });
  }

  function stopRun() {
    if (!state.running) return;
    state.aborted = true;
    if (state.controller) state.controller.abort();
  }

  els.btnRun.addEventListener('click', runBenchmark);
  els.btnStop.addEventListener('click', stopRun);
  els.btnDownload.addEventListener('click', downloadResults);
  els.btnCheck.addEventListener('click', checkStatus);
  els.endpoint.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') checkStatus();
  });

  els.modelList.addEventListener('change', function () {
    updateRunButton();
    updateModelToggle();
  });
  els.taskList.addEventListener('change', updateRunButton);
  els.repeats.addEventListener('input', function () {
    var v = parseInt(els.repeats.value, 10);
    if (v < 1) els.repeats.value = 1;
    if (v > 5) els.repeats.value = 5;
  });

  els.btnModelToggle.addEventListener('click', function () {
    var allOn = els.modelList.querySelectorAll('input:checked').length === state.models.length && state.models.length > 0;
    $$('#model-list input').forEach(function (inp) { inp.checked = !allOn; });
    updateModelToggle();
    updateRunButton();
  });

  els.btnTheme.addEventListener('click', function () {
    applyTheme(isDark() ? 'light' : 'dark');
    chartRender();
  });

  $$('.win-sort').forEach(function (btn) {
    btn.addEventListener('click', function () {
      state.windowSort = btn.getAttribute('data-sort');
      state.windowExpanded = false;
      $$('.win-sort').forEach(function (b) { b.classList.toggle('active', b === btn); });
      renderWindow();
    });
  });

  els.winExpand.addEventListener('click', function () {
    state.windowExpanded = !state.windowExpanded;
    renderWindow();
  });

  els.winRows.addEventListener('click', function (e) {
    var btn = e.target.closest ? e.target.closest('.win-del') : null;
    if (btn) deleteModel(btn.getAttribute('data-del'));
  });

  els.btnClear.addEventListener('click', function () {
    state.archive = [];
    saveArchive();
    renderHistory();
  });

  document.addEventListener('keydown', function (e) {
    var tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    if (e.key === 'Escape') {
      stopRun();
    } else if (e.key === 'r' || e.key === 'R') {
      runBenchmark();
    }
  });

  var observer = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  $$('.reveal').forEach(function (el) { observer.observe(el); });

  renderTasks();
  loadArchive();
  applyTheme(currentTheme());
  initChart();
  checkStatus();
})();
