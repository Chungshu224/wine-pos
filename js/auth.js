// ============================================
// Supabase client 初始化 + 登入/登出
// ============================================
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 登入
export async function signIn(email, password) {
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user;
}

// 登出
export async function signOut() {
  await sb.auth.signOut();
  location.reload();
}

// 取得目前登入者（含 display_name）
export async function currentUser() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: profile } = await sb
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();
  return { ...user, display_name: profile?.display_name ?? user.email };
}
