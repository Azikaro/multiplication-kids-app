(() => {
  "use strict";

  const STORAGE_KEY = "kids-math-family-trainer-v1";
  const SESSION_LENGTH = 12;
  const MAX_MASTERY = 10;

  const app = document.getElementById("app");
  const starTemplate = document.getElementById("starMascot");

  const families = buildFamilies();
  const familyMap = Object.fromEntries(families.map(f => [f.key, f]));

  let state = loadState();
  let runtime = {
    tab: "solve",
    learnOperation: "mul",
    answer: "",
    question: null,
    questionStartedAt: 0,
    selectedFamilyKey: "6x7",
    feedback: null,
    session: {
      total: 0,
      correct: 0,
      wrong: 0,
      streak: 0,
      bestStreak: 0,
      lastFamilyKey: null,
      lastVariantId: null,
      retryQueue: []
    }
  };

  initStats();
  chooseNextQuestion();
  render();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  function buildFamilies() {
    const list = [];
    for (let a = 1; a <= 10; a += 1) {
      for (let b = a; b <= 10; b += 1) {
        const product = a * b;
        const key = `${a}x${b}`;
        const variants = [
          { id: "mul_ab", kind: "mul", prompt: `${a} × ${b}`, answer: product, a, b, product },
        ];
        if (a !== b) variants.push({ id: "mul_ba", kind: "mul", prompt: `${b} × ${a}`, answer: product, a: b, b: a, product });
        variants.push({ id: "div_a", kind: "div", prompt: `${product} ÷ ${a}`, answer: b, a: product, b: a, product });
        if (a !== b) variants.push({ id: "div_b", kind: "div", prompt: `${product} ÷ ${b}`, answer: a, a: product, b, product });
        list.push({ key, a, b, product, variants });
      }
    }
    return list;
  }

  function defaultStat(family) {
    const variants = {};
    for (const variant of family.variants) {
      variants[variant.id] = {
        attempts: 0,
        correct: 0,
        wrong: 0,
        lastAnswerMs: null,
        lastSeenAt: 0
      };
    }
    return {
      mastery: 0,
      attempts: 0,
      correct: 0,
      wrong: 0,
      streak: 0,
      bestStreak: 0,
      lastSeenAt: 0,
      nextDueAt: 0,
      lastVariantId: null,
      variants
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) throw new Error("empty");
      const parsed = JSON.parse(raw);
      return {
        activeNumber: parsed.activeNumber || 6,
        stats: parsed.stats || {},
        completedSessions: parsed.completedSessions || 0,
        createdAt: parsed.createdAt || Date.now(),
        updatedAt: parsed.updatedAt || Date.now()
      };
    } catch {
      return {
        activeNumber: 6,
        stats: {},
        completedSessions: 0,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
    }
  }

  function saveState() {
    state.updatedAt = Date.now();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function initStats() {
    for (const family of families) {
      if (!state.stats[family.key]) {
        state.stats[family.key] = defaultStat(family);
        continue;
      }
      const stat = state.stats[family.key];
      stat.variants ||= {};
      for (const variant of family.variants) {
        stat.variants[variant.id] ||= { attempts: 0, correct: 0, wrong: 0, lastAnswerMs: null, lastSeenAt: 0 };
      }
    }
    saveState();
  }

  function render() {
    if (runtime.tab === "solve") return renderSolve();
    if (runtime.tab === "learn") return renderLearn();
    if (runtime.tab === "complete") return renderComplete();
  }

  function mascotHTML() {
    return starTemplate.innerHTML;
  }

  function navHTML(active) {
    return `
      <nav class="nav" aria-label="Основная навигация">
        <button class="nav-item ${active === "solve" ? "active" : ""}" data-action="tab" data-tab="solve">
          <span class="nav-icon">✎</span><span>Решать</span>
        </button>
        <span class="nav-divider" aria-hidden="true"></span>
        <button class="nav-item ${active === "learn" ? "active" : ""}" data-action="tab" data-tab="learn">
          <span class="nav-icon">📖</span><span>Учить</span>
        </button>
      </nav>`;
  }

  function progressHTML(filled) {
    const dots = Array.from({ length: 8 }, (_, index) => `<span class="progress-dot ${index < filled ? "filled" : ""}"></span>`).join("");
    return `<div class="progress-row">${mascotHTML()}${dots}</div>`;
  }

  function renderSolve() {
    const q = runtime.question;
    const expression = q ? `${q.prompt} = ?` : "6 × 7 = ?";
    const progressFilled = Math.min(8, Math.max(0, Math.ceil(runtime.session.total / SESSION_LENGTH * 8)));

    let body = "";
    if (runtime.feedback?.type === "correct") {
      body = `
        <div class="screen">
          ${progressHTML(progressFilled)}
          <div class="expression">${q.prompt} = <span class="accent">${q.answer}</span></div>
          <div class="feedback">
            ${mascotHTML()}
            <div class="feedback-title">Молодец!</div>
            <div class="reward-card" style="font-size:24px; justify-content:center; padding:14px 18px;">⭐ +1 звезда памяти</div>
          </div>
          <button class="primary-btn" data-action="next">Дальше</button>
          ${navHTML("solve")}
        </div>`;
    } else {
      const wrong = runtime.feedback?.type === "wrong";
      const hint = wrong ? hintHTML(q.family) : "";
      body = `
        <div class="screen">
          ${progressHTML(progressFilled)}
          <div class="expression">${expression}</div>
          <div class="answer-box ${runtime.answer ? "" : "empty"} ${wrong ? "wrong" : ""}">
            ${escapeHTML(runtime.answer)}${wrong ? `<span class="wrong-badge">×</span>` : ""}
          </div>
          ${wrong ? `<div class="feedback-title">Почти! Попробуй ещё</div>${hint}` : keypadHTML()}
          <button class="primary-btn" data-action="${wrong ? "retry" : "check"}" ${!runtime.answer && !wrong ? "disabled" : ""}>${wrong ? "Попробовать ещё" : "Проверить"}</button>
          ${navHTML("solve")}
        </div>`;
    }

    app.innerHTML = body;
    bindEvents();
  }

  function keypadHTML() {
    const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "⌫", "0", "✓"];
    return `
      <div class="keypad" aria-label="Цифровая клавиатура">
        ${keys.map(k => {
          if (k === "✓") return `<button class="key-btn confirm" data-action="check" aria-label="Проверить">✓</button>`;
          if (k === "⌫") return `<button class="key-btn small-icon" data-action="backspace" aria-label="Удалить">⌫</button>`;
          return `<button class="key-btn" data-action="digit" data-digit="${k}">${k}</button>`;
        }).join("")}
      </div>`;
  }

  function hintHTML(family) {
    const repeated = Array.from({ length: family.a }, () => family.b).join(" + ");
    const compact = repeated.length > 31 ? Array.from({ length: family.b }, () => family.a).join(" + ") : repeated;
    const title = repeated.length > 31 ? `${family.b} раз по ${family.a}` : `${family.a} раз по ${family.b}`;
    return `
      <div class="hint-card">
        <div class="hint-icon">💡</div>
        <div class="hint-title">${title}</div>
        <div class="dotted"></div>
        <div class="hint-sum">${compact}</div>
      </div>`;
  }

  function renderLearn() {
    const selectedNumber = state.activeNumber;
    const numberTiles = Array.from({ length: 10 }, (_, i) => i + 1).map(n => {
      const mastered = masteredCountForNumber(n);
      return `<button class="number-tile ${n === selectedNumber ? "active" : ""}" data-action="select-number" data-number="${n}">${n}<small>${mastered}/10 связей</small></button>`;
    }).join("");

    const rows = tableRowsHTML(selectedNumber, runtime.learnOperation);
    const selectedFamily = familyMap[runtime.selectedFamilyKey] || findFamily(selectedNumber, 7) || findFamily(selectedNumber, selectedNumber);

    app.innerHTML = `
      <div class="screen">
        <div class="header-row">
          <div>
            <div class="section-label">Учить</div>
            <h1 class="title">${runtime.learnOperation === "mul" ? "Выбери число" : "Деление"}</h1>
            <div class="helper">Нажми на пример, чтобы увидеть связь с делением.</div>
          </div>
          ${mascotHTML()}
        </div>

        <div class="segmented" role="tablist" aria-label="Тип обучения">
          <button class="${runtime.learnOperation === "mul" ? "active" : ""}" data-action="operation" data-operation="mul">▦ Умножение</button>
          <button class="${runtime.learnOperation === "div" ? "active" : ""}" data-action="operation" data-operation="div">÷ Деление</button>
        </div>

        <div class="number-grid">${numberTiles}</div>

        <h2 class="title" style="font-size:44px; margin-top:14px;">Таблица на ${selectedNumber}</h2>
        <div class="table-card">${rows}</div>
        <button class="reset-link" data-action="reset">Сбросить прогресс</button>
        ${navHTML("learn")}
      </div>
      ${runtime.modalOpen ? modalHTML(selectedFamily) : ""}`;
    bindEvents();
  }

  function tableRowsHTML(n, operation) {
    const rows = [];
    for (let x = 1; x <= 10; x += 1) {
      const family = findFamily(n, x);
      const selected = family.key === runtime.selectedFamilyKey;
      if (operation === "mul") {
        rows.push(`<button class="table-row ${selected ? "selected" : ""}" data-action="open-family" data-family="${family.key}"><span>${n} × ${x} =</span><span class="result">${n * x}</span></button>`);
      } else {
        rows.push(`<button class="table-row ${selected ? "selected" : ""}" data-action="open-family" data-family="${family.key}"><span>${n * x} ÷ ${n} =</span><span class="result">${x}</span></button>`);
      }
    }
    return rows.join("");
  }

  function modalHTML(family) {
    const a = family.a;
    const b = family.b;
    const p = family.product;
    const mul2 = a === b ? `${a} × ${b} = ${p}` : `${b} × ${a} = ${p}`;
    const div2 = a === b ? `${p} ÷ ${a} = ${b}` : `${p} ÷ ${b} = ${a}`;
    return `
      <div class="modal-backdrop" data-action="close-modal">
        <div class="modal-card" role="dialog" aria-modal="true" aria-label="Связь с делением" data-stop>
          <span class="chip">Связь с делением</span>
          ${mascotHTML()}
          <div class="modal-main">${a} × ${b} = <span class="accent">${p}</span></div>
          <div class="modal-line"></div>
          <div class="related-line">${mul2.replace(String(p), `<span class="accent">${p}</span>`)}</div>
          <div class="modal-line"></div>
          <div class="related-line"><span class="accent">${p}</span> ÷ ${a} = ${b}</div>
          <div class="modal-line"></div>
          <div class="related-line">${div2.replace(String(p), `<span class="accent">${p}</span>`)}</div>
          <button class="close-modal" data-action="close-modal">Понятно</button>
        </div>
      </div>`;
  }

  function renderComplete() {
    const stars = Math.min(5, Math.max(1, Math.round(runtime.session.correct / SESSION_LENGTH * 5)));
    const activeMastered = masteredCountForNumber(state.activeNumber);
    app.innerHTML = `
      <div class="screen reward-screen">
        ${mascotHTML()}
        <div class="reward-small">Занятие завершено</div>
        <div class="reward-title">Ты решил ${runtime.session.total} примеров!</div>
        <div class="stars">${Array.from({ length: 5 }, (_, i) => `<span class="${i < stars ? "" : "empty"}">★</span>`).join("")}</div>
        <div class="reward-card"><span class="big-number-badge">${state.activeNumber}</span><span>Число ${state.activeNumber}<br><strong>${activeMastered}/10 связей</strong></span></div>
        <div class="reward-card"><span>🔥</span><span><strong>${runtime.session.bestStreak} подряд</strong><br><small style="color:var(--muted);">лучшая серия</small></span></div>
        <div class="button-row">
          <button class="outline-btn" data-action="home">Домой</button>
          <button class="primary-btn" data-action="new-session">Продолжить</button>
        </div>
      </div>`;
    bindEvents();
  }

  function bindEvents() {
    app.querySelectorAll("[data-action]").forEach(el => {
      el.addEventListener("click", event => {
        const target = event.currentTarget;
        const action = target.dataset.action;
        if (target.dataset.stop !== undefined) event.stopPropagation();

        switch (action) {
          case "digit": addDigit(target.dataset.digit); break;
          case "backspace": backspace(); break;
          case "check": checkAnswer(); break;
          case "next": nextAfterCorrect(); break;
          case "retry": retryAfterWrong(); break;
          case "tab": switchTab(target.dataset.tab); break;
          case "select-number": selectNumber(Number(target.dataset.number)); break;
          case "operation": switchOperation(target.dataset.operation); break;
          case "open-family": openFamily(target.dataset.family); break;
          case "close-modal": closeModal(); break;
          case "reset": resetProgress(); break;
          case "home": runtime.tab = "solve"; resetSession(); chooseNextQuestion(); render(); break;
          case "new-session": resetSession(); runtime.tab = "solve"; chooseNextQuestion(); render(); break;
        }
      });
    });
  }

  function addDigit(digit) {
    if (runtime.feedback) return;
    if (runtime.answer.length >= 3) return;
    if (runtime.answer === "0") runtime.answer = digit;
    else runtime.answer += digit;
    renderSolve();
  }

  function backspace() {
    if (runtime.feedback) return;
    runtime.answer = runtime.answer.slice(0, -1);
    renderSolve();
  }

  function checkAnswer() {
    if (runtime.feedback || !runtime.question || runtime.answer === "") return;
    const answer = Number(runtime.answer);
    if (!Number.isFinite(answer)) return;
    const ms = Date.now() - runtime.questionStartedAt;
    const isCorrect = answer === runtime.question.answer;
    applyAnswer(isCorrect, ms);
    if (isCorrect) {
      runtime.feedback = { type: "correct" };
    } else {
      runtime.feedback = { type: "wrong" };
      runtime.session.retryQueue.push({
        familyKey: runtime.question.family.key,
        readyAt: runtime.session.total + randomInt(2, 4),
        avoidVariantId: runtime.question.variant.id
      });
    }
    saveState();
    renderSolve();
  }

  function applyAnswer(isCorrect, answerMs) {
    const q = runtime.question;
    const stat = state.stats[q.family.key];
    const variantStat = stat.variants[q.variant.id];
    const now = Date.now();

    stat.attempts += 1;
    stat.lastSeenAt = now;
    stat.lastVariantId = q.variant.id;
    variantStat.attempts += 1;
    variantStat.lastAnswerMs = answerMs;
    variantStat.lastSeenAt = now;

    runtime.session.total += 1;
    runtime.session.lastFamilyKey = q.family.key;
    runtime.session.lastVariantId = q.variant.id;

    if (isCorrect) {
      stat.correct += 1;
      variantStat.correct += 1;
      stat.streak += 1;
      stat.bestStreak = Math.max(stat.bestStreak, stat.streak);
      const fast = answerMs <= 6000;
      stat.mastery = clamp(stat.mastery + (fast ? 2 : 1), 0, MAX_MASTERY);
      stat.nextDueAt = Date.now() + intervalForMastery(stat.mastery, fast);
      runtime.session.correct += 1;
      runtime.session.streak += 1;
      runtime.session.bestStreak = Math.max(runtime.session.bestStreak, runtime.session.streak);
    } else {
      stat.wrong += 1;
      variantStat.wrong += 1;
      stat.streak = 0;
      stat.mastery = clamp(stat.mastery - 2, 0, MAX_MASTERY);
      stat.nextDueAt = Date.now();
      runtime.session.wrong += 1;
      runtime.session.streak = 0;
    }
  }

  function intervalForMastery(mastery, fast) {
    if (mastery < 2) return 3 * 60 * 1000;
    if (mastery < 4) return 20 * 60 * 1000;
    if (mastery < 6) return 4 * 60 * 60 * 1000;
    if (mastery < 8) return 24 * 60 * 60 * 1000;
    return (fast ? 4 : 2) * 24 * 60 * 60 * 1000;
  }

  function nextAfterCorrect() {
    runtime.feedback = null;
    runtime.answer = "";
    if (runtime.session.total >= SESSION_LENGTH) {
      runtime.tab = "complete";
      state.completedSessions += 1;
      saveState();
      render();
      return;
    }
    chooseNextQuestion();
    renderSolve();
  }

  function retryAfterWrong() {
    runtime.feedback = null;
    runtime.answer = "";
    chooseNextQuestion();
    renderSolve();
  }

  function chooseNextQuestion() {
    const family = chooseFamily();
    const variant = chooseVariant(family);
    runtime.question = { family, variant, prompt: variant.prompt, answer: variant.answer };
    runtime.questionStartedAt = Date.now();
  }

  function chooseFamily() {
    const now = Date.now();
    const active = state.activeNumber;
    const weighted = [];
    const last = runtime.session.lastFamilyKey;

    const readyRetry = runtime.session.retryQueue.filter(item => item.readyAt <= runtime.session.total);
    if (readyRetry.length) {
      for (const item of readyRetry) {
        if (item.familyKey !== last) addWeight(weighted, familyMap[item.familyKey], 120, "ошибка вернулась");
      }
      if (weighted.length) return weightedPick(weighted).family;
    }

    for (const family of families) {
      if (family.key === last && families.length > 1) continue;
      const stat = state.stats[family.key];
      const includesActive = family.a === active || family.b === active;
      let weight = 0;

      if (stat.attempts > 0 && stat.nextDueAt <= now) weight += 70;
      if (stat.attempts > 0 && stat.mastery < 4) weight += 42;
      if (includesActive && stat.mastery < 8) weight += 34;
      if (includesActive && stat.attempts === 0) weight += 44;
      if (isMastered(family.key) && includesActive) weight += 10;
      if (stat.mastery >= 6 && stat.mastery < 9) weight += 12;

      // Very easy facts keep confidence high, but they should not dominate.
      if ((family.a === 1 || family.b === 1 || family.a === 10 || family.b === 10) && runtime.session.total % 5 === 3) weight += 15;

      // Prefer the selected number heavily in early sessions.
      if (includesActive) weight *= 1.35;
      if (weight > 0) addWeight(weighted, family, weight, "adaptive");
    }

    if (!weighted.length) {
      for (const family of families.filter(f => f.a === active || f.b === active)) addWeight(weighted, family, 1, "fallback");
    }

    return weightedPick(weighted).family;
  }

  function chooseVariant(family) {
    const stat = state.stats[family.key];
    let candidates = [...family.variants];

    // When a family comes back after an error, avoid the exact same card if possible.
    const retryItem = runtime.session.retryQueue.find(item => item.familyKey === family.key && item.readyAt <= runtime.session.total);
    if (retryItem) {
      runtime.session.retryQueue = runtime.session.retryQueue.filter(item => item !== retryItem);
      const alternative = candidates.filter(v => v.id !== retryItem.avoidVariantId);
      if (alternative.length) candidates = alternative;
    }

    if (runtime.session.lastVariantId) {
      const nonRepeat = candidates.filter(v => v.id !== runtime.session.lastVariantId);
      if (nonRepeat.length) candidates = nonRepeat;
    }

    const weighted = candidates.map(variant => {
      const vStat = stat.variants[variant.id];
      let weight = 20;
      if (vStat.correct === 0) weight += 55;
      if (vStat.wrong > 0) weight += 28;
      if (variant.kind === "div") weight += 8; // make division appear naturally, not as an afterthought
      if (stat.lastVariantId && variant.kind !== family.variants.find(v => v.id === stat.lastVariantId)?.kind) weight += 12;
      return { variant, weight };
    });

    return weightedPickVariant(weighted).variant;
  }

  function addWeight(arr, family, weight, reason) {
    if (!family) return;
    arr.push({ family, weight: Math.max(1, Math.round(weight)), reason });
  }

  function weightedPick(items) {
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    let roll = Math.random() * total;
    for (const item of items) {
      roll -= item.weight;
      if (roll <= 0) return item;
    }
    return items[items.length - 1];
  }

  function weightedPickVariant(items) {
    const total = items.reduce((sum, item) => sum + item.weight, 0);
    let roll = Math.random() * total;
    for (const item of items) {
      roll -= item.weight;
      if (roll <= 0) return item;
    }
    return items[items.length - 1];
  }

  function findFamily(a, b) {
    const min = Math.min(a, b);
    const max = Math.max(a, b);
    return familyMap[`${min}x${max}`];
  }

  function switchTab(tab) {
    runtime.tab = tab;
    runtime.feedback = null;
    runtime.modalOpen = false;
    if (tab === "solve" && !runtime.question) chooseNextQuestion();
    render();
  }

  function selectNumber(number) {
    state.activeNumber = number;
    runtime.selectedFamilyKey = findFamily(number, Math.min(7, Math.max(1, number))).key;
    saveState();
    renderLearn();
  }

  function switchOperation(operation) {
    runtime.learnOperation = operation;
    renderLearn();
  }

  function openFamily(key) {
    runtime.selectedFamilyKey = key;
    runtime.modalOpen = true;
    renderLearn();
  }

  function closeModal() {
    runtime.modalOpen = false;
    renderLearn();
  }

  function resetProgress() {
    const ok = confirm("Сбросить весь прогресс на этом устройстве?");
    if (!ok) return;
    localStorage.removeItem(STORAGE_KEY);
    state = loadState();
    initStats();
    resetSession();
    chooseNextQuestion();
    runtime.tab = "learn";
    renderLearn();
  }

  function resetSession() {
    runtime.answer = "";
    runtime.feedback = null;
    runtime.session = {
      total: 0,
      correct: 0,
      wrong: 0,
      streak: 0,
      bestStreak: 0,
      lastFamilyKey: null,
      lastVariantId: null,
      retryQueue: []
    };
  }

  function masteredCountForNumber(n) {
    let count = 0;
    for (let x = 1; x <= 10; x += 1) {
      const family = findFamily(n, x);
      if (isMastered(family.key)) count += 1;
    }
    return count;
  }

  function isMastered(key) {
    const family = familyMap[key];
    const stat = state.stats[key];
    if (!stat || stat.mastery < 8) return false;
    return family.variants.every(variant => stat.variants[variant.id]?.correct > 0);
  }

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function randomInt(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
  function escapeHTML(value) {
    return String(value).replace(/[&<>'"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[ch]));
  }
})();
