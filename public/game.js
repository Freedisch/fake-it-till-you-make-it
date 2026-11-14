// Fake it till you make it: game loop (vanilla JS, no build step)
(() => {
  "use strict";

  const CONFIG = {
    HIRE_THRESHOLD: 60,
    BUSTED_MAX: 100,
    MAX_CHARS: 200,
    JOB_SECONDS: 10,
    STAGE_INTRO_SECONDS: 5,
    AUTO_NEXT_SECONDS: 6,     // result auto-advances so a run stays around 5 minutes
    AUTO_VERDICT_SECONDS: 4,
    FOLLOWUP_SECONDS: 15,     // time to answer a follow-up question
    FOLLOWUP_DELAY_SECONDS: 4, // reaction stays up this long before the question lands
    CLIENT_TIMEOUT_MS: 10000, // the server gives up at 8 s; this is the browser's backstop
    MAX_CALLS_PER_SESSION: 30,
    MIN_READING_MS: 900,      // keep "reading…" on screen long enough to register
  };

  // Three interviews, 8 CV lines in total. The server holds each persona's judging rules.
  const STAGES = [
    {
      id: 1,
      name: "CV screen",
      persona: "Bored Intern",
      accent: "#ffb703",
      seconds: 30,
      lines: 3,
      followUps: false,
      intro: "",
      greeting: "Hi. I'm the intern. They said I have to read these. Make it quick.",
      prompts: ["Next one. Go.", "Okay, what else you got?", "*sips iced latte* Next.", "Mm-hm. Keep going."],
    },
    {
      id: 2,
      name: "Phone screen",
      persona: "Jordan from HR",
      accent: "#ff5fa2",
      seconds: 30,
      lines: 3,
      followUps: true,
      intro: "You passed the CV screen. Nobody knows how, least of all the intern. Jordan has follow-up questions.",
      greeting: "Hiii! Love the energy. Let's unpack your journey and really drill into the value-add.",
      prompts: ["Love that. Let's double-click on the next one.", "Super aligned. Next!", "Ooh, synergy. Keep going."],
    },
    {
      id: 3,
      name: "Final round",
      persona: "The CTO",
      accent: "#ff4766",
      seconds: 30,
      lines: 2,
      followUps: true,
      intro: "Final round. The CTO has read everything you told the others. Everything.",
      greeting: "I have four minutes and your whole file. Every claim. Go.",
      prompts: ["Next.", "Hm. Convince me.", "Last one. Make it count."],
    },
  ];

  const FALLBACK = {
    impressiveness: 3,
    suspicion_delta: 5,
    reaction: "Hmm, okay…",
    follow_up_question: null,
    caught_contradiction: null,
  };

  const ENDINGS = {
    hired: { emoji: "🎉", title: "Hired!", sub: "Welcome aboard. HR will never, ever check your references." },
    overqualified: {
      emoji: "🥱",
      title: "Overqualified",
      sub: "“You'd get bored here.” Translation: nobody believed a word, but they were too polite to say so.",
    },
    busted: { emoji: "🚨", title: "Busted!", sub: "Security will walk you out. Please return the visitor badge." },
    rejected: { emoji: "📭", title: "Rejected", sub: "We've decided to go with a candidate who actually exists." },
  };

  // ---------- DOM ----------
  const $ = (id) => document.getElementById(id);
  const el = {
    btnApply: $("btn-apply"),
    jobTitle: $("job-title"),
    jobCompany: $("job-company"),
    jobDesc: $("job-desc"),
    jobCriteria: $("job-criteria"),
    jobFill: $("job-countdown-fill"),
    btnReady: $("btn-ready"),
    stageEyebrow: $("stage-eyebrow"),
    stageTitle: $("stage-title"),
    stageIntro: $("stage-intro"),
    stageAvatar: $("stage-avatar"),
    stagePersona: $("stage-persona"),
    stageStats: $("stage-stats"),
    btnStage: $("btn-stage"),
    stageLabel: $("stage-label"),
    lineCounter: $("line-counter"),
    hireValue: $("hire-value"),
    hireMax: $("hire-max"),
    hireFill: $("hire-fill"),
    hireDelta: $("hire-delta"),
    bustedValue: $("busted-value"),
    bustedFill: $("busted-fill"),
    bustedDelta: $("busted-delta"),
    meterBusted: document.querySelector(".meter-busted"),
    timer: $("timer"),
    timerValue: $("timer-value"),
    avatar: $("avatar"),
    personaName: $("persona-name"),
    bubble: $("bubble"),
    wantsList: $("wants-list"),
    cv: $("cv-card"),
    cvEyebrow: $("cv-eyebrow"),
    rewriteLabel: $("rewrite-label"),
    originalLine: $("original-line"),
    form: $("rewrite-form"),
    rewrite: $("rewrite"),
    charCount: $("char-count"),
    writeRow: $("write-row"),
    btnSubmit: $("btn-submit"),
    result: $("result"),
    resHire: $("res-hire"),
    resBusted: $("res-busted"),
    resTime: $("res-time"),
    resContradiction: $("res-contradiction"),
    btnNext: $("btn-next"),
    endCard: $("end-card"),
    endEmoji: $("end-emoji"),
    endTitle: $("end-title"),
    endSub: $("end-sub"),
    endGaveaway: $("end-gaveaway"),
    scHire: $("sc-hire"),
    scBusted: $("sc-busted"),
    scTime: $("sc-time"),
    scTotal: $("sc-total"),
    btnAgain: $("btn-again"),
    compareList: $("compare-list"),
    btnMute: $("btn-mute"),
  };

  // Sound is decoration: if sound.js failed to load, the game runs silently.
  const Sound = window.Sound || { play() {}, unlock() {}, toggle: () => true, muted: true };

  // ---------- Small helpers ----------
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normText = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  function restartAnimation(node, cls) {
    node.classList.remove(cls);
    void node.offsetWidth; // reflow so the animation plays again
    node.classList.add(cls);
  }

  function listItems(items) {
    return items.map((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      return li;
    });
  }

  // After a screen change, ignore clicks/Enter briefly so a keypress meant for the
  // previous screen (or racing an auto-advance) can't skip the new one.
  let inputLockedUntil = 0;
  const inputLocked = () => performance.now() < inputLockedUntil;
  const lockInput = (ms = 500) => {
    inputLockedUntil = Math.max(inputLockedUntil, performance.now() + ms);
  };

  function show(screenId, lockMs = 500) {
    document.querySelectorAll(".screen").forEach((s) => s.classList.toggle("active", s.id === screenId));
    document.body.dataset.screen = screenId.replace("screen-", "");
    lockInput(lockMs);
  }

  // sessionStorage can throw (private mode, blocked storage): always fall back to memory.
  const store = {
    get(key, fallback) {
      try {
        const v = sessionStorage.getItem(key);
        return v === null ? fallback : v;
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        sessionStorage.setItem(key, String(value));
      } catch {
        /* memory only */
      }
    },
  };

  let sid = null;
  function sessionId() {
    if (!sid) {
      sid =
        store.get("fitymi.sid", null) ||
        (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
      store.set("fitymi.sid", sid);
    }
    return sid;
  }

  let memoryCalls = 0;
  const callsUsed = () => Math.max(memoryCalls, parseInt(store.get("fitymi.calls", "0"), 10) || 0);
  function recordCall() {
    memoryCalls = callsUsed() + 1;
    store.set("fitymi.calls", memoryCalls);
  }

  // ---------- The interviewer (/api/judge) ----------
  function clampInt(value, low, high, fallback) {
    if (value === null || value === undefined || value === "") return fallback;
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(high, Math.max(low, n)) : fallback;
  }

  function cleanStr(value, max) {
    if (typeof value !== "string") return null;
    const s = value.replace(/\s+/g, " ").trim();
    if (!s || /^(null|none)$/i.test(s)) return null;
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  }

  function normalizeResult(data) {
    if (!data || typeof data !== "object") return { ...FALLBACK, fallback: true };
    return {
      impressiveness: clampInt(data.impressiveness, 0, 10, FALLBACK.impressiveness),
      suspicion_delta: clampInt(data.suspicion_delta, 0, 30, FALLBACK.suspicion_delta),
      reaction: cleanStr(data.reaction, 160) || FALLBACK.reaction,
      follow_up_question: cleanStr(data.follow_up_question, 160),
      caught_contradiction: cleanStr(data.caught_contradiction, 200),
      fallback: Boolean(data.fallback),
    };
  }

  async function callJudge(payload) {
    if (callsUsed() >= CONFIG.MAX_CALLS_PER_SESSION) {
      return { ...FALLBACK, reaction: "The interviewer has left for lunch. (Demo limit reached.)", fallback: true };
    }
    recordCall();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), CONFIG.CLIENT_TIMEOUT_MS);
    try {
      const res = await fetch("/api/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Session-Id": sessionId() },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await res.json().catch(() => null);
      return normalizeResult(data);
    } catch {
      return { ...FALLBACK, fallback: true };
    } finally {
      clearTimeout(timeout);
    }
  }

  // ---------- Timer (deadline-based, pausable) ----------
  const timer = {
    total: 1,
    remaining: 0,
    deadline: 0,
    running: false,
    raf: 0,
    onEnd: null,
    start(seconds, onEnd) {
      cancelAnimationFrame(this.raf);
      this.total = seconds * 1000;
      this.remaining = this.total;
      this.onEnd = onEnd;
      this.resume();
    },
    resume() {
      this.deadline = performance.now() + this.remaining;
      this.running = true;
      el.timer.classList.remove("paused");
      this.tick();
    },
    pause() {
      if (!this.running) return;
      this.remaining = Math.max(0, this.deadline - performance.now());
      this.running = false;
      cancelAnimationFrame(this.raf);
      el.timer.classList.add("paused");
      this.render(this.remaining);
    },
    stop() {
      this.running = false;
      this.onEnd = null;
      cancelAnimationFrame(this.raf);
    },
    remainingMs() {
      return this.running ? Math.max(0, this.deadline - performance.now()) : this.remaining;
    },
    tick() {
      if (!this.running) return;
      const left = Math.max(0, this.deadline - performance.now());
      this.render(left);
      if (left <= 0) {
        this.running = false;
        this.remaining = 0;
        Sound.play("timeup");
        const done = this.onEnd;
        this.onEnd = null;
        if (done) done();
        return;
      }
      this.raf = requestAnimationFrame(() => this.tick());
    },
    render(left) {
      const secs = String(Math.ceil(left / 1000));
      if (el.timerValue.textContent !== secs) {
        el.timerValue.textContent = secs;
        if (this.running && left > 0 && left < 5000) Sound.play("tick"); // last five seconds
      }
      el.timer.style.setProperty("--p", (left / this.total).toFixed(4));
      el.timer.classList.toggle("danger", left > 0 && left < 5000);
    },
  };

  // ---------- Run state ----------
  let run = null;
  let jobRaf = 0;
  let autoTimer = 0;

  function pickScenario() {
    const list = window.SCENARIOS || [];
    const forced = new URLSearchParams(location.search).get("scenario");
    const chosen = list.find((s) => s.id === forced);
    if (chosen) return chosen;
    const last = store.get("fitymi.last", "");
    const pool = list.length > 1 ? list.filter((s) => s.id !== last) : list;
    const choice = pick(pool);
    store.set("fitymi.last", choice.id);
    return choice;
  }

  function stageFor(lineIndex) {
    let end = 0;
    for (const stage of STAGES) {
      end += stage.lines;
      if (lineIndex < end) return stage;
    }
    return STAGES[STAGES.length - 1];
  }

  function isFirstLineOfStage(lineIndex) {
    let start = 0;
    for (const stage of STAGES) {
      if (lineIndex === start) return true;
      start += stage.lines;
    }
    return false;
  }

  function newRun() {
    clearTimeout(autoTimer);
    timer.stop();
    const scenario = pickScenario();
    run = {
      scenario,
      lineIndex: 0,
      totalLines: Math.min(
        STAGES.reduce((n, s) => n + s.lines, 0),
        scenario.cv.length,
      ),
      hire: 0,
      busted: 0,
      timeBonus: 0,
      ledger: [], // the lie ledger: every claim made so far, sent with each call to catch contradictions
      history: [],
      phase: "job",
      current: null, // the line being played: { index, stage, original, rewrite, question }
      pendingFollowUp: null,
      pendingEnding: null,
      bustedBy: null,
      resultShownAt: 0,
    };
    showJob();
  }

  // Shared auto-advance: drains a bar along the button, then calls fn.
  function armTimedButton(button, seconds, fn) {
    button.style.setProperty("--auto", `${seconds}s`);
    restartAnimation(button, "counting");
    clearTimeout(autoTimer);
    autoTimer = setTimeout(fn, seconds * 1000);
  }

  // ---------- Job ad ----------
  function showJob() {
    const s = run.scenario;
    el.jobTitle.textContent = s.title;
    el.jobCompany.textContent = s.company;
    el.jobDesc.textContent = s.description;
    el.jobCriteria.replaceChildren(...listItems(s.criteria));
    el.jobFill.style.transform = "scaleX(1)";
    show("screen-job");
    el.btnReady.focus();

    const started = performance.now();
    const duration = CONFIG.JOB_SECONDS * 1000;
    cancelAnimationFrame(jobRaf);
    const step = (now) => {
      if (!run || run.phase !== "job") return;
      const left = Math.max(0, 1 - (now - started) / duration);
      el.jobFill.style.transform = `scaleX(${left})`;
      if (left <= 0) beginInterview();
      else jobRaf = requestAnimationFrame(step);
    };
    jobRaf = requestAnimationFrame(step);
  }

  function beginInterview() {
    if (!run || run.phase !== "job") return;
    cancelAnimationFrame(jobRaf);
    run.phase = "between";
    el.hireMax.textContent = CONFIG.HIRE_THRESHOLD;
    el.wantsList.textContent = run.scenario.criteria.join(" · ");
    el.hireValue.textContent = "0";
    el.bustedValue.textContent = "0";
    renderMeters();
    show("screen-game");
    startLine();
  }

  // ---------- Stage intro (between interviews) ----------
  function showStageIntro() {
    const stage = stageFor(run.lineIndex);
    run.phase = "stage";
    el.stageEyebrow.textContent = `Stage ${stage.id} of ${STAGES.length}`;
    el.stageTitle.textContent = stage.name;
    el.stageIntro.textContent = stage.intro;
    el.stagePersona.textContent = stage.persona;
    el.stageAvatar.style.setProperty("--accent", stage.accent);
    el.stageAvatar.textContent = moodFace();
    el.stageStats.innerHTML = "";
    el.stageStats.append(
      "Hire-o-meter ",
      Object.assign(document.createElement("b"), { textContent: `${run.hire}/${CONFIG.HIRE_THRESHOLD}` }),
      " · Busted ",
      Object.assign(document.createElement("b"), { textContent: `${run.busted}/${CONFIG.BUSTED_MAX}` }),
    );
    show("screen-stage");
    Sound.play("stage");
    el.btnStage.focus();
    armTimedButton(el.btnStage, CONFIG.STAGE_INTRO_SECONDS, beginStage);
  }

  function beginStage() {
    if (!run || run.phase !== "stage") return;
    clearTimeout(autoTimer);
    run.phase = "between";
    show("screen-game");
    startLine();
  }

  // ---------- A round ----------
  function startLine() {
    if (run.lineIndex >= run.totalLines) return finish("rejected");
    const stage = stageFor(run.lineIndex);
    const original = run.scenario.cv[run.lineIndex];

    el.stageLabel.textContent = `Stage ${stage.id} of ${STAGES.length} · ${stage.name}`;
    el.lineCounter.textContent = `Line ${run.lineIndex + 1} of ${run.totalLines}`;
    el.personaName.textContent = stage.persona;
    el.avatar.style.setProperty("--accent", stage.accent);
    say(isFirstLineOfStage(run.lineIndex) ? stage.greeting : pick(stage.prompts));
    run.current = { index: run.lineIndex, stage, original, rewrite: null, question: null };

    setCardMode(false);
    el.originalLine.textContent = original;
    restartAnimation(el.originalLine, "enter");
    openTextBox(original);
    run.phase = "writing";
    timer.start(stage.seconds, () => submit(true));
  }

  // The interviewer asks about the claim just made; the player gets a short, separate timer.
  function startFollowUp() {
    const cur = run.current;
    cur.question = run.pendingFollowUp;
    run.pendingFollowUp = null;

    el.lineCounter.textContent = `Line ${cur.index + 1} of ${run.totalLines} · Follow-up question`;
    say(cur.question, true);
    Sound.play("question");
    setCardMode(true);
    el.originalLine.textContent = cur.rewrite || cur.original;
    restartAnimation(el.originalLine, "enter");
    openTextBox("");
    run.phase = "answering";
    timer.start(CONFIG.FOLLOWUP_SECONDS, () => submit(true));
  }

  function setCardMode(followUp) {
    el.cv.classList.toggle("followup", followUp);
    el.cvEyebrow.textContent = followUp ? "You claimed" : "Your real CV says";
    el.rewriteLabel.textContent = followUp ? "Your answer" : "Your version";
    el.rewrite.placeholder = followUp ? "Answer fast. Confidence is everything." : "";
  }

  function openTextBox(value) {
    el.rewrite.value = value;
    el.rewrite.disabled = false;
    el.btnSubmit.disabled = false;
    el.writeRow.hidden = false;
    el.result.hidden = true;
    el.resContradiction.hidden = true;
    updateCharCount();
    el.rewrite.focus();
    el.rewrite.setSelectionRange(value.length, value.length);
    lockInput(); // an Enter racing an auto-advance must not submit this right away
  }

  // Judges either a CV-line rewrite ("writing") or a follow-up answer ("answering").
  async function submit(timedOut) {
    if (!run || (run.phase !== "writing" && run.phase !== "answering")) return;
    const thisRun = run;
    const cur = run.current;
    const isAnswer = run.phase === "answering";
    run.phase = "judging";
    timer.pause();
    if (!timedOut) Sound.play("click");

    const secondsLeft = timedOut ? 0 : Math.ceil(timer.remainingMs() / 1000); // matches the number on screen
    const text = el.rewrite.value.replace(/\s+/g, " ").trim().slice(0, CONFIG.MAX_CHARS);
    el.rewrite.value = text;
    el.rewrite.disabled = true;
    el.btnSubmit.disabled = true;
    showReading();

    const payload = {
      stage: cur.stage.id,
      persona: cur.stage.persona,
      job: {
        title: run.scenario.title,
        company: run.scenario.company,
        description: run.scenario.description,
        criteria: run.scenario.criteria,
      },
      originalLine: cur.original,
      playerRewrite: text,
      type: isAnswer ? "followup_answer" : "rewrite",
      followUpQuestion: isAnswer ? cur.question : null,
      lieLedger: run.ledger.slice(),
    };
    const [result] = await Promise.all([callJudge(payload), wait(CONFIG.MIN_READING_MS)]);
    if (run !== thisRun) return; // the player restarted meanwhile

    let bonus = 0;
    if (isAnswer) {
      if (text) run.ledger.push(`Answer to "${cur.question}": ${text}`);
    } else {
      if (text) run.ledger.push(text);
      cur.rewrite = text;
      // Time bonus only for lines you actually rewrote (no points for mashing Enter).
      const rewritten = text.length > 0 && normText(text) !== normText(cur.original);
      bonus = rewritten ? secondsLeft : 0;
      run.lineIndex += 1;
      run.pendingFollowUp = cur.stage.followUps ? result.follow_up_question : null;
    }
    run.hire += result.impressiveness;
    run.busted = Math.min(CONFIG.BUSTED_MAX, run.busted + result.suspicion_delta);
    run.timeBonus += bonus;
    run.history.push({
      type: isAnswer ? "followup" : "rewrite",
      index: cur.index,
      stage: cur.stage.id,
      original: cur.original,
      question: isAnswer ? cur.question : null,
      text,
      impressiveness: result.impressiveness,
      suspicion: result.suspicion_delta,
      reaction: result.reaction,
      contradiction: result.caught_contradiction,
      bonus,
    });

    say(result.reaction);
    renderMeters({ hire: result.impressiveness, busted: result.suspicion_delta });
    showResult(result, bonus, timedOut, isAnswer);
    Sound.play(
      result.caught_contradiction
        ? "caught"
        : result.suspicion_delta >= 15
          ? "suspicious"
          : result.impressiveness >= 6
            ? "good"
            : "meh",
    );

    run.pendingEnding = checkEnding();
    if (run.pendingEnding) run.pendingFollowUp = null;
    run.phase = "result";
    run.resultShownAt = performance.now();

    let label = "Next line";
    let seconds = CONFIG.AUTO_NEXT_SECONDS;
    if (run.pendingEnding) {
      label = "See the verdict";
      seconds = CONFIG.AUTO_VERDICT_SECONDS;
    } else if (run.pendingFollowUp) {
      label = "Answer the question";
      seconds = CONFIG.FOLLOWUP_DELAY_SECONDS;
    } else if (isFirstLineOfStage(run.lineIndex)) {
      label = "Next interview";
    }
    el.btnNext.querySelector(".btn-label").textContent = label;
    el.btnNext.focus({ preventScroll: true });
    armTimedButton(el.btnNext, seconds, goNext);
  }

  function checkEnding() {
    if (run.busted >= CONFIG.BUSTED_MAX) {
      run.bustedBy = run.history[run.history.length - 1];
      return "busted";
    }
    // Reaching the threshold while very suspicious replaces Hired with Overqualified.
    if (run.hire >= CONFIG.HIRE_THRESHOLD) return run.busted > 80 ? "overqualified" : "hired";
    if (run.pendingFollowUp) return null; // the last line's follow-up still gets played
    if (run.lineIndex >= run.totalLines) return "rejected";
    return null;
  }

  function goNext() {
    if (!run || run.phase !== "result") return;
    if (performance.now() - run.resultShownAt < 350) return; // ignore a stray double Enter
    clearTimeout(autoTimer);
    el.btnNext.classList.remove("counting");
    run.phase = "between";
    if (run.pendingEnding) return finish(run.pendingEnding);
    if (run.pendingFollowUp) return startFollowUp();
    if (isFirstLineOfStage(run.lineIndex)) return showStageIntro();
    startLine();
  }

  // ---------- Rendering ----------
  function say(text, isQuestion = false) {
    el.bubble.textContent = text;
    el.bubble.classList.toggle("question", isQuestion);
    restartAnimation(el.bubble, "say");
  }

  function showReading() {
    el.bubble.classList.remove("say", "question");
    el.bubble.innerHTML =
      '<span class="reading"><span class="dots"><i></i><i></i><i></i></span>The interviewer is reading…</span>';
  }

  function showResult(result, bonus, timedOut, isAnswer) {
    el.resHire.textContent = `+${result.impressiveness} hire`;
    el.resBusted.textContent = `+${result.suspicion_delta} suspicion`;
    if (isAnswer) {
      // Time bonus is per CV line, so answers only mention the clock when it ran out.
      el.resTime.textContent = "Time's up, sent as is";
      el.resTime.hidden = !timedOut;
    } else {
      el.resTime.textContent = bonus > 0 ? `+${bonus} time bonus` : timedOut ? "Time's up, sent as is" : "No time bonus";
      el.resTime.hidden = false;
    }
    if (result.caught_contradiction) {
      el.resContradiction.textContent = `🚩 Caught: ${result.caught_contradiction}`;
      el.resContradiction.hidden = false;
    }
    el.writeRow.hidden = true;
    el.result.hidden = false;
  }

  function countTo(node, target, duration = 700) {
    const from = parseInt(node.textContent, 10) || 0;
    if (from === target) return;
    const started = performance.now();
    const step = (now) => {
      const t = Math.min(1, (now - started) / duration);
      node.textContent = Math.round(from + (target - from) * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function floatDelta(node, text) {
    node.textContent = text;
    restartAnimation(node, "pop");
  }

  function moodFace() {
    if (run.busted >= 67) return "😠";
    if (run.busted >= 34) return "🤨";
    return "🙂";
  }

  function renderMeters(delta) {
    el.hireFill.style.width = `${Math.min(1, run.hire / CONFIG.HIRE_THRESHOLD) * 100}%`;
    el.bustedFill.style.width = `${Math.min(1, run.busted / CONFIG.BUSTED_MAX) * 100}%`;
    countTo(el.hireValue, run.hire);
    countTo(el.bustedValue, run.busted);
    el.meterBusted.classList.toggle("hot", run.busted >= 80);

    const face = moodFace();
    if (el.avatar.textContent !== face) {
      el.avatar.textContent = face;
      if (delta) restartAnimation(el.avatar, "react");
    }
    if (delta && delta.hire) floatDelta(el.hireDelta, `+${delta.hire}`);
    if (delta && delta.busted) floatDelta(el.bustedDelta, `+${delta.busted}`);
  }

  function updateCharCount() {
    const n = el.rewrite.value.length;
    el.charCount.textContent = `${n} / ${CONFIG.MAX_CHARS}`;
    el.charCount.classList.toggle("near", n >= CONFIG.MAX_CHARS - 20);
  }

  // ---------- End ----------
  function finish(kind) {
    timer.stop();
    clearTimeout(autoTimer);
    run.phase = "end";
    const ending = ENDINGS[kind];
    el.endCard.className = `card panel end ${kind}`;
    el.endEmoji.textContent = ending.emoji;
    el.endTitle.textContent = ending.title;
    el.endSub.textContent = ending.sub;

    if (kind === "busted" && run.bustedBy) {
      const byAnswer = run.bustedBy.type === "followup";
      const label = Object.assign(document.createElement("div"), {
        className: "eyebrow",
        textContent: byAnswer ? "The answer that gave you away" : "The line that gave you away",
      });
      const quote = Object.assign(document.createElement("q"), {
        textContent: run.bustedBy.text || (byAnswer ? "(awkward silence)" : "(an empty line)"),
      });
      const persona = STAGES.find((s) => s.id === run.bustedBy.stage).persona;
      const said = Object.assign(document.createElement("div"), {
        className: "said",
        textContent: `${persona}: “${run.bustedBy.reaction}”`,
      });
      el.endGaveaway.replaceChildren(label, quote, said);
      el.endGaveaway.hidden = false;
    } else {
      el.endGaveaway.hidden = true;
    }

    const total = run.hire - run.busted + run.timeBonus;
    el.scHire.textContent = run.hire;
    el.scBusted.textContent = `−${run.busted}`;
    el.scTime.textContent = `+${run.timeBonus}`;
    el.scTotal.textContent = "0";
    renderComparison(kind);
    show("screen-end", 1500);
    el.btnAgain.focus();
    window.scrollTo(0, 0);

    Sound.play(kind);
    setTimeout(() => countTo(el.scTotal, total, 1100), 350);
    if (kind === "hired") confetti();
    if (kind === "busted") setTimeout(() => restartAnimation(el.endCard, "shake"), 250);
  }

  // The real CV next to what the player claimed, with each line's points and any follow-up.
  function renderComparison(kind) {
    const unplayedNote = {
      hired: "Not needed. You were already in.",
      overqualified: "Not needed. They'd seen enough.",
      busted: "Security got there first.",
    }[kind] || "—";
    const make = (tag, className = "", text = "") => Object.assign(document.createElement(tag), { className, textContent: text });
    const points = (entry) => {
      const box = make("div", "compare-pts");
      box.append(make("span", "h", `+${entry.impressiveness} hire`), make("span", "s", `+${entry.suspicion} suspicion`));
      return box;
    };

    const rows = run.scenario.cv.slice(0, run.totalLines).map((truth, i) => {
      const li = document.createElement("li");
      li.style.animationDelay = `${0.3 + i * 0.06}s`;
      const line = run.history.find((h) => h.type === "rewrite" && h.index === i);
      const answer = run.history.find((h) => h.type === "followup" && h.index === i);
      const claim = make("div", "compare-claim");
      if (!line) {
        claim.classList.add("unplayed");
        claim.textContent = unplayedNote;
      } else {
        claim.append(line.text || "(left blank)", points(line));
        if (answer) {
          const qa = make("div", "compare-qa");
          const q = make("div");
          q.append(make("b", "", "Q: "), answer.question);
          const a = make("div");
          a.append(make("b", "", "A: "), answer.text || "(silence)", ` (+${answer.impressiveness} / +${answer.suspicion})`);
          qa.append(q, a);
          claim.append(qa);
        }
      }
      li.append(make("div", "compare-truth", truth), claim);
      return li;
    });
    el.compareList.replaceChildren(...rows);
  }

  function confetti() {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const colors = ["#ffb703", "#3ee07a", "#ff4766", "#1368ce", "#ff5fa2", "#a78bfa", "#ffffff"];
    const box = document.createElement("div");
    box.className = "confetti";
    for (let i = 0; i < 120; i++) {
      const piece = document.createElement("i");
      piece.style.left = `${Math.random() * 100}vw`;
      piece.style.background = pick(colors);
      piece.style.setProperty("--d", `${(2 + Math.random() * 1.8).toFixed(2)}s`);
      piece.style.setProperty("--delay", `${(Math.random() * 0.6).toFixed(2)}s`);
      piece.style.setProperty("--drift", `${Math.round(Math.random() * 200 - 100)}px`);
      piece.style.setProperty("--spin", `${Math.round(Math.random() * 1000 - 500)}deg`);
      box.append(piece);
    }
    document.body.append(box);
    setTimeout(() => box.remove(), 4500);
  }

  // ---------- Input ----------
  const unlessLocked = (fn) => () => {
    if (!inputLocked()) fn();
  };
  const startWithSound = () => {
    Sound.unlock(); // browsers only allow audio after a user gesture
    Sound.play("click");
    newRun();
  };
  el.btnApply.addEventListener("click", startWithSound);
  el.btnAgain.addEventListener("click", unlessLocked(startWithSound));

  // Mute toggle: keep focus where it was (e.g. the text box) so Enter keeps working.
  const syncMute = () => {
    el.btnMute.classList.toggle("muted", Sound.muted);
    el.btnMute.setAttribute("aria-label", Sound.muted ? "Unmute sound" : "Mute sound");
  };
  el.btnMute.addEventListener("mousedown", (e) => e.preventDefault());
  el.btnMute.addEventListener("click", () => {
    Sound.toggle();
    syncMute();
    el.btnMute.blur();
  });
  syncMute();
  el.btnReady.addEventListener("click", unlessLocked(beginInterview));
  el.btnStage.addEventListener("click", unlessLocked(beginStage));
  el.btnNext.addEventListener("click", goNext);

  el.form.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!inputLocked()) submit(false);
  });

  el.rewrite.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      // An Enter meant for the previous screen (e.g. racing the stage intro) must not submit.
      if (!e.repeat && !inputLocked()) submit(false);
    }
  });

  el.rewrite.addEventListener("input", () => {
    if (/[\r\n]/.test(el.rewrite.value)) el.rewrite.value = el.rewrite.value.replace(/[\r\n]+/g, " ");
    updateCharCount();
  });

  // Held-down Enter must not fly through several screens.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Enter" && e.repeat) e.preventDefault();
    },
    true,
  );

  // Enter advances when focus isn't on a button or the text box (those handle Enter themselves).
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.repeat || !run) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "BUTTON" || tag === "TEXTAREA") return;
    if (inputLocked()) return;
    const actions = { result: goNext, job: beginInterview, stage: beginStage };
    if (actions[run.phase]) {
      e.preventDefault();
      actions[run.phase]();
    }
  });

  el.btnApply.focus();

  // ?debug=1 exposes the run state in the console for testing.
  if (new URLSearchParams(location.search).has("debug")) {
    window.__fitymi = { state: () => run, config: CONFIG, stages: STAGES };
  }
})();
