-- ============================================================
-- 葡萄酒進銷存 POS 系統 - Supabase PostgreSQL Schema
-- 路線 A: GitHub Pages 前端 + Supabase 後端
-- ============================================================

-- ------------------------------------------------------------
-- 1. 使用者資料 (搭配 Supabase Auth)
-- auth.users 由 Supabase 管理，這裡建 profiles 存顯示名稱
-- ------------------------------------------------------------
CREATE TABLE profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,           -- 顯示名稱，操作紀錄用
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 新使用者註冊時自動建立 profile
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', NEW.email));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ------------------------------------------------------------
-- 2. 客戶資料
-- ------------------------------------------------------------
CREATE TABLE customers (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT NOT NULL,
  phone       TEXT,
  email       TEXT,
  address     TEXT,
  note        TEXT,                     -- 偏好備註 (如: 喜歡 Burgundy 紅酒)
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customers_name ON customers (name);
CREATE INDEX idx_customers_phone ON customers (phone);

-- ------------------------------------------------------------
-- 3. 酒款品項 (SKU = 酒款 + 年份 + 容量)
-- ------------------------------------------------------------
CREATE TABLE products (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  sku         TEXT UNIQUE,              -- 自訂編號或條碼，可空
  name        TEXT NOT NULL,            -- 酒款名稱 (如: Chambertin Clos de Beze)
  producer    TEXT,                     -- 酒莊/生產者
  country     TEXT,                     -- 國家 (France, Spain...)
  region      TEXT,                     -- 產區 (Burgundy, Rioja...)
  appellation TEXT,                     -- 法定產區 (AOC / D.O.)
  wine_type   TEXT NOT NULL DEFAULT 'red'
              CHECK (wine_type IN ('red','white','rose','sparkling','sweet','fortified','spirits','other')),
  vintage     SMALLINT,                 -- 年份，NV 酒填 NULL
  volume_ml   INTEGER NOT NULL DEFAULT 750,  -- 容量 (750, 1500...)
  list_price  NUMERIC(12,2) NOT NULL DEFAULT 0,  -- 定價 (單瓶)
  case_size   SMALLINT DEFAULT 12,      -- 一箱幾瓶
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (name, producer, vintage, volume_ml)   -- 防止重複建檔
);

CREATE INDEX idx_products_name ON products (name);
CREATE INDEX idx_products_region ON products (region);

-- ------------------------------------------------------------
-- 4. 進貨批次 (同款酒不同批進價不同，毛利計算依據)
-- ------------------------------------------------------------
CREATE TABLE purchase_batches (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id   BIGINT NOT NULL REFERENCES products(id),
  purchased_at DATE NOT NULL DEFAULT CURRENT_DATE,
  supplier     TEXT,                    -- 供應商
  unit_cost    NUMERIC(12,2) NOT NULL,  -- 單瓶進價
  qty_in       INTEGER NOT NULL CHECK (qty_in > 0),   -- 進貨數量
  qty_left     INTEGER NOT NULL CHECK (qty_left >= 0),-- 該批剩餘 (FIFO 扣減)
  note         TEXT,
  created_by   UUID REFERENCES profiles(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_batches_product ON purchase_batches (product_id, purchased_at);

-- 目前庫存 = 各批次 qty_left 加總，用 VIEW 查詢
CREATE VIEW v_stock AS
SELECT
  p.id AS product_id,
  p.name, p.producer, p.vintage, p.volume_ml, p.list_price,
  COALESCE(SUM(b.qty_left), 0) AS stock_qty,
  CASE WHEN COALESCE(SUM(b.qty_left),0) > 0
       THEN ROUND(SUM(b.unit_cost * b.qty_left) / SUM(b.qty_left), 2)
       ELSE NULL END AS avg_cost   -- 剩餘庫存的加權平均成本
FROM products p
LEFT JOIN purchase_batches b ON b.product_id = p.id AND b.qty_left > 0
WHERE p.is_active
GROUP BY p.id;

-- ------------------------------------------------------------
-- 5. 銷售訂單
-- ------------------------------------------------------------
CREATE TABLE orders (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_no      TEXT UNIQUE NOT NULL,   -- 單號 (如 S20260702-001)
  customer_id   BIGINT REFERENCES customers(id),  -- 可空 = 散客
  status        TEXT NOT NULL DEFAULT 'completed'
                CHECK (status IN ('completed','void')),
  subtotal      NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount      NUMERIC(12,2) NOT NULL DEFAULT 0, -- 整單折讓
  total         NUMERIC(12,2) NOT NULL DEFAULT 0,
  payment_method TEXT DEFAULT 'cash'
                CHECK (payment_method IN ('cash','card','transfer','other')),
  note          TEXT,
  created_by    UUID NOT NULL REFERENCES profiles(id),  -- 誰開的單
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voided_by     UUID REFERENCES profiles(id),
  voided_at     TIMESTAMPTZ
);

CREATE INDEX idx_orders_customer ON orders (customer_id);
CREATE INDEX idx_orders_created ON orders (created_at);

-- ------------------------------------------------------------
-- 6. 訂單明細 (含當下成本快照，毛利報表用)
-- ------------------------------------------------------------
CREATE TABLE order_items (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_id    BIGINT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id  BIGINT NOT NULL REFERENCES products(id),
  qty         INTEGER NOT NULL CHECK (qty > 0),
  unit_price  NUMERIC(12,2) NOT NULL,   -- 實售單價 (可能有折扣)
  unit_cost   NUMERIC(12,2) NOT NULL DEFAULT 0,  -- FIFO 扣批次時的成本快照
  line_total  NUMERIC(12,2) GENERATED ALWAYS AS (qty * unit_price) STORED
);

CREATE INDEX idx_order_items_order ON order_items (order_id);
CREATE INDEX idx_order_items_product ON order_items (product_id);

-- ------------------------------------------------------------
-- 7. 庫存異動紀錄 (所有進出的流水帳)
-- ------------------------------------------------------------
CREATE TABLE stock_movements (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  product_id  BIGINT NOT NULL REFERENCES products(id),
  batch_id    BIGINT REFERENCES purchase_batches(id),
  movement    TEXT NOT NULL
              CHECK (movement IN ('purchase','sale','void_restore','adjust','breakage','sample')),
  qty_change  INTEGER NOT NULL,         -- 正 = 入庫, 負 = 出庫
  ref_order_id BIGINT REFERENCES orders(id),
  note        TEXT,
  created_by  UUID NOT NULL REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_movements_product ON stock_movements (product_id, created_at);

-- ------------------------------------------------------------
-- 8. 操作紀錄 audit_log (自動記錄所有異動)
-- ------------------------------------------------------------
CREATE TABLE audit_log (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  table_name  TEXT NOT NULL,
  record_id   TEXT NOT NULL,
  action      TEXT NOT NULL CHECK (action IN ('INSERT','UPDATE','DELETE')),
  old_data    JSONB,                    -- 變更前
  new_data    JSONB,                    -- 變更後
  changed_by  UUID,                     -- auth.uid()
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_table ON audit_log (table_name, changed_at);
CREATE INDEX idx_audit_user ON audit_log (changed_by, changed_at);

-- 通用 audit trigger function
CREATE OR REPLACE FUNCTION fn_audit()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO audit_log (table_name, record_id, action, new_data, changed_by)
    VALUES (TG_TABLE_NAME, NEW.id::TEXT, 'INSERT', to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, changed_by)
    VALUES (TG_TABLE_NAME, NEW.id::TEXT, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), auth.uid());
    RETURN NEW;
  ELSE
    INSERT INTO audit_log (table_name, record_id, action, old_data, changed_by)
    VALUES (TG_TABLE_NAME, OLD.id::TEXT, 'DELETE', to_jsonb(OLD), auth.uid());
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 掛在需要追蹤的表上
CREATE TRIGGER trg_audit_products
  AFTER INSERT OR UPDATE OR DELETE ON products
  FOR EACH ROW EXECUTE FUNCTION fn_audit();
CREATE TRIGGER trg_audit_batches
  AFTER INSERT OR UPDATE OR DELETE ON purchase_batches
  FOR EACH ROW EXECUTE FUNCTION fn_audit();
CREATE TRIGGER trg_audit_orders
  AFTER INSERT OR UPDATE OR DELETE ON orders
  FOR EACH ROW EXECUTE FUNCTION fn_audit();
CREATE TRIGGER trg_audit_customers
  AFTER INSERT OR UPDATE OR DELETE ON customers
  FOR EACH ROW EXECUTE FUNCTION fn_audit();

-- ------------------------------------------------------------
-- 9. 開單核心函式 (交易 + FIFO 扣庫存，防止超賣)
--    前端呼叫: supabase.rpc('create_order', {...})
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION create_order(
  p_customer_id BIGINT,
  p_discount    NUMERIC,
  p_payment     TEXT,
  p_note        TEXT,
  p_items       JSONB   -- [{"product_id":1,"qty":2,"unit_price":1500}, ...]
)
RETURNS BIGINT AS $$
DECLARE
  v_order_id  BIGINT;
  v_order_no  TEXT;
  v_item      JSONB;
  v_need      INTEGER;
  v_take      INTEGER;
  v_batch     RECORD;
  v_cost_sum  NUMERIC := 0;
  v_subtotal  NUMERIC := 0;
  v_line_cost NUMERIC;
BEGIN
  -- 產生單號 S + 日期 + 流水
  SELECT 'S' || to_char(NOW(),'YYYYMMDD') || '-' ||
         lpad((COUNT(*)+1)::TEXT, 3, '0')
  INTO v_order_no
  FROM orders WHERE created_at::DATE = CURRENT_DATE;

  INSERT INTO orders (order_no, customer_id, discount, payment_method, note, created_by)
  VALUES (v_order_no, p_customer_id, COALESCE(p_discount,0), p_payment, p_note, auth.uid())
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

    v_subtotal := v_subtotal + (v_item->>'qty')::INTEGER * (v_item->>'unit_price')::NUMERIC;
  END LOOP;

  UPDATE orders
  SET subtotal = v_subtotal,
      total = v_subtotal - COALESCE(p_discount,0)
  WHERE id = v_order_id;

  RETURN v_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 10. Row Level Security (登入者皆為管理者，須登入才能操作)
-- ------------------------------------------------------------
ALTER TABLE profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers        ENABLE ROW LEVEL SECURITY;
ALTER TABLE products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders           ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items      ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log        ENABLE ROW LEVEL SECURITY;

-- 已登入即可完整存取 (全員管理者)
CREATE POLICY all_access ON profiles         FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY all_access ON customers        FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY all_access ON products         FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY all_access ON purchase_batches FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY all_access ON orders           FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY all_access ON order_items      FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
CREATE POLICY all_access ON stock_movements  FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);
-- audit_log 只能讀，不能改寫 (trigger 以 SECURITY DEFINER 寫入)
CREATE POLICY read_only ON audit_log FOR SELECT TO authenticated USING (TRUE);
