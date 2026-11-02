# 故障排查 — dsh-ar-collection

每条按「症状 / 原因 / 动作」写。报错原文都是 `<一句人话>（E_COLLECTION_XXX）｜下一步：<动作>`，
把 `E_COLLECTION_XXX` 和这句话一起发到 issue 即可定位。不要把真实客户应收明细贴进 issue。

## 1. 列数对不上（E_COLLECTION_CSV_ROW）

- **症状**：`应收 CSV 有一行读不了：列数、表头或字段不合规（E_COLLECTION_CSV_ROW）｜下一步：对照表头检查这一行：客户、发票号、到期日、金额分、已收金额分、联系人邮箱｜细节：第 7 行有 5 列，表头有 6 列`
- **原因**：某一行的逗号数量不对，通常是有字段没填、或多了一个逗号；也可能是引号没有闭合，把后面的行吞掉了。
- **动作**：按报错里的行号打开 CSV，补成 6 列；字段里本身有逗号时用双引号包住，例如 `"江南纺织, 苏州"`。改完重跑 `collection.plan`。

## 2. 表头缺列或重复（E_COLLECTION_CSV_ROW）

- **症状**：`...E_COLLECTION_CSV_ROW...｜细节：表头缺少：联系人邮箱`，或 `表头里 金额分 出现了两次`
- **原因**：表头用了别的列名，漏了一列，或同一列出现两次（例如 `amount_cents` 与 `金额分` 同时存在）。
- **动作**：把表头改成 `customer,invoice_no,due_date,amount_cents,paid_cents,contact_email`（或对应中文别名），每列只留一次。确认后重跑。

## 3. 发票号重复或联系人邮箱不对（E_COLLECTION_CSV_ROW）

- **症状**：`...E_COLLECTION_CSV_ROW...｜细节：第 9 行发票号 INV-2026-0032 重复`，或 `第 4 行联系人邮箱 "ap(at)example.com" 不像一个邮箱地址`
- **原因**：同一张发票被导出了两次，或不同客户共用了同一个发票号；邮箱列填了电话、工号或 `at` 写法。
- **动作**：按发票号去重；如果确实是两张不同发票，先在源系统给它们不同的发票号。邮箱确实没有时留空，不要填占位文字。不要靠删行“修复”客户数据。

## 4. 日期不对（E_COLLECTION_DATE_INVALID）

- **症状**：`日期不是有效的 YYYY-MM-DD，或 as_of 不是真实日期（E_COLLECTION_DATE_INVALID）｜下一步：统一成 2026-06-30 这种格式，并确认 as_of 与到期日都是真实日期｜细节：第 12 行到期日：\"2026/04/01\" 不是 YYYY-MM-DD`
- **原因**：日期用了斜杠、两位年份、Excel 序列号，或填了不存在的日期（例如 2026-02-30）；也可能是 `as_of` 传了空值或非日期。
- **动作**：统一改成 `YYYY-MM-DD`；核对 `as_of` 是真实日期。到期日晚于 `as_of` 是允许的（尚未到期），不会报这个错。

## 5. 金额或已收金额不对（E_COLLECTION_AMOUNT）

- **症状**：`金额分不是正整数，或已收金额超过应收金额（E_COLLECTION_AMOUNT）｜下一步：金额分与已收金额分都填整数分（如 12800000 表示 128,000.00 元）｜细节：第 6 行金额分：\"12800.00\" 不是整数分`
- **原因**：把“元”填进了“分”列、填了小数或负数，或 `paid_cents > amount_cents`；也可能是 `min_amount_cents` 传了负数或小数。
- **动作**：金额统一填整数分（1 元 = 100 分）；确认 `amount_cents > 0` 且 `0 <= paid_cents <= amount_cents`；`min_amount_cents` 用非负整数。红字发票/贷记单请先在源系统冲抵。

## 6. 输入路径读不了（E_COLLECTION_PATH_INVALID）

