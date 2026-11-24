// Builds the presentation in English and Traditional Chinese.
//   node slides/make_slides.js            (needs: npm install pptxgenjs)
// Numbers come from README.md, loop/runs.jsonl and docs/part4.md.
const path = require("path");
const pptxgen = require("pptxgenjs");

const OUT = __dirname;
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
  const slideOf = (master, kicker, title, notes) => {
    const s = withLang(pres.addSlide({ masterName: master, sectionTitle: section }));
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
  sect(L("Overview", "總覽"));
  {
    const s = withLang(pres.addSlide({ masterName: "COVER", sectionTitle: section }));
    s.addText(L("An automated researcher for Barlow Twins on CIFAR-100", "Barlow Twins 在 CIFAR-100 上的\n自動研究迴圈"), { placeholder: "title" });
    s.addText(L("Take-home exam · FML-bench task Representation_Learning_solo_learn\nNovember 2026 · github.com/sandrinha-c/automated-researcher-takehome",
      "Take-home exam · FML-bench 任務 Representation_Learning_solo_learn\n2026 年 11 月 · github.com/sandrinha-c/automated-researcher-takehome"), { placeholder: "body" });
    s.addText("Propose → Modify → Execute → Evaluate → Record → Repeat", { isTextBox: true, x: 0.8, y: 1.45, w: 11.7, h: 0.4, fontFace: MONO, fontSize: 16, color: "8FB3F5", margin: 0 });
    s.addNotes(L("Thirty minutes: Part 1 five, Part 2 twelve, Part 3 eight, Part 4 five.", "三十分鐘：Part 1 五分鐘、Part 2 十二分鐘、Part 3 八分鐘、Part 4 五分鐘。"));
  }

  // ================================================================== 2 summary
  {
    const s = slideOf("CONTENT", L("SUMMARY", "摘要"),
      L("Three automatic experiments moved validation accuracy from 17.01% to 20.03%", "三個自動實驗把 validation accuracy 從 17.01% 提高到 20.03%"),
      L("Lead with the result and the caveat together. The gain is real at seed 42; whether it holds on other seeds is the open question that Part 4 addresses.",
        "先把結果和但書一起講。這個進步在 seed 42 上是真的，換 seed 是否成立還不知道，Part 4 會處理。"));
    const stats = [
      ["17.01% → 20.03%", L("best validation accuracy, baseline to final (seed 42, 20 pretrain epochs)", "最佳 validation accuracy，從 baseline 到最後（seed 42、20 個 pretrain epoch）")],
      [L("3 candidates", "3 個候選"), L("proposed by Claude Opus: 2 accepted, 1 rejected by the program", "由 Claude Opus 提出：2 個被接受，1 個被程式拒絕")],
      [L("77 min · $0.24", "77 分鐘 · $0.24"), L("GPU time on one RTX 3060 Ti, and LLM usage reported by the command line", "一張 RTX 3060 Ti 的 GPU 時間，以及命令列回報的 LLM 用量")],
    ];
    stats.forEach((st, i) => {
      const x = 0.6 + i * 4.1;
      card(s, x, 2.0, 3.9, 2.15, C.rule);
      txt(s, st[0], { x: x + 0.25, y: 2.2, w: 3.4, h: 0.7, fontFace: HEAD, fontSize: 28, bold: true, color: i === 0 ? C.llm : C.ink });
      txt(s, st[1], { x: x + 0.25, y: 3.0, w: 3.4, h: 1.0, fontSize: 14, color: C.muted });
    });
    card(s, 0.6, 4.45, 12.1, 1.05, "FFF6E0", "E8C97A");
    txt(s, [{ text: L("Caveat: ", "但書："), options: { bold: true, color: C.warn } },
      { text: L("every score is one run at one seed. The unmodified baseline alone varies by ±4.3 points across seeds 42, 43 and 44, so the gain is not yet shown to hold on other seeds.",
        "每個分數都只是一個 seed 跑一次。沒改過的 baseline 在 seed 42、43、44 之間就差了 ±4.3 個百分點，所以這個進步還沒被證明在其他 seed 上成立。") }],
      { x: 0.85, y: 4.6, w: 11.6, h: 0.8, fontSize: 15 });
    const parts = [["Part 1", L("Baseline", "Baseline"), "5 min"], ["Part 2", L("The loop", "研究迴圈"), "12 min"], ["Part 3", L("What happened", "發生了什麼"), "8 min"], ["Part 4", L("One improvement", "一個改進"), "5 min"]];
    parts.forEach((p, i) => {
      const x = 0.6 + i * 3.075;
      txt(s, [{ text: p[0] + "  ", options: { bold: true, color: C.llm } }, { text: p[1] + "  ", options: { bold: true } }, { text: p[2], options: { color: C.muted } }],
        { x, y: 5.95, w: 2.9, h: 0.4, fontSize: 15 });
    });
  }

  // ================================================================== 3 Part 1 concept
  sect("Part 1");
  const K1 = L("PART 1 · BASELINE", "PART 1 · BASELINE");
  {
    const s = slideOf("CONTENT", K1,
      L("Barlow Twins learns without labels; linear evaluation turns that into a score", "Barlow Twins 不用標籤學特徵；linear evaluation 把它變成一個分數"),
      L("Pretraining: two random views of each image go through the same network. The loss makes the cross-correlation matrix of the two embeddings look like the identity: the diagonal says both views agree, the off-diagonal says dimensions do not repeat each other. Linear evaluation: freeze the backbone, train one linear layer with labels, report its accuracy.",
        "預訓練：每張圖隨機產生兩個 view，通過同一個網路。loss 讓兩組 embedding 的交叉相關矩陣接近單位矩陣：對角線代表兩個 view 的答案一致，非對角線代表各維度不重複。Linear evaluation：凍結 backbone，用標籤只訓練一層線性層，回報它的準確率。"));
    head(s, L("1  Pretraining (no labels)", "1  預訓練（不用標籤）"), 0.6, 1.95, 7);
    const boxes = [L("image", "圖片"), L("2 random views", "2 個隨機 view"), "ResNet-18\n512-d", L("projector\n2048-d", "projector\n2048-d"), L("cross-correlation\n2048 × 2048", "交叉相關矩陣\n2048 × 2048")];
    const bw = 2.0, gap = 0.5;
    boxes.forEach((b, i) => {
      const x = 0.6 + i * (bw + gap);
      s.addText(b, { isTextBox: true, shape: pres.shapes.ROUNDED_RECTANGLE, rectRadius: 0.08, x, y: 2.45, w: bw, h: 0.95, fill: { color: i === 4 ? C.llmFill : C.rule }, line: { color: HEX.line, width: 0.75 },
        fontFace: BODY, fontSize: 14, color: C.ink, align: "center", valign: "middle", margin: 0.05 });
      if (i < boxes.length - 1) arrow(s, x + bw + 0.05, 2.925, gap - 0.1);
    });
    txt(s, [{ text: L("Loss pushes the matrix towards the identity:  ", "Loss 把這個矩陣推向單位矩陣：  "), options: { bold: true } },
      { text: L("diagonal → 1 (both views agree, so augmentations are ignored); off-diagonal → 0 (dimensions carry different information, which prevents collapse). No negative pairs, no momentum encoder.",
        "對角線 → 1（兩個 view 一致，所以忽略增強造成的差異）；非對角線 → 0（各維度帶不同資訊，避免全部輸出一樣）。不需要負樣本，也不需要 momentum encoder。") }],
      { x: 0.6, y: 3.6, w: 12.1, h: 0.85, fontSize: 14 });
    head(s, L("2  Linear evaluation (the score)", "2  Linear evaluation（分數）"), 0.6, 4.65, 7);
    const b2 = [L("frozen backbone\n(projector dropped)", "凍結的 backbone\n（丟掉 projector）"), L("one linear layer\n512 → 100 classes", "一層線性層\n512 → 100 類"), L("accuracy on 3,021\nvalidation images", "3,021 張驗證圖片\n上的準確率")];
    b2.forEach((b, i) => {
      const x = 0.6 + i * (2.6 + gap);
      s.addText(b, { isTextBox: true, shape: pres.shapes.ROUNDED_RECTANGLE, rectRadius: 0.08, x, y: 5.15, w: 2.6, h: 0.95, fill: { color: i === 2 ? C.llmFill : C.rule }, line: { color: HEX.line, width: 0.75 },
        fontFace: BODY, fontSize: 14, color: C.ink, align: "center", valign: "middle", margin: 0.05 });
      if (i < b2.length - 1) arrow(s, x + 2.65, 5.625, gap - 0.1);
    });
    txt(s, L("A linear layer cannot learn new features, so a higher accuracy means the backbone itself organises the images better. This protocol lives in the official evaluator and is identical for every experiment.",
      "線性層學不出新特徵，所以準確率高就代表 backbone 本身把圖片整理得更好。這個流程寫在官方 evaluator 裡，每個實驗都一樣。"),
      { x: 9.9, y: 5.05, w: 2.8, h: 1.75, fontSize: 12, color: C.muted });
    txt(s, L("Code: task/algorithm.py (BarlowTwinsLoss, BarlowTwinsModel) · task/train_eval_baseline.py (linear_eval)", "程式：task/algorithm.py（BarlowTwinsLoss、BarlowTwinsModel）· task/train_eval_baseline.py（linear_eval）"),
      { x: 0.6, y: 6.4, w: 9.0, h: 0.3, fontSize: 11, color: C.muted, fontFace: MONO });
  }

  // ================================================================== 4 baseline runs
  {
    const s = slideOf("CONTENT", K1,
      L("Baseline at a declared reduced budget: 20 pretrain epochs instead of 130", "在明確宣告的縮小預算下跑 baseline：20 個 pretrain epoch，而不是 130"),
      L("The official 47.77% uses 130 epochs and is not comparable. Everything here uses the same reduced budget, enforced by local_eval.py, which imports the official evaluator without editing it.",
        "官方的 47.77% 用了 130 個 epoch，不能直接比較。這裡所有實驗都用同一個縮小預算，由 local_eval.py 強制，它直接 import 官方 evaluator，沒有改檔。"));
    const rows = [
      [L("Hardware", "硬體"), "RTX 3060 Ti 8 GB · Ryzen 5 3600 · Windows 10"],
      [L("Budget", "預算"), L("20 pretrain epochs, 100 linear-eval epochs, batch 512", "20 個 pretrain epoch、100 個 linear-eval epoch、batch 512")],
      [L("Seed", "Seed"), L("42 (linear probe 100), deterministic mode", "42（linear probe 用 100），確定性模式")],
      [L("Time", "時間"), L("about 26 minutes per run", "每次約 26 分鐘")],
      [L("Evaluator", "Evaluator"), L("official file, SHA-256 checked before each run", "官方檔案，每次執行前檢查 SHA-256")],
    ];
    s.addTable(rows.map((r) => [
      { text: r[0], options: { bold: true, color: C.muted, fontSize: 14, fontFace: BODY } },
      { text: r[1], options: { color: C.ink, fontSize: 14, fontFace: BODY } }]),
      { x: 0.6, y: 2.0, w: 6.0, colW: [1.4, 4.6], rowH: 0.55, border: { type: "solid", pt: 0.5, color: HEX.line }, valign: "middle", margin: [0.04, 0.08, 0.04, 0.08] });
    code(s, ["python local_eval.py \\", "  --workdir runs/003_det_s42 \\", "  --pretrain-epochs 20 --seed 42"], 0.6, 5.1, 6.0, 0.95, 13);
    txt(s, L("Official full budget (130 epochs): 47.77%, reference only", "官方完整預算（130 個 epoch）：47.77%，僅供參考"), { x: 0.6, y: 6.25, w: 6.0, h: 0.3, fontSize: 12, color: C.muted });
    s.addChart(pres.charts.BAR, [{ name: L("Validation accuracy (%)", "Validation accuracy (%)"),
      labels: ["001", L("002 (repeat)", "002 重跑"), "003 s42", L("004 s42 (repeat)", "004 重跑"), "005 s43", "006 s44"], values: [18.80, 17.51, 17.01, 17.01, 9.47, 9.53] }],
      { x: 7.0, y: 1.9, w: 5.7, h: 4.3, barDir: "col", chartColors: [HEX.llm], showLegend: false, showTitle: true,
        title: L("Baseline validation accuracy (%)", "Baseline 的 validation accuracy (%)"), titleFontSize: 13, titleColor: HEX.ink, titleFontFace: "+mn-lt",
        showValue: true, dataLabelPosition: "outEnd", dataLabelFontSize: 11, dataLabelColor: HEX.ink, dataLabelFormatCode: "0.00", dataLabelFontFace: "+mn-lt",
        catAxisLabelColor: HEX.muted, valAxisLabelColor: HEX.muted, catAxisLabelFontSize: 10, valAxisLabelFontSize: 10, catAxisLabelFontFace: "+mn-lt", valAxisLabelFontFace: "+mn-lt",
        valGridLine: { color: "E5E7EB", size: 0.5 }, catGridLine: { style: "none" }, valAxisMaxVal: 22, valAxisMinVal: 0, valAxisMajorUnit: 5 });
    txt(s, L("001–002: default mode. 003–006: deterministic mode.", "001–002：預設模式。003–006：確定性模式。"), { x: 7.0, y: 6.25, w: 5.7, h: 0.3, fontSize: 12, color: C.muted });
  }

  // ================================================================== 5 noise
  {
    const s = slideOf("CONTENT", K1,
      L("Two sources of noise were measured before comparing anything", "在比較任何東西之前，先量了兩種雜訊"),
      L("First card: without deterministic mode, a 1.3-point difference means nothing. Second card: this is the limitation that remains, and the motivation for Part 4. The modification is a hypothesis only.",
        "第一張卡：不開確定性模式的話，1.3 個百分點的差距沒有意義。第二張卡：這是還留著的限制，也是 Part 4 的動機。可能的修改只是一個假設。"));
    card(s, 0.6, 2.0, 5.9, 2.9, C.rule);
    head(s, L("GPU non-determinism: fixed", "GPU 的非確定性：已解決"), 0.85, 2.15, 5.4, C.ok);
    bullets(s, [
      L("Same code, same seed, two runs: 18.80% and 17.51% (1.29 points apart)", "同樣的程式、同樣的 seed 跑兩次：18.80% 和 17.51%（差 1.29 個百分點）"),
      L("Losses diverge from the 2nd training step (tools/determinism_check.py)", "loss 從第 2 個訓練步就開始不同（tools/determinism_check.py）"),
      L("Deterministic mode: runs 003 and 004 are bit-identical, 17.01% twice", "確定性模式：003 和 004 逐位元相同，兩次都是 17.01%"),
    ], { x: 0.85, y: 2.6, w: 5.4, h: 2.2 });
    card(s, 6.8, 2.0, 5.9, 2.9, C.rule);
    head(s, L("Seed-to-seed variation: still there", "Seed 之間的差異：還在"), 7.05, 2.15, 5.4, C.bad);
    bullets(s, [
      L("Unmodified baseline: 17.01% (seed 42), 9.47% (43), 9.53% (44)", "沒改過的 baseline：17.01%（seed 42）、9.47%（43）、9.53%（44）"),
      L("Mean 12.0%, sample standard deviation 4.3 points", "平均 12.0%，樣本標準差 4.3 個百分點"),
      L("Final pretrain loss 746 against 1318 and 1422: two seeds train much more slowly", "最後的 pretrain loss 是 746 對 1318 和 1422：兩個 seed 學得慢很多"),
    ], { x: 7.05, y: 2.6, w: 5.4, h: 2.2 });
    card(s, 0.6, 5.15, 12.1, 1.5, C.llmFill, "A9C4F5");
    txt(s, [{ text: L("One possible modification: ", "一個可能的修改："), options: { bold: true } },
      { text: L("lower the pretraining learning rate from 0.4 to 0.2. The evaluator uses SGD with a cosine schedule and no warmup, and two of three seeds end with almost twice the loss, which suggests unstable early training. It is a one-line edit inside the file the loop may change. A hypothesis to test, not a result.",
        "把 pretrain 的學習率從 0.4 降到 0.2。evaluator 用 SGD 加 cosine schedule，沒有 warmup，而三個 seed 裡有兩個最後的 loss 將近兩倍，顯示訓練初期不穩定。這是迴圈可修改的檔案裡的一行改動。這是待驗證的假設，不是結果。") }],
      { x: 0.85, y: 5.3, w: 11.6, h: 1.25, fontSize: 14 });
  }

  // ================================================================== 6 architecture
  sect("Part 2");
  const K2 = L("PART 2 · THE LOOP", "PART 2 · 研究迴圈");
  {
    const s = slideOf("FIGURE", K2, L("The LLM only writes text; fixed program rules decide everything else", "LLM 只負責寫文字，其他都由固定的程式規則決定"),
      L("Walk the top row left to right: six steps, six functions in controller.py. Only step 1 is blue. The evaluator and the research memory sit below. The dashed line on top is where every failure goes: it is recorded and the loop continues.",
        "由左到右講上排：六個步驟，對應 controller.py 的六個函式。只有第 1 步是藍色。下面是 evaluator 和 research memory。上方虛線是所有失敗的去向：記錄下來，迴圈繼續。"));
    s.addImage({ path: path.join(DOCS, "architecture.png"), x: 0.3, y: 0.95, w: 9.8, h: 5.5125, altText: "Architecture diagram of one round of the research loop" });
    chip(s, 10.35, 3.35, "llm");
    txt(s, L("step 1 only: propose()", "只有第 1 步：propose()"), { x: 10.35, y: 3.72, w: 2.6, h: 0.5, fontSize: 13 });
    chip(s, 10.35, 4.35, "rule");
    txt(s, L("steps 2 to 6: edit, check, run, accept, record", "第 2 到 6 步：寫檔、檢查、執行、接受、記錄"), { x: 10.35, y: 4.72, w: 2.6, h: 0.75, fontSize: 13 });
    txt(s, L("Single file, no framework: controller.py, standard library only", "單一檔案、沒有框架：controller.py，只用標準函式庫"), { x: 10.35, y: 5.7, w: 2.6, h: 0.9, fontSize: 12, color: C.muted });
  }

  // ================================================================== 7 propose
  {
    const s = slideOf("CONTENT", K2, L("Step 1 · propose() is the only function that calls the LLM", "第 1 步 · propose() 是唯一呼叫 LLM 的函式"),
      L("build_prompt assembles the context, ClaudeCLI sends it, parse_reply extracts the hypothesis and the code block. The excerpt on the right is copied from the real prompt of run 009: both earlier results are in it.",
        "build_prompt 組出 context，ClaudeCLI 送出，parse_reply 取出假設和程式區塊。右邊這段是從 009 的真實提示詞複製的：前面兩個結果都在裡面。"));
    chip(s, 0.6, 1.95, "llm");
    txt(s, "controller.py · build_prompt()  →  ClaudeCLI  →  parse_reply()", { x: 2.3, y: 1.97, w: 7, h: 0.3, fontSize: 13, fontFace: MONO, color: C.muted });
    head(s, L("The context it sends", "它送出的 context"), 0.6, 2.5, 5.3);
    bullets(s, [
      L("What the score is, and that it comes from one seed", "分數是什麼，以及它只來自一個 seed"),
      L("The rules: full algorithm.py back, required names, allowed imports, no file or seed access", "規則：回傳完整的 algorithm.py、必要的名稱、允許的 import、不可讀寫檔案或改 seed"),
      L("Every past experiment: id, status, score, hypothesis, error text", "過去每個實驗：編號、狀態、分數、假設、錯誤訊息"),
      L("The complete current best algorithm.py", "目前最佳的 algorithm.py 全文"),
    ], { x: 0.6, y: 2.95, w: 5.3, h: 2.6 });
    txt(s, L("The full prompt and the unedited reply are saved per run: runs/NNN_loop/prompt.txt and llm_reply.txt", "完整提示詞和未修改的回覆每輪都存檔：runs/NNN_loop/prompt.txt 與 llm_reply.txt"),
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
      { text: L("llm_error, invalid_patch, crash and timeout are each recorded with the error text, count towards --max-experiments, and the loop goes on. None occurred in the real run; they are covered by the fake runner and 32 unit tests.",
        "llm_error、invalid_patch、crash、timeout 都會連同錯誤訊息記錄下來，計入 --max-experiments，迴圈繼續。真實執行中都沒發生；它們由假 runner 和 32 個單元測試涵蓋。") }],
      { x: 0.6, y: 5.75, w: 12.1, h: 0.9, fontSize: 14 });
  }

  // ================================================================== 10 evaluate + record
  {
    const s = slideOf("CONTENT", K2, L("Steps 5–6 · Acceptance is one line of code; the record feeds the next prompt", "第 5–6 步 · 接受規則只有一行程式；紀錄會進入下一次的提示詞"),
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
    txt(s, L("val_acc path: local_eval.json → run_experiment() → evaluate() → loop/runs.jsonl → next prompt", "val_acc 的路徑：local_eval.json → run_experiment() → evaluate() → loop/runs.jsonl → 下一次提示詞"),
      { x: 0.6, y: 5.9, w: 7.0, h: 0.7, fontSize: 13, color: C.muted });
    head(s, L("Experimental integrity", "實驗的公正性"), 7.95, 1.95, 4.75);
    bullets(s, [
      L("Accept only if strictly greater, under the same budget, seed and split", "同樣的預算、seed、split 之下，嚴格大於才接受"),
      L("Official evaluator unchanged: imported, never edited, hash-checked", "官方 evaluator 沒有修改：只 import、不改檔，並檢查雜湊"),
      L("Protocol keys such as linear_lr are overridden by the evaluator wrapper, so a candidate cannot change them", "linear_lr 這類評估協定的設定由 evaluator 外層覆寫，候選改不了"),
      L("Validation split only; held-out test labels are never read", "只用 validation split；held-out test 的標籤從未被讀取"),
      L("Baseline and best code are both preserved", "baseline 和 best 的程式都保留"),
    ], { x: 7.95, y: 2.4, w: 4.75, h: 4.2 });
  }

  // ================================================================== 11 demonstration
  {
    const s = slideOf("CONTENT", K2, L("Demonstration · One baseline and three LLM candidates, with no human in the loop", "實際示範 · 一個 baseline 加三個 LLM 候選，過程中沒有人介入"),
      L("The brief asks for one candidate plus a further proposal. Three were run back to back in one invocation; the log shows it. 009 was proposed from 007 because 008 had been rejected.",
        "題目要求一個候選加上一個後續提案。這裡三個都實際跑完，而且是一次執行裡連續跑的，log 可以佐證。因為 008 被拒絕，009 是從 007 出發的。"));
    const H = (t) => ({ text: t, options: { bold: true, color: C.white, fill: { color: C.ink }, fontSize: 13, fontFace: BODY } });
    const cell = (t, o) => ({ text: t, options: Object.assign({ color: C.ink, fontSize: 14, fontFace: BODY }, o || {}) });
    const acc = L("accepted", "接受"), rej = L("rejected", "拒絕");
    s.addTable([
      [H(L("Run", "Run")), H(L("Parent", "Parent")), H(L("Change proposed by the LLM", "LLM 提出的修改")), H(L("Val accuracy", "Val accuracy")), H(L("Decision by the program", "程式的判定"))],
      [cell("003_det_s42", { fontFace: MONO, fontSize: 12 }), cell("—"), cell(L("unmodified baseline", "沒改過的 baseline")), cell("17.01%"), cell(L("initial best", "初始 best"), { color: C.muted })],
      [cell("007_loop", { fontFace: MONO, fontSize: 12 }), cell("003"), cell(L("remove GaussianBlur from the augmentation", "拿掉資料增強裡的 GaussianBlur")), cell("18.40%", { bold: true }), cell(acc, { color: C.ok, bold: true })],
      [cell("008_loop", { fontFace: MONO, fontSize: 12 }), cell("007"), cell(L("raise the minimum crop scale 0.2 → 0.35", "把最小裁切比例從 0.2 提高到 0.35")), cell("16.09%"), cell(rej, { color: C.bad, bold: true })],
      [cell("009_loop", { fontFace: MONO, fontSize: 12 }), cell("007"), cell(L("multiply the loss by 0.1", "把 loss 乘上 0.1")), cell("20.03%", { bold: true }), cell(acc, { color: C.ok, bold: true })],
    ], { x: 0.6, y: 2.0, w: 12.1, colW: [1.8, 1.1, 5.2, 1.7, 2.3], rowH: 0.55, border: { type: "solid", pt: 0.5, color: HEX.line }, valign: "middle", margin: [0.04, 0.1, 0.04, 0.1] });
    const ev = [
      ["python controller.py --max-experiments 3", L("the whole command", "完整的指令")],
      ["loop/runs.jsonl", L("one line per experiment", "每個實驗一行紀錄")],
      ["runs/NNN_loop/", L("prompt, reply, diff, code, evaluator log", "提示詞、回覆、diff、程式、evaluator 的 log")],
    ];
    ev.forEach((e, i) => {
      const x = 0.6 + i * 4.1;
      card(s, x, 5.1, 3.9, 1.35, C.rule);
      txt(s, e[0], { x: x + 0.2, y: 5.25, w: 3.5, h: 0.6, fontFace: MONO, fontSize: 12, bold: true });
      txt(s, e[1], { x: x + 0.2, y: 5.85, w: 3.5, h: 0.5, fontSize: 13, color: C.muted });
    });
  }

  // ================================================================== 12 timeline
  sect("Part 3");
  const K3 = L("PART 3 · WHAT HAPPENED", "PART 3 · 發生了什麼");
  {
    const s = slideOf("FIGURE", K3, L("Every proposal, code change, run and decision, drawn from the real log", "每個提案、程式修改、執行與判定，都從真實 log 畫出來"),
      L("Read one column top to bottom: proposal, code change, check and run, decision. Blue is the LLM, grey is the program. An arrow between columns is drawn only if that result appears in the next prompt.txt.",
        "一欄由上往下讀：提案、程式修改、檢查與執行、判定。藍色是 LLM，灰色是程式。欄與欄之間的箭頭，只有在該結果確實出現在下一個 prompt.txt 時才會畫。"));
    s.addImage({ path: path.join(DOCS, "timeline.png"), x: 0.3, y: 0.3, w: 9.8, h: 6.888, altText: "Timeline of the real loop run: four columns, one per experiment" });
    chip(s, 10.35, 3.35, "llm");
    txt(s, L("proposal and code change", "提案與程式修改"), { x: 10.35, y: 3.72, w: 2.6, h: 0.5, fontSize: 13 });
    chip(s, 10.35, 4.35, "rule");
    txt(s, L("check, run and accept or reject", "檢查、執行、接受或拒絕"), { x: 10.35, y: 4.72, w: 2.6, h: 0.75, fontSize: 13 });
    txt(s, L("Generated by tools/make_figures.py from loop/runs.jsonl; nothing is typed by hand", "由 tools/make_figures.py 從 loop/runs.jsonl 產生，沒有任何手動輸入"), { x: 10.35, y: 5.7, w: 2.6, h: 1.1, fontSize: 12, color: C.muted });
  }

  // ================================================================== 13 one failure
  {
    const s = slideOf("CONTENT", K3, L("One failure explained: run 008 was the LLM's mistake, and the program contained it", "解釋一個失敗：008 是 LLM 判斷錯了，而程式把它擋了下來"),
      L("The LLM generalised from one success: removing blur helped, so it tried another milder augmentation. It was wrong. The program rejected it and gave the next call the code of 007, not 008. The honest limit: this shows the loop works as designed, not that 007 or 009 are real improvements.",
        "LLM 從一次成功做了推廣：拿掉模糊有效，所以再試一個更溫和的增強，結果錯了。程式拒絕它，並把 007 的程式（不是 008）交給下一次呼叫。要誠實說明的限制：這顯示迴圈照設計運作，不代表 007 或 009 是真的改進。"));
    const steps = [
      ["llm", L("Proposal", "提案"), L("After removing blur worked (007, 18.40%), the LLM proposed a change of the same kind: milder crops, minimum scale 0.2 → 0.35. Its hypothesis cites the 007 result.",
        "拿掉模糊成功之後（007，18.40%），LLM 提了同類型的修改：更溫和的裁切，最小比例 0.2 → 0.35。它的假設引用了 007 的結果。")],
      ["rule", L("Result and decision", "結果與判定"), L("16.09%, below the best of 18.40%. evaluate() rejected it. loop/best/algorithm.py stayed at 007.",
        "16.09%，低於 best 的 18.40%。evaluate() 拒絕了它。loop/best/algorithm.py 維持在 007。")],
      ["llm", L("Next proposal, using the feedback", "下一個提案，用上了回饋"), L("The prompt for 009 listed 008 as rejected and contained the code of 007. The LLM dropped the crop idea and scaled the loss by 0.1 instead: 20.03%, accepted.",
        "009 的提示詞列出 008 被拒絕，並附上 007 的程式。LLM 放棄裁切這個方向，改成把 loss 乘上 0.1：20.03%，被接受。")],
    ];
    steps.forEach((st, i) => {
      const x = 0.6 + i * 4.1;
      card(s, x, 2.0, 3.9, 3.0, st[0] === "llm" ? C.llmFill : C.rule, st[0] === "llm" ? "A9C4F5" : HEX.line);
      chip(s, x + 0.2, 2.18, st[0]);
      head(s, st[1], x + 0.2, 2.6, 3.5);
      txt(s, st[2], { x: x + 0.2, y: 3.05, w: 3.5, h: 1.85, fontSize: 14 });
    });
    txt(s, [{ text: L("What it shows: ", "這說明了什麼："), options: { bold: true } },
      { text: L("a failed idea costs one run and cannot damage the best version, because the program decides what is kept and what the next proposal starts from.",
        "一個失敗的想法只花掉一次執行，不會破壞 best，因為保留什麼、下一個提案從哪裡出發，都由程式決定。"), options: { breakLine: true } },
      { text: L("What it does not show: ", "這沒有說明什麼："), options: { bold: true } },
      { text: L("that either accepted change is a real improvement. Each is one run at seed 42.", "兩個被接受的修改是不是真的改進。它們各自只是 seed 42 的一次執行。") }],
      { x: 0.6, y: 5.25, w: 12.1, h: 1.4, fontSize: 14, paraSpaceAfter: 6 });
  }

  // ================================================================== 14 Part 4
  sect("Part 4");
  {
    const s = slideOf("CONTENT", L("PART 4 · ONE IMPROVEMENT", "PART 4 · 一個改進"),
      L("Main limitation: the loop selects on a single seed. Proposal: accept on the mean of three", "主要限制：迴圈只用一個 seed 做選擇。提案：改用三個 seed 的平均"),
      L("Both arms get the same GPU budget, so the cost of arm B is visible: it tests 4 ideas instead of 12. The verdict comes from seeds neither arm has seen. The thresholds are my own choice, fixed before running. Nothing here has been run.",
        "兩組用一樣的 GPU 預算，所以 B 組的代價看得見：只能測 4 個想法，而不是 12 個。判定來自兩組都沒用過的 seed。門檻是我自己訂的，在執行前就固定。這裡的內容都還沒執行。"));
    card(s, 0.6, 2.0, 3.7, 4.2, C.rule);
    head(s, L("Evidence", "證據"), 0.8, 2.15, 3.3);
    txt(s, "±4.3", { x: 0.8, y: 2.6, w: 3.3, h: 0.7, fontFace: HEAD, fontSize: 36, bold: true, color: C.bad });
    txt(s, L("points: spread of the unchanged baseline across seeds 42, 43, 44", "個百分點：沒改過的 baseline 在 seed 42、43、44 之間的差異"), { x: 0.8, y: 3.3, w: 3.3, h: 0.75, fontSize: 13, color: C.muted });
    txt(s, "+1.4, +1.6", { x: 0.8, y: 4.15, w: 3.3, h: 0.7, fontFace: HEAD, fontSize: 36, bold: true, color: C.llm });
    txt(s, L("points: gain of each accepted change over its parent, at seed 42 only", "個百分點：每個被接受的修改相對於 parent 的進步，只在 seed 42 上"), { x: 0.8, y: 4.85, w: 3.3, h: 0.75, fontSize: 13, color: C.muted });
    const rows = [
      [L("Hypothesis", "假設"), L("Accepting on the mean of several seeds picks changes that hold up on unseen seeds better than accepting on seed 42 alone, even though fewer ideas can be tested.",
        "用多個 seed 的平均來接受，選出的修改在沒看過的 seed 上，會比只看 seed 42 更站得住，即使能測試的想法變少。")],
      [L("Comparison", "比較"), L("Arm A: 1 run per candidate (seed 42). Arm B: 3 runs (seeds 42, 43, 44), accept on the mean. Same controller, model, prompt and budget: 12 training runs each, so 12 candidates against 4.",
        "A 組：每個候選跑 1 次（seed 42）。B 組：跑 3 次（seed 42、43、44），用平均判斷。controller、模型、提示詞、預算都相同：各 12 次訓練，所以是 12 個候選對 4 個。")],
      [L("Criterion", "評估標準"), L("Train the final best of each arm on 5 unseen seeds (45–49). Supported if B beats A on at least 4 of 5 seeds and the mean difference exceeds twice its standard error.",
        "把兩組最後的 best 各自在 5 個沒用過的 seed（45–49）上訓練。若 B 在 5 個 seed 中至少贏 4 個，且平均差距超過 2 倍標準誤，假設成立。")],
    ];
    rows.forEach((r, i) => {
      const y = 2.0 + i * 1.45;
      card(s, 4.6, y, 8.1, 1.3, i === 0 ? C.llmFill : C.rule, i === 0 ? "A9C4F5" : HEX.line);
      txt(s, r[0], { x: 4.8, y: y + 0.15, w: 1.6, h: 0.4, fontSize: 15, bold: true });
      txt(s, r[1], { x: 6.45, y: y + 0.13, w: 6.05, h: 1.1, fontSize: 13 });
    });
    txt(s, L("A proposal only: nothing on this slide has been run. Cheapest first step: re-run 007, 008 and 009 at seeds 43 and 44 (6 runs, about 2.6 GPU hours).",
      "這只是提案：這頁的內容都還沒執行。最便宜的第一步：把 007、008、009 在 seed 43 和 44 上重跑（6 次，約 2.6 個 GPU 小時）。"), { x: 0.6, y: 6.4, w: 12.1, h: 0.5, fontSize: 12, color: C.muted });
  }

  // ================================================================== 15 disclosure
  sect(L("Disclosure", "揭露"));
  {
    const s = slideOf("CONTENT", L("DISCLOSURE", "揭露"), L("What was used, who decided what, and what went wrong", "用了什麼、誰決定了什麼、哪裡出過問題"),
      L("Say it plainly: the code was written by Claude Code under my direction. I set the goals and constraints, read and reviewed the output, and can point to the function for every step.",
        "直接說：程式是在我的指示下由 Claude Code 寫的。我訂目標和限制、閱讀並審閱產出，而且能指出每個步驟對應的函式。"));
    const cards = [
      [L("LLM", "LLM"), [
        L("In the loop: claude-opus-5-5, medium effort, through the Claude Code command line", "迴圈內：claude-opus-5-5、medium effort，透過 Claude Code 命令列"),
        L("Coding assistant: Claude Code, the only AI tool used. The code was written by it; I set goals, reviewed and decided", "Coding assistant：Claude Code，唯一使用的 AI 工具。程式由它撰寫；我訂目標、審閱、做決定"),
      ]],
      [L("Libraries and reused code", "套件與重用的程式"), [
        L("Python 3.10, torch 2.1.0+cu121, torchvision 0.16.0, numpy 1.26.4", "Python 3.10、torch 2.1.0+cu121、torchvision 0.16.0、numpy 1.26.4"),
        L("controller.py: standard library only, no agent framework", "controller.py：只用標準函式庫，沒有 agent 框架"),
        L("task/ is FML-bench (Apache-2.0, commit d336651), unmodified", "task/ 來自 FML-bench（Apache-2.0，commit d336651），未修改"),
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
        L("Error handling ran only in tests, not in the real run", "錯誤處理只在測試裡跑過，真實執行沒遇到"),
      ]],
    ];
    cards.forEach((c, i) => {
      const x = 0.6 + (i % 2) * 6.2, y = 1.95 + Math.floor(i / 2) * 2.5;
      card(s, x, y, 5.9, 2.35, C.rule);
      head(s, c[0], x + 0.2, y + 0.12, 5.5);
      bullets(s, c[1], { x: x + 0.2, y: y + 0.52, w: 5.5, h: 1.75, fontSize: 14, paraSpaceAfter: 3 });
    });
  }

  return pres;
}

(async () => {
  for (const lang of ["en", "zh"]) {
    const file = path.join(OUT, `automated-researcher-${lang}.pptx`);
    await build(lang).writeFile({ fileName: file });
    console.log("wrote", file);
  }
})();
