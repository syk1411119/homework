// Supabase Edge Function：AI 代理（把 DeepSeek 密钥放在服务端，安全）
// 部署方法见 README「可选：AI 服务器端安全方案」
import { createClient } from "npm:@supabase/supabase-js@2";

const DEEPSEEK_KEY = Deno.env.get("DEEPSEEK_API_KEY") ?? "";
const MODEL = "deepseek-chat";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseAnonKey);
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "未登录" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });
    }

    const { mode, text } = await req.json();
    let sys = "你是作业解析助手。把学生输入的作业文字解析成 JSON 对象：{\"tasks\":[{\"subject\":\"科目\",\"title\":\"标题\",\"description\":\"说明\",\"deadline\":\"YYYY-MM-DD HH:mm\",\"estimated_minutes\":整数,\"difficulty\":\"简单|中等|困难\"}]}。科目用中文。没写时间的默认明天 20:00。只输出 JSON。";
    if (mode === "plan") {
      sys = "你是学习规划师。根据给定的待办任务列表，输出一个今日学习计划 JSON：{\"plan\":[{\"title\":\"任务\",\"reason\":\"为什么这么安排（一句话）\"}],\"summary\":\"今日计划总结\"}。按截止时间和难度合理安排顺序。只输出 JSON。";
    }

    const resp = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + DEEPSEEK_KEY },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: sys }, { role: "user", content: text }],
        response_format: { type: "json_object" },
        temperature: 0.2,
      }),
    });
    const data = await resp.json();
    return new Response(JSON.stringify({ content: data.choices?.[0]?.message?.content ?? "" }), {
      headers: { ...cors, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...cors, "Content-Type": "application/json" } });
  }
});
