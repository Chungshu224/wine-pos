-- 新增 抬頭（發票/公司名稱）欄位，與 統一編號 併排使用
ALTER TABLE customers ADD COLUMN IF NOT EXISTS tax_title TEXT;
