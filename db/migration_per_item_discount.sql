-- 開單改為「每品項套用折扣」而非整單折扣
-- create_order 的參數簽章從 (BIGINT, NUMERIC, TEXT, TEXT, JSONB) 改為 (BIGINT, TEXT, TEXT, JSONB)
-- 折讓金額改由各品項的 list_price（牌價）與 unit_price（實售價）差額加總計算，不再由前端傳入整單折扣
DROP FUNCTION IF EXISTS create_order(BIGINT, NUMERIC, TEXT, TEXT, JSONB);

CREATE OR REPLACE FUNCTION create_order(
  p_customer_id BIGINT,
  p_payment     TEXT,
  p_note        TEXT,
  p_items       JSONB   -- [{"product_id":1,"qty":2,"unit_price":1600,"list_price":2000}, ...]
                        -- unit_price = 實售單價 (該品項套用折扣後); list_price = 牌價 (未折扣)
)
RETURNS BIGINT AS $$
DECLARE
  v_order_id  BIGINT;
  v_order_no  TEXT;
  v_item      JSONB;
  v_need      INTEGER;
  v_take      INTEGER;
  v_batch     RECORD;
  v_subtotal  NUMERIC := 0;
  v_total     NUMERIC := 0;
  v_line_cost NUMERIC;
BEGIN
  -- 產生單號 S + 日期 + 流水
  SELECT 'S' || to_char(NOW(),'YYYYMMDD') || '-' ||
         lpad((COUNT(*)+1)::TEXT, 3, '0')
  INTO v_order_no
  FROM orders WHERE created_at::DATE = CURRENT_DATE;

  INSERT INTO orders (order_no, customer_id, payment_method, note, created_by)
  VALUES (v_order_no, p_customer_id, p_payment, p_note, auth.uid())
  RETURNING id INTO v_order_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_need := (v_item->>'qty')::INTEGER;
    v_line_cost := 0;

    -- FIFO: 鎖定批次列，依進貨日順序扣
    FOR v_batch IN
      SELECT id, unit_cost, qty_left
      FROM purchase_batches
      WHERE product_id = (v_item->>'product_id')::BIGINT AND qty_left > 0
      ORDER BY purchased_at, id
      FOR UPDATE
    LOOP
      EXIT WHEN v_need <= 0;
      v_take := LEAST(v_need, v_batch.qty_left);

      UPDATE purchase_batches SET qty_left = qty_left - v_take
      WHERE id = v_batch.id;

      INSERT INTO stock_movements (product_id, batch_id, movement, qty_change, ref_order_id, created_by)
      VALUES ((v_item->>'product_id')::BIGINT, v_batch.id, 'sale', -v_take, v_order_id, auth.uid());

      v_line_cost := v_line_cost + v_take * v_batch.unit_cost;
      v_need := v_need - v_take;
    END LOOP;

    IF v_need > 0 THEN
      RAISE EXCEPTION '庫存不足: product_id=%, 缺 % 瓶',
        (v_item->>'product_id')::BIGINT, v_need;
    END IF;

    INSERT INTO order_items (order_id, product_id, qty, unit_price, unit_cost)
    VALUES (
      v_order_id,
      (v_item->>'product_id')::BIGINT,
      (v_item->>'qty')::INTEGER,
      (v_item->>'unit_price')::NUMERIC,
      ROUND(v_line_cost / (v_item->>'qty')::INTEGER, 2)
    );

    v_subtotal := v_subtotal + (v_item->>'qty')::INTEGER * COALESCE((v_item->>'list_price')::NUMERIC, (v_item->>'unit_price')::NUMERIC);
    v_total    := v_total    + (v_item->>'qty')::INTEGER * (v_item->>'unit_price')::NUMERIC;
  END LOOP;

  UPDATE orders
  SET subtotal = v_subtotal,
      discount = v_subtotal - v_total,
      total = v_total
  WHERE id = v_order_id;

  RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
