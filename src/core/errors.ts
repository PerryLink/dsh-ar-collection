/** Stable, user-facing failure codes for dsh-ar-collection. */
export type CollectionErrorCode =
  | 'E_COLLECTION_CSV_ROW'
  | 'E_COLLECTION_DATE_INVALID'
  | 'E_COLLECTION_AMOUNT'
  | 'E_COLLECTION_PATH_INVALID'
  | 'E_COLLECTION_EMPTY'

interface HumanMessage {
  text: string
  next: string
}

const COLLECTION_HUMAN: Record<CollectionErrorCode, HumanMessage> = {
  E_COLLECTION_CSV_ROW: {
    text: '应收 CSV 有一行读不了：列数、表头或字段不合规',
    next: '对照表头检查这一行：客户、发票号、到期日、金额分、已收金额分、联系人邮箱',
  },
  E_COLLECTION_DATE_INVALID: {
    text: '日期不是有效的 YYYY-MM-DD，或 as_of 不是真实日期',
    next: '统一成 2026-06-30 这种格式，并确认 as_of 与到期日都是真实日期',
  },
  E_COLLECTION_AMOUNT: {
    text: '金额分不是正整数，或已收金额超过应收金额',
    next: '金额分与已收金额分都填整数分（如 12800000 表示 128,000.00 元）',
  },
  E_COLLECTION_PATH_INVALID: {
    text: '文件路径或导出文件名不可用',
    next: '传一个存在的 CSV 文件；导出时只传 [A-Za-z0-9._-] 组成的文件名',
  },
  E_COLLECTION_EMPTY: {
    text: '没有可催收的发票：全部已结清，或没有发票越过第一个提醒阶梯',
    next: '确认 as_of 与提醒阶梯；需要看已结清客户时传 include_settled=true',
  },
}

/** `one plain sentence（E_CODE）｜下一步：one action｜细节：detail` — what the end user sees. */
export function collectionErrorMessage(code: CollectionErrorCode, detail?: string): string {
  const human = COLLECTION_HUMAN[code]
  return `${human.text}（${code}）｜下一步：${human.next}${detail ? `｜细节：${detail}` : ''}`
}

export class CollectionError extends Error {
  readonly code: CollectionErrorCode

  constructor(code: CollectionErrorCode, detail?: string) {
    super(collectionErrorMessage(code, detail))
    this.name = 'CollectionError'
    this.code = code
  }
}
