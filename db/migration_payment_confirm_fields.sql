-- 收款確認：實際收款方式（現金/轉帳）、確認人
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_method TEXT CHECK (paid_method IN ('cash','transfer'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS paid_by UUID REFERENCES profiles(id);
