// Builds the presentation in English and Traditional Chinese.
//   node slides/make_slides_v2.js           (needs: npm install pptxgenjs)
// Numbers come from README.md, loop/runs.jsonl and docs/part4.md.
const fs = require("fs");
const path = require("path");
const pptxgen = require("pptxgenjs");

const OUT = process.env.SLIDES_OUT || __dirname; // SLIDES_OUT: write elsewhere, e.g. while the deck is open
const DOCS = path.join(__dirname, "..", "docs");

const HEX = {
  ink: "14213D", white: "FFFFFF", muted: "475569", rule: "F0EEEB",
  llm: "2F6FDE", llmFill: "D6E4FB", ok: "1E9E5A", bad: "D64545", warn: "B7791F", line: "C9CED8",
};

function build(lang) {
  const zh = lang === "zh";
  const L = (en, z) => (zh ? z : en);
  const HEAD = zh ? "Microsoft JhengHei" : "Cambria";
  const BODY = zh ? "Microsoft JhengHei" : "Calibri";
  const MONO = "Consolas";

  const pres = new pptxgen();
  pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
  pres.theme = { headFontFace: HEAD, bodyFontFace: BODY };
  pres.title = L("An automated researcher for Barlow Twins", "Barlow Twins 的自動研究迴圈");
  const C = {
    ink: HEX.ink, white: HEX.white, muted: HEX.muted, rule: HEX.rule, llm: HEX.llm,
    llmFill: HEX.llmFill, ok: HEX.ok, bad: HEX.bad, warn: HEX.warn,
  };
  const FOOT = "automated-researcher-takehome";

  pres.defineSlideMaster({
    title: "COVER", background: { color: HEX.ink },
    objects: [
      { placeholder: { options: { name: "title", type: "title", x: 0.8, y: 2.1, w: 11.7, h: 1.9, fontFace: HEAD, fontSize: 40, bold: true, color: HEX.white, valign: "top", align: "left", margin: 0 }, text: "" } },
      { placeholder: { options: { name: "body", type: "body", x: 0.8, y: 4.2, w: 11.7, h: 1.6, fontFace: BODY, fontSize: 18, color: "C9D6F2", valign: "top", margin: 0 }, text: "" } },
    ],
  });
  pres.defineSlideMaster({
    title: "CONTENT", background: { color: HEX.white },
    objects: [
      { placeholder: { options: { name: "kicker", type: "body", x: 0.6, y: 0.38, w: 12.1, h: 0.3, fontFace: BODY, fontSize: 12, bold: true, color: HEX.llm, margin: 0, charSpacing: 1.5 }, text: "" } },
      { placeholder: { options: { name: "title", type: "title", x: 0.6, y: 0.7, w: 12.1, h: 1.05, fontFace: HEAD, fontSize: 28, bold: true, color: HEX.ink, valign: "top", align: "left", margin: 0 }, text: "" } },
      { text: { text: FOOT, options: { x: 0.6, y: 7.05, w: 6, h: 0.3, fontFace: BODY, fontSize: 10, color: HEX.muted, margin: 0 } } },
    ],
    slideNumber: { x: 12.1, y: 7.05, w: 0.63, h: 0.3, fontFace: BODY, fontSize: 10, color: HEX.muted, align: "right" },
  });
  pres.defineSlideMaster({
    title: "FIGURE", background: { color: HEX.white },
    objects: [
      { placeholder: { options: { name: "kicker", type: "body", x: 10.35, y: 0.5, w: 2.6, h: 0.3, fontFace: BODY, fontSize: 12, bold: true, color: HEX.llm, margin: 0, charSpacing: 1.5 }, text: "" } },
      { placeholder: { options: { name: "title", type: "title", x: 10.35, y: 0.85, w: 2.6, h: 2.3, fontFace: HEAD, fontSize: 20, bold: true, color: HEX.ink, valign: "top", align: "left", margin: 0 }, text: "" } },
    ],
    slideNumber: { x: 12.1, y: 7.05, w: 0.63, h: 0.3, fontFace: BODY, fontSize: 10, color: HEX.muted, align: "right" },
  });

  let section = "";
  const sect = (title) => { section = title; pres.addSection({ title }); };
  const withLang = (s) => {
    if (!zh) return s;
    const add = s.addText.bind(s);
    s.addText = (t, o) => add(t, Object.assign({ lang: "zh-TW" }, o));
    return s;
  };
  let count = 0, LAST = null;
  const REF = {};
  const addS = (o) => { const s = pres.addSlide(o); s._n = ++count; LAST = s; return s; };
  const slideOf = (master, kicker, title, notes) => {
    const s = withLang(addS({ masterName: master, sectionTitle: section }));
    if (kicker) s.addText(kicker, { placeholder: "kicker" });
    s.addText(title, { placeholder: "title" });
    if (notes) s.addNotes(notes);
    return s;
  };

  // ---- helpers -------------------------------------------------------------------
  const txt = (s, text, o) => s.addText(text, Object.assign({ isTextBox: true, fontFace: BODY, fontSize: 14, color: C.ink, margin: 0, valign: "top" }, o));
  const card = (s, x, y, w, h, fill, lineColor) => s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, rectRadius: 0.08, fill: { color: fill || C.rule }, line: { color: lineColor || HEX.line, width: 0.75 } });
  const chip = (s, x, y, kind, w) => { // the deck's motif: who decides
    const isLLM = kind === "llm";
    const label = isLLM ? L("LLM decision", "LLM 的決定") : L("program rule", "程式規則");
    s.addText(label, { isTextBox: true, shape: pres.shapes.ROUNDED_RECTANGLE, rectRadius: 0.12, x, y, w: w || 1.55, h: 0.3,
      fill: { color: isLLM ? C.llm : C.muted }, color: C.white, fontFace: BODY, fontSize: 11, bold: true, align: "center", valign: "middle", margin: 0 });
  };
  const bullets = (s, items, o) => s.addText(items.map((t, i) => ({ text: t, options: { bullet: true, breakLine: i < items.length - 1 } })),
    Object.assign({ isTextBox: true, fontFace: BODY, fontSize: 14, color: C.ink, margin: 0, valign: "top", paraSpaceAfter: 6 }, o));
  const code = (s, lines, x, y, w, h, size) => {
    s.addShape(pres.shapes.RECTANGLE, { x, y, w, h, fill: { color: "0F1A30" }, line: { color: "0F1A30", width: 0 } });
    s.addText(lines.map((ln, i) => ({ text: ln.t === undefined ? ln : ln.t, options: { color: ln.c || "E6ECF7", breakLine: i < lines.length - 1 } })),
      { isTextBox: true, x: x + 0.15, y: y + 0.1, w: w - 0.3, h: h - 0.2, fontFace: MONO, fontSize: size || 11, margin: 0, valign: "top" });
  };
  const arrow = (s, x, y, w) => s.addShape(pres.shapes.LINE, { x, y, w, h: 0, line: { color: HEX.muted, width: 1.5, endArrowType: "triangle" } });
  const head = (s, text, x, y, w, color) => txt(s, text, { x, y, w, h: 0.35, fontSize: 16, bold: true, color: color || C.ink });

  // ================================================================== 1 cover
  sect("Overview");
  {
    const s = withLang(addS({ masterName: "COVER", sectionTitle: section }));
    s.addText(L("An automated researcher for Barlow Twins on CIFAR-100", "Barlow Twins 在 CIFAR-100 上的\n自動研究迴圈"), { placeholder: "title" });
    s.addText(L("Take-home exam · FML-bench task Representation_Learning_solo_learn\nNovember 2026 · github.com/sandrinha-c/automated-researcher-takehome",
      "Take-home exam · FML-bench 任務 Representation_Learning_solo_learn\n2026 年 11 月 · github.com/sandrinha-c/automated-researcher-takehome"), { placeholder: "body" });
    s.addText("Propose → Modify → Execute → Evaluate → Record → Repeat", { isTextBox: true, x: 0.8, y: 1.45, w: 11.7, h: 0.4, fontFace: MONO, fontSize: 16, color: "8FB3F5", margin: 0 });
    s.addNotes(L("Thirty minutes: Part 1 five, Part 2 twelve, Part 3 eight, Part 4 five.", "三十分鐘：Part 1 五分鐘、Part 2 十二分鐘、Part 3 八分鐘、Part 4 五分鐘。"));
  }

  // ================================================================== 2 summary
  {
    const s = slideOf("CONTENT", "Summary",
      L("An automated research loop: 17% → 20%, then 48% in a pilot run", "自動研究迴圈：第一輪 17% → 20%，pilot run 到 48%"),
      L("One card per part of the brief. "
        + "Part 1: the shortened baseline scores 17.01% on seed 42; that is the starting line. Part 2: my own controller ran three candidates from one command without a human in the loop, and the best went from 17.01% to 20.03%. "
        + "Part 3: what happened in that loop, and then a pilot run that goes beyond the brief; the best mean of three seeds went from 20.4% to 48.0%. That is at 20 pretraining epochs; the official 47.77% is the unmodified baseline at 130 epochs, so the two are not comparable. "
        + "Part 4: one controlled experiment that changes only how the loop explores. "
        + "The thread of the talk, to say aloud: the loop can run experiments by itself; a pilot run raised the score but cannot say why; a controlled experiment is how to find out.",
        "一張卡片對應題目的一個部分。"
        + "Part 1：縮短版 baseline 在 seed 42 是 17.01%，這是起跑線。Part 2：我自己寫的 controller 用一個指令跑完三個候選，過程中沒有人介入，best 從 17.01% 到 20.03%。"
        + "Part 3：那個迴圈裡發生了什麼，以及一次超出題目要求的 pilot run；best 的三 seed 平均從 20.4% 到 48.0%。這是預訓練 20 輪的結果；官方的 47.77% 是未修改的 baseline 跑 130 輪，兩者不能直接比。"
        + "Part 4：一個只改變探索方式的對照實驗。"
        + "整場報告的主線，用口頭講：迴圈可以自己做實驗；pilot run 讓分數提高，但說不出原因；要找出原因，就需要對照實驗。"));
    const cards = [
      ["Part 1 · 5 min", "Understand and run the baseline", "17.01%", L("The shortened baseline: the starting line.", "縮短版 baseline：起跑線。"), ""],
      ["Part 2 · 12 min", "Build and explain an autonomous research loop", "17.01% → 20.03%", L("My own loop: one command, three candidates.", "自己寫的迴圈：一個指令、三個候選。"), L("at seed 42: +3.02 points", "seed 42 上增加 3.02 個百分點")],
      ["Part 3 · 8 min", "Show what happened", "20.4% → 48.0%", L("Round 1, then a pilot run beyond the brief.", "第一輪的經過，以及題目之外的 pilot run。"),
        L("20 epochs; the official 47.77% is at 130, not comparable", "預訓練 20 輪；官方的 47.77% 是 130 輪，不能直接比")],
      ["Part 4 · 5 min", "Test one improvement", L("Fixed-ratio exploration", "固定比例的探索"), L("A controlled experiment that changes one thing.", "只改一件事的對照實驗。"), ""],
    ];
    cards.forEach((c, i) => {
      const w = 2.9, x = 0.6 + i * (w + 0.1667), y = 2.2, h = 3.1;
      card(s, x, y, w, h, C.rule);
      txt(s, c[0], { x: x + 0.2, y: y + 0.14, w: w - 0.4, h: 0.26, fontSize: 12, bold: true, color: C.llm, valign: "middle" });
      txt(s, c[1], { x: x + 0.2, y: y + 0.4, w: w - 0.4, h: 0.42, fontSize: 10, color: C.muted, valign: "top" });
      txt(s, c[2], { x: x + 0.2, y: y + 1.05, w: w - 0.4, h: 0.6, fontFace: HEAD, fontSize: 20, bold: true, color: C.ink, valign: "middle" });
      txt(s, [{ text: c[3], options: { fontSize: 13, breakLine: !!c[4] } }].concat(c[4] ? [{ text: c[4], options: { fontSize: 9, color: C.muted } }] : []),
        { x: x + 0.2, y: y + 1.8, w: w - 0.4, h: 1.2, valign: "top", paraSpaceAfter: 4 });
    });
  }

  // ================================================================== 3 Part 1: method + modification
  sect("Part 1");
  const P1 = "Part 1. Understand and run the baseline";
  const REF2 = "[2] FML-bench contributors. FML-bench: Benchmark code and Solo-learn task. GitHub, 2026.";
  const REF3 = "[3] J. Zbontar et al. Barlow Twins: Self-supervised learning via redundancy reduction. ICML, PMLR 139, 2021.";
  const refs = (s, lines) => {
    s.addShape(pres.shapes.LINE, { x: 0.6, y: 6.5, w: 12.1, h: 0, line: { color: HEX.line, width: 0.5 } });
    txt(s, lines.join("\n"), { x: 0.6, y: 6.55, w: 12.1, h: 0.45, fontSize: 9, color: C.muted, fontFace: BODY });
  };
  const subtitle = (s, t) => txt(s, t, { x: 0.6, y: 1.28, w: 12.1, h: 0.6, fontSize: 15, color: C.muted });
  {
    const s = slideOf("CONTENT", P1, L("How Barlow Twins and linear evaluation work, and one hypothesis: add a warm-up", "Barlow Twins、linear evaluation，以及一個假設：加上 warm-up"),
      L("Left: Barlow Twins. One photo, two different filters; the network must recognise that both are the same photo, and each feature must say something different, otherwise it could answer the same thing for every photo. The small grid is the scorecard: diagonal = recognises the pair, everything else = no repeated features. "
        + "Middle: how it is scored. Pretraining has no labels, so there is nothing to count as right or wrong. We freeze what it learned and train one very simple layer on top with labels. That layer cannot learn new features, so if it guesses well, the network learned well. This is FML-bench's evaluator, the same for every experiment. "
        + "Right: the learning rate is not fixed in either case; both lower it towards zero over training. The difference is the start. The Barlow Twins paper warms up for its first 10 of 1000 epochs. The FML-bench baseline starts at its maximum, 0.4, from the first step. The two use different optimisers (LARS and SGD), so only the shape of the curves is compared, not the values. The warm-up is drawn wider than it is so that it can be seen. My proposal: add a warm-up to the FML-bench baseline. It is a hypothesis; nothing on this slide tests it.",
        "左邊：Barlow Twins。同一張照片套兩種濾鏡，網路要認得出是同一張；每個特徵講的內容也不能重複，不然它可以偷懶，對每張照片都講一樣的話。小方格就是成績單：對角線代表認得出是同一張，其他格子代表特徵沒有重複。"
        + "中間：怎麼打分數。預訓練沒有答案，沒辦法算答對幾題。所以把學到的東西鎖住，只請一層很簡單的小幫手，用標籤去猜類別。小幫手自己學不出新東西，它猜得準就代表網路學得好。這是 FML-bench 的評估程式，每個實驗都用同一套考法。"
        + "右邊：兩邊的學習率都不是固定的，都會越來越小，像開車快到終點時慢慢放開油門。差別在一開始：Barlow Twins 論文前 10 輪先暖身（全部 1000 輪）；FML-bench 的 baseline 第一步就踩到底（0.4）。兩邊用的優化器不同（LARS 和 SGD），所以只比曲線的形狀，不比數值。暖身在圖上畫寬了，不然看不見。我的提案：在 FML-bench 的 baseline 加上 warm-up。這只是假設，這一頁沒有驗證它。"));

    const colW = 3.75, xs = [0.6, 4.75, 8.9], figY = 2.45, textY = 4.62;
    const colHead = [L("1  Barlow Twins", "1  Barlow Twins"), L("2  Linear evaluation", "2  Linear evaluation"), L("3  One possible modification: + warm-up", "3  一個可能的修改：+ warm-up")];
    colHead.forEach((h, i) => head(s, h, xs[i], 1.98, colW + (i === 2 ? 0.2 : 0)));
    const label = (t, x, y, w) => txt(s, t, { x, y, w, h: 0.45, fontSize: 11, color: C.muted, align: "center" });
    const box = (t, x, y, w, h, fill) => s.addText(t, { isTextBox: true, shape: pres.shapes.ROUNDED_RECTANGLE, rectRadius: 0.08, x, y, w, h,
      fill: { color: fill || C.rule }, line: { color: HEX.line, width: 0.75 }, fontFace: BODY, fontSize: 13, color: C.ink, align: "center", valign: "middle", margin: 0.04 });
    const photo = (x, y, size, sky, hill, sun) => { // a tiny picture: sky, hill, sun
      s.addShape(pres.shapes.RECTANGLE, { x, y, w: size, h: size, fill: { color: sky }, line: { color: HEX.line, width: 0.75 } });
      s.addShape(pres.shapes.ISOSCELES_TRIANGLE, { x: x + size * 0.08, y: y + size * 0.4, w: size * 0.84, h: size * 0.6, fill: { color: hill }, line: { color: hill, width: 0 } });
      s.addShape(pres.shapes.OVAL, { x: x + size * 0.62, y: y + size * 0.1, w: size * 0.22, h: size * 0.22, fill: { color: sun }, line: { color: sun, width: 0 } });
    };
    const colBullets = (items, x) => bullets(s, items, { x, y: textY, w: colW, h: 1.3, fontSize: 13, paraSpaceAfter: 4 });
    const note = (t, x) => txt(s, t, { x, y: 5.8, w: colW, h: 0.6, fontSize: 10, color: C.muted });

    // --- column 1: Barlow Twins, redrawn in simple form
    {
      const x = xs[0];
      photo(x, figY + 0.27, 0.66, "BFD7F5", "4C9A62", "F2C14E");
      arrow(s, x + 0.71, figY + 0.6, 0.22);
      photo(x + 0.98, figY, 0.56, "F5D6BF", "B0703C", "F2C14E");          // filter A: warm colours
      photo(x + 0.98, figY + 0.66, 0.56, "D9D9D9", "7A7A7A", "B5B5B5");   // filter B: grey
      arrow(s, x + 1.59, figY + 0.6, 0.22);
      box(L("same\nnetwork", "同一個\n網路"), x + 1.86, figY, 0.85, 1.22);
      arrow(s, x + 2.76, figY + 0.6, 0.22);
      const cell = 0.18, gx = x + 3.03, gy = figY + 0.25;
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++)
        s.addShape(pres.shapes.RECTANGLE, { x: gx + c * cell, y: gy + r * cell, w: cell, h: cell,
          fill: { color: r === c ? C.llm : "EEF2F8" }, line: { color: C.white, width: 0.75 } });
      label(L("photo", "照片"), x - 0.1, figY + 1.32, 0.86);
      label(L("2 filters", "兩種濾鏡"), x + 0.83, figY + 1.32, 0.86);
      label(L("scorecard", "成績單"), x + 2.92, figY + 1.32, 0.95);
      colBullets([
        L("Same photo, two filters: the network must recognise it is the same photo (diagonal → 1).", "同一張照片套兩種濾鏡，網路要認得出是同一張（對角線 → 1）。"),
        L("Each feature must say something different, so it cannot answer the same for every photo (rest → 0).", "每個特徵講的內容不能重複，免得它對每張照片都講一樣的話（其他格 → 0）。"),
      ], x);
      note(L("No labels are used. Simplified from Fig. 1 of the Barlow Twins paper [3].", "全程不用標籤。簡化自 Barlow Twins 論文 [3] 的圖 1。"), x);
    }

    // --- column 2: linear evaluation
    {
      const x = xs[1];
      box(L("network\n(frozen)", "網路\n（鎖住）"), x, figY, 1.1, 1.22);
      arrow(s, x + 1.15, figY + 0.6, 0.25);
      box(L("one simple\nlayer", "一層\n小幫手"), x + 1.45, figY, 0.95, 1.22);
      arrow(s, x + 2.45, figY + 0.6, 0.25);
      box(L("score", "分數"), x + 2.75, figY, 0.95, 1.22);
      label(L("not changed", "不准再改"), x - 0.05, figY + 1.32, 1.2);
      label(L("100 classes, labels", "用標籤學猜 100 類"), x + 1.2, figY + 1.32, 1.45);
      label(L("3,021 val images", "3,021 張驗證圖"), x + 2.6, figY + 1.32, 1.25);
      colBullets([
        L("Freeze what the network learned; train only one simple layer on top, with labels.", "把網路學到的東西鎖住，只訓練一層很簡單的小幫手，用標籤去猜類別。"),
        L("That layer cannot learn new features: if it guesses well, the network learned well.", "小幫手自己學不出新東西：它猜得準，就代表網路學得好。"),
      ], x);
      note(L("This is the FML-bench [2] evaluator. It is never edited and is the same for every experiment.", "這是 FML-bench [2] 的評估程式，不能改，每個實驗都一樣。"), x);
    }

    // --- column 3: modification. Shape of the learning rate only; warm-up drawn wider than in [3].
    {
      const x = xs[2], n = 20, warm = 4;
      const t = [...Array(n + 1).keys()];
      const paper = t.map((i) => (i <= warm ? i / warm : 0.5 * (1 + Math.cos(Math.PI * (i - warm) / (n - warm)))));
      const base = t.map((i) => 0.5 * (1 + Math.cos(Math.PI * i / n)));
      const labels = t.map((i) => (i % 10 === 0 ? `${i * 5}%` : ""));
      const nameP = L("Barlow Twins paper [3]: warm-up first", "Barlow Twins 論文 [3]：先暖身");
      const nameB = L("FML-bench baseline [2]: maximum from step 1", "FML-bench baseline [2]：一開始就最大");
      s.addChart(pres.charts.LINE, [{ name: nameP, labels, values: paper }, { name: nameB, labels, values: base }],
        { x: x - 0.15, y: figY - 0.1, w: colW + 0.2, h: 1.62, chartColors: [HEX.llm, HEX.bad], lineSize: 2.5, lineDataSymbol: "none",
          valAxisMinVal: 0, valAxisMaxVal: 1, valAxisMajorUnit: 1, valAxisLabelFormatCode: L('"max";;"0"', '"最高";;"0"'),
          valGridLine: { color: "E5E7EB", size: 0.5 }, catGridLine: { style: "none" },
          valAxisLabelColor: HEX.muted, valAxisLabelFontSize: 9, catAxisLabelColor: HEX.muted, catAxisLabelFontSize: 9,
          valAxisLabelFontFace: "+mn-lt", catAxisLabelFontFace: "+mn-lt",
          showValAxisTitle: true, valAxisTitle: L("learning rate", "學習率"), valAxisTitleFontSize: 9, valAxisTitleColor: HEX.ink,
          showCatAxisTitle: true, catAxisTitle: L("training progress", "訓練進度"), catAxisTitleFontSize: 9, catAxisTitleColor: HEX.ink,
          showLegend: false });
      txt(s, L("← warm-up: climb slowly", "← 暖身：慢慢爬坡"), { x: x + 0.95, y: figY + 0.66, w: 1.5, h: 0.25, fontSize: 10, bold: true, color: C.llm });
      [[HEX.llm, nameP], [HEX.bad, nameB]].forEach(([col, name], i) => {
        const ly = figY + 1.56 + i * 0.25;
        s.addShape(pres.shapes.LINE, { x: x + 0.1, y: ly + 0.11, w: 0.35, h: 0, line: { color: col, width: 2.5 } });
        txt(s, name, { x: x + 0.55, y: ly, w: colW - 0.55, h: 0.24, fontSize: 10, color: C.ink });
      });
      colBullets([
        L("Both lower the learning rate over training; they differ only at the start (see the two lines).",
          "兩者的學習率都會越來越小，差別只在一開始（看上面兩條線）。"),
        L("Proposal: add a warm-up to the FML-bench baseline [2]. A hypothesis, not yet tested.", "提案：在 FML-bench baseline [2] 加上 warm-up。這是假設，還沒驗證。"),
      ], x);
      note(L("Shape only: [3] uses LARS, [2] uses SGD, so the values are not comparable. Warm-up drawn wider; in [3] it is 10 of 1000 epochs.",
        "只比形狀：Barlow Twins 論文 [3] 用 LARS，FML-bench baseline [2] 用 SGD，數值不能直接比。暖身畫寬了，實際是 1000 輪中的前 10 輪。"), x);
    }
    refs(s, [REF2, REF3]);
  }

  // ================================================================== 4 Part 1: baseline run
  {
    const s = slideOf("CONTENT", P1, L("The shortened baseline scores 17.01%, but only 9.5% on another seed", "縮短版 baseline 是 17.01%，但換一個 seed 就只剩 9.5%"),
      L("Left is the identity card the brief asks for. We ran the shortened version: 20 pretraining epochs instead of FML-bench's 130, because 130 takes about 2.7 hours per run. The scoring (100 linear-evaluation epochs) is FML-bench's and was not shortened, so the meaning of the score does not change. "
        + "Right is how the starting line was decided. Step 1: shorten, the same for every experiment. Step 2: the same code with the same seed, run twice, gave 18.80% and 17.51%; the graphics card adds numbers in a slightly different order each time and the tiny differences grow. Step 3: deterministic mode forces the same order; two runs gave 17.01% both times, bit for bit. Step 4: other seeds give about 9.5%, almost half. Their pretraining loss ends almost twice as high, so the problem is in pretraining, not in the scoring. This fits the proposal on the previous slide but does not prove it; Part 4 comes back to it. "
        + "Deterministic mode makes a score repeatable, not precise.",
        "左邊是題目要的實驗身分證。我們跑的是縮短版：預訓練 20 輪，而不是 FML-bench 原本的 130 輪，因為 130 輪每次要 2.7 小時左右。評分（linear eval 100 輪）照 FML-bench 原設定，沒有縮短，所以分數的意思不變。"
        + "右邊是起跑線怎麼決定的。第一步：縮短，所有實驗都一樣。第二步：同程式、同 seed 跑兩次，18.80% 和 17.51%；顯示卡每次做加法的順序有一點不同，小誤差越滾越大。第三步：打開確定性模式，強迫每次照同樣順序算，兩次都是 17.01%，連小數點都一樣。第四步：換 seed，掉到 9.5% 左右，將近一半。預訓練結束時的 loss 高出快一倍，所以問題出在學習階段，不是考試階段。這和上一頁的提案不衝突，但不是證明，Part 4 會回來處理。"
        + "確定性模式只保證每次量都一樣，不保證量得準。"));

    // left: identity card
    head(s, L("Identity card", "實驗身分證"), 0.6, 1.98, 5.7);
    card(s, 0.6, 2.42, 5.7, 0.9, C.llmFill, "A9C4F5");
    txt(s, "17.01%", { x: 0.8, y: 2.45, w: 2.8, h: 0.82, fontFace: HEAD, fontSize: 40, bold: true, color: C.llm, valign: "middle" });
    txt(s, L("validation accuracy\nshortened version · seed 42", "validation accuracy\n縮短版 · seed 42"), { x: 3.5, y: 2.55, w: 2.75, h: 0.65, fontSize: 12, color: C.muted });
    const rows = [
      [L("Version", "版本"), L("Shortened: 20 pretraining epochs (FML-bench [2]: 130)", "縮短版：預訓練 20 輪（FML-bench [2] 原設定 130 輪）")],
      [L("Seed", "Seed"), L("42, deterministic mode", "42，確定性模式")],
      [L("Budget", "預算"), L("Pretraining 20 epochs, batch 512\nLinear evaluation 100 epochs (same as FML-bench [2])", "預訓練 20 輪，batch 512\nLinear evaluation 100 輪（和 FML-bench [2] 相同）")],
      [L("Hardware", "硬體"), L("1 × RTX 3060 Ti 8 GB", "1 張 RTX 3060 Ti 8 GB")],
      [L("Time", "時間"), L("about 26 minutes per run", "每次約 26 分鐘")],
    ];
    s.addTable(rows.map((r) => [
      { text: r[0], options: { bold: true, color: C.muted, fontSize: 12, fontFace: BODY } },
      { text: r[1], options: { color: C.ink, fontSize: 12, fontFace: BODY } }]),
      { x: 0.6, y: 3.42, w: 5.7, colW: [1.0, 4.7], rowH: [0.36, 0.36, 0.56, 0.36, 0.36], border: { type: "solid", pt: 0.5, color: HEX.line }, valign: "middle", margin: [0.02, 0.08, 0.02, 0.08] });
    code(s, ["python local_eval.py --workdir runs/003_det_s42 \\", "    --pretrain-epochs 20 --seed 42"], 0.6, 5.52, 5.7, 0.55, 11);
    txt(s, L("FML-bench [2] reports 47.77% for the full 130-epoch baseline. Different budget, not comparable.", "FML-bench [2] 公布的完整版（130 輪）baseline 是 47.77%。預算不同，不能直接比。"),
      { x: 0.6, y: 6.12, w: 5.7, h: 0.3, fontSize: 10, color: C.muted });

    // right: how the starting line was decided
    head(s, L("How the baseline was decided", "Baseline 怎麼決定的"), 6.75, 1.98, 6.0);
    const steps = [
      [C.llm, L("Shorten the training?", "要不要縮短？"),
        L("FML-bench [2]: 130 epochs, about 2.7 h per run", "FML-bench [2] 原設定 130 輪，每次約 2.7 小時"), L("20 epochs\n26 min", "改 20 輪\n26 分鐘")],
      [C.bad, L("Same run, twice", "同樣的程式跑兩次"),
        L("Different results: the GPU adds in a slightly different order", "結果不同：顯示卡每次加法順序有一點不同"), "18.80%\n17.51%"],
      [C.ok, L("Deterministic mode on", "打開確定性模式"),
        L("Same order every time: two runs are bit-identical", "強迫照同樣順序算，兩次連小數點都一樣"), "17.01%\n17.01%"],
      [C.warn, L("Other seeds", "換 seed 再跑"),
        L("Almost half. Noted; Part 4 comes back to it", "掉了將近一半，先記下來，Part 4 會處理"), "9.47%\n9.53%"],
    ];
    steps.forEach((st, i) => {
      const y = 2.42 + i * 0.83;
      card(s, 6.75, y, 5.95, 0.75, C.rule);
      s.addText(String(i + 1), { isTextBox: true, shape: pres.shapes.OVAL, x: 6.9, y: y + 0.17, w: 0.4, h: 0.4, fill: { color: st[0] }, line: { color: st[0], width: 0 },
        color: C.white, fontFace: BODY, fontSize: 14, bold: true, align: "center", valign: "middle", margin: 0 });
      txt(s, st[1], { x: 7.45, y: y + 0.07, w: 3.5, h: 0.3, fontSize: 14, bold: true });
      txt(s, st[2], { x: 7.45, y: y + 0.38, w: 3.6, h: 0.32, fontSize: 10.5, color: C.muted });
      txt(s, st[3], { x: 11.0, y: y + 0.05, w: 1.55, h: 0.65, fontFace: HEAD, fontSize: 14, bold: true, color: st[0], align: "right", valign: "middle" });
    });
    card(s, 6.75, 5.77, 5.95, 0.55, C.llmFill, "A9C4F5");
    txt(s, [{ text: L("Starting line:  ", "起跑線："), options: { bold: true } },
      { text: L("shortened, seed 42, deterministic → 17.01% (run 003)", "縮短版、seed 42、確定性模式 → 17.01%（run 003）") }],
      { x: 6.95, y: 5.77, w: 5.6, h: 0.55, fontSize: 13, valign: "middle" });
    refs(s, [REF2]);
  }

  // ================================================================== 6 architecture
  sect("Part 2");
  const K2 = "Part 2A. Architecture and code flow";
  const K2B = "Part 2B. Minimal autonomous demonstration";
  const K2C = L("PART 2C · EXPERIMENTAL INTEGRITY", "PART 2C · 實驗的公正性");
  {
    const s = withLang(addS({ masterName: "CONTENT", sectionTitle: section }));
    s.addText(K2, { placeholder: "kicker" });
    s.addNotes(
      L("Four moves, in this order. 1 Colours: blue is decided by the LLM, grey is a fixed rule in the program; only the block on the left is blue. "
        + "2 Top row, left to right: one round has six steps, and the large word in each box is the function name in controller.py: propose, write to disk, check, run, compare, record. The brief asks for five steps; step 3 was added because one run takes 26 minutes. "
        + "3 Below: the official evaluator, never edited and checked before and after every run; and the research memory, plain files on disk. "
        + "4 The long arrow on the left: what was recorded goes back into step 1 and becomes the next prompt. The dashed line on top: a failure in any step is recorded and the loop goes on. "
        + "Then: the next slide walks one real run through these six steps.",
        "照這個順序講四段。① 顏色：藍色是 LLM 決定的，灰色是程式照固定規則做的；只有左邊這一塊是藍色。"
        + "② 上排由左到右：一輪有六個步驟，方框裡的大字就是 controller.py 的函式名稱：提案、存檔、檢查、執行、比較、記錄。題目要求五步，第 3 步是多加的，因為跑一次要 26 分鐘。"
        + "③ 下面：官方 evaluator，沒有改過，每次執行前後都檢查；以及 research memory，就是磁碟上的普通檔案。"
        + "④ 左邊的長箭頭：記錄下來的結果回到第 1 步，變成下一次的 prompt。上面的虛線：任何一步出錯都只是記下來，迴圈繼續。"
        + "接著說：下一頁用一個真實的例子把這六步走一次。"));
    s.addImage({ path: path.join(DOCS, "architecture.png"), x: 1.167, y: 0.75, w: 11.0, h: 6.1875, altText: "Architecture diagram of one round of the research loop" });
  }

  // ================================================================== 7 the six steps, one real run
  {
    const s = slideOf("CONTENT", K2, L("Six steps, six functions: only one of them calls the LLM", "六個步驟、六個函式：只有一個呼叫 LLM"),
      L("Do not read the table cell by cell. Follow the right-hand column from top to bottom: it is run 007, the first candidate of the real run. "
        + "The LLM proposed removing the blur. The program wrote that code to disk unchanged, checked it without running it, ran the official evaluator for 26 minutes, compared 18.40 with 17.01, accepted it and wrote one line to the log. "
        + "The box at the bottom is the prompt of the next run, 008: the line about 007 is in it. That is the recorded result going into the next LLM call. "
        + "Three backup slides in the appendix show the prompt, the reply and the checks in detail.",
        "不要逐格唸。順著最右欄由上往下講：這是 007，真實執行裡的第一個候選。"
        + "LLM 提議拿掉模糊。程式把這份程式碼原封不動存檔，不執行就先檢查，用官方 evaluator 跑了 26 分鐘，比較 18.40 和 17.01，接受，然後在 log 寫一行。"
        + "最下面的框是下一個 run（008）的 prompt：裡面有 007 這一行。這就是記錄下來的結果進入下一次 LLM 呼叫。"
        + "附錄有三張備用投影片，詳細列出 prompt、回覆和檢查項目。"));
    const H = (t) => ({ text: t, options: { bold: true, color: C.white, fill: { color: C.ink }, fontSize: 12, fontFace: BODY } });
    const row = (step, fn, llm, what, example) => {
      const fill = llm ? { fill: { color: C.llmFill } } : {};
      const c = (t, o) => ({ text: t, options: Object.assign({ color: C.ink, fontSize: 12, fontFace: BODY }, fill, o || {}) });
      return [c(step, { bold: true }), c(fn, { fontFace: MONO }),
        c(llm ? "LLM" : L("program", "程式"), { bold: true, color: llm ? C.llm : C.muted }), c(what), c(example)];
    };
    s.addTable([
      [H(L("Step", "步驟")), H(L("Function in controller.py", "controller.py 的函式")), H(L("Who decides", "誰決定")), H(L("What it does", "做什麼")), H(L("Real example: run 007", "真實例子：007"))],
      row(L("1  Propose", "1  提案"), "propose()", true,
        L("Sends the rules, every past result and the full best code; gets back a hypothesis and a complete algorithm.py", "送出規則、過去每個結果和目前最佳程式的全文；拿回一個假設和完整的 algorithm.py"),
        L("Hypothesis: removing GaussianBlur should raise accuracy, because blur destroys fine detail in 32×32 images", "假設：拿掉 GaussianBlur 應該會提高準確率，因為模糊會破壞 32×32 圖片的細節")),
      row(L("2  Modify", "2  修改"), "apply_edit()", false,
        L("Writes the code from the reply, unchanged, into a new run folder and saves the diff", "把回覆裡的程式碼原封不動寫進新的 run 資料夾，並存下 diff"),
        L("runs/007_loop/diff.patch: the GaussianBlur line is removed", "runs/007_loop/diff.patch：GaussianBlur 那一行被拿掉")),
      row(L("3  Check", "3  檢查"), "validate()", false,
        L("Static check, nothing is executed: syntax, required names, allowed imports, no file or seed access", "靜態檢查，不執行任何東西：語法、必要名稱、允許的 import、不可碰檔案或 seed"),
        L("passed", "通過")),
      row(L("4  Execute", "4  執行"), "run_experiment()", false,
        L("Runs the official evaluator in a separate process with a 40-minute limit; reads val_acc from local_eval.json", "用獨立行程執行官方 evaluator，上限 40 分鐘；從 local_eval.json 讀出 val_acc"),
        L("26 minutes, val_acc = 0.1840", "26 分鐘，val_acc = 0.1840")),
      row(L("5  Evaluate", "5  比較"), "evaluate()", false,
        L("Accepts only if val_acc is strictly greater than the current best", "val_acc 嚴格大於目前的 best 才接受"),
        L("18.40% > 17.01%: accepted, 007 is the new best", "18.40% > 17.01%：接受，007 成為新的 best")),
      row(L("6  Record", "6  記錄"), "record()", false,
        L("Appends one line to loop/runs.jsonl; build_prompt() reads it in the next round", "在 loop/runs.jsonl 加一行；下一輪的 build_prompt() 會讀它"),
        L("appears in the prompt of 008 (below)", "出現在 008 的 prompt 裡（見下方）")),
    ], { x: 0.6, y: 1.9, w: 12.1, colW: [1.35, 2.35, 1.15, 4.1, 3.15], rowH: [0.36, 0.56, 0.56, 0.56, 0.56, 0.5, 0.56],
      border: { type: "solid", pt: 0.5, color: HEX.line }, valign: "middle", margin: [0.03, 0.08, 0.03, 0.08] });
    txt(s, L("The recorded result in the next LLM call · from runs/008_loop/prompt.txt", "記錄下來的結果進入下一次 LLM 呼叫 · 摘自 runs/008_loop/prompt.txt"),
      { x: 0.6, y: 5.72, w: 12.1, h: 0.28, fontSize: 12, color: C.muted });
    code(s, [
      "Experiments so far (current best val_acc = 0.1840):",
      "- 003_det_s42 [baseline] val_acc=0.1701 | unmodified baseline",
      { t: "- 007_loop [accepted] val_acc=0.1840 | Removing GaussianBlur from the augmentation should raise linear-probe accuracy, ...", c: "8EE3B0" },
    ], 0.6, 6.02, 12.1, 0.82, 11);
  }

  // Shared look of Part 2: a table whose rows are checked one by one, then a dark box with real evidence.
  const TH = (t) => ({ text: t, options: { bold: true, color: C.white, fill: { color: C.ink }, fontSize: 12, fontFace: BODY } });
  const TD = (t, o) => ({ text: t, options: Object.assign({ color: C.ink, fontSize: 12, fontFace: BODY }, o || {}) });
  const TABLE = { border: { type: "solid", pt: 0.5, color: HEX.line }, valign: "middle", margin: [0.03, 0.08, 0.03, 0.08] };
  const reqRow = (req, how, where) => [TD(req, { bold: true }), TD(how), TD(where, { fontFace: MONO, fontSize: 11 })];
  const reqHead = () => [TH(L("Requirement in the brief", "題目的要求")), TH(L("How it is met", "怎麼做到")), TH(L("Where to check", "在哪裡可以查"))];

  // Real text on the left (read from the repository, never retyped), numbered notes on the right.
  // rows: [{ t, k, head, color }] where k is the index of the note the line belongs to (-1 = spacer).
  const ROOT = path.join(__dirname, "..");
  const TINT_DEFAULT = ["5B9BFF", "3DBE7B", "E0A93B", "E86A6A", "A98BE8"];
  const cut = (ln) => (ln.length > 118 ? ln.slice(0, 116) + " …" : ln);
  const readLines = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r/g, "").split("\n");
  const grab = (rel, anchor, n) => { // n lines starting at the first line that contains `anchor`, dedented
    const all = readLines(rel), i = all.findIndex((ln) => ln.includes(anchor));
    if (i < 0) throw new Error(`anchor not found in ${rel}: ${anchor}`);
    const part = all.slice(i, i + n), indent = Math.min(...part.filter((ln) => ln.trim()).map((ln) => ln.match(/^ */)[0].length));
    return part.map((ln) => ln.slice(indent));
  };
  const annotated = (s, rows, notes, footer, tints) => {
    const TINT = tints || TINT_DEFAULT;
    const X = 0.6, Y = 1.6, W = 7.75, LH = 10 / 72, PAD = 0.1; // line height: 10 pt
    const H = rows.length * LH + 2 * PAD;
    s.addShape(pres.shapes.RECTANGLE, { x: X, y: Y, w: W, h: H, fill: { color: "0F1A30" }, line: { color: "0F1A30", width: 0 } });
    s.addText(rows.map((r, i) => ({ text: cut(r.t) || " ", options: { color: r.color || (r.head ? TINT[r.k] : "E6ECF7"), bold: !!r.head, breakLine: i < rows.length - 1 } })),
      { isTextBox: true, x: X + 0.28, y: Y + PAD, w: W - 0.38, h: rows.length * LH, fontFace: MONO, fontSize: 8, lineSpacing: 10, margin: 0, valign: "top", wrap: false });
    const AX = X + W + 0.25, AW = 12.7 - AX;
    notes.forEach((n, k) => {
      const idx = rows.map((r, i) => (r.k === k ? i : -1)).filter((i) => i >= 0);
      const y0 = Y + PAD + idx[0] * LH, lines = idx[idx.length - 1] - idx[0] + 1;
      s.addShape(pres.shapes.RECTANGLE, { x: X + 0.1, y: y0 + 0.01, w: 0.06, h: lines * LH - 0.02, fill: { color: TINT[k] }, line: { color: TINT[k], width: 0 } });
      s.addText(String(k + 1), { isTextBox: true, shape: pres.shapes.OVAL, x: AX, y: y0, w: 0.3, h: 0.3, fill: { color: TINT[k] }, line: { color: TINT[k], width: 0 },
        color: C.white, fontFace: BODY, fontSize: 12, bold: true, align: "center", valign: "middle", margin: 0 });
      txt(s, [{ text: n[0], options: { bold: true, fontSize: 13, breakLine: true } }, { text: n[1], options: { fontSize: 10.5, color: C.ink, breakLine: !!n[2] } }]
        .concat(n[2] ? [{ text: n[2], options: { fontSize: 9, color: C.muted, italic: true } }] : []),
        { x: AX + 0.4, y: y0 - 0.02, w: AW - 0.4, h: Math.max(lines * LH, 0.6) });
    });
    if (footer) txt(s, footer, { x: 0.6, y: Y + H + 0.08, w: 12.1, h: 0.36, fontSize: 8.5, color: C.muted });
    return Y + H;
  };

  // ================================================================== 2A-3 what the LLM sees
  {
    const raw = readLines("runs/009_loop/prompt.txt");
    const at = (prefix) => raw.findIndex((ln) => ln.startsWith(prefix));
    const iRules = at("Rules:"), iReply = at("Reply format:"), iExp = at("Experiments so far"), iBest = at("Current best algorithm.py:");
    const fileLines = raw.slice(iBest + 2).findIndex((ln) => ln.startsWith("```"));
    const nRules = raw.slice(iRules + 1, iReply).filter((ln) => ln.startsWith("- ")).length;
    const shown = raw.slice(0, iBest + 4).concat([`… (${fileLines} lines in total: the complete algorithm.py of 007_loop)`]);
    const starts = [0, iRules, iReply, iExp, iBest];
    const rows = shown.map((ln, i) => {
      const k = starts.reduce((acc, st, j) => (i >= st ? j : acc), 0);
      return { t: ln, k: ln === "" ? -1 : k, head: starts.includes(i) && k > 0,
        color: ln.includes("[rejected]") ? "FF9C9C" : ln.includes("[accepted]") ? "8EE3B0" : undefined };
    });

    const s = slideOf("CONTENT", K2, L("What the LLM sees: the complete prompt of run 009, in five parts", "LLM 看到的完整 prompt：五個部分（以 009 為例）"),
      L("This slide zooms into the only blue row of the previous table. On the left is the prompt of run 009 as it was sent, read from the saved file; only long lines and the body of the code file are cut. "
        + "Walk the five numbers top to bottom. 1 The task and how the score is used, including the warning that a small gain may be noise. 2 The rules: what the LLM may and may not do. 3 The reply format. "
        + "4 The feedback: every earlier experiment with its status, score and hypothesis. Point at the red line: 008 is listed as rejected, which is why 009 went in another direction. 5 The complete current best file, here the code of 007. "
        + "The small notes on the right say where the same kind of information appears in the projects the brief references; the idea of giving the LLM its earlier attempts and their results follows OpenEvolve. "
        + "If asked what is missing: this first prompt does not show which lines each attempt changed, scores on other seeds or a loss curve. The second loop added those.",
        "這一頁是把上一頁表格裡唯一的藍色那一列放大。左邊是 009 實際送出的 prompt，直接從存檔讀出來，只有太長的句子和程式檔的內文被刪減。"
        + "照編號由上往下講五個部分。① 任務和分數怎麼用，包含「小進步可能是雜訊」的提醒。② 規則：LLM 可以做什麼、不可以做什麼。③ 回覆的格式。"
        + "④ 回饋：過去每個實驗的狀態、分數和假設。指紅色那一行：008 被列為拒絕，所以 009 換了方向。⑤ 目前最佳程式的全文，這裡是 007 的程式。"
        + "右邊的小字說明同一類資訊在題目列的參考專案裡出現在哪裡；把先前的嘗試和結果交給 LLM 這個做法，是參考 OpenEvolve。"
        + "如果被問少了什麼：第一版 prompt 沒有每次改了哪幾行、其他 seed 的分數和 loss 曲線。第二個迴圈把這些加進去了。"));
    annotated(s, rows, [
      [L("The task and how the score is used", "任務與分數怎麼用"),
        L("What to improve, what the score is, that only a strictly greater score is accepted, and that one seed means a small gain may be noise.", "要改進什麼、分數是什麼、嚴格大於才接受，以及只有一個 seed，小進步可能是雜訊。"), ""],
      [L(`The rules (${nRules})`, `規則（${nRules} 條）`),
        L("What the LLM may and may not do: return the whole file, keep the required names, allowed imports, no files or seeds, which settings have no effect.", "LLM 可以做什麼、不可以做什麼：回傳整個檔案、保留必要名稱、允許的 import、不可碰檔案或 seed、哪些設定改了沒用。"),
        L("as in Autoresearch [4]: program.md", "類似 Autoresearch [4] 的 program.md")],
      [L("The reply format", "回覆格式"),
        L("One sentence of hypothesis, then the complete file.", "一句假設，加上完整的檔案。"),
        L("as in OpenEvolve [5]: full-rewrite mode", "類似 OpenEvolve [5] 的 full-rewrite 模式")],
      [L("Feedback: every earlier experiment", "回饋：過去每個實驗"),
        L("Status, score, hypothesis; a failed run adds its error text.", "狀態、分數、假設；失敗的實驗還會附上錯誤訊息。"),
        L("as in OpenEvolve [5]; error text: mini-SWE-agent [6]", "類似 OpenEvolve [5]；錯誤訊息：mini-SWE-agent [6]")],
      [L("The complete current best file", "目前最佳程式的全文"),
        L(`Here the algorithm.py of 007, ${fileLines} lines.`, `這裡是 007 的 algorithm.py，共 ${fileLines} 行。`),
        L("as in OpenEvolve [5]: Current Program", "類似 OpenEvolve [5] 的 Current Program")],
    ], L("Source: runs/009_loop/prompt.txt, built by build_prompt() in controller.py. \"…\" marks a cut.   [4] A. Karpathy, Autoresearch, GitHub, 2026.   [5] A. Sharma, OpenEvolve: An open-source evolutionary coding agent, GitHub, 2025.   [6] K. Lieret and C. E. Jimenez, Mini-swe-agent, GitHub, 2025.",
      "來源：runs/009_loop/prompt.txt，由 controller.py 的 build_prompt() 組成。「…」表示刪減。   [4] A. Karpathy, Autoresearch, GitHub, 2026.   [5] A. Sharma, OpenEvolve: An open-source evolutionary coding agent, GitHub, 2025.   [6] K. Lieret and C. E. Jimenez, Mini-swe-agent, GitHub, 2025."));
  }

  // The next three slides are backup for questions; they are added after the disclosure.
  const backupA = () => {
  const K2 = "Appendix · Part 2A";
  // ================================================================== A1 propose
  {
    const s = slideOf("CONTENT", K2, L("Step 1 · propose() is the only function that calls the LLM", "第 1 步 · propose() 是唯一呼叫 LLM 的函式"),
      L("build_prompt assembles the context, ClaudeCLI sends it, parse_reply extracts the hypothesis and the code block. The excerpt on the right is copied from the real prompt of run 009: both earlier results are in it.",
        "build_prompt 組出 context，ClaudeCLI 送出，parse_reply 取出假設和程式區塊。右邊這段是從 009 的真實 prompt 複製的：前面兩個結果都在裡面。"));
    chip(s, 0.6, 1.95, "llm");
    txt(s, "controller.py · build_prompt()  →  ClaudeCLI  →  parse_reply()", { x: 2.3, y: 1.97, w: 7, h: 0.3, fontSize: 13, fontFace: MONO, color: C.muted });
    head(s, L("The context it sends", "它送出的 context"), 0.6, 2.5, 5.3);
    bullets(s, [
      L("What the score is, and that it comes from one seed", "分數是什麼，以及它只來自一個 seed"),
      L("The rules: full algorithm.py back, required names, allowed imports, no file or seed access", "規則：回傳完整的 algorithm.py、必要的名稱、允許的 import、不可讀寫檔案或改 seed"),
      L("Every past experiment: id, status, score, hypothesis, error text", "過去每個實驗：編號、狀態、分數、假設、錯誤訊息"),
      L("The complete current best algorithm.py", "目前最佳的 algorithm.py 全文"),
    ], { x: 0.6, y: 2.95, w: 5.3, h: 2.6 });
    txt(s, L("The full prompt and the unedited reply are saved per run: runs/NNN_loop/prompt.txt and llm_reply.txt", "完整 prompt 和未修改的回覆每輪都存檔：runs/NNN_loop/prompt.txt 與 llm_reply.txt"),
      { x: 0.6, y: 5.75, w: 5.3, h: 0.8, fontSize: 12, color: C.muted });
    txt(s, L("From runs/009_loop/prompt.txt", "摘自 runs/009_loop/prompt.txt"), { x: 6.3, y: 2.5, w: 6.4, h: 0.3, fontSize: 12, color: C.muted });
    code(s, [
      "Experiments so far (current best val_acc = 0.1840):",
      "- 003_det_s42 [baseline] val_acc=0.1701 |",
      "    unmodified baseline",
      { t: "- 007_loop [accepted] val_acc=0.1840 |", c: "8EE3B0" },
      "    Removing GaussianBlur from the augmentation ...",
      { t: "- 008_loop [rejected] val_acc=0.1609 |", c: "FF9C9C" },
      "    Raising the RandomResizedCrop minimum scale ...",
      "",
      "Current best algorithm.py:",
      "```python",
      "...",
    ], 6.3, 2.85, 6.4, 2.75, 11);
    txt(s, L("The call", "呼叫方式"), { x: 6.3, y: 5.75, w: 6.4, h: 0.3, fontSize: 12, color: C.muted });
    code(s, ['claude -p --model claude-opus-5-5 --effort medium --tools ""'], 6.3, 6.05, 6.4, 0.5, 11);
  }

  // ================================================================== 8 trace one change
  {
    const s = slideOf("CONTENT", K2, L("Step 2 · One change traced from the LLM's reply to a file on disk", "第 2 步 · 追蹤一個修改：從 LLM 的回覆到磁碟上的檔案"),
      L("Run 007. The reply has a hypothesis line and one python block. parse_reply takes the block as is. apply_edit writes it into a new run folder, copies fresh official files next to it, and saves the diff against the parent. The program never edits the LLM's code.",
        "以 007 為例。回覆裡有一行假設和一個 python 區塊。parse_reply 原封不動取出區塊。apply_edit 把它寫進新的 run 資料夾，旁邊放上全新的官方檔案副本，並存下相對於 parent 的 diff。程式不會修改 LLM 寫的程式碼。"));
    const cols = [
      ["llm", L("Reply from the LLM", "LLM 的回覆"), "runs/007_loop/llm_reply.txt",
        ["HYPOTHESIS: Removing GaussianBlur", "from the augmentation should", "raise linear-probe accuracy,", "because blur destroys much of", "the useful fine detail in", "32x32 CIFAR images ...", "", "```python", "<full algorithm.py>", "```"]],
      ["rule", "parse_reply()", L("takes the code block unchanged", "原封不動取出程式區塊"),
        ["m = HYPOTHESIS.search(reply)", "blocks = CODE_BLOCK.findall(reply)", "if not blocks:", '    return ..., None, "reply', '      contains no code block"', "code = max(blocks, key=len)"]],
      ["rule", "apply_edit()", "runs/007_loop/algorithm.py + diff.patch",
        [" RandomGrayscale(p=0.2),", { t: "-RandomApply([GaussianBlur(3,", c: "FF9C9C" }, { t: "-    sigma=(0.1, 2.0))], p=0.5),", c: "FF9C9C" }, " ToTensor(),", " Normalize(mean, std),"]],
    ];
    cols.forEach((c, i) => {
      const x = 0.6 + i * 4.1;
      chip(s, x, 1.95, c[0]);
      head(s, c[1], x, 2.4, 3.9);
      txt(s, c[2], { x, y: 2.78, w: 3.9, h: 0.3, fontSize: 11, color: C.muted, fontFace: i === 1 ? BODY : MONO });
      code(s, c[3], x, 3.15, 3.9, 2.45, 11);
    });
    txt(s, L("Each candidate gets its own folder with fresh copies of the official evaluator and split file. The baseline file is kept untouched in loop/baseline/.",
      "每個候選都有自己的資料夾，裡面是全新複製的官方 evaluator 和 split 檔。baseline 原檔保留在 loop/baseline/，不會被動到。"), { x: 0.6, y: 5.85, w: 12.1, h: 0.7, fontSize: 14 });
  }

  // ================================================================== 9 validate + run
  {
    const s = slideOf("CONTENT", K2, L("Steps 3–4 · Check the code before spending GPU time, then run it in a separate process", "第 3–4 步 · 花 GPU 時間前先檢查程式，再用獨立的行程執行"),
      L("validate is a static check: nothing is imported or executed. It is a filter for honest mistakes and obvious shortcuts, not a sandbox, which is why the hash checks exist as a second guard. Be direct that none of the four failure types happened in the real run.",
        "validate 是靜態檢查：不 import 也不執行任何東西。它是用來擋無心的錯誤和明顯的捷徑，不是沙盒，所以另外有雜湊檢查當第二道防線。要直接說明四種失敗在真實執行裡都沒發生。"));
    chip(s, 0.6, 1.95, "rule");
    card(s, 0.6, 2.4, 5.9, 3.1, C.rule);
    head(s, "validate()", 0.85, 2.55, 5.4);
    bullets(s, [
      L("Parses as Python (ast)", "能被解析成 Python（ast）"),
      L("Keeps the four required names; the model sets backbone, projector, backbone_dim", "保留四個必要名稱；model 有設定 backbone、projector、backbone_dim"),
      L("Imports only from an allow-list", "只能 import 白名單內的模組"),
      L("No file access, dataset loading, downloads or seed changes", "不可讀寫檔案、載入資料集、下載、改 seed"),
    ], { x: 0.85, y: 3.0, w: 5.4, h: 2.4 });
    card(s, 6.8, 2.4, 5.9, 3.1, C.rule);
    head(s, "run_experiment()", 7.05, 2.55, 5.4);
    bullets(s, [
      L("Starts local_eval.py as a subprocess, output to stdout.log", "用 subprocess 啟動 local_eval.py，輸出寫到 stdout.log"),
      L("40-minute limit; the process tree is killed on timeout", "40 分鐘上限；逾時就砍掉整個行程樹"),
      L("Evaluator and split hashes checked before and after the run", "執行前後都檢查 evaluator 和 split 的雜湊"),
      L("Reads val_acc from local_eval.json", "從 local_eval.json 讀出 val_acc"),
    ], { x: 7.05, y: 3.0, w: 5.4, h: 2.4 });
    txt(s, [{ text: L("Failures: ", "失敗的處理："), options: { bold: true } },
      { text: L("llm_error, invalid_patch, crash and timeout are each recorded with the error text, count towards --max-experiments, and the loop goes on. None occurred in round 1; in the pilot run 016 crashed once and was recorded as a crash. The other paths are covered by the fake runner and the unit tests.",
        "llm_error、invalid_patch、crash、timeout 都會連同錯誤訊息記錄下來，計入 --max-experiments，迴圈繼續。第一輪都沒發生；pilot run 的 016 當機一次，被記錄為 crash 後繼續。其餘路徑由假 runner 和單元測試涵蓋。") }],
      { x: 0.6, y: 5.75, w: 12.1, h: 0.9, fontSize: 14 });
  }

  // ================================================================== A4 evaluate + record
  {
    const s = slideOf("CONTENT", K2, L("Steps 5–6 · Acceptance is one line of code; the record feeds the next prompt", "第 5–6 步 · 接受規則只有一行程式；紀錄會進入下一次的 prompt"),
      L("evaluate is deliberately trivial so there is nothing to argue about. A tie keeps the old best. The log is the source of truth: on restart the best is rebuilt from it. Then read the four integrity points on the right, which map to Part 2C of the brief.",
        "evaluate 故意寫得很簡單，沒有模糊空間。平手就保留舊的 best。log 是唯一的依據：重啟時會從 log 重建 best。接著講右邊四點，對應題目的 Part 2C。"));
    chip(s, 0.6, 1.95, "rule");
    code(s, [
      { t: "def evaluate(val_acc, best_acc):", c: "8FB3F5" },
      '    """Strictly greater. A tie keeps the old best."""',
      "    return val_acc > best_acc",
      "",
      { t: "# in run_loop()", c: "8A94A6" },
      "accepted = evaluate(result[\"val_acc\"], best_acc)",
      "entry[\"status\"] = \"accepted\" if accepted else \"rejected\"",
      "if accepted:",
      "    best_id, best_acc, best_code = run_id, ..., p[\"code\"]",
      "    write_text(best_path, best_code)",
      "record(log_path, entry)      # one line in loop/runs.jsonl",
      "history.append(entry)        # read by the next build_prompt()",
    ], 0.6, 2.4, 7.0, 3.3, 11);
    txt(s, L("val_acc path: local_eval.json → run_experiment() → evaluate() → loop/runs.jsonl → next prompt", "val_acc 的路徑：local_eval.json → run_experiment() → evaluate() → loop/runs.jsonl → 下一次 prompt"),
      { x: 0.6, y: 5.9, w: 7.0, h: 0.7, fontSize: 13, color: C.muted });
    head(s, L("Experimental integrity", "實驗的公正性"), 7.95, 1.95, 4.75);
    bullets(s, [
      L("Accept only if strictly greater, under the same budget, seed and split", "同樣的預算、seed、split 之下，嚴格大於才接受"),
      L("Official evaluator unchanged: imported, never edited, hash-checked", "官方 evaluator 沒有修改：只 import、不改檔，並檢查雜湊"),
      L("Protocol keys such as linear_lr are overridden by the evaluator wrapper, so a candidate cannot change them", "linear_lr 這類評估協定的設定由 evaluator 外層覆寫，候選改不了"),
      L("Selection uses the validation split only; held-out test labels play no part in it", "只用 validation split 做選擇；held-out test 的標籤不參與選擇"),
      L("Baseline and best code are both preserved", "baseline 和 best 的程式都保留"),
    ], { x: 7.95, y: 2.4, w: 4.75, h: 4.2 });
  }

  };

  // ================================================================== 2B demonstration
  {
    const s = slideOf("CONTENT", K2B, L("One command, three candidates: the loop ran unattended and changed direction after a rejection", "一個指令、三個候選：迴圈自己跑完，被拒絕後換了方向"),
      L("Top table, top to bottom: the three candidates. Point at the Parent column: 008 was rejected, so the parent of 009 is 007, not 008. The program decides where the next proposal starts. "
        + "Bottom table: the five requirements of part B of the brief, one row each. Do not read them all; say that every row names a place in the repository where it can be checked, and read the last two. "
        + "Be direct on row 4: no failure happened in this run, so the error handling was exercised only by the tests. "
        + "Link to Part 1: none of the three candidates is the warm-up proposed there. The prompt of this loop said only that the baseline varies by several points between seeds: it gave no scores for other seeds, no loss curve and no mention of the missing warm-up. 009 scales every gradient by 0.1, so it reaches the same problem, steps that are too large, from another side. "
        + "Every score here is one run at one seed; Part 4 comes back to that. "
        + "Close Part 2 with parts C and D, one sentence each; both have a link at the top right. C: every integrity requirement of the brief is a rule in code, listed one by one in the appendix. D: the controller code, the logs, the diff of every candidate and the commands are in the repository; the only reused code is the official task folder, unmodified, and the controller uses no agent framework.",
        "上面的表由上往下講三個候選。指 Parent 那一欄：008 被拒絕，所以 009 的 parent 是 007，不是 008。下一個提案從哪裡出發，是程式決定的。"
        + "下面的表是題目 B 的五項要求，一項一列。不用全部唸，說明每一列都指到 repo 裡可以查證的地方，然後唸最後兩列。"
        + "第 4 列要直接說：這次執行沒有發生任何失敗，所以錯誤處理只在測試裡跑過。"
        + "和 Part 1 的關係：三個候選都不是 Part 1 提的 warm-up。這個迴圈的 prompt 只說了「baseline 在不同 seed 之間會差好幾個百分點」：沒有其他 seed 的分數、沒有 loss 曲線，也沒有提到少了 warm-up。009 把每個梯度縮小十倍，是從另一個方向碰到同一個問題：步子太大。"
        + "這裡每個分數都只是一個 seed 跑一次，Part 4 會回來處理。"
        + "最後用 C 和 D 各一句話結束 Part 2，右上角有連結可以點過去。C：題目的每一項公正性要求都是程式裡的規則，逐項列在附錄。D：controller 程式、log、每個候選的 diff 和指令都在 repo 裡；重用的程式只有官方的 task 資料夾，沒有修改，controller 沒有用任何 agent 框架。"));
    const acc = L("accepted", "接受"), rej = L("rejected", "拒絕");
    const id = (t) => TD(t, { fontFace: MONO, fontSize: 11 });
    s.addTable([
      [TH("Run"), TH("Parent"), TH(L("Change proposed by the LLM", "LLM 提出的修改")), TH("Val accuracy"), TH(L("Decision by the program", "程式的判定"))],
      [id("003_det_s42"), TD("—"), TD(L("unmodified baseline", "沒改過的 baseline")), TD("17.01%"), TD(L("initial best", "初始 best"), { color: C.muted })],
      [id("007_loop"), TD("003"), TD(L("remove GaussianBlur from the augmentation", "拿掉資料增強裡的 GaussianBlur")), TD("18.40%", { bold: true }), TD(acc, { color: C.ok, bold: true })],
      [id("008_loop"), TD("007"), TD(L("raise the minimum crop scale 0.2 → 0.35", "把最小裁切比例從 0.2 提高到 0.35")), TD("16.09%"), TD(rej, { color: C.bad, bold: true })],
      [id("009_loop"), TD("007"), TD(L("multiply the loss by 0.1", "把 loss 乘上 0.1")), TD("20.03%", { bold: true }), TD(acc, { color: C.ok, bold: true })],
    ], Object.assign({ x: 0.6, y: 1.9, w: 12.1, colW: [1.8, 1.1, 5.2, 1.7, 2.3], rowH: 0.36 }, TABLE));
    s.addTable([
      reqHead(),
      reqRow(L("One baseline and one LLM-generated candidate", "一個 baseline 和一個 LLM 產生的候選"),
        L("003 is the baseline. 007, 008 and 009 were written by the LLM and all three were run.", "003 是 baseline。007、008、009 由 LLM 寫出，三個都實際執行。"),
        "loop/runs.jsonl"),
      reqRow(L("Use the candidate's feedback for a further proposal", "用候選的回饋產生下一個提案"),
        L("The prompt of 009 lists 008 as rejected with its score and contains the code of 007. The LLM dropped the crop idea.", "009 的 prompt 列出 008 被拒絕和它的分數，並附上 007 的程式。LLM 放棄了裁切這個方向。"),
        "build_prompt()\nruns/009_loop/prompt.txt"),
      reqRow(L("Preserve the baseline and the best valid code", "保留 baseline 和最佳的有效程式"),
        L("The baseline file is never overwritten. The best file is replaced only on an accept; it is now the code of 009.", "baseline 檔永遠不會被覆寫。best 檔只有在接受時才更換，現在是 009 的程式。"),
        "loop/baseline/algorithm.py\nloop/best/algorithm.py"),
      reqRow(L("Handle invalid patches, execution failures and timeouts", "處理 invalid patch、執行失敗和 timeout"),
        L("Each is recorded with its error text and the loop goes on. None occurred in this run: covered by the unit tests (55 in total).", "每一種都連同錯誤訊息記錄下來，迴圈繼續。這次執行都沒發生：由單元測試涵蓋（共 55 個）。"),
        "validate(), run_experiment()\ntest_controller.py"),
      reqRow(L("Enforce an experiment limit", "強制執行實驗上限"),
        L("The loop stops after 3 proposals. A failed proposal counts as one of them.", "提出 3 個提案後迴圈就停止。失敗的提案也算一次。"),
        "python controller.py\n  --max-experiments 3"),
    ], Object.assign({ x: 0.6, y: 3.92, w: 12.1, colW: [3.6, 5.5, 3.0], rowH: [0.34, 0.5, 0.5, 0.5, 0.5, 0.5] }, TABLE));
  }

  REF.B = LAST;

  const backupC = () => {
  // ================================================================== 2C integrity
  {
    const s = slideOf("CONTENT", "Appendix · Part 2C. Experimental integrity",
      L("Experimental integrity: each requirement and its enforcing code", "Experimental integrity：五項要求，以及強制執行每一項的程式碼"),
      L("The five numbers are part C of the brief, in its order. The left side is the code itself, read from the repository. Do not read all five. Say: every requirement is a rule in code, not a promise. Then pick two. "
        + "2: the official evaluator is imported and never edited. Before a run may start, its hash and the hash of the split file are compared with the official copies; the controller checks again after the run, and a mismatch voids the score. "
        + "5: the loop can only ask for the validation split. Test scores exist in the repository, but they were produced once, after selection had ended, by a separate script that refuses to run without an explicit flag. "
        + "1 is the whole acceptance rule: one comparison. A tie keeps the old best. "
        + "Limit to state: validate() is a filter for honest mistakes and obvious shortcuts, not a sandbox. The hash checks are the second guard.",
        "五個編號就是題目 C 的內容，照它的順序排。左邊是程式碼本身，直接從 repo 讀出來。不用五項都唸。先說：每一項要求都是程式裡的規則，不是口頭保證。然後挑兩項講。"
        + "②：官方 evaluator 只被 import，從來沒有被修改。執行前先比對它和 split 檔的雜湊；結束後 controller 再檢查一次，不一致的話分數直接作廢。"
        + "⑤：迴圈只能要求 validation split。repo 裡有 test 分數，但那是選擇結束之後，由另一支程式評一次得到的，那支程式沒有明確的旗標就拒絕執行。"
        + "① 是完整的接受規則：只有一個比較。平手就保留舊的 best。"
        + "要主動說明的限制：validate() 是用來擋無心的錯誤和明顯的捷徑，不是沙盒。雜湊檢查是第二道防線。"));
    const sec = (k, header, lines) => [{ t: "# " + header, k, head: true }].concat(lines.map((t) => ({ t, k })));
    const gap = [{ t: "", k: -1 }];
    const rows = [].concat(
      sec(0, "controller.py · evaluate()", grab("controller.py", "def evaluate(val_acc, best_acc):", 3)), gap,
      sec(1, "local_eval.py · before a run may start", grab("local_eval.py", 'for name, ref in (("train_eval_baseline.py"', 6)), gap,
      sec(2, "controller.py · validate(): names a candidate may not use", grab("controller.py", '"seed": "changes the fixed seed"', 4)), gap,
      sec(3, "local_eval.py · the declared budget", grab("local_eval.py", "DEFAULT_BUDGET = {", 7)),
      [{ t: "# local_eval.py · budgeted_config(): it overwrites what the candidate returns", k: 3, head: true }],
      grab("local_eval.py", "cfg.update(budget)", 1).map((t) => ({ t, k: 3 })), gap,
      sec(4, "local_eval.py · the only split the loop can ask for", grab("local_eval.py", '"--split", "val"]', 1)),
      [{ t: "# tools/final_test.py · run by hand, after selection had ended", k: 4, head: true }],
      grab("tools/final_test.py", "if not args.selection_is_finished:", 2).map((t) => ({ t, k: 4 })));
    annotated(s, rows, [
      [L("Accept only if strictly greater", "嚴格大於才接受"),
        L("One comparison; a tie keeps the old best. Baseline and candidates are run by the same command.", "整個接受規則只有一個比較，平手就保留舊的 best。baseline 和每個候選都用同一個指令執行。"), ""],
      [L("Official evaluator unchanged", "官方 evaluator 不可修改"),
        L("Imported, never edited. Its SHA-256 is compared before a run starts; a mismatch stops the run. The controller checks again afterwards (protected_files_changed()); a mismatch voids the score.",
          "只 import、不改檔。開始前比對 SHA-256，不一致就不執行。結束後 controller 再檢查一次（protected_files_changed()），不一致分數作廢。"), ""],
      [L("Fixed splits, seeds and protocol", "固定 split、seed 和評估協定"),
        L("The split file is hash-checked in 2. A candidate that uses one of these names is refused by validate(). linear_lr is fixed in 4.", "split 檔在 ② 一起檢查雜湊。候選程式用到這些名稱就被 validate() 退回。linear_lr 在 ④ 固定。"), ""],
      [L("The same declared budget for all", "所有實驗用同一個宣告的預算"),
        L("20 pretraining and 100 linear-evaluation epochs for the baseline and every candidate. The values a candidate returns for these keys are overwritten.",
          "baseline 和每個候選都是預訓練 20 輪、linear evaluation 100 輪。候選自己回傳的這幾個設定會被蓋掉。"), ""],
      [L("Test labels kept out of selection", "test 標籤不參與選擇"),
        L("The loop can only request the validation split. Test was scored once, after selection had ended, by a script that needs an explicit flag.", "迴圈只能要求 validation split。test 是選擇結束後，由一支需要明確旗標的程式評分一次。"), ""],
    ], L("Source: controller.py, local_eval.py and tools/final_test.py as they are in the repository; each excerpt starts under its own comment line. \"…\" marks a cut.",
      "來源：repo 裡的 controller.py、local_eval.py、tools/final_test.py 原文；每段摘錄上方的註解行標明出處。「…」表示刪減。"));
  }
  REF.C = LAST;
  };

  // ================================================================== 3-1 the three rounds, one row each
  sect("Part 3");
  const K3 = "Part 3. Show what happened";
  const LOG = readLines("loop/runs.jsonl").filter((l) => l.trim()).map((l) => JSON.parse(l));
  const pc = (x) => (100 * x).toFixed(2) + "%";
  {
    const s = slideOf("CONTENT", K3, L("Three real rounds: each result goes into the next prompt", "真實 log 裡的三輪：LLM 提案，程式判定，結果進入下一個 prompt"),
      L("One row is one round of the loop, read left to right, in the same order as the architecture diagram. Blue was written by the LLM, grey was done by the program. "
        + "Row 007: the LLM saw only the baseline and proposed to remove the blur; the second line in the blue box is the line it deleted. On the right are two bars: grey is the best so far, the coloured one is this candidate. 18.40 is longer than 17.01, so the program accepted it. "
        + "Follow the arrow back to the left: the result is written to the log and appears in the next prompt. 'The prompt showed' in each blue box is checked against the saved prompt file. "
        + "Row 008: the LLM proposed a similar change, milder crops. Its bar is shorter than the grey one, so the program rejected it and the best stayed 007. "
        + "Row 009: the grey bar is the same as in row 008, because the best did not move. The prompt now lists 008 as rejected. The LLM dropped the crop idea and scaled the loss instead: 20.03, accepted. "
        + "The next slide follows the step from 008 to 009 in the files themselves.",
        "一列就是迴圈的一輪，由左往右讀，順序和架構圖一樣。藍色是 LLM 寫的，灰色是程式做的。"
        + "007 這一列：LLM 只看到 baseline，提議拿掉模糊；藍色框裡第二行就是它刪掉的那一行程式。右邊有兩條長條：灰色是目前的 best，有顏色的是這個候選。18.40 比 17.01 長，所以程式接受。"
        + "順著箭頭回到左邊：結果寫進 log，然後出現在下一個 prompt 裡。每個藍色框裡的「prompt 裡看得到」，是對照存下來的 prompt 檔確認過的。"
        + "008 這一列：LLM 提了類似的修改，把裁切調溫和。它的長條比灰色那條短，程式拒絕，best 還是 007。"
        + "009 這一列：灰色長條和 008 那一列一樣長，因為 best 沒有變。prompt 裡現在列出 008 被拒絕。LLM 放棄裁切，改成縮小 loss：20.03，接受。"
        + "下一頁用檔案原文追蹤 008 到 009 這一步。"));
    // code changes without comments and docstrings, computed by the same function that draws docs/timeline.svg
    const changes = JSON.parse(require("child_process").execFileSync("python", ["-c",
      "import json,sys; sys.path.insert(0,'tools'); import make_figures as m\n"
      + "L=[json.loads(l) for l in open('loop/runs.jsonl',encoding='utf-8') if l.strip()]\n"
      + "p=lambda i: 'loop/baseline/algorithm.py' if i==L[0]['id'] else 'runs/%s/algorithm.py'%i\n"
      + "print(json.dumps({r['id']: m.code_changes(p(r['parent']), p(r['id'])) for r in L[1:]}))"], { cwd: ROOT, encoding: "utf8" }));
    const seen = (id) => readLines(`runs/${id}/prompt.txt`).filter((l) => /^- \d{3}_/.test(l)).map((l) => l.slice(2, 5));
    const idea = { "007_loop": L("Remove GaussianBlur", "拿掉資料增強裡的 GaussianBlur"),
      "008_loop": L("Minimum crop scale 0.2 → 0.35", "最小裁切比例 0.2 → 0.35"),
      "009_loop": L("Multiply the loss by 0.1", "把 loss 乘上 0.1") };
    const X0 = 0.6, CW = [1.05, 5.45, 2.3, 3.3];
    const cx = CW.map((w, i) => X0 + CW.slice(0, i).reduce((a, b) => a + b, 0));
    // every heading has the same form: who · step number: what, and under it the function in controller.py
    [[1, L("LLM · steps 1–2: proposal and code change", "LLM · 步驟 1–2：提案與程式修改"), "propose() → apply_edit()", C.llm],
      [2, L("Program · 3–4: check, run", "程式 · 3–4：檢查與執行"), "validate() → run_experiment()", C.muted],
      [3, L("Program · 5: compare and decide", "程式 · 5：比較與判定"), "evaluate()", C.muted]].forEach((h) =>
      txt(s, [{ text: h[1], options: { fontSize: 12, bold: true, color: h[3], breakLine: true } }, { text: h[2], options: { fontFace: MONO, fontSize: 9, color: h[3] } }],
        { x: cx[h[0]] + 0.05, y: 1.56, w: CW[h[0]] - 0.1, h: 0.44, valign: "bottom" }));
    const base = LOG[0];
    card(s, X0, 2.05, 12.1, 0.42, C.white);
    txt(s, [{ text: base.id + "    ", options: { fontFace: MONO, fontSize: 11, bold: true } },
      { text: L("unmodified baseline, run before the loop started: ", "沒改過的 baseline，迴圈開始前就跑好："), options: { fontSize: 12, color: C.muted } },
      { text: pc(base.val_acc), options: { fontSize: 12, bold: true } }, { text: L("  → the first \"best so far\"", "  → 第一個「目前的 best」"), options: { fontSize: 12, color: C.muted } }],
      { x: X0 + 0.15, y: 2.05, w: 11.8, h: 0.42, valign: "middle" });
    const word = { "-": L("removed", "刪掉"), "+": L("added", "加上") };
    const H = 1.08, STEP = 1.3, LBL = 1.05, NUM = 0.72, BW = CW[3] - 0.3 - LBL - NUM, bar = (v) => BW * v / 0.22; // bars start at 0%
    LOG.slice(1).forEach((r, k) => {
      const y = 2.72 + k * STEP, ok = r.status === "accepted";
      txt(s, [{ text: r.id, options: { fontFace: MONO, fontSize: 12, bold: true, breakLine: true } },
        { text: L("starts from ", "從 ") + r.parent.slice(0, 3) + L("", " 出發"), options: { fontSize: 10.5, color: C.muted } }], { x: cx[0], y, w: CW[0] - 0.1, h: H, valign: "middle" });
      // LLM: the idea, what it had seen, and the lines it changed
      card(s, cx[1], y, CW[1] - 0.12, H, C.llmFill, "A9C4F5");
      const ch = changes[r.id], short = (t) => { const u = t.trim().replace(/transforms\./g, ""); return u.length > 58 ? u.slice(0, 56) + " …" : u; };
      const lines = ch.slice(0, 2).map((c) => [{ text: word[c[0]] + "  ", options: { fontFace: BODY, fontSize: 10, bold: true, color: c[0] === "-" ? C.bad : C.ok } },
        { text: short(c[1]), options: { fontFace: MONO, fontSize: 9.5, color: C.ink, breakLine: true } }]).flat();
      const more = ch.length > 2 ? L(`… ${ch.length} changed lines in total`, `… 共改了 ${ch.length} 行`) : "";
      txt(s, [{ text: idea[r.id], options: { fontSize: 14, bold: true } },
        { text: "     " + L("prompt showed: ", "prompt 裡看得到：") + seen(r.id).join(L(", ", "、")), options: { fontSize: 10.5, color: C.muted, breakLine: true } }]
        .concat(lines, more ? [{ text: more, options: { fontSize: 10, color: C.muted } }] : []),
        { x: cx[1] + 0.15, y, w: CW[1] - 0.42, h: H, valign: "middle", paraSpaceAfter: 3 });
      // program: check and run
      card(s, cx[2], y, CW[2] - 0.12, H, C.rule);
      txt(s, [{ text: L("validate(): passed", "validate()：通過"), options: { breakLine: true } }, { text: L(`ran ${(r.seconds / 60).toFixed(1)} min`, `執行 ${(r.seconds / 60).toFixed(1)} 分鐘`) }],
        { x: cx[2] + 0.12, y, w: CW[2] - 0.36, h: H, fontSize: 11.5, valign: "middle" });
      // program: two bars, the best so far and this candidate
      card(s, cx[3], y, CW[3], H, C.rule);
      const bx = cx[3] + 0.15 + LBL;
      [[L("best so far", "目前的 best"), r.best_before, "9AA5B8", false], [L("this candidate", "這個候選"), r.val_acc, ok ? C.ok : C.bad, true]].forEach((b, j) => {
        const by = y + 0.14 + j * 0.27;
        txt(s, b[0], { x: cx[3] + 0.15, y: by, w: LBL, h: 0.2, fontSize: 10, color: C.muted, valign: "middle" });
        s.addShape(pres.shapes.RECTANGLE, { x: bx, y: by + 0.02, w: bar(b[1]), h: 0.16, fill: { color: b[2] }, line: { color: b[2], width: 0 } });
        txt(s, pc(b[1]), { x: bx + bar(b[1]) + 0.06, y: by, w: NUM, h: 0.2, fontSize: 10.5, bold: b[3], valign: "middle" });
      });
      txt(s, ok ? L("higher → accepted: the new best", "比較高 → 接受：成為新的 best") : L("lower → rejected: the best stays", "比較低 → 拒絕：best 不變"),
        { x: cx[3] + 0.15, y: y + 0.72, w: CW[3] - 0.3, h: 0.26, fontSize: 12, bold: true, color: ok ? C.ok : C.bad, valign: "middle" });
      if (k < LOG.length - 2) { // step 6: the result goes back to the start of the next row
        const ay = y + H + (STEP - H) / 2, xr = cx[3] + CW[3] / 2, xl = cx[1] + 0.5, lx = cx[1] + 1.35, lw = 5.3;
        const ln = (o) => s.addShape(pres.shapes.LINE, Object.assign({ line: Object.assign({ color: HEX.muted, width: 1.5 }, o.line || {}) }, { x: o.x, y: o.y, w: o.w, h: o.h }));
        ln({ x: xr, y: y + H, w: 0, h: ay - y - H });                                              // down from the decision
        ln({ x: lx + lw + 0.05, y: ay, w: xr - lx - lw - 0.05, h: 0, line: { beginArrowType: "triangle" } }); // towards the label
        ln({ x: xl, y: ay, w: lx - 0.05 - xl, h: 0 });                                             // from the label to the left
        ln({ x: xl, y: ay, w: 0, h: y + STEP - ay, line: { endArrowType: "triangle" } });          // down into the next proposal
        s.addText([{ text: L("Program · 6: record, show in the next prompt", "程式 · 6：記錄，並出現在下一個 prompt") + "   ", options: { fontFace: BODY, fontSize: 12, bold: true } },
          { text: "record() → build_prompt()", options: { fontFace: MONO, fontSize: 9 } }],
          { isTextBox: true, x: lx, y: ay - 0.12, w: lw, h: 0.24, color: C.muted, align: "center", valign: "middle", margin: 0 });
      }
    });
    chip(s, 0.6, 6.56, "llm");
    chip(s, 2.3, 6.56, "rule");
    txt(s, L("Scores, times and decisions are read from loop/runs.jsonl; the changed lines from the saved algorithm.py files (comments left out, \"transforms.\" dropped); \"the prompt showed\" from each prompt.txt. Only the short name of each idea is typed by hand.",
      "分數、時間、判定讀自 loop/runs.jsonl；修改的程式行來自存檔的 algorithm.py（略去註解和「transforms.」字首）；「prompt 裡看得到」來自各自的 prompt.txt。只有每個候選的簡短名稱是手寫的。"),
      { x: 4.0, y: 6.5, w: 8.7, h: 0.42, fontSize: 9, color: C.muted, valign: "middle" });
  }

  // ================================================================== 3-2 one step traced in the files
  {
    const s = slideOf("CONTENT", K3, L("One failure traced through the files: 008 was rejected, and 009 used that result", "用檔案原文追蹤一次失敗：008 被拒絕，009 用上了這個結果"),
      L("This is the step from row 008 to row 009 of the previous slide, in the files themselves. Blue numbers are text written by the LLM; grey numbers are what the program did. "
        + "1 The LLM's reasoning: removing blur worked, so make the crops milder too. It generalised from one success. 2 The change it wrote, one line. "
        + "3 The program ran it and compared: 0.1609 is below 0.1840, so rejected, and the best stays 007. 4 The next prompt, built by the program, lists 008 as rejected and carries the code of 007, not of 008. "
        + "5 The LLM's next proposal goes in another direction and names large gradients as the reason. "
        + "Then the two lines at the bottom. What it shows: a wrong idea cost one run and could not damage the best. What it does not show: that 007 or 009 are real gains; each is one run at one seed. Part 4 starts there.",
        "這是上一頁 008 那一列到 009 那一列的過程，用檔案原文呈現。藍色編號是 LLM 寫的文字，灰色編號是程式做的事。"
        + "① LLM 的推論：拿掉模糊有效，所以裁切也調溫和一點。它從一次成功做了推廣。② 它寫出的修改，只有一行。"
        + "③ 程式執行並比較：0.1609 低於 0.1840，拒絕，best 維持 007。④ 程式組出的下一個 prompt 列出 008 被拒絕，附上的是 007 的程式，不是 008 的。"
        + "⑤ LLM 的下一個提案換了方向，理由是梯度太大。"
        + "接著講最下面兩行。這說明了什麼：一個錯的想法只花掉一次執行，動不了 best。這沒有說明什麼：007 或 009 是不是真的進步；它們各自只是一個 seed 跑一次。Part 4 從這裡開始。"));
    const hyp = (id, n) => { // the HYPOTHESIS line of a reply, wrapped to n lines
      const t = readLines(`runs/${id}/llm_reply.txt`).find((l) => l.startsWith("HYPOTHESIS:")), words = t.split(" "), out = [""];
      words.forEach((w) => { if ((out[out.length - 1] + " " + w).length > 112) out.push(w); else out[out.length - 1] = (out[out.length - 1] + " " + w).trim(); });
      return out.length > n ? out.slice(0, n - 1).concat([out[n - 1].slice(0, 108) + " …"]) : out;
    };
    const diff = readLines("runs/008_loop/diff.patch"), di = diff.findIndex((l) => l.startsWith("-") && l.includes("transforms.RandomResizedCrop"));
    const e = LOG.find((r) => r.id === "008_loop"), f4 = (x) => x.toFixed(4);
    const p9 = readLines("runs/009_loop/prompt.txt");
    const sec = (k, header, lines) => [{ t: "# " + header, k, head: true }].concat(lines.map((t) => ({ t, k,
      color: t.startsWith("-  ") || t.startsWith("-\t") || /^- +transforms/.test(t) ? "FF9C9C" : /^\+ +transforms/.test(t) ? "8EE3B0" : t.includes("[rejected]") ? "FF9C9C" : undefined })));
    const gap = [{ t: "", k: -1 }];
    const rows = [].concat(
      sec(0, "runs/008_loop/llm_reply.txt · the proposal", hyp("008_loop", 3)), gap,
      sec(1, "runs/008_loop/diff.patch · the change, saved by apply_edit()", diff.slice(di - 1, di + 3)), gap,
      sec(2, "loop/runs.jsonl · fields of the line for 008_loop: run_experiment(), evaluate(), record()",
        [`"id": "${e.id}", "parent": "${e.parent}", "seconds": ${e.seconds},`, `"val_acc": ${f4(e.val_acc)}, "best_before": ${f4(e.best_before)}, "status": "${e.status}",`, `"best_after": ${f4(e.best_after)}, "best_id": "${e.best_id}"`]), gap,
      sec(3, "runs/009_loop/prompt.txt · what build_prompt() gave the next call",
        p9.filter((l) => l.startsWith("Experiments so far") || l.startsWith("- 007_loop") || l.startsWith("- 008_loop"))), gap,
      sec(4, "runs/009_loop/llm_reply.txt · the next proposal", hyp("009_loop", 3)));
    const BL = "5B9BFF", GR = "97A3B6";
    const yEnd = annotated(s, rows, [
      [L("The LLM proposes", "LLM 提案"), L("\"Removing blur gained 1.4 points the same way\": it generalised from one success.", "「拿掉模糊也是這樣進步了 1.4 分」：它從一次成功做了推廣。"), ""],
      [L("The LLM's code change", "LLM 寫的程式修改"), L("One line: the minimum crop scale. The program saves it unchanged.", "只有一行：最小裁切比例。程式原封不動存檔。"), ""],
      [L("The program runs and decides", "程式執行並判定"), L("0.1609 is below 0.1840: rejected. The best stays 007.", "0.1609 低於 0.1840：拒絕。best 維持 007。"), ""],
      [L("The program builds the next prompt", "程式組出下一個 prompt"), L("008 is listed as rejected with its score. The code attached is 007's, not 008's.", "008 被列為拒絕並附上分數。附上的程式是 007 的，不是 008 的。"), ""],
      [L("The LLM changes direction", "LLM 換了方向"), L("It drops the crop idea and scales the loss: 20.03%, accepted.", "放棄裁切，改成縮小 loss：20.03%，被接受。"), ""],
    ], null, [BL, BL, GR, GR, BL]);
    chip(s, 0.6, yEnd + 0.14, "llm");
    chip(s, 2.3, yEnd + 0.14, "rule");
    txt(s, L("Read from the files named in each comment line. \"…\" marks a cut.", "文字讀自每段註解行標明的檔案。「…」表示刪減。"), { x: 4.0, y: yEnd + 0.14, w: 8.7, h: 0.3, fontSize: 9, color: C.muted, valign: "middle" });
    txt(s, [{ text: L("What it shows: ", "這說明了什麼："), options: { bold: true } },
      { text: L("a wrong idea costs one run and cannot damage the best version, because the program decides what is kept and where the next proposal starts.",
        "一個錯的想法只花掉一次執行，動不了 best，因為保留什麼、下一個提案從哪裡出發，都由程式決定。"), options: { breakLine: true } },
      { text: L("What it does not show: ", "這沒有說明什麼："), options: { bold: true } },
      { text: L("that 007 or 009 are real improvements. Each is one run at seed 42. Part 4 starts there.", "007 或 009 是不是真的進步。它們各自只是 seed 42 的一次執行。Part 4 從這裡開始。") }],
      { x: 0.6, y: yEnd + 0.58, w: 12.1, h: 0.8, fontSize: 13, paraSpaceAfter: 4 });
  }

  // ================================================================== 3-3 round 2 as a pilot run: what changed, what happened, what can be said
  const SEARCH = readLines("loop_multiseed/runs.jsonl").filter((l) => l.trim()).map((l) => JSON.parse(l));
  const CAT = { optimisation: "D9982B", architecture: "8E6BD9", augmentation: "2AA198", loss: "D64545", other: "7C8799" };
  const CATS = Object.keys(CAT);
  const tried = (c) => SEARCH.slice(1).filter((r) => r.category === c).length;
  const won = (c) => SEARCH.slice(1).filter((r) => r.category === c && r.status === "accepted").length;
  const explored = SEARCH.slice(1).filter((r) => r.explore).length;
  // Replay: would the decision have been the same with seed 42 only? (each idea against its own parent)
  const first = Object.keys(SEARCH[0].scores)[0], byId = Object.fromEntries(SEARCH.map((r) => [r.id, r]));
  const sameDecision = SEARCH.slice(1).filter((r) => (r.scores[first] > byId[r.parent].scores[first]) === (r.status === "accepted"));
  const differs = SEARCH.slice(1).filter((r) => !sameDecision.includes(r)).map((r) => r.id.slice(0, 3));
  {
    const n = SEARCH.length - 1, top = CATS.reduce((a, c) => (tried(c) > tried(a) ? c : a)), bestEnd = Math.max(...SEARCH.filter((r) => r.status === "accepted" || r.status === "baseline").map((r) => r.val_acc));
    const s = slideOf("CONTENT", K3, L("Pilot run: three ideas tried, a better score, no conclusion yet", "Pilot run：試了三個改進機會，分數提高，但仍需對照實驗"),
      L("This goes beyond the brief. After round 1 I reviewed it and saw three opportunities. One: the LLM was shown very little about earlier candidates. Two: nothing made it change direction when progress stalled. Three: a single run on one seed cannot tell a real gain from luck. I tried all three in one pilot run, to see what would happen before designing an experiment. "
        + "Left, the table: the three highlighted rows are those opportunities. The last row is the budget. Round 1 was the minimal demonstration the brief asks for, three training runs. For the pilot run I gave it about nine GPU hours, 23 runs, which was enough for eight candidates. "
        + "Right, the result, drawn from the log: the best mean went from 20.4 to 48.0. One column is one candidate and the colour is its kind. "
        + "The largest step is 013, a warm-up, proposed by the LLM. In Part 1 I had argued from the paper and the code that the missing warm-up makes early training unstable. Here the LLM, shown how the evaluator trains and how the baseline behaved on other seeds, reached the same diagnosis, and it gained 11 to 17 points on every seed. That is consistent with my hypothesis and far outside the noise. It is not a test of warm-up alone, because 013 sits on top of the earlier changes. "
        + "Bottom left, the other observations: six of the eight candidates are of one kind, because the LLM stays with a direction that works; and the explore rule never fired, because it requires two candidates in a row without improvement. "
        + "Bottom right, what I cannot conclude: three things changed together and the budget was larger, so the source of the gain cannot be separated; and explore never fired, so there is no data on it. "
        + "That is why this is a pilot run and not an experiment. Part 4 takes one observation and designs a comparison in which only one factor changes. "
        + "If asked about 48%: it is at 20 epochs; the official 47.77% is the unmodified baseline at 130, so the two are not comparable. If asked whether three seeds helped: replaying the eight decisions with seed 42 only gives the same answer for six of them, so this run does not show it. If asked whether the prompt gave the warm-up away: it states, as a fact about the fixed evaluator, that the schedule has no warm-up; the first candidate of the same run saw the same text and chose something else.",
        "這一頁超出題目的要求。第一輪結束後我回頭 review，看到三個改進機會。第一，LLM 對先前的候選看到的資訊很少。第二，停滯的時候沒有任何機制讓它換方向。第三，單一 seed 跑一次，分不出是真的進步還是運氣。我用一次 pilot run 把三個都試了，想在設計實驗之前先看看會發生什麼。"
        + "左邊的表格：標示出來的三列就是這三個機會。最後一列是預算。第一輪是題目要求的最小示範，3 次訓練。Pilot run 我給它大約 9 個 GPU 小時，也就是 23 次訓練，夠跑 8 個候選。"
        + "右邊是結果，從 log 畫出來：best 的平均從 20.4 到 48.0。一欄是一個候選，顏色是類別。"
        + "最大的一步是 013，它是 warm-up，由 LLM 提出。我在 Part 1 根據論文和程式碼推論，少了 warm-up 會讓訓練初期不穩。這裡 LLM 看到 evaluator 怎麼訓練、以及 baseline 在其他 seed 上的表現之後，得到同樣的診斷，而且三個 seed 各提高了 11 到 17 分。這和我的假設一致，而且遠大於雜訊。但它不是對 warm-up 的單獨測試，因為 013 是加在先前的修改之上。"
        + "左下是其他的觀察：8 個候選中有 6 個屬於同一類別，因為 LLM 傾向沿用已經有效的方向；explore 規則沒有觸發，因為它的條件是連續兩次未改進。"
        + "右下是尚無法下結論的事：三個項目同時改動，預算也比較大，所以無法區分進步的來源；explore 沒有觸發，所以沒有它的資料。"
        + "所以這是 pilot run，不是實驗。Part 4 針對其中一項觀察，設計只改變一個因素的對照實驗。"
        + "如果被問 48%：那是 20 輪的結果，官方的 47.77% 是未修改的 baseline 跑 130 輪，兩者不能直接比。如果被問三個 seed 有沒有幫助：把 8 個決定改成只看 seed 42 重算，有 6 個相同，所以這次執行沒有證明它有幫助。如果被問 prompt 是不是洩漏了 warm-up：prompt 寫的是關於固定 evaluator 的一個事實，也就是排程沒有 warm-up；同一輪的第一個候選看到同樣的文字，選了別的方向。"));
    const labels = JSON.parse(require("child_process").execFileSync("python", ["-c",
      "import json,sys; sys.path.insert(0,'tools'); import make_search_figure as m; print(json.dumps(m.LABELS))"], { cwd: ROOT, encoding: "utf8" }));

    // 1. what changed, all at once
    const AX = 0.6, AW = 4.3, TY = 1.62;
    txt(s, L("1  Review of round 1: three opportunities", "① Review 第一輪：三個改進機會"), { x: AX, y: TY, w: AW, h: 0.28, fontSize: 13, bold: true });
    const th = (t, fill) => ({ text: t, options: { bold: true, color: C.white, fill: { color: fill || C.ink }, fontSize: 10, fontFace: BODY } });
    const td = (t, o) => ({ text: t, options: Object.assign({ color: C.ink, fontSize: 10, fontFace: BODY }, o || {}) });
    const hi = { fill: { color: C.llmFill } };
    s.addTable([
      [th(""), th(L("Round 1", "第一輪")), th("Pilot run", C.llm)],
      [td(L("Feedback to the LLM", "給 LLM 的回饋"), Object.assign({ bold: true }, hi)), td(L("one line per candidate", "每個候選一行"), hi), td(L("also the changed lines, the score per seed, the loss", "另外提供修改的程式行、各 seed 的分數、loss"), hi)],
      [td(L("When progress stalls", "停滯時的處理"), Object.assign({ bold: true }, hi)), td(L("no rule", "沒有規則"), hi), td(L("explore: after 2 stalled candidates, another kind is required", "explore：連續兩次未改進時，要求更換類別"), hi)],
      [td(L("Acceptance rule", "接受規則"), Object.assign({ bold: true }, hi)), td(L("one seed above the best", "單一 seed 的分數高於 best"), hi), td(L("mean of 3 seeds above the best: rules out luck", "三個 seed 的平均高於 best，排除運氣"), hi)],
      [{ text: L("Also different", "另外也不同"), options: { colspan: 3, bold: true, color: C.muted, fontSize: 9.5, fontFace: BODY, fill: { color: C.rule } } }],
      [td(L("Training budget", "訓練預算"), { bold: true }), td(L("3 runs", "3 次：最小的示範"), { color: C.muted }), td(L(`limit 23 runs, 22 used (about 9 GPU h): ${n} candidates`, `上限 23 次，實際用 22 次（約 9 個 GPU 小時）：${n} 個候選`))],
    ], { x: AX, y: TY + 0.34, w: AW, colW: [1.15, 1.15, 2.0], rowH: [0.28, 0.5, 0.5, 0.48, 0.24, 0.5], border: { type: "solid", pt: 0.5, color: HEX.line }, valign: "middle", margin: [0.03, 0.06, 0.03, 0.06] });
    txt(s, L("Unchanged: six steps, evaluator, 20 epochs. Start: best of round 1.", "未改動：六個步驟、evaluator、每次訓練 20 輪。起點是第一輪的 best。"), { x: AX, y: TY + 2.9, w: AW, h: 0.22, fontSize: 9.5, color: C.muted, valign: "middle" });

    // 2. what happened
    const BX = 5.2, PX = 5.75, PW = 6.95, CY = TY + 0.66, CH = 1.38, colW = PW / SEARCH.length, yv = (v) => CY + CH * (1 - (v - 0.10) / 0.42);
    txt(s, [{ text: L("2  Result   ", "② 結果   "), options: { bold: true, fontSize: 13 } },
      { text: (100 * SEARCH[0].val_acc).toFixed(1) + "% → " + (100 * bestEnd).toFixed(1) + "%", options: { bold: true, fontSize: 15, color: C.llm } },
      { text: L("   best mean of three seeds", "   best 的三 seed 平均"), options: { fontSize: 10, color: C.muted } }], { x: BX, y: TY, w: 7.5, h: 0.3, valign: "middle" });
    txt(s, L("one column = one candidate · grey dot = one seed · bar = mean of three, filled if accepted · colour = kind of candidate", "一欄 = 一個候選 · 灰點 = 一個 seed · 橫條 = 三個的平均，實心表示被接受 · 顏色 = 候選的類別"),
      { x: BX, y: TY + 0.32, w: 7.5, h: 0.2, fontSize: 8.5, color: C.muted, valign: "middle" });
    [0.1, 0.3, 0.5].forEach((g) => {
      s.addShape(pres.shapes.LINE, { x: PX, y: yv(g), w: PW, h: 0, line: { color: HEX.line, width: 0.5 } });
      txt(s, (100 * g).toFixed(0) + "%", { x: PX - 0.5, y: yv(g) - 0.09, w: 0.45, h: 0.18, fontSize: 8, color: C.muted, align: "right", valign: "middle" });
    });
    let best = SEARCH[0].val_acc;
    SEARCH.forEach((r, i) => {
      const x0 = PX + i * colW, xc = x0 + colW / 2, color = r.category ? CAT[r.category] : "5B6676", vals = Object.values(r.scores || {});
      const prev = best; if (r.status === "accepted") best = r.val_acc;
      s.addShape(pres.shapes.LINE, { x: x0, y: yv(best), w: colW, h: 0, line: { color: "8FB3F5", width: 1.25 } });
      if (best !== prev) s.addShape(pres.shapes.LINE, { x: x0, y: yv(best), w: 0, h: yv(prev) - yv(best), line: { color: "8FB3F5", width: 1.25 } });
      vals.forEach((v, j) => s.addShape(pres.shapes.OVAL, { x: xc - 0.03 + (j - (vals.length - 1) / 2) * 0.11, y: yv(v) - 0.03, w: 0.06, h: 0.06, fill: { color: "8C959F" }, line: { color: "8C959F", width: 0 } }));
      if (vals.length === 3) {
        const filled = r.status === "accepted" || r.status === "baseline";
        s.addShape(pres.shapes.RECTANGLE, { x: xc - 0.22, y: yv(r.val_acc) - 0.035, w: 0.44, h: 0.07, fill: { color: filled ? color : C.white }, line: { color, width: 1.5 } });
        txt(s, (100 * r.val_acc).toFixed(1), { x: xc - 0.4, y: yv(Math.max(...vals)) - 0.24, w: 0.8, h: 0.18, fontSize: 9, bold: filled, align: "center", valign: "middle" });
      }
      if (r.id === "013_loop") txt(s, L("loss warm-up: echoes Part 1", "loss warm-up：呼應 Part 1 的假設"), { x: xc - 1.1, y: yv(Math.max(...vals)) - 0.46, w: 2.2, h: 0.2, fontSize: 9, bold: true, color: C.llm, align: "center", valign: "middle" });
      if (vals.length && vals.length < 3) txt(s, r.status === "crash" ? L("crash on\nseed 44", "seed 44\n當機") : L("dropped after\nseed 42", "seed 42 後\n淘汰"),
        { x: x0, y: yv(Math.min(...vals)) + 0.06, w: colW, h: 0.3, fontSize: 7.5, bold: true, color: r.status === "crash" ? C.bad : C.muted, align: "center", valign: "top" });
      const by = CY + CH + 0.04;
      txt(s, r.id.slice(0, 3), { x: x0, y: by, w: colW, h: 0.17, fontFace: MONO, fontSize: 9, bold: true, align: "center" });
      txt(s, labels[r.id], { x: x0 + 0.02, y: by + 0.17, w: colW - 0.04, h: 0.3, fontSize: 7, align: "center", valign: "top" });
      s.addText(r.category || L("start", "起點"), { isTextBox: true, shape: pres.shapes.ROUNDED_RECTANGLE, rectRadius: 0.04, x: x0 + 0.03, y: by + 0.49, w: colW - 0.06, h: 0.17,
        fill: { color }, line: { color, width: 0 }, color: C.white, fontFace: BODY, fontSize: 7, bold: true, align: "center", valign: "middle", margin: 0 });
    });

    // 3. observations, and what cannot be concluded
    const Y3 = 4.8, H3 = 1.84, W3 = 5.95, step13 = 100 * (byId["013_loop"].val_acc - SEARCH[0].val_acc);
    card(s, 0.6, Y3, W3, H3, C.rule);
    txt(s, [{ text: L("3  Observations", "③ 觀察"), options: { bold: true, fontSize: 13, breakLine: true } },
      { text: L(`The largest step (013, +${step13.toFixed(1)} points, up on all three seeds) ramps the loss scale over the first 200 steps: it supports the idea that smaller early gradients help.`, `最大的一步（013，+${step13.toFixed(1)} 分，三個 seed 都提高）是在前 200 步逐步放大 loss 的倍率：支持「減小早期梯度有幫助」的假設。`), options: { bullet: true, fontSize: 11, breakLine: true } },
      { text: L(`${tried(top)} of the ${n} candidates are of one kind (${top}): the LLM stays with a direction that works.`, `${n} 個候選中有 ${tried(top)} 個屬於同一類別（${top}）：LLM 傾向沿用已經有效的方向。`), options: { bullet: true, fontSize: 11, breakLine: true } },
      { text: L(`Explore fired ${explored} times: it needs two stalled candidates in a row.`, `explore 規則觸發 ${explored} 次：條件是連續兩次未改進，本次沒有出現。`), options: { bullet: true, fontSize: 11, breakLine: true } },
      { text: L("016 crashed on its third seed: the controller recorded the crash, kept the best and went on.", "016 在第三個 seed 當機：controller 記錄 crash、保留原本的 best，並繼續執行。"), options: { bullet: true, fontSize: 11 } }],
      { x: 0.8, y: Y3 + 0.05, w: W3 - 0.4, h: H3 - 0.1, valign: "top", paraSpaceAfter: 3 });
    card(s, 0.6 + W3 + 0.2, Y3, W3, H3, "FFF6E0", "E8C97A");
    txt(s, [{ text: L("Not yet possible to conclude", "尚無法下結論"), options: { bold: true, fontSize: 13, color: C.warn, breakLine: true } },
      { text: L("The source of the gain: three things changed together and the budget grew from 3 runs to 23, so their effects cannot be separated.", "進步的來源：三個項目同時改動，訓練預算也從 3 次增加到 23 次，無法區分各自的影響。"), options: { bullet: true, fontSize: 11, breakLine: true } },
      { text: L("Warm-up on its own: 013 is compared with 009 (no blur, loss × 0.1), not with the unmodified baseline, and it scales the loss, not the learning rate.", "warm-up 單獨的效果：013 的比較對象是 009（已拿掉 blur、loss 乘 0.1），不是原始 baseline；而且調的是 loss 的倍率，不是學習率。"), options: { bullet: true, fontSize: 11, breakLine: true } },
      { text: L("The effect of explore: it never fired, so there is no data.", "explore 的效果：沒有觸發，所以沒有資料。"), options: { bullet: true, fontSize: 11, breakLine: true } },
      { text: L("→ Part 4: a controlled experiment that changes one factor.", "→ Part 4：針對其中一項觀察，設計只改變一個因素的對照實驗。"), options: { bold: true, fontSize: 11.5, color: C.llm } }],
      { x: 0.8 + W3 + 0.2, y: Y3 + 0.05, w: W3 - 0.4, h: H3 - 0.1, valign: "top", paraSpaceAfter: 3 });
    txt(s, L("Chart and counts: loop_multiseed/runs.jsonl (python controller.py --seeds 42,43,44 --max-runs 23). Only the short name of each candidate is typed by hand.",
      "圖和數字：loop_multiseed/runs.jsonl（python controller.py --seeds 42,43,44 --max-runs 23）。只有每個候選的簡短名稱是手寫的。"),
      { x: 0.6, y: 6.62, w: 12.1, h: 0.24, fontSize: 8, color: C.muted, valign: "middle" });
  }

  // ================================================================== 14 Part 4
  sect("Part 4");
  {
    const n = SEARCH.length - 1, accepted = SEARCH.slice(1).filter((r) => r.status === "accepted").length;
    const s = slideOf("CONTENT", "Part 4. Test one improvement",
      L("Explore only on stagnation? Proposal: a fixed exploration ratio", "探索只在停滯時啟動；提案：改成固定比例的探索"),
      L("This slide takes one observation of the pilot run and changes one factor. "
        + "Top left, the limitation. The loop explores only after two candidates in a row fail to improve. In the pilot run that never happened, so the rule fired zero times, and six of the eight candidates are of one kind. "
        + "Top right, the hypothesis: if exploration happens at a fixed ratio, the search reaches a better best for the same budget. I state the opposite expectation as well. The FML-bench paper reports that greedy search tends to be more effective when improvements are easy to find, and in my pilot run half of the candidates were accepted. So either outcome tells me something: support means exploration helps here; no support reproduces their finding in my setting. "
        + "The middle is the comparison. One box is one candidate. The control group is the pilot run, already done: its rule starts exploring only on stagnation, which is the same idea as AdaptiveSearch in that paper. "
        + "In the experimental group every second candidate must be of the kind tried least so far; the program names the kind and the LLM writes the change. That is the fixed exploration ratio of OpenEvolve, applied to my sequential loop. OpenEvolve's default is 20 percent; with so few candidates I use one in two. "
        + "Everything else is identical: start, seeds, acceptance rule, the rest of the prompt, and the budget of 23 training runs. Because the budget is the same, a difference cannot come from running longer, which was the open question of the pilot run. "
        + "Right, the criterion: the final best of each group on five seeds neither has used. Supported if the experimental group wins on at least four, a win rate of 0.8 against the 0.75 that Bouthillier and colleagues recommend. I also report how many kinds each group tried and how many produced an accepted candidate. "
        + "Limits to state: the control group is a single run of a non-deterministic LLM, so ideally it is rerun; and five seeds give little power. "
        + "Status: the control group is done; the experimental group has not been run.",
        "這一頁拿 pilot run 的一項觀察，只改一個因素。"
        + "左上是限制。迴圈只有在連續兩個候選未改進之後才探索。Pilot run 裡這個情況沒有發生，所以規則觸發 0 次，8 個候選中有 6 個屬於同一類別。"
        + "右上是假設：如果探索以固定比例發生，搜尋可以在相同預算內得到更好的 best。我也把相反的預期寫出來。FML-bench 論文指出，改進容易找到的時候，貪心搜尋通常比較有效；而我的 pilot run 有一半的候選被接受。所以兩種結果都有意義：成立，代表探索在這裡有幫助；不成立，就是在我的環境裡重現了他們的發現。"
        + "中間是比較。一格是一個候選。對照組就是 pilot run，已經完成：它的規則是停滯才探索，和那篇論文的 AdaptiveSearch 是同一個想法。"
        + "實驗組每兩個候選，就有一個必須屬於目前試過最少的類別；類別由程式指定，修改由 LLM 撰寫。這是 OpenEvolve 的固定探索比例，套用到我的逐一搜尋上。OpenEvolve 的預設是 20%；我的候選數很少，所以用每兩個一個。"
        + "其他條件完全相同：起點、seed、接受規則、prompt 的其餘內容，以及 23 次訓練的預算。因為預算相同，差異不可能來自跑比較久，而這正是 pilot run 留下的疑問。"
        + "右邊是評估標準：兩組最後的 best 各自用 5 個都沒用過的 seed 訓練。實驗組至少贏 4 個，假設才成立；勝率 0.8，高於 Bouthillier 等人建議的 0.75。我也會報告兩組各試了幾個類別、幾個類別出現被接受的候選。"
        + "要主動說明的限制：對照組只跑過一次，而 LLM 有隨機性，所以理想上應該重跑；5 個 seed 的檢定力有限。"
        + "現況：對照組已完成，實驗組還沒有執行。"));
    const label = (t, x, y, w, color) => txt(s, t, { x, y, w, h: 0.28, fontSize: 12, bold: true, color: color || C.muted, valign: "middle" });

    // ---- limitation
    const LX = 0.6, LY = 1.62, LW = 5.3, LH = 1.86;
    card(s, LX, LY, LW, LH, C.rule);
    label(L("Limitation", "限制"), LX + 0.22, LY + 0.08, 2);
    txt(s, [{ text: L(`Explore fired ${explored} times`, `explore 觸發 ${explored} 次`), options: { fontSize: 17, bold: true, color: C.bad, breakLine: true } },
      { text: L("It starts only after two candidates in a row without improvement.", "它要連續兩個候選未改進才啟動。"), options: { fontSize: 11.5 } }],
      { x: LX + 0.22, y: LY + 0.4, w: LW - 0.44, h: 0.62, valign: "top", paraSpaceAfter: 2 });
    txt(s, L("So this search cannot say whether the same budget, partly spent on other kinds, would find a better candidate.", "所以這次搜尋無法回答：同樣的預算分一部分給其他類別，能不能找到更好的候選。"),
      { x: LX + 0.22, y: LY + 0.98, w: LW - 0.44, h: 0.46, fontSize: 11.5, bold: true, valign: "middle" });
    let qx = LX + 0.22;
    CATS.filter((c) => tried(c)).forEach((c) => {
      for (let j = 0; j < tried(c); j++) { s.addShape(pres.shapes.RECTANGLE, { x: qx, y: LY + 1.52, w: 0.2, h: 0.2, fill: { color: CAT[c] }, line: { color: CAT[c], width: 0 } }); qx += 0.25; }
    });
    txt(s, CATS.filter((c) => tried(c)).map((c, i, arr) => [{ text: "■ ", options: { color: CAT[c] } }, { text: `${c} ${tried(c)}` + (i < arr.length - 1 ? "   " : "") }]).flat(),
      { x: qx + 0.1, y: LY + 1.43, w: LX + LW - qx - 0.25, h: 0.38, fontSize: 9, color: C.muted, valign: "middle" });

    // ---- hypothesis
    const HX = LX + LW + 0.18, HW = 12.7 - HX;
    card(s, HX, LY, HW, LH, C.llmFill, "A9C4F5");
    label(L("Hypothesis", "假設"), HX + 0.22, LY + 0.08, 2, C.llm);
    txt(s, L("With exploration at a fixed ratio, the search reaches a better best for the same training budget.", "探索改成固定比例後，相同的訓練預算可以得到更好的 best。"),
      { x: HX + 0.22, y: LY + 0.4, w: HW - 0.44, h: 0.5, fontSize: 14, bold: true, valign: "middle" });
    txt(s, [{ text: L("The literature expects the opposite", "文獻的預期相反"), options: { bold: true, fontSize: 10.5, color: C.muted, breakLine: true } },
      { text: L("[1]: when improvements are easy to find, greedy search tends to do better.", "[1]：改進容易找到時，貪心搜尋通常比較有效。"), options: { bullet: true, fontSize: 10.5, breakLine: true } },
      { text: L(`Pilot run: ${accepted} of ${n} candidates were accepted, so improvements were easy to find.`, `Pilot run：${n} 個候選有 ${accepted} 個被接受，屬於容易找到的情況。`), options: { bullet: true, fontSize: 10.5, breakLine: true } },
      { text: L("One search against one search: the result is a first signal, not a conclusion.", "這是一次搜尋對一次搜尋的比較：結果是初步訊號，不是結論。"), options: { fontSize: 10.5, bold: true } }],
      { x: HX + 0.22, y: LY + 0.92, w: HW - 0.44, h: 0.84, valign: "top", paraSpaceAfter: 2 });

    // ---- comparison: one box = one candidate
    const AX = 0.6, AY = 3.58, AW = 8.2, AH = 2.92, CX = AX + 1.55, BW = 0.68, BH = 0.34, BG = 0.07;
    card(s, AX, AY, AW, AH, C.white);
    label(L("Comparison", "比較"), AX + 0.22, AY + 0.08, 1.2);
    txt(s, L("one box = one candidate · same budget for both: 23 training runs", "一格 = 一個候選 · 兩組預算相同：23 次訓練"), { x: AX + 1.2, y: AY + 0.08, w: AW - 1.4, h: 0.28, fontSize: 10.5, color: C.muted, valign: "middle" });
    const chipBox = (x, y, text, color, mono) => s.addText(text, { isTextBox: true, shape: pres.shapes.ROUNDED_RECTANGLE, rectRadius: 0.04, x, y, w: BW, h: BH, fill: { color }, line: { color, width: 0 },
      color: C.white, fontFace: mono ? MONO : BODY, fontSize: 10, bold: true, align: "center", valign: "middle", margin: 0 });
    const group = (y, name, state, chips, rule, source, ruleColor) => {
      txt(s, [{ text: name, options: { fontSize: 13, bold: true, breakLine: true } }, { text: state, options: { fontSize: 10, color: C.muted } }], { x: AX + 0.22, y: y - 0.06, w: 1.3, h: 0.5, valign: "middle" });
      chips(y);
      txt(s, [{ text: rule[0], options: { bold: true, color: ruleColor || C.ink } }, { text: rule[1] }, { text: "   " + source, options: { color: C.muted, fontSize: 9.5 } }],
        { x: CX, y: y + BH + 0.06, w: AW - 1.75, h: 0.26, fontSize: 11, valign: "middle" });
    };
    group(AY + 0.56, L("Control", "對照組"), L("done: pilot run", "已完成：pilot run"),
      (y) => SEARCH.slice(1).forEach((r, i) => chipBox(CX + i * (BW + BG), y, r.id.slice(0, 3), CAT[r.category], true)),
      [L("Explore on stagnation: ", "停滯才探索："), L("only after two candidates without improvement.", "連續兩個候選未改進才換類別。")], L("as AdaptiveSearch in [1]", "同 [1] 的 AdaptiveSearch"));
    group(AY + 1.42, L("Experimental", "實驗組"), L("the proposal", "提案"),
      (y) => { for (let i = 0; i < 8; i++) chipBox(CX + i * (BW + BG), y, i % 2 ? L("assigned", "指定") : L("free", "自由"), i % 2 ? "334155" : C.llm, false); },
      [L("Explore at a fixed ratio: ", "固定比例探索："), L("every second candidate is assigned the kind tried least.", "每兩個候選，一個指定為試過最少的類別。")], L("as OpenEvolve [5]", "同 OpenEvolve [5]"), C.llm);
    s.addShape(pres.shapes.LINE, { x: AX + 0.22, y: AY + 2.3, w: AW - 0.44, h: 0, line: { color: HEX.line, width: 0.75 } });
    txt(s, [{ text: L("Same: ", "相同："), options: { bold: true } }, { text: L("start (009), screening on seed 42, acceptance on three seeds, limit of 23 runs, and the prompt template apart from the explore instruction.", "起點（009）、seed 42 篩選、三 seed 接受規則、23 次訓練上限，以及探索指令以外的 prompt 模板。"), options: { breakLine: true } },
      { text: L("Only difference: ", "唯一不同："), options: { bold: true, color: C.llm } }, { text: L("the explore rule.", "explore 規則。"), options: { bold: true } }],
      { x: AX + 0.22, y: AY + 2.34, w: AW - 0.44, h: 0.52, fontSize: 11.5, valign: "middle", paraSpaceAfter: 1 });

    // ---- evaluation criterion
    const JX = AX + AW + 0.3, JW = 12.7 - JX, JS = 0.29, JG = 0.06;
    s.addShape(pres.shapes.LINE, { x: AX + AW + 0.03, y: AY + AH / 2, w: 0.24, h: 0, line: { color: HEX.muted, width: 1.5, endArrowType: "triangle" } });
    card(s, JX, AY, JW, AH, C.rule);
    label(L("Evaluation criterion", "評估標準"), JX + 0.2, AY + 0.08, JW - 0.4);
    txt(s, L("The best of each group on 5 new seeds:", "兩組的 best 各跑 5 個新的 seed："), { x: JX + 0.2, y: AY + 0.4, w: JW - 0.4, h: 0.24, fontSize: 11, valign: "middle" });
    [[L("control", "對照組"), 0], [L("experimental", "實驗組"), 1]].forEach((r) => {
      const y = AY + 0.7 + r[1] * 0.35;
      txt(s, r[0], { x: JX + 0.2, y, w: 1.05, h: JS, fontSize: 10.5, valign: "middle" });
      for (let j = 0; j < 5; j++) s.addText(String(45 + j), { isTextBox: true, shape: pres.shapes.RECTANGLE, x: JX + 1.3 + j * (JS + JG), y, w: JS, h: JS, fill: { color: "7C8799" }, line: { color: "7C8799", width: 0 },
        color: C.white, fontFace: BODY, fontSize: 8, bold: true, align: "center", valign: "middle", margin: 0 });
    });
    txt(s, [{ text: L("Main measure: paired accuracy difference per seed", "主要指標：同一個 seed 的 accuracy 配對差"), options: { bold: true, fontSize: 11, breakLine: true } },
      { text: L("reported as the mean and for every seed", "報告平均差和每個 seed 的結果"), options: { fontSize: 10, color: C.muted, breakLine: true } },
      { text: L("4 of 5 wins = a first signal worth repeating ([7] suggests a win rate of 0.75)", "贏 4 個以上 = 初步訊號，值得重複驗證（[7] 建議的勝率門檻是 0.75）"), options: { fontSize: 10.5, breakLine: true } },
      { text: L("Limit: each strategy searched once. Comparing strategies needs several full searches each.", "限制：每種策略只搜尋一次。要比較策略，需要各自重跑多次完整搜尋。"), options: { fontSize: 10.5, color: C.bad } }],
      { x: JX + 0.2, y: AY + 1.46, w: JW - 0.4, h: 1.4, valign: "top", paraSpaceAfter: 4 });
    txt(s, "[1] Q. Zou et al. FML-bench: A controlled study of AI research agent strategies from the perspective of search dynamics. arXiv:2605.17373v2, 2026.   [5] A. Sharma. OpenEvolve: An open-source evolutionary coding agent. GitHub, 2025.   [7] X. Bouthillier et al. Accounting for Variance in Machine Learning Benchmarks. Proceedings of Machine Learning and Systems (MLSys) 3, 2021.",
      { x: 0.6, y: 6.56, w: 12.1, h: 0.4, fontSize: 8, color: C.muted, valign: "middle" });
  }

  // ================================================================== 15 disclosure
  sect("Disclosure");
  {
    const s = slideOf("CONTENT", "Disclosure", L("What was used, who decided what, and what went wrong", "用了什麼、誰決定了什麼、哪裡出過問題"),
      L("Say it plainly: the code was written by Claude Code under my direction. I set the goals and constraints, read and reviewed the output, and can point to the function for every step.",
        "直接說：程式是在我的指示下由 Claude Code 寫的。我訂目標和限制、閱讀並審閱產出，而且能指出每個步驟對應的函式。"));
    const cards = [
      [L("LLM", "LLM"), [
        L("In the loop: claude-opus-5-5, medium effort, through the Claude Code command line", "迴圈內：claude-opus-5-5、medium effort，透過 Claude Code 命令列"),
        L("Development and experiments: Claude Code. The code was written by it; I set goals, reviewed and decided. The slides were also reviewed with Codex", "開發與實驗：Claude Code。程式由它撰寫；我訂目標、審閱、做決定。簡報另使用 Codex 協助審閱"),
      ]],
      [L("Libraries, reused code and own code (Part 2D)", "套件、重用的程式與自己寫的（Part 2D）"), [
        L("Python 3.10, torch 2.1.0+cu121, torchvision 0.16.0, numpy 1.26.4", "Python 3.10、torch 2.1.0+cu121、torchvision 0.16.0、numpy 1.26.4"),
        L("controller.py: standard library only, no agent framework", "controller.py：只用標準函式庫，沒有 agent 框架"),
        L("Reused: task/ is FML-bench (Apache-2.0, commit d336651), unmodified", "重用：task/ 來自 FML-bench（Apache-2.0，commit d336651），未修改"),
        L("Written for this project: controller.py, local_eval.py, tools/, test_controller.py", "為這個專案寫的：controller.py、local_eval.py、tools/、test_controller.py"),
      ]],
      [L("Interventions", "人工介入"), [
        L("During the real run: none. No restart, interruption or manual edit", "真實執行期間：沒有。沒有重啟、中斷或手動改檔"),
        L("Design choices were proposed by the assistant and approved by me", "設計選擇由 assistant 提議，經我同意"),
        L("My own decisions: model and effort, checking the plan against the brief, when to run", "我自己的決定：模型與 effort、把規劃對照題目確認、何時開跑"),
      ]],
      [L("Failures", "失敗"), [
        L("Identical runs differed by 1.29 points until deterministic mode", "開確定性模式之前，相同的執行差了 1.29 個百分點"),
        L("Windows line endings changed the official files' hashes", "Windows 的換行符號改變了官方檔案的雜湊"),
        L("A candidate could have changed linear_lr; now overridden", "候選原本可以改 linear_lr；現在已被覆寫"),
        L("Round 1 (007–009): no failed run. Pilot run: 016 crashed on seed 44, so it has no mean; the controller kept 015 and went on", "第一輪（007–009）沒有執行失敗。Pilot run 的 016 在 seed 44 當機，缺第三個分數而沒有平均；controller 保留 015 並繼續"),
      ]],
    ];
    cards.forEach((c, i) => {
      const x = 0.6 + (i % 2) * 6.2, y = 1.95 + Math.floor(i / 2) * 2.5;
      card(s, x, y, 5.9, 2.35, C.rule);
      head(s, c[0], x + 0.2, y + 0.12, 5.5);
      bullets(s, c[1], { x: x + 0.2, y: y + 0.5, w: 5.5, h: 1.8, fontSize: 12.5, paraSpaceAfter: 3 });
    });
  }

  REF.D = LAST; // the disclosure slide holds part 2D

  sect("Appendix");
  backupC();
  backupA();

  // Links between the main deck and the appendix (slide numbers are known only now).
  const link = (s, parts) => s.addText(parts.map((p, i) => ({ text: p[0] + (i < parts.length - 1 ? "     " : ""), options: p[1] ? { hyperlink: { slide: p[1]._n }, color: C.llm, underline: { style: "sng" } } : { color: C.muted } })),
    { isTextBox: true, x: 6.2, y: 0.36, w: 6.5, h: 0.32, fontFace: BODY, fontSize: 11, align: "right", valign: "middle", margin: 0 });
  link(REF.B, [[L("Part 2C. Experimental integrity: appendix →", "Part 2C. Experimental integrity：見附錄 →"), REF.C], [L("Part 2D. Evidence and reuse: disclosure →", "Part 2D. Evidence and reuse：見揭露頁 →"), REF.D]]);
  link(REF.C, [[L("← back to Part 2B", "← 回到 Part 2B"), REF.B]]);
  link(REF.D, [[L("← back to Part 2B", "← 回到 Part 2B"), REF.B]]);

  return pres;
}

(async () => {
  for (const lang of ["en", "zh"]) {
    const file = path.join(OUT, `automated-researcher-v2-${lang}.pptx`);
    await build(lang).writeFile({ fileName: file });
    console.log("wrote", file);
  }
})();
