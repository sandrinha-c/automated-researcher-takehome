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

    subgraph DD["Session D（選做）：一代一代的探索式搜尋"]
        D1["controller.py 加 run_generations()<br/>一代 4 個點子，其中 2 個由程式指定方向"]
        D2["用假 runner 測試"]
        D3["真實執行：從 009 出發，22 次訓練<br/>和 012–019 同預算、同 seeds"]
        D1 --> D2 --> D3
    end

    B4 -->|"貪心迴圈是對照組"| D1
    D3 -.->|"有跑完才放進投影片"| C5
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

## Session D（選做）：一代一代的探索式搜尋

想法來自 OpenEvolve [5]：一次養一批候選、先篩再選、下一代參考上一代。不採用它的框架，
只把這個做法加進自己的 controller。

### 現在的程式為什麼沒有真的探索

`loop_multiseed/runs.jsonl` 裡 8 個候選的紀錄：

| 事實 | 數字 |
|---|---|
| 探索規則被觸發的次數 | 0 次（8 個候選的 `explore` 欄位都是 false） |
| 候選的類別 | optimisation 6 個、architecture 1 個、augmentation 1 個、loss 0 個 |
| 被接受的 4 個候選 | 全部是 optimisation（warmup、學習率兩次、weight decay） |

原因有三個：

1. **探索是「失敗後才啟動」。** 規則是連續 2 個候選沒進步才要求換方向。這次一直有進步，
   所以從頭到尾沒啟動。
2. **方向由 LLM 自己挑。** 它發現調學習率有效，就一直調下去。
3. **只有一條線。** 每一輪都從目前的 best 往下改，同一時間只有一個點子在比。

### 新的做法：一代 4 個點子

```mermaid
flowchart TD
    S[("目前的 best<br/>+ 所有歷史紀錄")] --> G["開始新的一代"]
    G --> P1["點子 1、2：自由題<br/>🤖 LLM 自己選方向<br/>（點子 2 不能和點子 1 同一招）"]
    G --> P2["點子 3、4：指定題<br/>🔧 程式指定「目前試過最少次的兩個類別」<br/>🤖 LLM 在指定類別裡寫出改法"]
    P1 --> V{"🔧 validate()<br/>和現在一樣的檢查<br/>+ 指定題的類別對不對"}
    P2 --> V
    V -->|"不通過"| X1["記錄 invalid_patch<br/>這個名額作廢"]
    V -->|"通過"| SC["初賽：每個點子只跑 seed 42<br/>🔧 最多 4 次訓練"]
    SC --> SEL{"🔧 seed 42 分數前 2 名<br/>而且沒有比 best 低超過 1 分？"}
    SEL -->|"否"| X2["記錄 screened_out"]
    SEL -->|"是"| FULL["複賽：再跑 seed 43、44<br/>🔧 最多 4 次訓練"]
    FULL --> ACC{"🔧 三個 seed 的平均<br/>嚴格大於 best 的平均？"}
    ACC -->|"是，取最高的那個"| NEW["成為新的 best"]
    ACC -->|"否"| KEEP["best 不變"]
    FULL --> RU["複賽的另一名記為「第二名」<br/>它的改動會放進下一代的 prompt<br/>🤖 LLM 可以決定要不要合併"]
    NEW --> REC["🔧 record()：全部寫進 runs.jsonl"]
    KEEP --> REC
    RU --> REC
    X1 --> REC
    X2 --> REC
    REC --> CHK{"🔧 剩下的訓練次數<br/>還夠跑一輪初賽（4 次）？"}
    CHK -->|"夠"| S
    CHK -->|"不夠"| END["結束<br/>最後用 tools/final_test.py 對 test 評分一次"]
```

🤖 是 LLM 做的決定，🔧 是寫死的程式規則。

**三個重點：**

- **探索變成固定配額。** 每一代一定有 2 個點子落在最少試過的類別，不管前面成功或失敗。
- **同一代的點子互相看不到分數。** 4 個點子都從同一個 best 出發，是真的「同時比」，
  不是一個接一個修。
- **先便宜篩、再花錢確認。** 初賽 1 次訓練就淘汰一半，所以同樣的 GPU 時間可以試更多點子。

**預算怎麼分（總共 22 次訓練，和貪心那組一樣）：**

| 代 | 初賽 | 複賽 | 累計 |
|---|---|---|---|
| 第 1 代 | 4 次 | 最多 2 個點子 × 2 次 | 8 |
| 第 2 代 | 4 次 | 最多 2 個點子 × 2 次 | 16 |
| 第 3 代 | 4 次 | 只夠 1 個點子 × 2 次 | 22 |

最多試 12 個點子；貪心那組同樣 22 次訓練試了 8 個。

### 實驗程序

1. **寫程式。** 在 controller.py 加 `run_generations()` 和對應的參數。六個步驟的函式
   （`propose`、`apply_edit`、`validate`、`run_experiment`、`evaluate`、`record`）沿用，不改寫。
2. **假 runner 測試。** 不用 GPU、不用 API。要測到：指定類別有沒有被遵守、前 2 名怎麼選、
   預算用完會不會停、中斷後能不能接著跑。
3. **真實執行。** 從 009 出發，seeds 42 / 43 / 44，上限 22 次訓練，狀態存在新的資料夾
   `loop_explore/`。約 9.5 GPU 小時，中途不介入。
4. **最後評分。** 新的 best 用 `tools/final_test.py` 對 test 評分一次，不用來做選擇。
5. **寫進 README 和圖。** 兩組並排的表，加上兩組各自試過哪些類別。

### 對照方式

對照組已經存在：012–019（貪心、從 009 出發、同樣的 seeds、22 次訓練）。
新的一組只差「點子怎麼產生、怎麼篩」，接受規則一樣是三個 seed 的平均嚴格大於 best。

### 評估標準（跑之前先定）

| 指標 | 貪心組（已知） | 探索組 |
|---|---|---|
| 22 次訓練後 best 的三 seed 平均 | 48.00% | 待測 |
| 試過的點子數 | 8 | 待測（最多 12） |
| 至少試過 1 次的類別數（共 5 類） | 3 | 待測（設計上至少 4） |
| 有候選被接受的類別數 | 1 | 待測 |
| test 分數（最後評一次） | 48.66% | 待測 |

### 已知弱點

- **探索組可能輸。** 貪心組的 48% 是連續 4 步 optimisation 疊出來的。探索組每代只有 2 個
  自由名額，三代下來疊不了那麼多步。論文 [1] 也說：改進容易找到時，貪心比較好。
  輸了也是一個可以報告的結果，但要有心理準備。
- **初賽只看 seed 42。** 這正是 Part 4 指出的雜訊問題。取前 2 名（不是只取第 1 名）可以減輕，
  不能消除。
- **每組只跑一次。** LLM 有隨機性，兩組各一次不足以證明哪種搜尋比較好。
- **起點重複。** 從 009 出發代表會重新發現 warmup 這類已知的改進。這是為了對照公平付的代價。

### 和題目的關係

題目沒有要求這一項，Part 4 也只要一張投影片、一個改進。沒跑完的話，只在投影片放一行
「下一步」，不取代現有的 Part 4。

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
