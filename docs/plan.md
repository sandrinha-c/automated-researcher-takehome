# 專案規劃

這份文件是整個作業的工作規劃，對應題目的 Part 1–4。進度以 GitHub issues 追蹤。

## 圖 1：三個階段

```mermaid
flowchart TD
    subgraph A["Session A：打地基（Part 1）"]
        A1["複製官方任務檔<br/>task/，雜湊鎖定"] --> A2["環境 sololearn<br/>environment.yml"]
        A2 --> A3["local_eval.py<br/>縮小預算 20 epochs + 確定性模式"]
        A3 --> A4["Baseline 001 / 002<br/>18.80% / 17.51%（非確定性）"]
        A4 --> A5["determinism_check.py<br/>證明確定性模式逐位元相同"]
        A5 --> A6["003–006 確定性 runs<br/>重現性 + seed 間變異"]
        A6 --> A7["Part 1 說明<br/>Barlow Twins、linear evaluation、一個可能的修改"]
    end

    subgraph B["Session B：自動研究迴圈（Part 2）"]
        B1["controller.py 骨架"] --> B2["用假 runner 測試<br/>不用 GPU、不用 API key"]
        B2 --> B3["接上 Claude API"]
        B3 --> B4["真實執行：baseline + 至少一個 LLM 候選<br/>再用它的回饋產生下一個提案"]
    end

    subgraph C["Session C：呈現與交付（Part 3、4）"]
        C1["時間軸圖（用真實 log）<br/>提案 → diff → 結果 → 下一個提案"]
        C2["架構圖"]
        C3["Part 4：主要限制與一個改進提案<br/>假設、比較方式、評估標準"]
        C4["README 揭露段落<br/>LLM、套件、人工介入、失敗、重用的程式"]
        C5["投影片"]
        C1 --> C5
        C2 --> C5
        C3 --> C5
        C4 --> C5
    end

    A6 -->|"003 當初始 best"| B4
    A6 -->|"seed 變異 = 雜訊大小"| C3
    A7 --> C5
    B4 --> C1
    C5 --> D["交付：GitHub repo + 投影片"]
```

## 圖 2：controller.py 每一輪做什麼

🤖 是 LLM 做的決定，🔧 是寫死的程式規則。

```mermaid
flowchart TD
    M[("記憶<br/>best/algorithm.py<br/>runs.jsonl")] --> P["1. propose()<br/>🤖 LLM 決定：<br/>讀 best code + 歷史 → 提出新版 algorithm.py"]
    P --> E["2. apply_edit()<br/>🔧 寫入 runs/NNN/algorithm.py 副本"]
    E --> V{"3. validate()<br/>🔧 ast 可解析？必要函式都在？<br/>沒碰 evaluator / split？"}
    V -->|"不通過"| R1["記錄 invalid_patch"]
    V -->|"通過"| X["4. run_experiment()<br/>🔧 subprocess 呼叫 local_eval.py<br/>有 timeout"]
    X -->|"crash / timeout"| R2["記錄 crash / timeout + 錯誤訊息"]
    X -->|"完成"| EV{"5. evaluate()<br/>🔧 val_acc > best ？<br/>（嚴格大於）"}
    EV -->|"是"| ACC["接受：更新 best/algorithm.py"]
    EV -->|"否"| REJ["拒絕：保留舊 best"]
    R1 --> REC["6. record()<br/>🔧 寫 runs.jsonl + diff<br/>baseline 原檔永遠保留"]
    R2 --> REC
    ACC --> REC
    REJ --> REC
    REC --> CHK{"🔧 達到 --max-experiments？"}
    CHK -->|"否，下一輪"| M
    CHK -->|"是"| END["結束，輸出摘要"]
```

## 題目要求對照

| 題目要求 | 對應的規劃 |
|---|---|
| Part 1：解釋 Barlow Twins、linear evaluation、一個可能的修改 | A7 |
| Part 1：跑 baseline，報告 val accuracy、指令、硬體、seed、預算 | A3–A6，README |
| Part 2A：一張架構圖（LLM、code editor、runner、evaluator、memory） | C2 |
| Part 2A：五個步驟各自指出函式，區分 LLM 決定與程式檢查 | 圖 2 的 1–6 |
| Part 2B：一個 baseline + 一個 LLM 候選，再用回饋產生下一個提案 | B4 |
| Part 2B：保留 baseline 與 best；處理 invalid patch、crash、timeout；實驗上限 | 圖 2 |
| Part 2C：嚴格大於才接受；官方 evaluator 不改；固定 split、seed、協定；不用 test 標籤 | local_eval.py，evaluate() |
| Part 2D：controller 程式、log、diff、指令；標明重用與自己寫的部分 | record()，C4 |
| Part 3：一張用真實 log 畫的圖，解釋一個成功或失敗 | C1 |
| Part 4：一張投影片：假設、比較、評估標準 | C3 |
| 交付：投影片 + repo；揭露 LLM、套件、人工介入、失敗 | C4、C5 |
