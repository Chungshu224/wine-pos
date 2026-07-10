-- ============================================================
-- 作廢訂單新增「作廢原因」欄位，並改為必填
-- 貼到 Supabase SQL Editor 執行
-- （若尚未執行過 migration_void_order.sql，本檔已包含完整 void_order 邏輯，
--   可直接執行本檔即可，不需再另外執行 migration_void_order.sql）
-- ============================================================
ALTER TABLE orders ADD COLUMN IF NOT EXISTS void_reason TEXT;

DROP FUNCTION IF EXISTS void_order(BIGINT);

CREATE OR REPLACE FUNCTION void_order(p_order_id BIGINT, p_reason TEXT)
RETURNS VOID AS $$
DECLARE
  v_status TEXT;
  v_mv     RECORD;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION '請填寫作廢原因';
  END IF;

  SELECT status INTO v_status FROM orders WHERE id = p_order_id FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION '訂單不存在';
  END IF;
  IF v_status = 'void' THEN
    RAISE EXCEPTION '此訂單已作廢';
  END IF;

  FOR v_mv IN
    SELECT product_id, batch_id, qty_change
    FROM stock_movements
    WHERE ref_order_id = p_order_id AND movement = 'sale'
  LOOP
    UPDATE purchase_batches SET qty_left = qty_left + (-v_mv.qty_change)
    WHERE id = v_mv.batch_id;

    INSERT INTO stock_movements (product_id, batch_id, movement, qty_change, ref_order_id, created_by)
    VALUES (v_mv.product_id, v_mv.batch_id, 'void_restore', -v_mv.qty_change, p_order_id, auth.uid());
  END LOOP;

  UPDATE orders
  SET status = 'void', voided_by = auth.uid(), voided_at = NOW(), void_reason = p_reason
  WHERE id = p_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
