-- ============================================================
-- 訂單作廢（刪除表單）功能
-- 貼到 Supabase SQL Editor 執行
-- 會將訂單標記為作廢、記錄作廢人與時間，並把當初扣的庫存
-- 依原批次（purchase_batches）回補，同時留下 stock_movements 紀錄
-- ============================================================
CREATE OR REPLACE FUNCTION void_order(p_order_id BIGINT)
RETURNS VOID AS $$
DECLARE
  v_status TEXT;
  v_mv     RECORD;
BEGIN
  SELECT status INTO v_status FROM orders WHERE id = p_order_id FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION '訂單不存在';
  END IF;
  IF v_status = 'void' THEN
    RAISE EXCEPTION '此訂單已作廢';
  END IF;

  -- 依當初扣庫的批次，逐筆回補庫存
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
  SET status = 'void', voided_by = auth.uid(), voided_at = NOW()
  WHERE id = p_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