- **症状**：`文件路径或导出文件名不可用（E_COLLECTION_PATH_INVALID）｜下一步：传一个存在的 CSV 文件；导出时只传 [A-Za-z0-9._-] 组成的文件名｜细节：找不到 "/data/ar.csv"，或当前用户读不到`
- **原因**：路径拼错、文件已移动、传了目录，或当前进程没有读权限。
- **动作**：用绝对路径确认文件存在且可读；不要把目录当文件传。确认后重跑 `collection.plan`。

## 7. 导出文件名不安全（E_COLLECTION_PATH_INVALID）

- **症状**：`...E_COLLECTION_PATH_INVALID...｜细节：导出文件名不安全：\"../催收清单.csv\"`
- **原因**：`filename` / `filename_prefix` 里带了 `../`、`/`、反斜杠、空格、中文，或超过长度上限。
- **动作**：`filename` 只传一个由 `[A-Za-z0-9._-]` 组成的文件名，例如 `collection-2026-06-30.csv`；`filename_prefix` 只传 `[A-Za-z0-9._-]`，例如 `batch-2026`。目录固定为 `$DSH_HOME/dsh-ar-collection/exports/` 或 `letters/`，不要传绝对路径。

## 8. 没有可催收的发票（E_COLLECTION_EMPTY）

- **症状**：`没有可催收的发票：全部已结清，或没有发票越过第一个提醒阶梯（E_COLLECTION_EMPTY）｜下一步：确认 as_of 与提醒阶梯；需要看已结清客户时传 include_settled=true`
- **原因**：CSV 为空或只有表头；所有发票都已结清；所有未收发票都还没到第一档（默认 7 天）；或 `min_amount_cents` 把所有客户都过滤掉了。
- **动作**：先用 `collection.plan` 看 `totals.pre_ladder_invoices` 和 `totals.below_min_customers`，确认 `as_of`、`days`、`min_amount_cents` 是否符合预期；只想核对已结清客户时传 `include_settled=true`。`collection.letters` 在没有应催客户时也会报这个码，因为确实没有函可写。

## 9. 计划里的阶梯或动作日期和手工表不一样

- **症状**：没有报错，但某个客户落在“催告”而不是“提醒”，或 `next_action_date` 和手工表不同。
- **原因**：本包的客户阶梯取该客户**逾期最久**的一张发票；下次动作日期取该客户所有应催发票“下一档日期”的**最早值**；`升级` 档没有下一档，按 `as_of + 第一档天数` 复盘。另外，未越过第一档的发票不会进入计划。
- **动作**：用 `collection.plan` 的 `customers[].invoices` 对到具体发票的 `days_past_due` 与 `next_action_date`，再用 `collection.export` 导出清单核对。如果仍然不一致，附上脱敏后的两行输入和完整输出。

## 10. 生成了函件但不想发送 / 担心联网

- **症状**：`letters/` 下出现了 `.txt`，担心中间调用邮件或外网。
- **原因**：本包只做本地草稿生成，代码里没有邮件、HTTP、WebSocket 或上传逻辑；`dsh.demo.network` 为 `false`。
- **动作**：函件里的 `[联系人姓名]`、`[联系电话]`、`[联系人邮箱待补充]` 都是占位符，发送前必须人工复核并补全。是否发送、发给谁、用什么渠道，由你决定，本包不发送也不记录投递状态。

## 还不行

```sh
node samples/quickstart/run.mjs --check   # 自带样例必须通过
node --test test/*.test.mjs               # 83 项测试
node scripts/gate.mjs                     # 元数据 + 验收门
```

仍失败时请在 <https://github.com/PerryLink/dsh-ar-collection/issues> 附上：包版本、最小合成 CSV（或生成脚本）、
`collection.plan` / `collection.letters` / `collection.export` 的完整报错行、Node 与 DSH 版本。**不要附真实客户应收明细。**
