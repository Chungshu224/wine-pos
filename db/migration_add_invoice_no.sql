-- 訂單新增「發票號碼」欄位，訂單列表可隨時編輯
ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_no TEXT;
