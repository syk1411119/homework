# 作业打卡 APP

一个**手机优先**的作业打卡应用，AI 自动识别作业并安排每日任务。前端 GitHub Pages（免费），后端 Supabase（免费），AI 用 DeepSeek。

- 地址：`https://syk1411119.github.io/homework/`
- 角色：**学生**（记作业/打卡）、**家长**（查看孩子）、**管理员**（管理成员/角色）

## 功能

- ✨ **AI 识别**：把作业一句话贴进去，自动拆出科目、截止时间、耗时、难度
- 📅 **自动安排**：按截止时间 + 难度 + 耗时自动排出今日任务顺序
- ✅ **每日打卡**：完成一项点一下，记录每天完成度
- 👨‍👩‍👧 **多角色**：学生/家长/管理员，管理员可改角色、关联家长和孩子
- 📱 **手机适配**：底部导航、可「添加到主屏幕」当 APP 用（透明多尺寸图标）

---

## 一、配置后端（Supabase，已填好地址，还差建表）

1. 打开你的 Supabase 项目（`hyimcfabrvptfmxroxjj`）→ 左侧 **SQL Editor** → New query
2. 粘贴仓库里 `supabase/schema.sql` 的**全部内容** → 点 **Run**
3. 左侧 **Authentication → Providers → Email**：关闭 **Confirm email**（否则注册后要收邮件验证，很麻烦）

> 注册规则：**第一位注册的用户自动成为管理员**，之后注册的可选学生/家长。

## 二、AI（DeepSeek）

1. 去 https://platform.deepseek.com 注册 → **API Keys** → 创建密钥（`sk-...`）
2. 打开 APP → 登录 → **「我的」→ AI 设置** → 粘贴密钥 → 保存
3. 密钥只存在你当前浏览器里，**不写进代码、不上传 GitHub**

> 想让 AI 用起来更安全（密钥放服务器端，别人完全看不到）：见下方「可选」一节。

## 三、部署到 GitHub Pages

代码已推送到 `syk1411119/homework`，Pages 已从 main 分支自动部署。以后改了代码：

```bash
git add -A && git commit -m "说明" && git push
```

## 四、可选：AI 服务器端安全方案（Edge Function）

默认方案（密钥存浏览器）对个人/家庭够用。若想让密钥彻底不上浏览器，用 Supabase Edge Function：

1. 安装 Supabase CLI：`npm i -g supabase`
2. `supabase login`（登录你的 Supabase 账号）
3. `supabase link --project-ref hyimcfabrvptfmxroxjj`
4. `supabase secrets set DEEPSEEK_API_KEY=sk-xxx SUPABASE_URL=https://hyimcfabrvptfmxroxjj.supabase.co SUPABASE_ANON_KEY=你的anon密钥`
5. `supabase functions deploy ai`

部署后告诉开发者，把前端 `app.js` 里的 `callAI` 改成调用这个函数的地址即可。

## 目录结构

```
index.html            应用入口（单页）
assets/app.js         全部逻辑（认证/角色/AI/打卡）
assets/style.css       样式（手机优先）
assets/config.js       Supabase 配置
assets/icon*.png       多尺寸透明图标（tools/gen-icons.js 生成）
manifest.webmanifest   PWA 清单
supabase/schema.sql    数据库脚本
supabase/functions/ai   AI 代理（可选）
tools/gen-icons.js     图标生成脚本
server.js              本地预览
```
