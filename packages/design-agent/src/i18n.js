// 画布包双语桥接（C2）。
//
// 站点语言由 client 的 LanguageContext 统一管理，持久化在 localStorage 键 "lang"
// （"zh" | "en"，中文为默认）。本包是独立 prebuilt 产物，不直接依赖 client 代码，
// 因此沿用 CreativeCanvas 里 processReferenceDoc 已有的桥接模式：在调用时读
// localStorage.getItem("lang")，而不是在模块加载时缓存。语言切换发生在 client
// 页面级并触发整页刷新，所以 t() 无需响应式——但 *绝不能* 在模块加载时把语言固化，
// 否则切换后构建产物里的文案会卡在旧语言。
//
// SSR 安全：服务端无 localStorage，typeof 检查后回落到中文（默认）。

const dict = {
  zh: {
    // ── 侧边栏 / 会话 ──────────────────────────────────────────────
    studio_brand: "Picsmith Studio",
    go_back: "返回",
    home: "首页",
    toggle_sessions: "切换会话列表",
    no_previous_sessions: "暂无历史会话",
    rename: "重命名",
    delete: "删除",
    total_sessions: "会话总数",
    creative_canvas: "创意画布",
    today: "今天",
    yesterday: "昨天",

    // ── 顶栏 / 个人菜单 ────────────────────────────────────────────
    new_chat: "新建对话",
    new_session: "新建会话",
    profile: "头像",
    support: "联系支持",
    available: "可用",
    pro: "Pro",
    bronze: "Bronze",
    dark_mode: "深色模式",
    open_chat: "展开对话栏",
    hide_chat: "收起对话栏",

    // ── 对话区 ────────────────────────────────────────────────────
    agent: "Agent",
    auto_model_access: "自动选模 · 多工具调用",
    copy_message: "复制消息",
    quick_start: "快速开始",
    qs_ecommerce: "🛍️ 电商主图",
    qs_ecommerce_prompt: "为一款保温杯生成 2 张电商主图，白底，突出产品质感",
    qs_logo: "⭐ Logo 设计",
    qs_logo_prompt: "为一家手冲咖啡店设计 3 个 logo 方案，极简风格",
    qs_social: "📱 社媒封面",
    qs_social_prompt: "做 2 张小红书封面图，主题是居家收纳技巧，明亮治愈风",

    // ── 欢迎语 / 占位文案 ──────────────────────────────────────────
    welcome: (name) => `你好 ${name} —— 今天想创作点什么？`,
    session_ready: "会话已就绪 —— 想创作点什么？",
    user: "用户",
    input_placeholder: "输入一个想法，或用 @ 引用素材…",
    skill_placeholder: (skill, field) => `来创作 ${skill} 吧，先从你的${field}说起？`,
    idea: "想法",

    // ── 提及 / 素材 / 技能 ─────────────────────────────────────────
    mentions: "提及",
    assets: "素材",
    skills: "技能",
    no_matches: "无匹配项",
    audio: "音频",
    upload_image: "上传素材",
    agent_skills: "智能技能",
    expert_skills: "专家技能",
    specialized_workflow: "专项工作流",
    dismiss: "关闭",
    session_assets: "会话素材",
    items: (n) => `${n} 项`,
    no_assets_yet: "尚未生成任何素材",
    asset_preview: (kind) => `${kind} 预览`,
    creative_asset: "创意素材",

    // ── 事件 / 审批 ────────────────────────────────────────────────
    reply_to_continue: "回复以继续。",
    generated: (kind) => `已生成 ${kind}`,
    done: "已完成",
    failed: "失败",
    approve_execute: "确认并执行",
    cancel: "取消",
    approve: "通过",
    reject: "拒绝",

    // ── Toast / 提示 ───────────────────────────────────────────────
    another_task_running: "另一个任务正在执行",
    insufficient_credits: "积分不足",
    top_up: "去充值 →",
    region_edit_failed: "局部编辑失败",
    region_edit_failed_msg: "❌ 局部编辑失败",
    region_edit_label: (label, prompt) => `🖌 局部编辑 ${label}：${prompt}`,
    job_actioned: (action) => action === "approve" ? "任务已通过" : "任务已拒绝",
    job_action_failed: (action) => action === "approve" ? "任务通过失败" : "任务拒绝失败",
    session_renamed: "会话已重命名",
    session_rename_failed: "重命名失败",
    session_deleted: "会话已删除",
    undo: "撤销",
    restore_failed: "恢复失败",
    canvas_deleted: (n) => `已删除 ${n} 项`,
    canvas_deleted: (n) => `已删除 ${n} 项`,
    session_delete_failed: "删除失败",
    establish_session_failed: "会话建立失败",
    copied: "已复制到剪贴板",
    copy_failed: "复制失败",
    doc_upload_label: (name) => `📄 上传参考文档「${name}」`,
    doc_duplicate: (name) => `📄「${name}」此前已解析过，设计时会继续参考它，无需重复上传。`,
    doc_upload_failed: "文档上传失败",
    doc_upload_failed_msg: "❌ 文档上传失败",
    unsupported_format: (ext) => `暂不支持「${ext}」格式，请上传图片、视频、音频或 PDF/Word 文档`,
    uploaded_as: (label) => `已上传为 ${label}`,
    upload_failed: "上传失败",
    still_running_bg: "还在为你生成中，稍等片刻～（即使刷新或离开也不会丢）",

    // ── 画布（CanvasArea）─────────────────────────────────────────
    image: "图片",
    video: "视频",
    audio_asset: "音频素材",
    double_click_edit: "双击编辑",
    generating: "生成中…",
    rendering: "渲染中…",
    move_to_change_spawn: "（拖动可改变生成位置）",
    playback_failed: "播放失败，请再次点击播放按钮。",
    paint_within_image: "请在选中的图片范围内涂抹",
    preparing_download: "正在准备下载…",
    download_started: "下载已开始",
    download_failed: "下载失败，可能被跨域策略拦截。",
    source_url_not_found: "未找到源文件地址",
    all_items_visible: "所有元素已恢复显示",
    confirm_clear_canvas: "确定要清空整个画布吗？",
    canvas_cleared: "画布已清空",
    export_failed: "导出失败：该图片来自外部源且未授予跨域权限。",
    canvas_export_failed: "画布导出失败：画布上有图片来自外部源且未授予跨域权限。",
    image_load_failed: "素材加载失败，已跳过（仅支持图片格式）",

    // 局部编辑（蒙版）
    edit_region: "🖌 局部编辑",
    paint_area: "涂抹要修改的区域",
    brush: "笔刷",
    clear: "清除",
    region_prompt_placeholder: "描述这块区域要怎么改，如：把文字改成「限时 8 折」",
    apply_credits: (cr) => `应用 · ${cr} CR`,
    mask_hint: "涂抹要修改的区域 · ESC 取消 · 涂完点应用",

    // 右键菜单
    copy: "复制",
    cut: "剪切",
    duplicate: "创建副本",
    bring_to_front: "置于顶层",
    send_to_back: "置于底层",
    move_up: "上移一层",
    move_down: "下移一层",
    lock_unlock: "锁定 / 解锁",
    show_hide: "显示 / 隐藏",
    flip_horizontal: "水平翻转",
    flip_vertical: "垂直翻转",
    download: "下载",
    export_as: "导出为",
    paste: "粘贴",
    zoom_in: "放大",
    zoom_out: "缩小",
    zoom_to_fit: "适配视图",
    reset_zoom: "重置缩放",
    export_canvas: "导出画布",
    show_all_hidden: "显示全部隐藏元素",
    clear_canvas: "清空画布",
  },

  en: {
    // ── Sidebar / sessions ────────────────────────────────────────
    studio_brand: "Picsmith Studio",
    go_back: "Go back",
    home: "Home",
    toggle_sessions: "Toggle sessions",
    no_previous_sessions: "No previous sessions",
    rename: "Rename",
    delete: "Delete",
    total_sessions: "Total sessions",
    creative_canvas: "Creative Canvas",
    today: "Today",
    yesterday: "Yesterday",

    // ── Top bar / profile menu ────────────────────────────────────
    new_chat: "New chat",
    new_session: "New session",
    profile: "Profile",
    support: "Support",
    available: "available",
    pro: "Pro",
    bronze: "Bronze",
    dark_mode: "Dark mode",
    open_chat: "Open chat",
    hide_chat: "Hide chat",

    // ── Chat ──────────────────────────────────────────────────────
    agent: "Agent",
    auto_model_access: "Auto model • Multi-tool access",
    copy_message: "Copy message",
    quick_start: "Quick start",
    qs_ecommerce: "🛍️ E-commerce hero image",
    qs_ecommerce_prompt: "Generate 2 e-commerce hero shots of an insulated tumbler on a clean white background, emphasizing material quality",
    qs_logo: "⭐ Logo design",
    qs_logo_prompt: "Design 3 minimal logo concepts for a pour-over coffee shop",
    qs_social: "📱 Social media cover",
    qs_social_prompt: "Create 2 social covers on the theme of home organization tips, bright and calming",

    // ── Greetings / placeholders ──────────────────────────────────
    welcome: (name) => `Hello ${name} — what shall we create today?`,
    session_ready: "Session ready — what shall we create?",
    user: "User",
    input_placeholder: "Start with an idea or mention assets using @…",
    skill_placeholder: (skill, field) => `Let's create ${skill}s — start with your ${field}?`,
    idea: "idea",

    // ── Mentions / assets / skills ────────────────────────────────
    mentions: "Mentions",
    assets: "Assets",
    skills: "Skills",
    no_matches: "No matches found",
    audio: "Audio",
    upload_image: "Upload image",
    agent_skills: "Agent skills",
    expert_skills: "Expert skills",
    specialized_workflow: "Specialized workflow",
    dismiss: "Dismiss",
    session_assets: "Session assets",
    items: (n) => `${n} items`,
    no_assets_yet: "No assets generated yet",
    asset_preview: (kind) => `${kind} preview`,
    creative_asset: "Creative asset",

    // ── Events / approval ─────────────────────────────────────────
    reply_to_continue: "Reply to continue.",
    generated: (kind) => `Generated ${kind}`,
    done: "Done",
    failed: "Failed",
    approve_execute: "Approve & execute",
    cancel: "Cancel",
    approve: "Approve",
    reject: "Reject",

    // ── Toasts / prompts ──────────────────────────────────────────
    another_task_running: "Another task is running",
    insufficient_credits: "Insufficient credits",
    top_up: "Top up →",
    region_edit_failed: "Region edit failed",
    region_edit_failed_msg: "❌ Region edit failed",
    region_edit_label: (label, prompt) => `🖌 Region edit ${label}: ${prompt}`,
    job_actioned: (action) => action === "approve" ? "Job approved" : "Job rejected",
    job_action_failed: (action) => `Failed to ${action} job`,
    session_renamed: "Session renamed",
    session_rename_failed: "Failed to rename session",
    session_deleted: "Session deleted",
    undo: "Undo",
    canvas_deleted: (n) => `Deleted ${n} item${n > 1 ? "s" : ""}`,
    restore_failed: "Restore failed",
    canvas_deleted: (n) => `Deleted ${n} item${n > 1 ? "s" : ""}`,
    session_delete_failed: "Failed to delete session",
    establish_session_failed: "Failed to establish session",
    copied: "Copied to clipboard",
    copy_failed: "Failed to copy",
    doc_upload_label: (name) => `📄 Uploaded reference doc "${name}"`,
    doc_duplicate: (name) => `📄 "${name}" was already parsed earlier — it'll keep informing the design, no need to re-upload.`,
    doc_upload_failed: "Document upload failed",
    doc_upload_failed_msg: "❌ Document upload failed",
    unsupported_format: (ext) => `"${ext}" files aren't supported — please upload an image, video, audio, or a PDF/Word document`,
    uploaded_as: (label) => `Uploaded as ${label}`,
    upload_failed: "Upload failed",
    still_running_bg: "Still working on it — hang tight (you won't lose it if you refresh or leave)",

    // ── Canvas (CanvasArea) ───────────────────────────────────────
    image: "Image",
    video: "Video",
    audio_asset: "Audio asset",
    double_click_edit: "Double-click to edit",
    generating: "Generating…",
    rendering: "Rendering…",
    move_to_change_spawn: "(Move to change spawn location)",
    playback_failed: "Playback failed. Please click the play button again.",
    paint_within_image: "Paint inside the selected image",
    preparing_download: "Preparing download…",
    download_started: "Download started",
    download_failed: "Download failed. CORS may be blocking the direct download.",
    source_url_not_found: "Source URL not found",
    all_items_visible: "All items are now visible",
    confirm_clear_canvas: "Are you sure you want to clear the entire canvas?",
    canvas_cleared: "Canvas cleared",
    export_failed: "Export failed: this image is from an external source without CORS permission.",
    canvas_export_failed: "Canvas export failed: one or more images are from an external source without CORS permission.",
    image_load_failed: "Asset failed to load and was skipped (images only)",

    // Region edit (mask)
    edit_region: "🖌 Edit region",
    paint_area: "Paint over the area to edit",
    brush: "Brush",
    clear: "Clear",
    region_prompt_placeholder: 'Describe how this area should change, e.g. change the text to "20% off today"',
    apply_credits: (cr) => `Apply · ${cr} CR`,
    mask_hint: "Paint over the area to edit · ESC to cancel · Apply when done",

    // Context menu
    copy: "Copy",
    cut: "Cut",
    duplicate: "Duplicate",
    bring_to_front: "Bring to front",
    send_to_back: "Send to back",
    move_up: "Move up",
    move_down: "Move down",
    lock_unlock: "Lock / Unlock",
    show_hide: "Show / Hide",
    flip_horizontal: "Flip horizontal",
    flip_vertical: "Flip vertical",
    download: "Download",
    export_as: "Export as",
    paste: "Paste",
    zoom_in: "Zoom in",
    zoom_out: "Zoom out",
    zoom_to_fit: "Zoom to fit",
    reset_zoom: "Reset zoom",
    export_canvas: "Export canvas",
    show_all_hidden: "Show all hidden",
    clear_canvas: "Clear canvas",
  },
};

// 当前语言：调用时读取，不在模块加载时缓存。SSR 无 localStorage → 默认中文。
function currentLang() {
  try {
    if (typeof localStorage !== "undefined" && localStorage.getItem("lang") === "en") {
      return "en";
    }
  } catch {
    // localStorage 在某些隐私模式 / SSR 下可能抛错 → 回落默认
  }
  return "zh";
}

/**
 * 取一条文案。key 命中的值若为函数，则用传入的参数调用它，便于插值。
 * 找不到则回退到键名本身（开发期可见，便于排查漏翻）。
 */
export function t(key, ...args) {
  const lang = currentLang();
  const table = dict[lang] || dict.zh;
  const val = key in table ? table[key] : dict.zh[key];
  if (typeof val === "function") return val(...args);
  return val !== undefined ? val : key;
}

export default t;
