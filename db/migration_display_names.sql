-- ============================================================
-- 設定使用者顯示名稱（訂單頁「製作表單人」欄位會顯示這個名稱）
-- 貼到 Supabase SQL Editor 執行
-- ============================================================
UPDATE public.profiles p
SET display_name = m.display_name
FROM (
  SELECT u.id, v.display_name
  FROM auth.users u
  JOIN (VALUES
    ('chungshu224@gmail.com',        'Chungshu'),
    ('jackie123450000@yahoo.com.tw', 'Jackie'),
    ('pig23pooh@gmail.com',          'Ginny')
  ) AS v(email, display_name) ON u.email = v.email
) m
WHERE p.id = m.id;
