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
    // 会话侧栏三态（P0-5）：别把网络错误显示成「暂无历史会话」
    sessions_loading: "加载会话中…",
    sessions_error: "会话加载失败",
    retry: "重试",
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
    // 一级快捷入口：直达套图/详情页流程（卖家上传产品图→一键出整套）
    qs_main6: "🖼️ 主图六联",
    qs_detail7: "📄 详情页七段",
    qs_main6_sub: "上传产品图 → AI 出 6 张电商主图",
    qs_detail7_sub: "上传产品图 → AI 出 7 段详情长图",
    qs_upload_product: "📤 上传产品图",
    qs_upload_product_sub: "拖入或选择本地产品图，立即可套图/拆图/局改",
    // 触发套图/详情页时若画布没有可用产品图 → 引导先上传
    need_product_first: "请先上传一张产品图，再一键生成整套",
    // 上传后主动建议（P0-3c）
    suggest_after_upload_title: "产品图已就绪 🎉 要不要一键生成整套？",
    suggest_main6: "生成主图六联",
    suggest_detail7: "生成详情页七段",
    suggest_dismiss: "先不用",

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
    // P1-C：ask_user 带选项时的提示（之前缺 key，界面裸奔显示 "click_or_reply"）
    click_or_reply: "点选一项，或直接回复",
    // P1-C：tool_call ETA 展示（函数 key——调用处按 t("eta_about", 秒数) 传参）
    eta_about: (s) => `约 ${s} 秒`,
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
    set_generate_failed: "套图生成失败",
    set_generate_failed_msg: "❌ 套图生成失败",
    split_failed: "AI 拆图失败",
    split_failed_msg: "❌ AI 拆图失败",
    // H1 历史加载失败三态：网络抖动时别静默降级成「全新会话」误弹新手引导
    history_load_failed: "历史消息加载失败",
    history_load_retry: "重试加载",
    // M9 多选时禁用 AI 拆图：拆图只能作用于一张，避免拆错扣费
    ai_split_need_one: "拆图请只选一张图片",
    plan_expired: "该计划已失效（可能已处理、超时或被取消），如需可重新发起。",
    set_user_msg: (label, n) => `🎨 套图：${label}（${n} 张统一风格）`,
    split_user_msg: (label) => `✂️ 帮我把这张图拆成可编辑的图层`,
    next_steps: "接下来可以",
    plan_auto_low: (total, limit) => `小额任务（${total} 积分）已自动开工，无需确认`,
    // P1-C：极速模式自动批准的计划卡说明（之前缺 key，界面裸奔显示 "plan_auto_express"）
    plan_auto_express: "极速模式已开，自动执行",
    // P1-C：下一步建议 chips 里最后一张图无 asset_label 时的兜底称呼
    chip_this_image: "这张图",
    // P3：发送失败别把 axios 英文 err.message 塞进气泡——收敛成人话
    send_failed_msg: "发送失败，请重试",
    chip_make_set: "🛍 做成整套物料",
    chip_make_set_prompt: (label) => `基于刚生成的这张图，做一套配套的电商物料（主图+海报+详情头图），风格保持一致`,
    chip_swap_bg: "🎨 换个背景试试",
    chip_swap_bg_prompt: (label) => `把刚生成的这张图换一个不同氛围的背景，主体保持不变`,
    chip_add_badge: "🏷 加促销角标",
    chip_add_badge_prompt: (label) => `给刚生成的这张图加上促销角标和利益点文案，排版自然`,
    chip_stitch_detail: "🧵 拼成详情长图",
    chip_stitch_detail_prompt: () => `把这套图按顺序拼成一张电商详情长图`,
    chip_edit_copy: "✏️ 改文案再出一版",
    chip_edit_copy_prompt: () => `保持这套图的版式和风格，换一组新的标题文案再出一版`,

    // ── 事件动作文案（tool pills）──────────────────────────────────
    tool_generate_image: "正在绘制画面",
    tool_edit_image: "正在处理画面",
    tool_enhance_image: "正在提升画质",
    tool_generate_video: "正在生成视频",
    tool_image_to_video: "正在让图片动起来",
    tool_edit_video: "正在处理视频",
    tool_lipsync_video: "正在对口型",
    tool_concat_videos: "正在拼接视频",
    tool_generate_audio: "正在生成音频",
    tool_extract_text: "正在识别文字",
    tool_upload_file: "正在上传",
    tool_ask_user: "等你确认",
    tool_processing: "正在处理",
    done_text_extracted: "文字已识别",
    done_video: "视频已生成",
    done_subject: "主体已抠出",
    done_bg: "背景已生成",
    done_image: "画面已生成",
    step_skipped: "这一步没成功，已自动跳过",

    // ── 极速模式 ───────────────────────────────────────────────────
    express_on: "极速模式：开（计划自动批准）",
    express_off: "极速模式：关（需手动确认计划）",
    send: "发送",

    // ── 计划卡（PlanVisualizer）────────────────────────────────────
    plan_about_to_make: "即将为你制作",
    credits_unit: "积分",
    steps_unit: (n) => `${n} 步`,
    node_processing: "处理中",
    // 逐条预览：把每步的工具类型翻成人话（key = plan_tool_<tool>，与后端 tool 名对齐）
    plan_tool_generate_image: "全新绘制一张图",
    plan_tool_edit_image: "在现有素材上修改",
    plan_tool_generate_video: "生成短视频",
    plan_tool_cutout_layer: "抠出主体图层",
    plan_tool_compose_subject: "锁定主体、合成新背景",
    plan_tool_extract_text: "识别图中文字",
    plan_tool_default: "AI 处理",
    plan_seconds_unit: (s) => `${s} 秒`,
    plan_after_steps: (steps) => `衔接第 ${steps} 步`,
    // M8：依赖成环/缺失时兜底渲染的节点标注
    plan_dep_anomaly: "依赖异常",

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

    // 本地图上传注册（P0-3a）：拖入/粘贴本地图 → 走上传管线注册成后端资产
    registering_upload: "正在上传并注册产品图…",
    upload_registered: "已注册产品图，可套图 / 拆图 / 局部编辑",
    upload_register_failed: "上传注册失败：已落图但套图/拆图/局改暂不可用",

    // 画布空态起点（P0-4）
    empty_canvas_title: "从一张产品图开始",
    empty_canvas_desc: "上传你的产品图，一键生成整套电商主图或详情页；也可以直接描述需求让 AI 来做。",
    empty_upload_product: "上传产品图",
    empty_main6: "主图六联",
    empty_detail7: "详情页七段",
    empty_describe: "描述需求",

    // 局部编辑（蒙版）。按钮已并入底部主操作条（自带 FiEdit3 图标，故去掉 emoji）
    edit_region: "局部编辑",
    edit_region_title: "涂抹选区，AI 只重画这一块（改文字/换元素/修瑕疵）",
    edit_region_need_one: "局部编辑一次只能改一张图：请只选中一张",
    edit_region_need_asset: "这张图还没注册成资产（上传或 AI 生成的图才能局部编辑）",
    paint_area: "涂抹要修改的区域",
    brush: "笔刷",
    clear: "清除",
    region_prompt_placeholder: "描述这块区域要怎么改，如：把文字改成「限时 8 折」",
    apply_credits: (cr) => `应用 · ${cr} 积分`,
    mask_hint: "涂抹要修改的区域 · ESC 取消 · 涂完点应用",

    // ── 画布浮动操作条 / 添加文字 / 套图面板（CanvasArea）──────────────
    add_text: "添加文字",
    add_text_title: "在图上叠加文字（导出精确不糊）",
    set_template: "套图模板",
    set_template_title: "选多张图，套用统一的固定排版模板",
    selected_count: (n) => `已选 ${n} 张`,
    align_left: "左对齐",
    align_center_h: "水平居中",
    align_right: "右对齐",
    align_top: "顶对齐",
    align_middle_v: "垂直居中",
    align_bottom: "底对齐",
    distribute_h: "水平等距",
    distribute_v: "垂直等距",
    set_generate: "套图生成",
    stitch_long: "拼长图",
    stitching: "拼接中…",
    stitch_title: "把选中的图按上下顺序拼成一张详情页长图导出（需选 ≥2 张）",
    export_psd: "导出 PSD",
    exporting_psd: "导出中…",
    export_psd_title: "导出分层 PSD：每张图一层、每段文字一层（PS/Photopea 可继续编辑）",
    ai_split: "AI 拆分",
    ai_split_title: "AI 拆图：把这张 AI 图拆成 背景层 + 主体层(透明)，可分别移动/导出分层",
    deselect: "取消选择",
    deselect_title: "取消当前选择",
    delete_title: "删除选中项",

    // 快捷键提示条
    hint_drag: "拖拽",
    hint_marquee: "框选",
    hint_shift_drag: "Shift+拖",
    hint_add_select: "加选",
    hint_space_drag: "空格+拖",
    hint_pan: "平移",
    hint_wheel: "滚轮",
    hint_cmd_wheel: "⌘+滚轮",
    hint_zoom: "缩放",
    hint_arrows: "方向键",
    hint_nudge: "微移",

    // 套图面板
    set_panel_title: "套图 · AI 统一风格生成",
    set_panel_desc: "选一批产品图，AI 按同一排版/字体/风格生成一组新图",
    set_mode_single_note: "🎨 AI 直出（好看优先）：一次渲染成整张设计图，光影融为一体、最好看 —— 但文字烤进画面、不可二次编辑。",
    set_mode_label: "出图方式（按需求选）：",
    set_mode_ai: "AI 融合版",
    set_mode_ai_hint: "一次渲染成整图 · 最融合 · 文字烤死不可编辑",
    set_mode_ai_scene: "只要最好看、以后不改字 → 选这个",
    set_mode_layered: "分层版",
    set_mode_layered_hint: "背景/产品/文字 三层原生分开 · 可改可导 PSD",
    set_mode_layered_scene: "要拿去 PS 精修 → 选这个",
    set_mode_editable: "可编辑版",
    set_mode_editable_hint: "干净底图 + 可编辑文字层 · 可改可换字体",
    set_mode_editable_scene: "以后可能改价格 / 文案 → 选这个",
    tag_beauty_first: "好看优先",
    tag_editable_first: "可编辑优先",
    no_images_on_canvas: "画布上还没有图片",
    set_footer_single: (n, cta) => `已选 ${n} 张 · 用第 1 张产品图，${cta}`,
    set_footer_multi: (n) => `已选 ${n} 张 · 排版/字体/风格统一，每张消耗积分`,
    set_cta_single: (cta, count) => `${cta}（${count} 张）`,
    set_cta_multi: (n) => `生成套图（${n} 张）`,
    // 出图前的积分预估（前端估算值，恒带 ≈；真实扣费以后端逐节点计价为准）
    set_estimated_cost: (n) => `预计消耗 ≈ ${n} 积分`,

    // 文字样式面板
    font_title: "字体（Google Fonts 免费字体）",
    text_stroke: "描边",
    text_shadow: "阴影",

    // 文字预设（TEXT_PRESETS label）
    preset_title: "大标题",
    preset_price: "价格",
    preset_badge: "促销角标",
    preset_body: "正文",

    // 套图模板（SET_TEMPLATES label/desc/cta）
    tpl_main6: "电商主图六联",
    tpl_main6_desc: "选 1 张产品图 → AI 出 6 张（白底/卖点/风味/工艺/场景/参数）",
    tpl_main6_cta: "生成主图六联",
    tpl_detail7: "电商详情页七段",
    tpl_detail7_desc: "选 1 张产品图 → AI 出 7 段暗调详情页（封面/参数/风味/工艺/产区/餐配/规格）",
    tpl_detail7_cta: "生成详情页七段",
    tpl_social5: "社媒封面五联",
    tpl_social5_desc: "选 1 张图 → 小红书·微博·公众号·X·YouTube 各 1 张",
    tpl_social5_cta: "社媒封面",
    set_pick_on_canvas: "请先在画布上点选或框选图片，再打开套图生成",
    tidy_canvas: "一键整理",
    tidy_canvas_title: "全部图片按网格整齐排列（统一尺寸，文字层跟随）",
    tpl_ecom: "电商主图",
    tpl_ecom_desc: "白底影棚 · 标题居中 · 三条卖点",
    tpl_rednote: "小红书封面",
    tpl_rednote_desc: "生活场景 · 大标题 · 竖版 3:4",
    tpl_minimal: "极简画册",
    tpl_minimal_desc: "纯净留白 · 单标题 · 编辑感",

    // Toast（CanvasArea）
    stitch_need_two: "请至少选择 2 张图",
    stitch_done: (n, w, h) => `已拼接 ${n} 段 → 长图 ${w}×${h}`,
    stitch_failed: "拼图失败（可能是图片跨域）。可右键单张另存后再拼。",
    long_image_filename: (w, h) => `详情页长图_${w}x${h}.jpg`,
    psd_no_images: "画布上没有图片可导出",
    psd_invalid_region: "导出区域无效",
    psd_done: (layers, groups) => `已导出分层 PSD（${layers} 层 / ${groups} 组）`,
    psd_failed: (msg) => `PSD 导出失败：${msg}`,
    text_blocks_done: (n) => `已生成 ${n} 条可编辑文案`,
    set_need_labeled: "请选择带标签的生成图（上传的本地图暂不支持）",

    // 清空画布确认 toast
    clear_canvas_confirm: "确定要清空整个画布吗？",
    confirm: "确定",

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
    // Session sidebar tri-state (P0-5)
    sessions_loading: "Loading sessions…",
    sessions_error: "Failed to load sessions",
    retry: "Retry",
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
    // First-class shortcuts: jump straight into the set / detail-page flow
    qs_main6: "🖼️ 6-shot hero set",
    qs_detail7: "📄 7-panel detail page",
    qs_main6_sub: "Upload a product photo → AI makes 6 hero shots",
    qs_detail7_sub: "Upload a product photo → AI makes a 7-panel detail page",
    qs_upload_product: "📤 Upload product photo",
    qs_upload_product_sub: "Drop or pick a local product photo — ready to set / split / edit",
    need_product_first: "Please upload a product photo first, then generate the whole set",
    suggest_after_upload_title: "Product photo ready 🎉 Generate a whole set?",
    suggest_main6: "Generate 6-shot set",
    suggest_detail7: "Generate 7-panel page",
    suggest_dismiss: "Not now",

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
    // P1-C: ask_user hint when choices are present (key was missing — UI showed the raw key)
    click_or_reply: "Pick one, or just reply",
    // P1-C: tool_call ETA (function key — called as t("eta_about", seconds))
    eta_about: (s) => `~${s}s`,
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
    restore_failed: "Restore failed",
    // （顺手修）此前 canvas_deleted 在 en 字典里重复声明了两次，保留一份
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
    set_generate_failed: "Batch generation failed",
    set_generate_failed_msg: "❌ Batch generation failed",
    split_failed: "AI split failed",
    split_failed_msg: "❌ AI split failed",
    // H1 history-load error triad: don't silently fall back to a "brand new session" on a network blip
    history_load_failed: "Failed to load message history",
    history_load_retry: "Retry",
    // M9 disable AI split on multi-select: split works on exactly one image, avoids splitting the wrong one (billed)
    ai_split_need_one: "Select just one image to split",
    plan_expired: "This plan is no longer valid (it may have been handled, timed out, or cancelled). Start a new one if needed.",
    set_user_msg: (label, n) => `🎨 Batch: ${label} (${n} images, unified style)`,
    split_user_msg: (label) => `✂️ Split this image into editable layers`,
    next_steps: "Next you can",
    plan_auto_low: (total, limit) => `Small task (${total} credits) started automatically`,
    // P1-C: express-mode auto-approval note on the plan card (key was missing)
    plan_auto_express: "Express mode on — running automatically",
    // P1-C: fallback label for next-step chips when the last image has no asset_label
    chip_this_image: "this image",
    // P3: human-readable send failure (instead of raw axios err.message in the bubble)
    send_failed_msg: "Failed to send — please try again",
    chip_make_set: "🛍 Build a full set",
    chip_make_set_prompt: (label) => `Based on the image just generated, create a matching e-commerce set (hero + poster + detail header) in the same style`,
    chip_swap_bg: "🎨 Try another background",
    chip_swap_bg_prompt: (label) => `Give the image just generated a different background mood, keep the subject unchanged`,
    chip_add_badge: "🏷 Add a promo badge",
    chip_add_badge_prompt: (label) => `Add a promo badge and selling-point copy to the image just generated, naturally composed`,
    chip_stitch_detail: "🧵 Stitch into detail page",
    chip_stitch_detail_prompt: () => `Stitch this set into one long e-commerce detail image in order`,
    chip_edit_copy: "✏️ New copy, same layout",
    chip_edit_copy_prompt: () => `Keep the layout and style of this set, regenerate with a fresh set of titles`,

    // ── Event action labels (tool pills) ──────────────────────────
    tool_generate_image: "Painting the image",
    tool_edit_image: "Editing the image",
    tool_enhance_image: "Upscaling quality",
    tool_generate_video: "Generating video",
    tool_image_to_video: "Bringing the image to life",
    tool_edit_video: "Editing video",
    tool_lipsync_video: "Lip-syncing",
    tool_concat_videos: "Stitching videos",
    tool_generate_audio: "Generating audio",
    tool_extract_text: "Recognizing text",
    tool_upload_file: "Uploading",
    tool_ask_user: "Awaiting your input",
    tool_processing: "Working on it",
    done_text_extracted: "Text recognized",
    done_video: "Video generated",
    done_subject: "Subject extracted",
    done_bg: "Background generated",
    done_image: "Image generated",
    step_skipped: "This step didn't succeed and was skipped",

    // ── Express mode ──────────────────────────────────────────────
    express_on: "Express mode: on (plans auto-approved)",
    express_off: "Express mode: off (plans need manual approval)",
    send: "Send",

    // ── Plan card (PlanVisualizer) ────────────────────────────────
    plan_about_to_make: "About to create",
    credits_unit: "credits",
    steps_unit: (n) => `${n} steps`,
    node_processing: "Processing",
    // Per-node preview: human wording per tool (key = plan_tool_<tool>, matches backend tool names)
    plan_tool_generate_image: "Paint a brand-new image",
    plan_tool_edit_image: "Edit an existing asset",
    plan_tool_generate_video: "Generate a short video",
    plan_tool_cutout_layer: "Cut out the subject layer",
    plan_tool_compose_subject: "Lock subject, compose a new background",
    plan_tool_extract_text: "Recognize text in the image",
    plan_tool_default: "AI processing",
    plan_seconds_unit: (s) => `${s}s`,
    plan_after_steps: (steps) => `after step ${steps}`,
    // M8: label for nodes rendered via the cycle/missing-dependency fallback
    plan_dep_anomaly: "dependency issue",

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

    // Local image upload registration (P0-3a)
    registering_upload: "Uploading and registering product photo…",
    upload_registered: "Product photo registered — set / split / region-edit ready",
    upload_register_failed: "Registration failed: placed on canvas, but set/split/region-edit unavailable",

    // Empty canvas starting point (P0-4)
    empty_canvas_title: "Start with a product photo",
    empty_canvas_desc: "Upload your product photo to generate a full e-commerce hero set or detail page in one click — or just describe what you need.",
    empty_upload_product: "Upload product photo",
    empty_main6: "6-shot hero set",
    empty_detail7: "7-panel detail page",
    empty_describe: "Describe it",

    // Region edit (mask). Button now lives in the bottom action bar (FiEdit3 icon, no emoji)
    edit_region: "Edit region",
    edit_region_title: "Paint a region; AI redraws only that area (fix text / swap elements / retouch)",
    edit_region_need_one: "Region edit works on one image at a time — select just one",
    edit_region_need_asset: "This image isn't registered as an asset yet (only uploaded or AI-generated images can be region-edited)",
    paint_area: "Paint over the area to edit",
    brush: "Brush",
    clear: "Clear",
    region_prompt_placeholder: 'Describe how this area should change, e.g. change the text to "20% off today"',
    apply_credits: (cr) => `Apply · ${cr} credits`,
    mask_hint: "Paint over the area to edit · ESC to cancel · Apply when done",

    // ── Canvas floating action bar / add text / set panel ─────────
    add_text: "Add text",
    add_text_title: "Overlay text on the image (exports crisp, not blurry)",
    set_template: "Batch template",
    set_template_title: "Select multiple images and apply one unified layout template",
    selected_count: (n) => `${n} selected`,
    align_left: "Align left",
    align_center_h: "Align horizontal centers",
    align_right: "Align right",
    align_top: "Align top",
    align_middle_v: "Align vertical centers",
    align_bottom: "Align bottom",
    distribute_h: "Distribute horizontally",
    distribute_v: "Distribute vertically",
    set_generate: "Batch generate",
    stitch_long: "Stitch tall",
    stitching: "Stitching…",
    stitch_title: "Stitch selected images top-to-bottom into one tall detail image (need ≥2)",
    export_psd: "Export PSD",
    exporting_psd: "Exporting…",
    export_psd_title: "Export layered PSD: one layer per image, one per text (editable in PS/Photopea)",
    ai_split: "AI split",
    ai_split_title: "AI split: break this AI image into background + subject (transparent) layers, movable/exportable separately",
    deselect: "Deselect",
    deselect_title: "Clear current selection",
    delete_title: "Delete selected",

    // Shortcut hint bar
    hint_drag: "Drag",
    hint_marquee: "marquee",
    hint_shift_drag: "Shift+drag",
    hint_add_select: "add to selection",
    hint_space_drag: "Space+drag",
    hint_pan: "pan",
    hint_wheel: "Scroll",
    hint_cmd_wheel: "⌘+scroll",
    hint_zoom: "zoom",
    hint_arrows: "Arrows",
    hint_nudge: "nudge",

    // Set panel
    set_panel_title: "Batch · AI unified-style generation",
    set_panel_desc: "Pick a batch of product images; AI generates a set with one layout/font/style",
    set_mode_single_note: "🎨 AI direct (beauty first): rendered as one full design in a single pass — most cohesive lighting, best looking — but text is baked in and not re-editable.",
    set_mode_label: "Output mode (choose by need):",
    set_mode_ai: "AI blended",
    set_mode_ai_hint: "Single-pass full render · most cohesive · text baked, not editable",
    set_mode_ai_scene: "Just want the best look, won't change text later → pick this",
    set_mode_layered: "Layered",
    set_mode_layered_hint: "Background/product/text natively separated · editable, PSD-exportable",
    set_mode_layered_scene: "Planning to fine-tune in Photoshop → pick this",
    set_mode_editable: "Editable",
    set_mode_editable_hint: "Clean base image + editable text layer · edit text and swap fonts",
    set_mode_editable_scene: "Might change the price or copy later → pick this",
    tag_beauty_first: "Beauty first",
    tag_editable_first: "Editable first",
    no_images_on_canvas: "No images on the canvas yet",
    set_footer_single: (n, cta) => `${n} selected · using the 1st product image, ${cta}`,
    set_footer_multi: (n) => `${n} selected · unified layout/font/style, credits charged per image`,
    set_cta_single: (cta, count) => `${cta} (${count})`,
    set_cta_multi: (n) => `Generate set (${n})`,
    // Pre-generation credit estimate (frontend approximation, always shown with ≈)
    set_estimated_cost: (n) => `Est. cost ≈ ${n} credits`,

    // Text style panel
    font_title: "Font (free Google Fonts)",
    text_stroke: "Stroke",
    text_shadow: "Shadow",

    // Text presets (TEXT_PRESETS label)
    preset_title: "Heading",
    preset_price: "Price",
    preset_badge: "Promo badge",
    preset_body: "Body",

    // Set templates (SET_TEMPLATES label/desc/cta)
    tpl_main6: "6-shot hero set",
    tpl_main6_desc: "Pick 1 product image → AI makes 6 (white bg / selling points / flavor / craft / scene / specs)",
    tpl_main6_cta: "Generate 6-shot set",
    tpl_detail7: "7-panel detail page",
    tpl_detail7_desc: "Pick 1 product image → AI makes a 7-panel dark detail page (cover / specs / flavor / craft / origin / pairing / specs)",
    tpl_detail7_cta: "Generate 7-panel page",
    tpl_social5: "Social covers ×5",
    tpl_social5_desc: "1 image → RED · Weibo · WeChat · X · YouTube covers",
    tpl_social5_cta: "Social covers",
    set_pick_on_canvas: "Select image(s) on the canvas first, then open Set Generate",
    tidy_canvas: "Tidy up",
    tidy_canvas_title: "Arrange all images into a clean grid (uniform size, text layers follow)",
    tpl_ecom: "E-commerce hero",
    tpl_ecom_desc: "White studio · centered title · three selling points",
    tpl_rednote: "Social cover",
    tpl_rednote_desc: "Lifestyle scene · big title · portrait 3:4",
    tpl_minimal: "Minimal album",
    tpl_minimal_desc: "Clean whitespace · single title · editorial",

    // Toasts (CanvasArea)
    stitch_need_two: "Please select at least 2 images",
    stitch_done: (n, w, h) => `Stitched ${n} segments → tall image ${w}×${h}`,
    stitch_failed: "Stitch failed (images may be cross-origin). Save individual images via right-click, then stitch.",
    long_image_filename: (w, h) => `detail_page_${w}x${h}.jpg`,
    psd_no_images: "No images on the canvas to export",
    psd_invalid_region: "Invalid export region",
    psd_done: (layers, groups) => `Exported layered PSD (${layers} layers / ${groups} groups)`,
    psd_failed: (msg) => `PSD export failed: ${msg}`,
    text_blocks_done: (n) => `Generated ${n} editable text block${n > 1 ? "s" : ""}`,
    set_need_labeled: "Please select generated images with labels (local uploads not supported yet)",

    // Clear canvas confirm toast
    clear_canvas_confirm: "Clear the entire canvas?",
    confirm: "Confirm",

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
