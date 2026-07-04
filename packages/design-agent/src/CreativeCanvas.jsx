"use client";

import React, { useState, useEffect, useRef, useCallback, Suspense, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import axios from "axios";
import {
  FiSend, FiImage, FiTerminal, FiSearch,
  FiZap, FiLayout, FiUpload,
  FiPlus, FiSun, FiMoon, FiCheck, FiX, FiEdit2,
  FiArrowLeft, FiAlertCircle, FiCopy,
} from "react-icons/fi";
import { CgTerminal } from "react-icons/cg";
import { BiLoaderAlt } from "react-icons/bi";
import { RiRobot2Line, RiSparklingLine } from "react-icons/ri";
// import { useUser } from "@/context/UserContext";
import { useTheme } from "next-themes";
import dynamic from "next/dynamic";
import toast, { Toaster } from "react-hot-toast";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import PlanVisualizer from "./components/PlanVisualizer";
import { t } from "./i18n";
import Link from "next/link";
import { GoBook } from "react-icons/go";
import { VscLayoutSidebarLeftOff } from "react-icons/vsc";

const CanvasArea = dynamic(() => import("./CanvasArea"), { ssr: false });
const SyntaxHighlighter = dynamic(
  () => import('react-syntax-highlighter').then((mod) => mod.Prism),
  { ssr: false }
);
import { oneLight, oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { HiOutlineArrowUpTray, HiOutlineTrash } from "react-icons/hi2";
import Image from "next/image";


const API = "/api/v1/creative-agent";

// P1-1.1 审批默认反转的阈值（积分）。
// 心智反转：自主 agent 不该每单都伸手要「批准」——那是把 agent 变成要人陪跑的表单。
// 低消耗计划（≤ 此值）默认直接开跑，只有大额消耗才值得打断用户确认一次。
// 取 30 ≈ 单张图生成/小修小改的量级：误批的最大损失可控（一张图的钱）；
// 而主图六联、详情页七段这类批量任务的总消耗通常远超此值，仍会走人工确认。
const AUTO_APPROVE_UNDER = 30;

const formatTime = (dateStr) => {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const formatDateHeader = (dateStr) => {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return t("today");
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return t("yesterday");
  return d.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
};

const TypingDots = () => (
  <div className="typing-dots py-1.5 px-1">
    <span></span>
    <span></span>
    <span></span>
  </div>
);

export default function CreativeCanvas({
  user,
  theme: forcedTheme,
  setTheme: forcedSetTheme,
  creditConversionRate = 200,
  // Embed-mode props (set by the /embed/agent/[id] page).
  // When embedCode is truthy, the component:
  //   1. Sends `x-agent-embed-code: <code>` instead of a Bearer token.
  //   2. Tracks session_id in localStorage instead of the URL query string
  //      (the iframe URL stays at /embed/agent/<code>).
  //   3. Hides owner-only UI (sessions sidebar, profile menu, / links).
  embedCode = null,
  isEmbed = false,
  // Platform customization props:
  // navLinks: array of { icon, label, path } to show in the user dropdown menu.
  // If not provided, defaults to the built-in links.
  navLinks = null,
  // userBalanceLabel: string like "1200 credits" / "1200 积分" to show in the dropdown.
  // If not provided, falls back to "{user.balance} 积分/credits" (currency unit unified — no "$").
  userBalanceLabel = null,
  // onBalanceChange: 余额可能变化时回调（审批扣费/任务结束/失败退还），宿主用来刷新余额显示
  onBalanceChange = null,
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inEmbedMode = isEmbed && !!embedCode;
  const embedStorageKey = inEmbedMode ? `picsmith_agent_session_${embedCode}` : null;
  const [embedSessionId, setEmbedSessionId] = useState(() => {
    if (typeof window === "undefined" || !embedStorageKey) return null;
    return window.localStorage.getItem(embedStorageKey) || null;
  });
  const sessionId = inEmbedMode ? embedSessionId : searchParams.get("session");

  const [input, setInput] = useState("");
  const [messages, setMessages] = useState([]);
  // H1 历史加载三态：loading / ready / error。
  // why：旧逻辑 loadHistory 的 catch 把 messages 重置成只有「会话已就绪」问候，
  // 与真空会话同形 → 老会话遇网络抖动就误判「全新会话」、弹出快速开始卡 + 画布起点卡，
  // 让用户以为历史丢了、还被当新用户引导。三态把「加载失败」与「真的是空会话」区分开。
  const [historyStatus, setHistoryStatus] = useState("ready");
  const [assets, setAssets] = useState([]);
  const [activeTasks, setActiveTasks] = useState([]);
  const [busy, setBusy] = useState(false);
  const [openProfile, setOpenProfile] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [attachments, setAttachments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const [sessions, setSessions] = useState([]);
  // 会话列表三态（P0-5）：loading / ready / error(带重试)。别把网络错误当「暂无历史会话」。
  const [sessionsStatus, setSessionsStatus] = useState("loading");
  // 上传产品图后的主动建议卡（P0-3c）：{ assetLabel } 或 null
  const [uploadSuggestion, setUploadSuggestion] = useState(null);
  const [currentSessionName, setCurrentSessionName] = useState(t("creative_canvas"));
  const [isEditingName, setIsEditingName] = useState(false);
  const [newName, setNewName] = useState("");
  const [showSessions, setShowSessions] = useState(false);
  const [skills, setSkills] = useState([]);
  const [activeSkill, setActiveSkill] = useState(null);
  const [showSkillsMenu, setShowSkillsMenu] = useState(false);
  const [showAssetsMenu, setShowAssetsMenu] = useState(false);
  // 极速模式：计划一到自动批准、跳过手动确认卡（简单需求直出）。持久化在 localStorage
  const [expressMode, setExpressMode] = useState(false);
  const [showMentionPopup, setShowMentionPopup] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionCursorPos, setMentionCursorPos] = useState(0);
  const [hoveredAsset, setHoveredAsset] = useState(null);

  // Left Sidebar and Session Management
  const [showLeftSidebar, setShowLeftSidebar] = useState(true);
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editingSessionName, setEditingSessionName] = useState("");
  const [hoveredSessionId, setHoveredSessionId] = useState(null);

  // Layout resizing
  const [sidebarWidth, setSidebarWidth] = useState(350);
  const [showChat, setShowChat] = useState(true);
  const [prevWidth, setPrevWidth] = useState(350);
  const isResizing = useRef(false);

  const handleToggleSidebar = () => {
    if (showChat) {
      setPrevWidth(sidebarWidth);
      setSidebarWidth(0);
      setShowChat(false);
    } else {
      setSidebarWidth(prevWidth || 350);
      setShowChat(true);
    }
  };

  // Theme handling: Use props if provided, otherwise fallback to useTheme hook
  const { setTheme: nextSetTheme, resolvedTheme: nextResolvedTheme } = useTheme();
  const resolvedTheme = forcedTheme || nextResolvedTheme;
  const setTheme = forcedSetTheme || nextSetTheme;
  const [mounted, setMounted] = useState(false);

  const canvasRef = useRef(null);
  const chatEndRef = useRef(null);
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const syncedUrlsRef = useRef(new Set());
  const justCreatedSessionRef = useRef(false);
  // 发送进行中标记：阻止异步 loadHistory 用空历史覆盖刚写入的消息（H1 根因之一）
  const sendingRef = useRef(false);
  // 会话首次加载后把镜头对准内容（zoom-to-fit），后续生成不抢镜头
  const initialFitDoneRef = useRef(false);
  const initialHandoffProcessed = useRef(false);
  const autoApprovedRef = useRef(new Set()); // 已自动批准过的 job（极速/低消耗共用），防重复批准
  // P1-5.2 失败可重试：记住最近一条用户指令原文（不含附件注记），失败 pill 一键重发
  const lastUserMsgRef = useRef("");
  const mountedRef = useRef(true);           // 卸载后停止后台轮询
  const sessionIdRef = useRef(sessionId);    // 切会话时让旧轮询自停，防串会话/锁死输入
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => () => { mountedRef.current = false; }, []);

  // 极速开关持久化：初始读取 + 写回（localStorage 是自动批准判断的事实来源，避免闭包过期）
  useEffect(() => {
    if (typeof localStorage !== "undefined") setExpressMode(localStorage.getItem("picsmith_express") === "1");
  }, []);
  const toggleExpress = () => {
    setExpressMode((v) => {
      const next = !v;
      if (typeof localStorage !== "undefined") localStorage.setItem("picsmith_express", next ? "1" : "0");
      return next;
    });
  };

  const getHeaders = useCallback(() => {
    if (inEmbedMode) {
      return { "x-agent-embed-code": embedCode };
    }
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [inEmbedMode, embedCode]);

  // Persist embed session_id across page reloads so the conversation resumes.
  const setActiveEmbedSession = useCallback((id) => {
    setEmbedSessionId(id);
    if (typeof window !== "undefined" && embedStorageKey) {
      if (id) window.localStorage.setItem(embedStorageKey, id);
      else window.localStorage.removeItem(embedStorageKey);
    }
  }, [embedStorageKey]);

  // Initialize
  useEffect(() => {
    setMounted(true);
    // In embed mode there's no concept of "switch to another session" — the
    // visitor only ever sees the one keyed by their localStorage. Skip the
    // sessions list fetch (which would also 403-on-allowed-origins or surface
    // sessions from other embeds spawned by the same owner).
    if (!inEmbedMode) fetchSessions();
    fetchSkills();
  }, []);

  // Handle initial query and skill from URL (Fallback only)
  useEffect(() => {
    if (!mounted || busy || initialHandoffProcessed.current) return;
    // Embed pages never have a / handoff URL — skip.
    if (inEmbedMode) {
      initialHandoffProcessed.current = true;
      return;
    }

    const q = searchParams.get("q");
    const skillName = searchParams.get("skill");
    const a = searchParams.get("a");

    if (!q && !skillName && !a) {
      initialHandoffProcessed.current = true;
      return;
    }

    // We only process URL parameters if the session is brand new AND history has loaded as empty or default.
    // Since the Dashboard now sends the message, this useEffect will typically see the user message in history
    // and correctly skip sending q again.
    const isNewSession = messages.length === 1 && messages[0].role === "assistant";
    
    if (isNewSession) {
      initialHandoffProcessed.current = true;

      let initialAtts = null;
      if (a) {
        initialAtts = a.split(",").map(label => ({ asset_label: label, kind: "image" }));
      }

      if (skillName && !activeSkill) {
        const found = skills.find(s => s.name === skillName);
        if (found) {
          setActiveSkill(found);
          if (q) {
            setTimeout(() => sendMessage(q, found, initialAtts), 10);
          }
        }
      } else if (q) {
        sendMessage(q, null, initialAtts);
      }

      // Cleanup URL once processed
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.delete("q");
      newParams.delete("skill");
      newParams.delete("a");
      router.replace(`?${newParams.toString()}`, { scroll: false });
    } else if (messages.length > 1 || (messages.length === 1 && messages[0].role === "user")) {
      // If history already has messages, we consider the handoff "processed" by the backend.
      initialHandoffProcessed.current = true;
      
      const newParams = new URLSearchParams(searchParams.toString());
      newParams.delete("q");
      newParams.delete("skill");
      newParams.delete("a");
      router.replace(`?${newParams.toString()}`, { scroll: false });
    }
  }, [mounted, busy, messages, skills.length, searchParams]);

  useEffect(() => {
    if (justCreatedSessionRef.current) {
      // 新建会话路径（null → ?session=newid，由 ensureSession 触发）：
      // 此时可能正有一条消息在发送途中（sendMessage/套图/拆图先 ensureSession 再轮询），
      // 绝不能清画布/清消息，否则会丢掉正在发的内容。直接放行。
      justCreatedSessionRef.current = false;
      return;
    }
    // 走到这里 = 初次带 sessionId 挂载，或真正切到「另一个已存在会话」。
    // H2 命令式清画布：切会话只改 URL、CanvasArea 不重挂也没人清它的本地 state，
    // 旧会话的图会残留、来回切叠图翻倍。这里在真正切会话时命令画布重置。
    // （没走 key={sessionId} 重挂：那样会在新建会话 null→newid 的发送途中把 CanvasArea
    //  连同正在上传/落图的内容一起重挂丢掉——justCreatedSessionRef 短路的正是这条路径，
    //  而此处只对「真实切换」触发，故对新建流程零影响。）
    canvasRef.current?.resetCanvas?.();
    // Clear the sync-tracking set whenever the session changes so assets from
    // the new session are always painted to canvas (prevents stale URL leakage).
    syncedUrlsRef.current.clear();
    initialFitDoneRef.current = false;
    // M6/M7 跨会话残留清理：附件 chips、最近指令 ref、上传建议卡都归属旧会话，
    // 切会话必须清掉——否则新会话带着旧附件发送、或「重试」重发上个会话的指令。
    setAttachments([]);
    lastUserMsgRef.current = "";
    setUploadSuggestion(null);
    // M3：切会话时清掉旧会话遗留的画布占位 Loader（activeTasks），否则永久转圈。
    setActiveTasks([]);
    if (sessionId) {
      loadHistory();
      loadAssets();
      // Sync name if sessions are already loaded
      const current = sessions.find(s => s.id === sessionId);
      if (current) {
        setCurrentSessionName(current.name);
      } else {
        fetchSessions(); // Re-fetch to find the name if not in list
      }
    } else {
      setMessages([{ role: "assistant", content: t("welcome", user?.username || t("user")), timestamp: new Date().toISOString() }]);
      setHistoryStatus("ready"); // 真空新会话：非错误态，允许起点卡/快速开始卡正常出现
      setAssets([]);
      setCurrentSessionName(t("new_session"));
    }
  }, [sessionId]); // Removed sessions from deps to avoid infinite loop if fetchSessions updates sessions

  const fetchSessions = async () => {
    // 只有首次/空列表时进 loading 态；重新拉取（重命名/删除后）不清空已有列表避免闪烁
    setSessionsStatus((prev) => (sessions.length === 0 ? "loading" : prev));
    try {
      const { data } = await axios.get(`${API}/sessions`, { headers: getHeaders() });
      setSessions(data);
      setSessionsStatus("ready");
      if (sessionId) {
        const current = data.find(s => s.id === sessionId);
        if (current) setCurrentSessionName(current.name);
      }
    } catch {
      // 网络/鉴权失败 → error 态（带重试），而非静默显示「暂无历史会话」误导用户
      setSessionsStatus("error");
    }
  };

  const fetchSkills = async () => {
    try {
      const { data } = await axios.get(`${API}/agent-skills`, { headers: getHeaders() });
      setSkills(data);
    } catch (err) {
      console.error("Failed to fetch skills:", err);
    }
  };

  const processEvent = (ev, msgIdx) => {
    const p = ev.payload || {};

    // Canvas mutation events — apply directly to the live canvas, don't push
    // them into the chat transcript.
    if (ev.type === "canvas_op") {
      const op = p.op;
      const args = p.args || {};
      const c = canvasRef.current;
      if (!c) return;
      if (op === "move" && typeof c.moveNode === "function") {
        c.moveNode(args.asset_id, args.x, args.y);
      } else if (op === "arrange" && typeof c.arrangeNodes === "function") {
        c.arrangeNodes(args.moves || []);
      } else if (op === "add_texts" && typeof c.addTextLayers === "function") {
        c.addTextLayers(args.ref, args.texts || []);
      }
      return;
    }

    const flat = (() => {
      switch (ev.type) {
        case "text":         return { type: "text", content: p.content, assets: p.assets };
        case "info":         return { type: "info", content: p.content };
        case "error":        return { type: "error", message: p.message };
        case "tool_call":    return { type: "tool_call", name: p.name, args: p.args, est_seconds: p.est_seconds };
        case "tool_result":  return { type: "tool_result", name: p.name, result: p.result, asset: p.asset };
        case "plan_propose": return { type: "plan_propose", title: p.title, nodes: p.nodes, total_credits: p.total_credits };
        default:             return { type: ev.type, ...p };
      }
    })();
    if (!flat) return;
    flat.job_id = ev.job_id || p.job_id;

    // P1-1.1 审批默认反转（对标 Lovart 的自主感）：
    // 旧行为 = 每个计划都弹卡等人点「批准」，打断心流；
    // 新行为 = 低消耗计划（total_credits ≤ AUTO_APPROVE_UNDER）默认直接执行，
    //          只有大额消耗才打断用户确认一次。极速模式（用户显式开启）= 不看金额全自动。
    // 读 localStorage 而非闭包变量，避免轮询回调里拿到过期的 expressMode。
    if (
      flat.type === "plan_propose" &&
      (ev.approved === undefined || ev.approved === null) &&
      flat.job_id &&
      !autoApprovedRef.current.has(flat.job_id)
    ) {
      const expressOn = typeof localStorage !== "undefined" && localStorage.getItem("picsmith_express") === "1";
      // 消耗未知（后端没给数字）时不自动批 —— 未知成本必须人工把关
      const cheapPlan = typeof flat.total_credits === "number" && flat.total_credits <= AUTO_APPROVE_UNDER;
      if (expressOn || cheapPlan) {
        autoApprovedRef.current.add(flat.job_id); // 每个 job 只批一次，防轮询重放重复批准
        // 标记原因：计划卡仍然展示（用户能看到 agent 在做什么），但按钮换成一行自动执行说明
        flat.auto_approved = expressOn ? "express" : "low_cost";
        setTimeout(() => handleJobAction(flat.job_id, "approve", { silent: true }), 60);
      }
    }

    // If the job has already been approved or rejected, mark approval events as handled.
    if (ev.approved !== undefined && ev.approved !== null) {
      const isApproval = flat.type === "plan_propose" || (flat.type === "info" && (flat.content?.includes("approval") || flat.content?.includes("confirmation")));
      if (isApproval) {
        flat.handled = true;
      }
    }

    setMessages(prev => {
      const arr = [...prev];
      if (msgIdx < 0 || msgIdx >= arr.length) return arr;
      const m = { ...arr[msgIdx], events: [...(arr[msgIdx].events || [])] };
      if (m.events.find(e => e.id === ev.id)) return arr;
      
      // Update event and mark previous ones as handled if this is a result
      m.events.push({ ...flat, id: ev.id });
      if (flat.type === "text") {
        m.content = (m.content || "") + (flat.content || "");
        // 文档回执自带提取的图片清单 → 在消息内渲染可点击缩略图条（随消息持久化）
        if (Array.isArray(flat.assets) && flat.assets.length) m.docAssets = flat.assets;
      }
      
      // If this is an info-approval pill, hide it if we already have a plan for this job
      if (flat.type === "info" && (flat.content?.includes("approval") || flat.content?.includes("confirmation"))) {
        const hasPlan = m.events.some(e => e.job_id === flat.job_id && e.type === "plan_propose");
        if (hasPlan) flat.handled = true;
      }

      if (flat.type === "tool_result" || flat.type === "error") {
        m.events = m.events.map(e => 
          e.job_id === flat.job_id && (
            (e.type === "info" && (e.content?.includes("approval") || e.content?.includes("confirmation"))) ||
            (e.type === "plan_propose")
          )
            ? { ...e, handled: true }
            : e
        );
      }
      
      // If we just got a plan, hide any loose "Waiting for approval" pills for this job
      if (flat.type === "plan_propose") {
        m.events = m.events.map(e => 
          e.job_id === flat.job_id && e.type === "info" && (e.content?.includes("approval") || e.content?.includes("confirmation"))
            ? { ...e, handled: true }
            : e
        );
      }
      
      arr[msgIdx] = m;
      return arr;
    });

    if (flat.type === "tool_call" && ["generate_image", "generate_video", "image_to_video", "edit_image", "edit_video", "enhance_image"].includes(flat.name)) {
      // For edit-style tools, spawn the loader at the same spot the result
      // will land at — beside the source asset (32px to its right). The
      // source stays visible throughout. Keeps the loader and the final
      // asset position in sync — no visual jump on completion.
      //
      // generate_* (no source) keeps the default centre placement.
      let x, y;
      const a = flat.args || {};
      const srcLabel = a.image || a.video || a.audio || a.source_asset;
      if (srcLabel && typeof srcLabel === "string" && srcLabel.startsWith("asset_")) {
        try {
          const cs = canvasRef.current?.getCanvasState?.();
          const srcNode = cs?.nodes?.find(n => n.asset_id === srcLabel);
          if (srcNode) {
            x = srcNode.x + (srcNode.w || 200) + 32;
            y = srcNode.y;
          }
        } catch {}
      }
      setActiveTasks(prev => [...prev, {
        taskId: `task-${Date.now()}-${Math.random()}`,
        modelName: flat.name,
        // M3：记住 job_id，好让「以 error 事件(无 name)结束」的 job 也能定位到它的占位 Loader。
        job_id: flat.job_id,
        status: "processing",
        x, y,
      }]);
    }
    
    if (flat.type === "tool_result" || flat.type === "error") {
      setActiveTasks(prev => {
        // 优先按 name 配对（tool_result 带 name）；
        // M3：error 事件常无 name → 回落到「同 job_id 且仍 processing」的占位 Loader，
        // 否则 loader 会在 job 以 error 结束后永久转圈。
        let idx = flat.name ? prev.findIndex(t => t.modelName === flat.name) : -1;
        if (idx === -1 && flat.job_id) {
          idx = prev.findIndex(t => t.job_id === flat.job_id && t.status === "processing");
        }
        if (idx !== -1) {
          const next = [...prev];
          next.splice(idx, 1);
          return next;
        }
        return prev;
      });
      
      if (flat.asset) {
        setAssets(pa => {
          // Use a combination of label and url for reliable identification
          const idx = pa.findIndex(a =>
            (flat.asset.asset_label && a.asset_label === flat.asset.asset_label) ||
            (a.url === flat.asset.url)
          );
          if (idx !== -1) {
            const next = [...pa];
            next[idx] = { ...next[idx], ...flat.asset };
            return next;
          }
          return [...pa, flat.asset];
        });

        // Side-by-side placement: when a tool result carries source_asset_id,
        // drop the new asset just to the right of the source so both stay
        // visible. Source is preserved (the user can still see / branch
        // from it). Mark the new label-url as synced so the auto-sync
        // effect doesn't also drop it at canvas centre.
        const srcLabel = flat.result?.source_asset_id;
        const newLabel = flat.asset.asset_label;
        const newUrl = flat.asset.url;
        const newKind = flat.asset.kind || "image";
        const place = canvasRef.current?.placeNextToSource || canvasRef.current?.replaceAt;
        if (srcLabel && newLabel && newUrl && place) {
          place(srcLabel, newUrl, newKind, newLabel);
          syncedUrlsRef.current?.add?.(`${newLabel}-${newUrl}`);
        }
        // 智能拆解文字层：live 时 add_texts 已重建文字，标记 synced 防 asset-sync 重复 addTextLayers
        if (newKind === "text_layer" && newLabel) {
          syncedUrlsRef.current?.add?.(`${newLabel}-${newUrl || ""}`);
        }
      }
    }
  };

  const resumePolling = async (jobId, assistantIdx, pollSessionId = sessionId) => {
    let cursor = 0;
    const POLL_INTERVAL = 1200;
    const MAX_DEAD_AIR = 6 * 60 * 1000;
    let lastProgress = Date.now();

    setBusy(true);
    while (true) {
      // 卸载 / 切换会话 → 停止本轮询（否则旧 job 事件会灌进新会话、并锁死新会话输入）
      if (!mountedRef.current || sessionIdRef.current !== pollSessionId) return;
      try {
        const { data } = await axios.get(`${API}/jobs/${jobId}/events`, {
          params: { since: cursor },
          headers: getHeaders(),
        });
        if (data.events?.length) {
          data.events.forEach(ev => processEvent({ ...ev, approved: data.approved }, assistantIdx));
          cursor = data.cursor || cursor;
          lastProgress = Date.now();
        }
        if (data.done) break;
        if (Date.now() - lastProgress > MAX_DEAD_AIR) throw new Error("Stalled");
      } catch (err) {
        // 致命 4xx（job 不存在/无权）→ 立即退出，不再空转 6 分钟锁着输入框
        // M3：退出前清掉本 job 的占位 Loader，否则它会永久转圈（没有结果事件来消解）。
        if ([403, 404, 410].includes(err.response?.status)) {
          setActiveTasks(prev => prev.filter(t => t.job_id !== jobId));
          setBusy(false);
          return;
        }
        if (Date.now() - lastProgress > MAX_DEAD_AIR) {
          // 长时间无进展时不再静默退出：告知用户任务仍在后台，刷新可重连
          // M3：轮询超时也清本 job 的占位 Loader（任务转后台，前台不该再挂着转圈）。
          setActiveTasks(prev => prev.filter(t => t.job_id !== jobId));
          setMessages(prev => {
            const arr = [...prev];
            if (assistantIdx >= 0 && assistantIdx < arr.length) {
              const m = { ...arr[assistantIdx], events: [...(arr[assistantIdx].events || [])] };
              m.events.push({ id: `stall-${jobId}`, type: "info", job_id: jobId,
                content: t("still_running_bg") });
              arr[assistantIdx] = m;
            }
            return arr;
          });
          break;
        }
      }
      await new Promise(r => setTimeout(r, POLL_INTERVAL));
    }
    // 会话已切走 → 交给新会话管理，别复位它的 busy
    if (!mountedRef.current || sessionIdRef.current !== pollSessionId) return;
    setBusy(false);
    loadAssets();
    onBalanceChange?.();
    // Persist final state（用轮询启动时的 sessionId，避免新建会话时闭包里的 sessionId 为 null）
    setMessages(prev => {
      const next = [...prev];
      if (pollSessionId) {
        axios.patch(`${API}/sessions/${pollSessionId}/messages`, { messages: next }, { headers: getHeaders() }).catch(() => {});
      }
      return next;
    });
  };

  // 画布局部编辑：涂抹蒙版 + 指令 → 跳过审批直接执行（面板已展示消耗）
  // 套图：选中的产品图 + 模板 → 后端按统一约束批量 AI 生成一组风格一致的新图
  const handleSetTemplate = async ({ assetLabels, template, templateLabel, mode }) => {
    if (busy || sendingRef.current) {
      toast.error(t("another_task_running"));
      return;
    }
    sendingRef.current = true;
    setBusy(true);
    const userMsg = {
      role: "user",
      content: t("set_user_msg", templateLabel, assetLabels.length),
      timestamp: new Date().toISOString(),
    };
    let aIdx = -1;
    setMessages(prev => {
      aIdx = prev.length + 1;
      return [...prev, userMsg, { role: "assistant", content: "", events: [], timestamp: new Date().toISOString() }];
    });
    // H3：记住本操作启动时的会话，复位 busy/sendingRef 前比对，避免误复位「已切走的新会话」的 busy。
    let opSessionId = sessionIdRef.current;
    try {
      const activeSessionId = await ensureSession();
      opSessionId = activeSessionId;
      const { data } = await axios.post(
        `${API}/sessions/${activeSessionId}/set-template`,
        {
          template,
          asset_labels: assetLabels,
          mode,
          client_request_id:
            (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        },
        { headers: getHeaders() }
      );
      sendingRef.current = false;
      await resumePolling(data.job_id, aIdx, activeSessionId);
    } catch (err) {
      if (err.response?.status === 402) {
        toast((tt) => (
          <span className="flex items-center gap-3 text-[12px]">
            {err.response?.data?.detail || t("insufficient_credits")}
            <a href="/billing" className="px-2 py-1 bg-white text-black rounded-sm text-[10px] font-bold uppercase tracking-wider shrink-0" onClick={() => toast.dismiss(tt.id)}>
              {t("top_up")}
            </a>
          </span>
        ), { duration: 8000 });
      } else {
        toast.error(err.response?.data?.detail || t("set_generate_failed"));
      }
      setMessages(prev => {
        const arr = [...prev];
        if (aIdx >= 0 && aIdx < arr.length) arr[aIdx] = { ...arr[aIdx], content: t("set_generate_failed_msg") };
        return arr;
      });
    } finally {
      // H3：无论成功/失败/中途异常都复位 busy，避免「进行中切会话→busy 卡死 true→新会话输入锁死」。
      // 仅当仍停在本操作的会话时才复位——切走了就交给新会话自己管理（不误清它的 busy）。
      if (sessionIdRef.current === opSessionId) {
        sendingRef.current = false;
        setBusy(false);
      }
    }
  };

  // P0-3b 一级入口：从聊天首屏直达套图/详情页流程。
  // 画布已有带 label 的产品图 → 直接开套图面板并预选该模板；否则引导先上传产品图。
  const startSetFlow = (template) => {
    const opened = canvasRef.current?.openSetPanel?.(template);
    if (!opened) {
      // 没有可用产品图：提示先上传，并弹出文件选择器降低门槛
      toast(t("need_product_first"));
      fileInputRef.current?.click();
    }
  };

  const handleSplitImage = async ({ assetLabel }) => {
    if (busy || sendingRef.current) {
      toast.error(t("another_task_running"));
      return;
    }
    sendingRef.current = true;
    setBusy(true);
    const userMsg = {
      role: "user",
      content: t("split_user_msg", assetLabel),
      timestamp: new Date().toISOString(),
    };
    let aIdx = -1;
    setMessages(prev => {
      aIdx = prev.length + 1;
      return [...prev, userMsg, { role: "assistant", content: "", events: [], timestamp: new Date().toISOString() }];
    });
    // H3：见 handleSetTemplate —— 记住启动会话，复位前比对，避免误清新会话 busy / 卡死输入。
    let opSessionId = sessionIdRef.current;
    try {
      const activeSessionId = await ensureSession();
      opSessionId = activeSessionId;
      const { data } = await axios.post(
        `${API}/sessions/${activeSessionId}/split-image`,
        {
          source_asset: assetLabel,
          client_request_id:
            (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        },
        { headers: getHeaders() }
      );
      sendingRef.current = false;
      await resumePolling(data.job_id, aIdx, activeSessionId);
    } catch (err) {
      if (err.response?.status === 402) {
        toast((tt) => (
          <span className="flex items-center gap-3 text-[12px]">
            {err.response?.data?.detail || t("insufficient_credits")}
            <a href="/billing" className="px-2 py-1 bg-white text-black rounded-sm text-[10px] font-bold uppercase tracking-wider shrink-0" onClick={() => toast.dismiss(tt.id)}>
              {t("top_up")}
            </a>
          </span>
        ), { duration: 8000 });
      } else {
        toast.error(err.response?.data?.detail || t("split_failed"));
      }
      setMessages(prev => {
        const arr = [...prev];
        if (aIdx >= 0 && aIdx < arr.length) arr[aIdx] = { ...arr[aIdx], content: t("split_failed_msg") };
        return arr;
      });
    } finally {
      if (sessionIdRef.current === opSessionId) {
        sendingRef.current = false;
        setBusy(false);
      }
    }
  };

  const handleRegionEdit = async ({ assetLabel, prompt, maskDataUrl }) => {
    if (busy || sendingRef.current) {
      toast.error(t("another_task_running"));
      return;
    }
    sendingRef.current = true;
    setBusy(true);
    const userMsg = {
      role: "user",
      content: t("region_edit_label", assetLabel, prompt),
      timestamp: new Date().toISOString(),
    };
    let aIdx = -1;
    setMessages(prev => {
      aIdx = prev.length + 1;
      return [...prev, userMsg, { role: "assistant", content: "", events: [], timestamp: new Date().toISOString() }];
    });
    // H3：见 handleSetTemplate —— 记住启动会话，复位前比对，避免误清新会话 busy / 卡死输入。
    let opSessionId = sessionIdRef.current;
    try {
      const activeSessionId = await ensureSession();
      opSessionId = activeSessionId;
      const { data } = await axios.post(
        `${API}/sessions/${activeSessionId}/region-edit`,
        {
          source_asset: assetLabel,
          prompt,
          mask_b64: maskDataUrl,
          client_request_id:
            (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        },
        { headers: getHeaders() }
      );
      sendingRef.current = false;
      await resumePolling(data.job_id, aIdx, activeSessionId);
    } catch (err) {
      if (err.response?.status === 402) {
        toast((tt) => (
          <span className="flex items-center gap-3 text-[12px]">
            {err.response?.data?.detail || t("insufficient_credits")}
            <a href="/billing" className="px-2 py-1 bg-white text-black rounded-sm text-[10px] font-bold uppercase tracking-wider shrink-0" onClick={() => toast.dismiss(tt.id)}>
              {t("top_up")}
            </a>
          </span>
        ), { duration: 8000 });
      } else {
        toast.error(err.response?.data?.detail || t("region_edit_failed"));
      }
      setMessages(prev => {
        const arr = [...prev];
        if (aIdx >= 0 && aIdx < arr.length) arr[aIdx] = { ...arr[aIdx], content: t("region_edit_failed_msg") };
        return arr;
      });
    } finally {
      if (sessionIdRef.current === opSessionId) {
        sendingRef.current = false;
        setBusy(false);
      }
    }
  };

  // 自动批准失败（如积分不足）时，撤掉计划卡上的「已自动执行」说明、把手动按钮还给用户，
  // 否则卡片会停留在一个「说已开始、其实没开始」的撒谎态。
  const revertAutoApproved = (jobId) => {
    setMessages(prev => prev.map(m => ({
      ...m,
      events: (m.events || []).map(e =>
        e.job_id === jobId && e.type === "plan_propose" && e.auto_approved
          ? { ...e, auto_approved: null }
          : e
      )
    })));
  };

  // opts.silent：自动批准（低消耗/极速）时不弹「任务已通过」toast —— 自动化就该安静
  const handleJobAction = async (jobId, action, opts = {}) => {
    try {
      await axios.post(`${API}/jobs/${jobId}/${action}`, {}, { headers: getHeaders() });
      if (!opts.silent) toast.success(t("job_actioned", action));
      
      // Hide the approval card in the UI
      setMessages(prev => prev.map(m => ({
        ...m,
        events: (m.events || []).map(e => 
          e.job_id === jobId && (
            (e.type === "info" && (e.content?.includes("approval") || e.content?.includes("confirmation"))) ||
            (e.type === "plan_propose")
          )
            ? { ...e, handled: true }
            : e
        )
      })));
      onBalanceChange?.();
    } catch (err) {
      // 审计 U2：积分不足时给充值直达入口，而不是只报错
      if (err.response?.status === 402) {
        revertAutoApproved(jobId);
        toast((tt) => (
          <span className="flex items-center gap-3 text-[12px]">
            {err.response?.data?.detail || t("insufficient_credits")}
            <a
              href="/billing"
              className="px-2 py-1 bg-white text-black rounded-sm text-[10px] font-bold uppercase tracking-wider shrink-0"
              onClick={() => toast.dismiss(tt.id)}
            >
              {t("top_up")}
            </a>
          </span>
        ), { duration: 8000 });
      } else if (err.response?.status === 409 || err.response?.status === 410) {
        // 计划已失效（已处理 / 已拒 / 超时 / 服务重启）：把这张卡标记为已处理、按钮消失，温和提示而非红错
        setMessages(prev => prev.map(m => ({
          ...m,
          events: (m.events || []).map(e =>
            e.job_id === jobId && (
              (e.type === "info" && (e.content?.includes("approval") || e.content?.includes("confirmation"))) ||
              (e.type === "plan_propose")
            )
              ? { ...e, handled: true }
              : e
          )
        })));
        // L4：自动批准（silent）在刷新重放时会对早已处理的 job 再点一次 approve → 409。
        // 这属于预期内的重放，不该弹「计划已失效」惊扰用户；卡片照常标已处理即可。
        if (!opts.silent) toast(t("plan_expired"), { icon: "ℹ️" });
      } else {
        revertAutoApproved(jobId);
        toast.error(err.response?.data?.detail || t("job_action_failed", action));
      }
    }
  };

  const loadHistory = async () => {
    const loadingSessionId = sessionId; // 加载期间可能切会话，回来时用它判断结果是否还归属当前会话
    setHistoryStatus("loading");
    try {
      const { data } = await axios.get(`${API}/sessions/${sessionId}/messages`, { headers: getHeaders() });
      if (sendingRef.current) return; // 发送中：不要用旧历史覆盖正在构建的消息流
      // 加载途中已切走 → 丢弃这次结果，交给新会话的 loadHistory
      if (sessionIdRef.current !== loadingSessionId) return;
      setHistoryStatus("ready");
      if (data && data.length > 0) {
        // Cleanup: Hide approval cards that already have results or are for inactive jobs
        const cleaned = data.map(m => ({
          ...m,
          events: (m.events || []).map((e, idx, arr) => {
            if ((e.type === "info" && (e.content?.includes("approval") || e.content?.includes("confirmation"))) || e.type === "plan_propose") {
              const hasResult = arr.slice(idx + 1).some(next => 
                next.job_id === e.job_id && (next.type === "tool_result" || next.type === "error")
              );
              if (hasResult) return { ...e, handled: true };
            }
            return e;
          })
        }));
        setMessages(cleaned);
        checkActiveJobs(cleaned);
      } else {
        setMessages([{ role: "assistant", content: t("session_ready"), timestamp: new Date().toISOString() }]);
      }
    } catch {
      // 加载途中已切走 → 别把错误态泼给新会话
      if (sessionIdRef.current !== loadingSessionId) return;
      // H1：加载失败 ≠ 空会话。置 error 态、渲染「历史加载失败 + 重试」，
      // 并强制 hasConversation=true（不弹起点卡）、不渲染快速开始卡——避免把老会话当新用户引导。
      setHistoryStatus("error");
      setMessages([{ role: "assistant", content: t("session_ready"), timestamp: new Date().toISOString() }]);
    }
  };

  const checkActiveJobs = async (currentMessages) => {
    if (!sessionId) return;
    try {
      const { data } = await axios.get(`${API}/sessions/${sessionId}/jobs`, { headers: getHeaders() });
      // 非终态全部恢复（含等待审批），刷新/跨页后重建事件流与审批卡片
      const ACTIVE = ["pending", "processing", "planning", "awaiting_approval", "approving", "running"];
      const active = data.find(j => ACTIVE.includes(j.status) && j.id);
      if (active) {
        // If the last message is assistant but empty/no events, it might be the one for this job.
        let aIdx = currentMessages.length - 1;
        if (aIdx < 0 || currentMessages[aIdx].role !== "assistant") {
          // No assistant bubble to resume into, create a new one.
          setMessages(prev => {
            const next = [...prev, { role: "assistant", content: "", events: [], timestamp: new Date().toISOString() }];
            resumePolling(active.id, next.length - 1);
            return next;
          });
        } else {
          resumePolling(active.id, aIdx);
        }
      }
    } catch {}
  };

  const loadAssets = async () => {
    if (!sessionId) return;
    try {
      const { data } = await axios.get(`${API}/sessions/${sessionId}/assets`, { headers: getHeaders() });
      setAssets(data);
    } catch {}
  };

  // 手动布局持久化：CanvasArea 防抖回报的拖拽/缩放批次 → PATCH 后端，刷新后按新布局重建。
  // 静默失败（布局回写不该打扰创作；下次变动会带着最新坐标再试）。
  const persistLayout = useCallback(async (moves) => {
    const sid = sessionIdRef.current;
    if (!sid || !moves?.length) return;
    try {
      await axios.patch(`${API}/sessions/${sid}/assets/layout`, { moves }, { headers: getHeaders() });
    } catch {}
  }, [getHeaders]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);
  
  const ensureSession = async () => {
    if (sessionId) return sessionId;
    const { data } = await axios.post(`${API}/sessions`, {}, { headers: getHeaders() });
    justCreatedSessionRef.current = true;
    // 立即同步 sessionIdRef：router.replace(?session=) 更新 searchParams→sessionId→ref 是异步的，
    // 但 sendMessage 会紧接着同步调 resumePolling(job, newid)，其守卫 sessionIdRef.current !== newid
    // 会因 ref 还没同步(仍为旧值/null)而误判"已切走"→ 立刻 return → 永不轮询、任务卡在待批准。
    sessionIdRef.current = data.id;
    if (inEmbedMode) {
      setActiveEmbedSession(data.id);
    } else {
      router.replace(`?session=${data.id}`, { scroll: false });
      fetchSessions();
    }
    return data.id;
  };

  // 参考文档（PDF/DOCX）：上传秒回 job，解析进度走聊天事件流（与生图一致）
  const processReferenceDoc = async (file) => {
    if (busy || sendingRef.current) {
      toast.error(t("another_task_running"));
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    sendingRef.current = true;
    const userMsg = {
      role: "user",
      content: t("doc_upload_label", file.name),
      timestamp: new Date().toISOString(),
    };
    let aIdx = -1;
    setMessages(prev => {
      aIdx = prev.length + 1;
      return [...prev, userMsg, { role: "assistant", content: "", events: [], timestamp: new Date().toISOString() }];
    });
    // H3：见 handleSetTemplate —— 记住启动会话，复位前比对，避免误清新会话 busy / 卡死输入。
    let opSessionId = sessionIdRef.current;
    try {
      const activeSessionId = await ensureSession();
      opSessionId = activeSessionId;
      const formData = new FormData();
      formData.append("file", file);
      // 回执语言跟随站点语言设置（LanguageContext 持久化在 localStorage）
      formData.append("lang", (typeof localStorage !== "undefined" && localStorage.getItem("lang")) || "zh");
      const { data } = await axios.post(
        `/api/v1/sessions/${activeSessionId}/reference-docs`,
        formData,
        {
          headers: { "Content-Type": "multipart/form-data", ...getHeaders() },
          onUploadProgress: (pe) => setUploadProgress(Math.round((pe.loaded * 100) / pe.total)),
        }
      );
      setUploading(false);
      sendingRef.current = false;
      if (data.duplicate) {
        // 同一文档已解析过：不再烧一遍视觉理解，直接告知
        setMessages(prev => {
          const arr = [...prev];
          if (aIdx >= 0 && aIdx < arr.length) arr[aIdx] = { ...arr[aIdx], content: t("doc_duplicate", file.name) };
          return arr;
        });
        return;
      }
      setBusy(true);
      await resumePolling(data.job_id, aIdx, activeSessionId);
    } catch (err) {
      toast.error(err.response?.data?.detail || t("doc_upload_failed"));
      setMessages(prev => {
        const arr = [...prev];
        if (aIdx >= 0 && aIdx < arr.length) arr[aIdx] = { ...arr[aIdx], content: t("doc_upload_failed_msg") };
        return arr;
      });
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
      // H3：仅在仍停留于本操作会话时复位 busy/sendingRef，避免误清已切走的新会话状态。
      if (sessionIdRef.current === opSessionId) {
        sendingRef.current = false;
        setBusy(false);
      }
    }
  };

  // 上传管线抽成可复用函数：签名URL → 二进制上传(经代理) → register-asset 拿 asset_label。
  // 返回 { asset_label, url, kind }，供聊天区上传【和】画布本地拖入(P0-3a) 共用同一套注册逻辑，
  // 避免各自发明。onProgress 可选（画布拖入无需进度条时可省）。失败向上抛，由调用方决定兜底。
  const uploadFileAsAsset = async (file, onProgress) => {
    // 0. Make sure we have a session — uploaded assets must belong to one.
    const activeSessionId = await ensureSession();

    // 1. Get signed URL
    const { data: signData } = await axios.get("/api/v1/get_upload_url", {
      params: { filename: file.name },
      headers: getHeaders()
    });

    const { url, fields } = signData;

    // Use the proxy for the actual binary upload to maintain consistency and avoid CORS issues
    const formData = new FormData();
    formData.append("x-proxy-target-url", url);
    Object.entries(fields).forEach(([key, value]) => {
      formData.append(key, value);
    });
    formData.append("file", file);

    // 2. Upload via local proxy
    await axios.post("/api/v1/upload-binary", formData, {
      headers: { "Content-Type": "multipart/form-data" },
      onUploadProgress: (pe) => {
        if (onProgress && pe.total) onProgress(Math.round((pe.loaded * 100) / pe.total));
      }
    });

    // 3. Final URL
    const uploadedUrl = signData.public_url;

    // 4. Register as a real session asset so the agent can address it as asset_N.
    const kind = file.type?.startsWith("video/") ? "video"
               : file.type?.startsWith("audio/") ? "audio"
               : "image";
    const { data: registered } = await axios.post(
      `${API}/sessions/${activeSessionId}/assets`,
      { url: uploadedUrl, kind, source_tool: "upload" },
      { headers: getHeaders() },
    );

    // 让会话素材列表 / @提及立即可见（画布拖入也应能被 @ 引用）
    setAssets(prev => [...prev, {
      asset_label: registered.asset_label, url: uploadedUrl, kind,
      source_tool: "upload", model: null, prompt: null,
    }]);

    return { asset_label: registered.asset_label, url: uploadedUrl, kind };
  };

  // 画布本地图注册（P0-3a）：CanvasArea 的 handleDrop/paste 拿到本地 File 后调这个。
  // 成功返回 asset_label 让画布带 label 落图（立刻能套图/拆图/局改）；同时冒出主动建议(P0-3c)。
  // 失败抛错 → 画布侧以 dataURL 兜底落图并提示「未注册」。
  const registerCanvasImage = async (file) => {
    const { asset_label, url, kind } = await uploadFileAsAsset(file);
    // 仅对图片弹「一键出整套」建议——视频/音频不适用套图
    if (kind === "image") setUploadSuggestion({ assetLabel: asset_label });
    return { asset_label, url, kind };
  };

  const processFile = async (file) => {
    if (!file) return;
    // 文档类型走解析通道（文字进上下文、图片登画布）
    const docExt = (file.name.split(".").pop() || "").toLowerCase();
    if (["pdf", "docx", "doc"].includes(docExt)) {
      return processReferenceDoc(file);
    }
    // 媒体类型校验：其他格式会以 broken image 摧毁画布
    const okType = /^(image|video|audio)\//.test(file.type || "");
    if (!okType) {
      toast.error(t("unsupported_format", docExt));
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      const registered = await uploadFileAsAsset(file, setUploadProgress);
      const att = { asset_label: registered.asset_label, url: registered.url, kind: registered.kind };
      setAttachments(prev => [...prev, att]);
      toast.success(t("uploaded_as", registered.asset_label));
      // 聊天区上传产品图后，同样主动建议「一键出整套」(P0-3c)
      if (registered.kind === "image") setUploadSuggestion({ assetLabel: registered.asset_label });
    } catch (err) {
      console.error("Upload failed", err);
      toast.error(t("upload_failed"));
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleFileUpload = (e) => {
    processFile(e.target.files?.[0]);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    if (busy || uploading) return;
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (busy || uploading) return;
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  };

  const removeAttachment = (label) => {
    setAttachments(prev => prev.filter(a => a.asset_label !== label));
  };

  const sendMessage = async (textOverride = null, skillOverride = null, attachmentsOverride = null) => {
    const typed = (typeof textOverride === 'string' ? textOverride : input).trim();
    const currentAttachments = attachmentsOverride || attachments;
    if ((!typed && currentAttachments.length === 0) || busy || sendingRef.current) return;
    sendingRef.current = true;
    // P1-5.2：留住这条指令原文，失败 pill 的「重试」一键重发
    if (typed) lastUserMsgRef.current = typed;
    
    const currentSkill = skillOverride || activeSkill;

    
    let activeSessionId;
    try {
      activeSessionId = await ensureSession();
    } catch (err) {
      toast.error(t("establish_session_failed"));
      sendingRef.current = false;  // 复位：否则此后所有发送/套图/拆图被 guard 静默吞掉，UI 死锁到刷新
      return;
    }

    // Tell the LLM about any uploaded assets so it can call edit_image / image_to_video / etc.
    // by asset_label without us having to expose URLs in the user-visible bubble.
    const attachmentNote = currentAttachments.length
      ? "\n\n[Attached " + currentAttachments.map(a => `${a.asset_label} (${a.kind || "image"})`).join(", ") + "]"
      : "";
    const msg = typed + attachmentNote;
    const msgAttachments = [...currentAttachments];
    
    if (!attachmentsOverride) setAttachments([]);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "24px";
    
    const userMsg = { 
      role: "user", 
      content: msg, 
      attachments: msgAttachments,
      timestamp: new Date().toISOString(),
      skill_name: currentSkill?.name
    };
    const updatedMessages = [...messages, userMsg];
    
    setMessages([...updatedMessages, { role: "assistant", content: "", events: [], timestamp: new Date().toISOString() }]);
    setBusy(true);

    const aIdx = updatedMessages.length; 
    
    try {
      let canvasState = null;
      try {
        canvasState = canvasRef.current?.getCanvasState?.() || null;
      } catch {}

      let endpoint = `${API}/sessions/${activeSessionId}/chat`;
      let payload = {
        message: typed,
        model: "gpt-5-mini",
        messages_snapshot: updatedMessages,
        canvas_state: canvasState,
      };

      // If a skill is pinned, use the run-skill endpoint
      if (currentSkill) {
        endpoint = `${API}/sessions/${activeSessionId}/run-skill`;
        // Map the user input to the first required input of the skill
        const primaryInputKey = currentSkill.inputs?.[0] || "premise";
        payload = {
          skill_name: currentSkill.name,
          inputs: { [primaryInputKey]: typed },
          messages_snapshot: updatedMessages,
          model: "gpt-5-mini"
        };
        if (!skillOverride) setActiveSkill(null); // Clear skill after sending if not override
      }

      // 幂等键：双击/重试不会产生重复任务（后端按 session+key 去重）
      payload.client_request_id =
        (typeof crypto !== "undefined" && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;

      const enqueueRes = await axios.post(endpoint, payload, { headers: getHeaders() });
      await resumePolling(enqueueRes.data.job_id, aIdx, activeSessionId);
    } catch (err) {
      // 积分不足给充值直达入口（与套图/拆图/局部编辑一致），而不是抛 axios 英文原文
      if (err.response?.status === 402) {
        toast((tt) => (
          <span className="flex items-center gap-3 text-[12px]">
            {err.response?.data?.detail || t("insufficient_credits")}
            <a href="/billing" className="px-2 py-1 bg-white text-black rounded-sm text-[10px] font-bold uppercase tracking-wider shrink-0" onClick={() => toast.dismiss(tt.id)}>
              {t("top_up")}
            </a>
          </span>
        ), { duration: 8000 });
      }
      const errText = err.response?.status === 402
        ? (err.response?.data?.detail || t("insufficient_credits"))
        : (err.response?.data?.detail || err.message || err);
      setMessages(prev => {
        const arr = [...prev];
        if (aIdx >= 0) arr[aIdx] = { ...arr[aIdx], content: `❌ ${errText}` };
        return arr;
      });
    } finally {
      sendingRef.current = false;
      setBusy(false);
      await loadAssets();
      if (activeSessionId) {
        setMessages(prev => {
          const newMsgs = [...prev];
          axios.patch(`${API}/sessions/${activeSessionId}/messages`, { messages: newMsgs }, { headers: getHeaders() }).catch(() => {});
          return newMsgs;
        });
      }
    }
  };

  // P1-5.2 失败可重试：优先用 ref 里的最近指令；刷新恢复的会话 ref 为空时，
  // 从消息流兜底找最近一条用户消息（去掉附件注记），保证老会话里的失败也能一键重发。
  const retryLastMessage = () => {
    let text = lastUserMsgRef.current;
    if (!text) {
      const lastUser = [...messages].reverse().find(m => m?.role === "user" && m.content);
      text = (lastUser?.content || "").replace(/\n\n\[Attached [^\]]*\]$/, "").trim();
    }
    if (text) sendMessage(text);
  };

  // P1-1.2 结果尾部「下一步建议」chips：纯前端启发式，无需后端。
  // why：Lovart 式自主感的核心是 agent「想在用户前面」——出图后主动给出最可能的下一步，
  // 点一下就继续，而不是让用户面对空输入框想指令。单图 vs 套图给不同的后续动作。
  const nextStepChips = (msg) => {
    const okImages = (msg.events || []).filter(
      e => e.type === "tool_result" && e.result?.ok !== false && e.asset?.kind === "image"
    );
    if (okImages.length === 0) return [];
    const label = okImages[okImages.length - 1].asset?.asset_label || t("chip_this_image");
    if (okImages.length === 1) {
      // 出了单图 → 往「整套电商物料」引导
      return [
        { label: t("chip_make_set"), prompt: t("chip_make_set_prompt", label) },
        { label: t("chip_swap_bg"), prompt: t("chip_swap_bg_prompt", label) },
        { label: t("chip_add_badge"), prompt: t("chip_add_badge_prompt", label) },
      ];
    }
    // 出了套图 → 往「成品交付」引导
    return [
      { label: t("chip_stitch_detail"), prompt: t("chip_stitch_detail_prompt") },
      { label: t("chip_edit_copy"), prompt: t("chip_edit_copy_prompt") },
    ];
  };

  const markdownComponents = useMemo(() => ({
    a: ({ node, ...props }) => {
      const isMedia = props.href?.match(/\.(jpeg|jpg|gif|png|webp|avif)$/i);
      const isVideo = props.href?.match(/\.(mp4|webm|mov)$/i);
      if (isMedia) {
        return (
          <span className="block mt-2 mb-1">
            <a href={props.href} target="_blank" rel="noreferrer" className="block relative group overflow-hidden rounded border border-divider shadow-sm">
              <img src={props.href} alt="Generated Asset" className="w-full h-auto object-cover transition-transform group-hover:scale-105" />
              <span className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
            </a>
          </span>
        );
      }
      if (isVideo) {
        return (
          <span className="block mt-2 mb-1">
            <video src={props.href} controls className="w-full rounded border border-divider shadow-sm" />
          </span>
        );
      }
      return <a {...props} className="text-primary hover:underline underline-offset-4 font-bold" target="_blank" rel="noreferrer" />;
    },
    div: ({ node, ...props }) => <div {...props} />, 
    p: ({ node, ...props }) => <div className="mb-2 last:mb-0" {...props} />,
    pre: ({ node, ...props }) => <div className="my-3 overflow-x-auto rounded border border-divider" {...props} />,
    code: ({ node, inline, className, children, ...props }) => {
      const match = /language-(\w+)/.exec(className || '');
      return !inline && match ? (
        <SyntaxHighlighter
          style={resolvedTheme === 'dark' ? oneDark : oneLight}
          language={match[1]}
          showLineNumbers
          PreTag="div"
          className="scrollbar-subtle !m-0 !p-3 text-[12px]"
          {...props}
        >
          {String(children).replace(/\n$/, '')}
        </SyntaxHighlighter>
      ) : (
        <code className="bg-primary/10 text-primary px-1.5 py-0.5 rounded text-[12px] font-mono" {...props}>
          {children}
        </code>
      );
    }
  }), [resolvedTheme]);


  // Sync assets to canvas once ref is ready — only push URLs not yet synced
  useEffect(() => {
    if (!sessionId || assets.length === 0) return;

    const newAssets = assets.filter(a => {
      // 文档提取的产品图只进资产面板（生成时作底图引用），不自动铺上画布
      if (a.source_tool === "doc_extract") return false;
      // 智能拆解文字层：无 url、用 prompt 里的 blocks JSON 重建可编辑文字（syncKey 用 label 即可）
      const syncKey = `${a.asset_label || "no-label"}-${a.url}`;
      return !syncedUrlsRef.current.has(syncKey);
    });
    if (newAssets.length === 0) return;

    let attempts = 0;
    const sync = () => {
      if (canvasRef.current) {
        newAssets.forEach(a => {
          const syncKey = `${a.asset_label || "no-label"}-${a.url}`;
          const isTextLayer = a.kind === "text_layer";
          // 文字层无 url；其它 kind 缺 url 跳过（沿用原逻辑）
          if (!isTextLayer && !a.url) return;
          if (syncedUrlsRef.current.has(syncKey)) return;
          syncedUrlsRef.current.add(syncKey);

          if (isTextLayer) {
            // 智能拆解文字层：blocks 存在 prompt(JSON)，锚到同坐标的底图（拆解各层叠回源图同位置）
            let blocks = [];
            try { blocks = JSON.parse(a.prompt || "[]"); } catch { blocks = []; }
            if (!blocks.length) return;
            // 找一张同 canvas 坐标的图片资产做锚（背景/主体层都在源图同位置），否则用最近一张
            const anchor = assets.find(o => o.kind === "image" && o.url
              && (o.canvas_x ?? null) === (a.canvas_x ?? null)
              && (o.canvas_y ?? null) === (a.canvas_y ?? null));
            canvasRef.current.addTextLayers(anchor?.asset_label ?? null, blocks);
            return;
          }

          const kind = a.kind || (a.url.match(/\.(mp4|webm|mov)$/i) ? "video" : a.url.match(/\.(mp3|wav|ogg|m4a)$/i) ? "audio" : "image");
          const label = a.asset_label || null;
          // 后端持久化的画布坐标+尺寸：刷新后恢复布局（含用户手动拖拽/缩放的结果），避免叠图/回跳
          const px = a.canvas_x ?? undefined;
          const py = a.canvas_y ?? undefined;
          const pw = a.canvas_w ?? undefined;
          const ph = a.canvas_h ?? undefined;
          if (kind === "image") canvasRef.current.addImage(a.url, px, py, pw, ph, undefined, label, a.set_template, a.set_content, a.z_index, a.split_role, a.split_label);
          else if (kind === "video") canvasRef.current.addVideo(a.url, px, py, pw, ph, undefined, label);
          else if (kind === "audio") canvasRef.current.addAudio(a.url, px, py, undefined, label);
        });

        // 首次加载：镜头对准内容（图片异步落布，轮询重试直到 fit 成功）
        if (!initialFitDoneRef.current) {
          initialFitDoneRef.current = true;
          let attempts = 0;
          const tryFit = setInterval(() => {
            attempts++;
            if (canvasRef.current?.fitToContent?.() || attempts > 16) clearInterval(tryFit);
          }, 250);
        }
        return true;
      }
      return false;
    };

    if (!sync()) {
      const timer = setInterval(() => {
        attempts++;
        if (sync() || attempts > 20) clearInterval(timer);
      }, 500);
      return () => clearInterval(timer);
    }
  }, [assets, sessionId]);

  const renameSession = async (id = null, name = null) => {
    const targetId = id || sessionId;
    const targetName = name || newName;
    const currentName = id ? (sessions.find(s => s.id === id)?.name) : currentSessionName;

    if (!targetId || !targetName.trim() || targetName.trim() === currentName) {
      setIsEditingName(false);
      setEditingSessionId(null);
      return;
    }
    try {
      await axios.patch(`${API}/sessions/${targetId}`, { name: targetName.trim() }, { headers: getHeaders() });
      if (targetId === sessionId) setCurrentSessionName(targetName.trim());
      setIsEditingName(false);
      setEditingSessionId(null);
      fetchSessions();
      toast.success(t("session_renamed"));
    } catch {
      toast.error(t("session_rename_failed"));
      setIsEditingName(false);
      setEditingSessionId(null);
    }
  };

  const deleteSession = async (id) => {
    // 软删除 + toast 撤销（替代原生 confirm 弹窗）
    try {
      await axios.delete(`${API}/sessions/${id}`, { headers: getHeaders() });
      toast((tt) => (
        <span className="flex items-center gap-3 text-[12px]">
          {t("session_deleted")}
          <button
            className="px-2 py-1 bg-white text-black rounded-sm text-[10px] font-bold uppercase tracking-wider"
            onClick={async () => {
              toast.dismiss(tt.id);
              try {
                await axios.post(`${API}/sessions/${id}/restore`, {}, { headers: getHeaders() });
                fetchSessions();
              } catch {
                toast.error(t("restore_failed"));
              }
            }}
          >
            {t("undo")}
          </button>
        </span>
      ), { duration: 5000 });
      if (inEmbedMode) {
        if (id === sessionId) setActiveEmbedSession(null);
      } else {
        fetchSessions();
        if (id === sessionId) {
          router.push("/canvas");
        }
      }
    } catch (err) {
      toast.error(t("session_delete_failed"));
    }
  };

  const handleMouseMove = useCallback((e) => {
    if (!isResizing.current) return;
    const newWidth = window.innerWidth - e.clientX;
    if (newWidth > 300 && newWidth < 800) {
      setSidebarWidth(newWidth);
    }
  }, []);

  const stopResizing = useCallback(() => {
    isResizing.current = false;
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", stopResizing);
    document.body.style.cursor = "default";
    document.body.style.userSelect = "auto";
  }, [handleMouseMove]);

  const startResizing = useCallback((e) => {
    isResizing.current = true;
    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", stopResizing);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [handleMouseMove, stopResizing]);

  const selectMention = (item, type) => {
    const before = input.substring(0, mentionCursorPos);
    // mentionCursorPos is where @ is. query is after @.
    const after = input.substring(textareaRef.current.selectionStart);
    
    if (type === "skill") {
      setActiveSkill(item);
      setInput(before + after); 
    } else {
      const insertion = `@${item.asset_label}`;
      setInput(before + insertion + after);
    }
    
    setShowMentionPopup(false);
    setTimeout(() => textareaRef.current?.focus(), 10);
  };

  const copyToClipboard = async (text) => {
    if (!text) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        toast.success(t("copied"));
      } else {
        const textArea = document.createElement("textarea");
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        try {
          document.execCommand('copy');
          toast.success(t("copied"));
        } catch (err) {
          toast.error(t("copy_failed"));
        }
        document.body.removeChild(textArea);
      }
    } catch (err) {
      toast.error(t("copy_failed"));
    }
  };

  const handleKey = (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } };
  
  const filteredSkills = skills.filter(s => s.name.toLowerCase().includes(mentionQuery.toLowerCase()));
  // 文字层(text_layer)无 url、不是可引用的媒体资产，从 @ 提及/资产面板里排除
  const mediaAssets = assets.filter(a => a.kind !== "text_layer");
  const filteredAssets = mediaAssets.filter(a => (a.asset_label || "").toLowerCase().includes(mentionQuery.toLowerCase()));

  if (!mounted) return null;

  return (
    <div className="h-dvh w-full text-sm flex flex-col bg-bg-page text-primary-text overflow-hidden" style={{ fontFamily: "'Inter', sans-serif" }}>
      <Toaster position="top-right" reverseOrder={false} />
      <main className="flex h-full w-full overflow-hidden">
        {/* Left Sidebar: Session List — owner only. Embed visitors don't get
            a session switcher; the iframe is scoped to one localStorage-keyed
            session per embed code. */}
        <div className={`flex-shrink-0 flex flex-col bg-bg-card border-r border-divider shadow-[4px_0_12px_rgba(0,0,0,0.05)] z-20 transition-all duration-300 ${(showLeftSidebar || inEmbedMode) ? 'overflow-hidden w-0' : 'w-64'}`}>
          <div className="p-3 border-b border-divider flex items-center justify-between bg-bg-card/50">
            <div className="flex items-center gap-2 overflow-hidden">
              <Link 
                href="/dashboard"
                className={`p-2 hover:bg-bg-page rounded text-secondary-text hover:text-primary transition-colors`}
                title={t("go_back")}
              >
                <FiArrowLeft size={16} />
              </Link>
              <Link
                href="/dashboard"
                className="flex items-center flex-shrink-0 transition-transform duration-300 hover:scale-[1.02] active:scale-95"
                aria-label={t("home")}
              >
                <span className="font-bold text-lg">{t("studio_brand")}</span>
              </Link>
            </div>
            <button 
              onClick={() => setShowLeftSidebar(!showLeftSidebar)}
              className={`p-1.5 rounded transition-colors ${showLeftSidebar ? "bg-primary/10 text-primary" : "hover:bg-bg-card text-secondary-text hover:text-primary"}`}
              title={t("toggle_sessions")}
            >
              <VscLayoutSidebarLeftOff size={16} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto scrollbar-subtle">
            {/* 三态（P0-5）：加载中 / 出错(可重试) / 空 / 列表 */}
            {sessionsStatus === "loading" && sessions.length === 0 ? (
              <div className="px-4 py-8 text-center text-secondary-text text-[11px] flex items-center justify-center gap-2">
                <span className="w-3 h-3 border-2 border-secondary-text/40 border-t-primary rounded-full animate-spin" />
                {t("sessions_loading")}
              </div>
            ) : sessionsStatus === "error" && sessions.length === 0 ? (
              <div className="px-4 py-8 text-center text-secondary-text text-[11px] flex flex-col items-center gap-2">
                <span>{t("sessions_error")}</span>
                <button
                  onClick={fetchSessions}
                  className="px-3 py-1.5 rounded-lg bg-bg-card border border-divider text-primary-text hover:border-primary/60 transition-colors text-[11px] font-medium"
                >{t("retry")}</button>
              </div>
            ) : sessions.length === 0 ? (
              <div className="px-4 py-8 text-center text-secondary-text italic text-[11px]">{t("no_previous_sessions")}</div>
            ) : (
              sessions.map((s) => (
                <div
                  key={s.id}
                  onMouseEnter={() => setHoveredSessionId(s.id)}
                  onMouseLeave={() => setHoveredSessionId(null)}
                  className={`relative w-full flex items-center gap-3 px-4 py-3.5 cursor-pointer transition-all border-l-2 group
                    ${sessionId === s.id ? "border-primary bg-primary/5" : "border-transparent hover:bg-bg-card-hover"}`}
                  onClick={() => {router.push(`?session=${s.id}`); setShowLeftSidebar(!showLeftSidebar);}}
                >
                  <div className="flex-1 min-w-0 pr-12">
                    {editingSessionId === s.id ? (
                      <input
                        autoFocus
                        className="bg-bg-card border border-primary px-2 py-1 rounded text-xs focus:outline-none w-full"
                        value={editingSessionName}
                        onChange={(e) => setEditingSessionName(e.target.value)}
                        onBlur={() => renameSession(s.id, editingSessionName)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") renameSession(s.id, editingSessionName);
                          if (e.key === "Escape") setEditingSessionId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <div className={`flex items-center gap-2 text-[13px] font-semibold transition-colors ${sessionId === s.id ? "text-primary" : "text-primary-text"}`}>
                        <span className="truncate flex-1">{s.name}</span>
                        <span className="flex items-center gap-1 text-[10px] text-secondary-strong">
                          <FiImage size={10} /> {s.asset_count}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Hover Actions */}
                  {hoveredSessionId === s.id && editingSessionId !== s.id && (
                    <div className="flex items-center gap-0.5 animate-fade-in absolute right-2 top-1/2 -translate-y-1/2 bg-bg-card/90 backdrop-blur-sm pl-2 py-1 rounded-l shadow-[-12px_0_12px_rgba(0,0,0,0.1)]">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingSessionId(s.id);
                          setEditingSessionName(s.name);
                        }}
                        className="p-1.5 hover:bg-bg-page rounded text-secondary-text hover:text-primary transition-colors"
                        title={t("rename")}
                      >
                        <FiEdit2 size={13} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteSession(s.id);
                        }}
                        className="p-1.5 hover:bg-red-500/10 rounded text-secondary-text hover:text-red-500 transition-colors"
                        title={t("delete")}
                      >
                        <HiOutlineTrash size={14} />
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
          <div className="p-3 border-t border-divider bg-bg-page/30">
            <div className="flex items-center justify-between text-[10px] text-secondary-text font-medium px-1">
              <span>{t("total_sessions")}</span>
              <span>{sessions.length}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-col relative bg-bg-page flex-1 overflow-hidden">
          {/* Canvas Top Bar */}
          <div className="flex justify-between items-center z-10 p-2 border-b border-divider bg-bg-page">
            <div className="relative flex items-center gap-1">
              {!inEmbedMode && (
                <button
                  onClick={() => setShowLeftSidebar(!showLeftSidebar)}
                  className={`p-2 hover:bg-bg-card rounded transition-colors ${showLeftSidebar ? "text-primary" : "hidden"}`}
                  title={t("toggle_sessions")}
                >
                  <VscLayoutSidebarLeftOff size={18} />
                </button>
              )}

              {!inEmbedMode && (
                <Link
                  href="/dashboard"
                  className={`p-1.5 hover:bg-bg-card rounded text-secondary-text hover:text-primary transition-colors ${!showLeftSidebar && "hidden"}`}
                  title={t("go_back")}
                >
                  <FiArrowLeft size={16} />
                </Link>
              )}

              {inEmbedMode && (
                <button
                  onClick={() => setActiveEmbedSession(null)}
                  className="p-1.5 hover:bg-bg-card rounded text-secondary-text hover:text-primary transition-colors"
                  title={t("new_chat")}
                >
                  <FiPlus size={16} />
                </button>
              )}

              <div className="flex items-center gap-2 text-primary-text p-1.5">
                <span className="font-medium text-sm max-w-[200px] truncate">
                  {currentSessionName}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {!inEmbedMode && (
                <div className="flex items-center gap-2 h-8 border border-divider rounded bg-bg-page/30 overflow-hidden px-2">
                  <span
                    suppressHydrationWarning
                    className="font-bold text-xs flex items-center text-primary-text truncate"
                  >
                    {userBalanceLabel ?? `${user?.balance ?? 0} ${t("credits_unit")}`}
                  </span>
                </div>
              )}

              <div
                className={`relative outline-none flex items-center gap-2 ${inEmbedMode ? "hidden" : ""}`}
                tabIndex={-1}
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget)) {
                    setOpenProfile(false);
                  }
                }}
              >
                <button
                  onClick={() => setOpenProfile(!openProfile)}
                  aria-label={t("profile")}
                  title={t("profile")}
                  className="w-8 h-8 rounded-full bg-primary/10 border border-primary flex items-center justify-center text-primary shadow-sm hover:bg-primary/20 transition-all overflow-hidden"
                >
                  {user?.profile_photo ? (
                    <img src={user.profile_photo} alt={t("profile")} className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-[10px] font-bold">
                      {(user?.username || "U").substring(0, 2).toUpperCase()}
                    </span>
                  )}
                </button>
                {!showChat && (
                  <button
                    onClick={handleToggleSidebar}
                    className="w-8 h-8 rounded-full rotate-270 hover:bg-bg-page hover:text-primary-text transition-all flex items-center justify-center text-secondary-text z-[60]"
                    title={t("open_chat")}
                  >
                    <HiOutlineArrowUpTray size={18} />
                  </button>
                )}
                
                <div 
                  className={`absolute top-full right-0 mt-2 w-64 bg-bg-card border border-divider rounded shadow-2xl z-[100] py-1 transition-all duration-200 origin-top-right ${
                    openProfile ? "opacity-100 scale-100 visible translate-y-0" : "opacity-0 scale-95 invisible translate-y-2"
                  }`}
                >
                  <div className="px-4 py-3 border-b border-divider flex flex-col">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-bold text-primary-text truncate">
                        {user?.username || t("user")}
                      </span>
                      {user?.plan === "pro" ? (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-primary text-black uppercase tracking-wider">
                          {t("pro")}
                        </span>
                      ) : (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-orange-500/10 text-orange-500 border border-orange-500 uppercase tracking-wider">
                          {t("bronze")}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-secondary-text truncate">
                      {user?.email}
                    </span>
                    <div className="mt-2 text-[13px] font-bold text-primary">
                      {userBalanceLabel ?? `${user?.balance ?? 0} ${t("credits_unit")}`} <span className="font-normal text-secondary-text">{t("available")}</span>
                    </div>
                  </div>
                  
                  <div className="py-1">
                    <a 
                      href="mailto:support@vadoo.tv"
                      className="w-full flex items-center gap-3 px-4 py-2 hover:bg-bg-page transition-colors text-[13px] font-semibold text-primary-text"
                    >
                      {t("support")}
                    </a>
                  </div>
                  {/* 深色模式开关：仅当宿主未强制主题(forcedTheme)时可见——否则是死控件 */}
                  {!forcedTheme && (
                    <>
                      <div className="h-px bg-divider w-full my-1" />
                      <div className="py-1">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setTheme(resolvedTheme === "dark" ? "light" : "dark");
                          }}
                          className="w-full flex items-center justify-between px-4 py-2 hover:bg-bg-page transition-colors text-[13px] font-semibold text-primary-text"
                        >
                          <div className="flex items-center gap-3">
                            <span className="text-secondary-text">
                              {resolvedTheme === "dark" ? <FiSun size={15} /> : <FiMoon size={15} />}
                            </span>
                            {t("dark_mode")}
                          </div>
                          <div className={`w-8 h-4 rounded-full relative transition-colors ${resolvedTheme === "dark" ? "bg-primary" : "bg-bg-card-hover"}`}>
                            <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-black dark:bg-white transition-all ${resolvedTheme === "dark" ? "left-4.5" : "left-0.5"}`} />
                          </div>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Main Canvas View */}
          <div className="flex-1 relative overflow-hidden bg-bg-page/50 w-full">
            <CanvasArea
              ref={canvasRef}
              theme={resolvedTheme}
              activeTasks={activeTasks}
              chatBusy={busy}  // 任务(含规划期)进行中 → 画布空态起点卡先让位，避免看着像「还要再输入一遍」
              // 起点卡只服务「真正的冷启动」：会话里只要有过用户诉求（如从 dashboard 带话进来），
              // 再弹「上传产品图」就是答非所问（用户实测：说了要小红书封面还被要求传产品图）。
              // 历史未加载完(messages 为空)也先不弹，防闪现。
              // H1：加载出错时强制 true —— error 态下画布不该弹「上传产品图」起点卡（老会话被当新用户）。
              hasConversation={historyStatus === "error" || messages.length === 0 || messages.some((m) => m.role === "user")}
              setActiveTasks={setActiveTasks}
              onZoomChange={setZoomLevel}
              onLayoutChange={persistLayout}
              onRegionEdit={handleRegionEdit}
              onSetTemplate={handleSetTemplate}
              onSplitImage={handleSplitImage}
              // P0-3a：画布本地图注册成后端资产（复用聊天区上传管线）
              onUploadImage={registerCanvasImage}
              // P0-4 空态「描述需求」：聚焦聊天输入框，让卖家直接说需求
              onRequestDescribe={() => textareaRef.current?.focus()}
            />

            {/* 缩放工具条：放右下角，避免与画布底部居中的多选操作条(CanvasArea)同位重叠 */}
            <div className="absolute bottom-6 right-6 flex items-center gap-1 bg-bg-card border border-divider shadow-2xl px-2 py-1.5 rounded z-20">
              <div className="flex items-center gap-3 px-3">
                <span className="text-[10px] font-bold text-secondary-text uppercase tracking-widest">{zoomLevel}%</span>
                <div className="flex items-center gap-1">
                  <button onClick={() => canvasRef.current?.zoomOut()} aria-label={t("zoom_out")} title={t("zoom_out")} className="w-7 h-7 rounded border border-divider flex items-center justify-center text-secondary-strong hover:text-primary-text hover:border-primary transition-all">-</button>
                  <button onClick={() => canvasRef.current?.zoomIn()} aria-label={t("zoom_in")} title={t("zoom_in")} className="w-7 h-7 rounded border border-divider flex items-center justify-center text-secondary-strong hover:text-primary-text hover:border-primary transition-all">+</button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Resizer Handle */}
        <div 
          className="h-full cursor-col-resize hover:bg-primary w-1 transition-all z-10 group relative flex items-center justify-center"
          onMouseDown={startResizing}
        >
          {/* <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-[1px] bg-divider group-hover:bg-primary/50 transition-colors" /> */}
          <div className="z-10 w-3 h-8 rounded-full bg-bg-card border border-divider shadow-sm flex flex-col items-center justify-center gap-1 opacity-60 group-hover:opacity-100 transition-opacity translate-x-[-0.5px]">
            <div className="w-0.5 h-0.5 rounded-full bg-primary-text" />
            <div className="w-0.5 h-0.5 rounded-full bg-primary-text" />
            <div className="w-0.5 h-0.5 rounded-full bg-primary-text" />
          </div>
        </div>

        {/* Right Panel: Chat Sidebar */}
        <div 
          className={`flex-shrink-0 flex flex-col min-h-0 overflow-hidden bg-bg-card border-l border-divider shadow-[-10px_0_20px_rgba(0,0,0,0.02)] z-20 transition-all duration-300`}
          style={{ width: sidebarWidth }}
        >
          {/* Sidebar Header */}
          <div className="p-4 flex items-center justify-between border-b border-divider bg-bg-card shrink-0">
            <div className="flex flex-col">
              <h2 className="font-bold text-[13px] text-primary-text uppercase tracking-widest leading-none flex items-center gap-2">
                <RiSparklingLine className="text-primary" /> Picsmith
              </h2>
              <span className="text-[10px] text-secondary-text mt-1.5">{t("auto_model_access")}</span>
            </div>
            <div className="flex items-center gap-1">
              {sessionId && (
                <button
                  onClick={() => {
                    if (inEmbedMode) setActiveEmbedSession(null);
                    else router.push("/canvas");
                  }}
                  className="p-1.5 hover:bg-bg-page hover:text-primary-text transition-colors rounded text-secondary-text"
                  title={t("new_session")}
                >
                  <FiPlus size={16} />
                </button>
              )}
              <button
                onClick={handleToggleSidebar}
                className={`w-8 h-8 rounded-full transition-all flex items-center justify-center shrink-0 ${showChat ? "bg-primary/10 text-primary" : "hover:bg-bg-page text-secondary-text hover:text-primary"}`}
                title={showChat ? t("hide_chat") : t("open_chat")}
              >
                <FiLayout size={16} />
              </button>
            </div>
          </div>
          {/* Chat History */}
          {/* min-h-0：flex-1 子项默认 min-height:auto（=内容高），消息多时不肯收缩会把输入框顶出可视区；置 0 才能让 overflow 滚动生效 */}
          <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-6 scrollbar-subtle">
            {messages.map((msg, idx) => {
              if (!msg) return null;
              const prevMsg = idx > 0 ? messages[idx - 1] : null;
              const showDateHeader = msg.timestamp && (
                !prevMsg || 
                !prevMsg.timestamp || 
                new Date(msg.timestamp).toDateString() !== new Date(prevMsg.timestamp).toDateString()
              );

              return (
                <React.Fragment key={idx}>
                  {showDateHeader && msg.timestamp && (
                    <div className="flex justify-center my-4">
                      <span className="px-2 py-1 bg-bg-page border border-divider rounded text-[10px] font-medium text-secondary-text shadow-sm">
                        {formatDateHeader(msg.timestamp)}
                      </span>
                    </div>
                  )}
                  <div className={`flex flex-col gap-2 ${msg.role === "user" ? "items-end" : "items-start"} animate-fade-in-up group`}>
                    <div className="flex items-center gap-2">
                      {msg.role === "assistant" && (
                        <div className="flex items-center gap-1.5 text-[10px] font-medium text-secondary-text ml-1">
                          <RiRobot2Line /> {t("agent")}
                        </div>
                      )}
                      <div className={`flex items-center justify-end gap-2 text-[9px] text-secondary-text`}>
                        {msg.timestamp && <span>{formatTime(msg.timestamp)}</span>}
                      </div>
                      {msg.role === "user" && msg.skill_name && (
                        <div className="flex items-center gap-1.5 text-xs font-medium text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary w-fit ml-auto">
                          <RiSparklingLine size={10} /> {msg.skill_name}
                        </div>
                      )}
                    </div>
                    <div className={`max-w-[90%] space-y-2 ${msg.role === "user" ? "text-right" : "text-left"}`}>
                      <div className="relative">
                        <div className={`px-3.5 py-2.5 text-[13px] leading-relaxed break-words relative
                          ${msg.role === "user" ? "bg-bg-card-hover text-primary-text rounded-2xl rounded-tr-md shadow-soft" : "text-primary-text bg-bg-page rounded-2xl rounded-tl-md shadow-soft border border-divider/60"}`}>
                          
                          {msg.content ? (
                            msg.role === "assistant" ? (
                              <div className="prose dark:prose-invert max-w-none prose-p:leading-relaxed prose-pre:bg-black/30">
                                <ReactMarkdown
                                  remarkPlugins={[remarkGfm]}
                                  components={markdownComponents}
                                >
                                  {msg.content}
                                </ReactMarkdown>
                                {/* 文档提取的图片：缩略图条让用户立刻看到 AI 拿到了什么，点击即插入引用 */}
                                {msg.docAssets?.length > 0 && (
                                  <div className="not-prose mt-2 flex gap-1.5 overflow-x-auto pb-1 scrollbar-subtle">
                                    {msg.docAssets.map(da => (
                                      <button
                                        key={da.label}
                                        type="button"
                                        onClick={() => {
                                          setInput(prev => prev + (prev ? " " : "") + da.label);
                                          textareaRef.current?.focus();
                                        }}
                                        title={da.caption || da.label}
                                        className="group relative flex-shrink-0 w-16 h-16 rounded border border-divider overflow-hidden bg-black/20 hover:border-primary transition-all"
                                      >
                                        <img src={da.url} alt={da.label} className="w-full h-full object-cover" />
                                        {da.is_product && (
                                          <span className="absolute top-0.5 left-0.5 px-1 rounded-sm bg-primary/90 text-black text-[8px] font-bold leading-tight">P</span>
                                        )}
                                        <span className="absolute bottom-0 inset-x-0 bg-black/70 text-white text-[8px] px-0.5 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                                          {da.caption || da.label}
                                        </span>
                                      </button>
                                    ))}
                                  </div>
                                )}
                              </div>
                            ) : (
                              <div className="flex flex-col gap-2">
                                <div className="prose dark:prose-invert max-w-none text-primary-text prose-p:leading-relaxed">
                                  <ReactMarkdown
                                    remarkPlugins={[remarkGfm]}
                                    components={markdownComponents}
                                  >
                                    {msg.content}
                                  </ReactMarkdown>
                                </div>
                                {msg.attachments && msg.attachments.length > 0 && (
                                  <div className="flex flex-col gap-2 mt-2 w-full">
                                    {msg.attachments.map(att => (
                                      <div key={att.asset_label} className="relative w-full rounded border border-white/20 overflow-hidden shadow-sm bg-black/10">
                                        {att.kind === "image" && (
                                          <img src={att.url} alt={att.asset_label} className="w-full max-h-64 object-contain" />
                                        )}
                                        {att.kind === "video" && (
                                          <video src={att.url} controls className="w-full max-h-64 object-contain" />
                                        )}
                                        {att.kind === "audio" && (
                                          <div className="p-2">
                                            <audio src={att.url} controls className="w-full" />
                                          </div>
                                        )}
                                        {!["image", "video", "audio"].includes(att.kind) && (
                                          <div className="w-full p-4 flex items-center justify-center text-[10px] text-white/70">
                                            {att.kind}: {att.asset_label}
                                          </div>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )
                          ) : (msg.role === "assistant" && busy) && (
                            <TypingDots />
                          )}
                          
                          {visibleEvents(msg.events).map((ev, i) => (
                            <EventPill key={i} event={{
                              ...ev,
                              onAction: handleJobAction,
                              // P1-1.3 ask_user 选项可点：点选项直接替用户回信，不用手打「1/2」
                              onSend: (text) => sendMessage(text),
                              // P1-5.2 重试只挂在最后一条消息上：历史消息里的失败若也能点，
                              // 会重发「最新」指令而非当年那条，反而制造事故
                              onRetry: idx === messages.length - 1 ? retryLastMessage : undefined,
                            }} />
                          ))}
                        </div>

                        {/* Copy Button - Hover only */}
                        <button 
                          onClick={() => copyToClipboard(msg.content)}
                          className={`absolute top-0 opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded bg-bg-card border border-divider shadow-md hover:text-primary z-10
                            ${msg.role === "user" ? "right-full mr-2" : "left-full ml-2"}`}
                          title={t("copy_message")}
                        >
                          <FiCopy size={12} />
                        </button>
                      </div>

                      {/* P1-1.2 下一步建议 chips：只在「最后一条助手消息 + 空闲」时出现，
                          避免历史消息串满过期建议；点击即发送对应指令，延续心流 */}
                      {msg.role === "assistant" && !busy && idx === messages.length - 1 && (() => {
                        const chips = nextStepChips(msg);
                        if (chips.length === 0) return null;
                        return (
                          <div className="flex flex-wrap items-center gap-1.5 mt-1.5 animate-fade-in-up">
                            <span className="text-[10px] text-secondary-text">{t("next_steps")}</span>
                            {chips.map((c) => (
                              <button
                                key={c.label}
                                type="button"
                                onClick={() => sendMessage(c.prompt)}
                                className="px-2.5 py-1 rounded-full bg-bg-page border border-divider text-[11px] text-secondary-text hover:border-primary/60 hover:text-primary-text transition-all"
                              >
                                {c.label}
                              </button>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                </React.Fragment>
              );
            })}

            {/* 空会话快捷示例：垂直场景一键开始。
                P0-3b：把「主图六联 / 详情页七段」提到一级入口（与电商主图并列），
                点击直达套图流程（有产品图→开面板预选；无→引导上传），卖家不用懂框选/工具条。
                另加「上传产品图」入口，把卖家最自然的动作放在最显眼处。 */}
            {/* H1 历史加载失败：显式「加载失败 + 重试」，而非静默降级成新手引导。
                error 态下不渲染下方快速开始卡（老会话不该被当新用户）。 */}
            {historyStatus === "error" && (
              <div className="mx-1 p-3 rounded-xl bg-[var(--color-error-bg)] border border-[var(--color-error)] flex items-center justify-between gap-3 animate-fade-in-up">
                <div className="flex items-center gap-2 text-[12px] text-[var(--color-error)]">
                  <FiAlertCircle size={14} className="shrink-0" />
                  <span>{t("history_load_failed")}</span>
                </div>
                <button
                  onClick={loadHistory}
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-bg-card border border-divider text-primary-text hover:border-primary/60 transition-colors text-[11px] font-medium"
                >{t("history_load_retry")}</button>
              </div>
            )}

            {historyStatus !== "error" && !busy && messages.length === 1 && messages[0]?.role === "assistant" && (
              <div className="flex flex-col gap-2 px-1 animate-fade-in-up">
                <div className="micro-label">{t("quick_start")}</div>
                {[
                  { label: t("qs_upload_product"), sub: t("qs_upload_product_sub"), onClick: () => fileInputRef.current?.click() },
                  { label: t("qs_main6"), sub: t("qs_main6_sub"), onClick: () => startSetFlow("main6") },
                  { label: t("qs_detail7"), sub: t("qs_detail7_sub"), onClick: () => startSetFlow("detail7") },
                  { label: t("qs_ecommerce"), sub: t("qs_ecommerce_prompt"), onClick: () => sendMessage(t("qs_ecommerce_prompt")) },
                  { label: t("qs_logo"), sub: t("qs_logo_prompt"), onClick: () => sendMessage(t("qs_logo_prompt")) },
                  { label: t("qs_social"), sub: t("qs_social_prompt"), onClick: () => sendMessage(t("qs_social_prompt")) },
                ].map((s) => (
                  <button
                    key={s.label}
                    onClick={s.onClick}
                    className="text-left px-3 py-2 rounded bg-bg-page border border-divider text-[12px] text-secondary-text hover:border-primary/40 hover:text-primary-text transition-all"
                  >
                    {s.label}
                    <span className="block text-[10px] opacity-60 mt-0.5">{s.sub}</span>
                  </button>
                ))}
              </div>
            )}

            {/* P0-3c 上传后主动建议：卖家上传/拖入产品图后，主动冒出「一键出整套」建议卡。
                点按钮直达套图流程（openSetPanel 预选并预勾选刚上传的图）。这是 agent 主动性的体现。 */}
            {uploadSuggestion && (
              <div className="mx-1 p-3 rounded-xl bg-bg-card border border-primary/40 shadow-float animate-fade-in-up">
                <div className="text-[12px] font-semibold text-primary-text mb-2">{t("suggest_after_upload_title")}</div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => {
                      // M2：openSetPanel 返回 false（画布已无那张带 label 的图，如切过会话/清过画布）
                      // 时别静默无效，回落到 startSetFlow 引导重新上传。
                      if (!canvasRef.current?.openSetPanel?.("main6", uploadSuggestion.assetLabel)) startSetFlow("main6");
                      setUploadSuggestion(null);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-primary text-black text-[12px] font-semibold hover:opacity-90 transition-opacity"
                  >{t("suggest_main6")}</button>
                  <button
                    onClick={() => {
                      if (!canvasRef.current?.openSetPanel?.("detail7", uploadSuggestion.assetLabel)) startSetFlow("detail7");
                      setUploadSuggestion(null);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-bg-page border border-divider text-[12px] font-medium text-primary-text hover:border-primary/60 transition-colors"
                  >{t("suggest_detail7")}</button>
                  <button
                    onClick={() => setUploadSuggestion(null)}
                    className="ml-auto px-2 py-1.5 text-[11px] text-secondary-text hover:text-primary-text transition-colors"
                  >{t("suggest_dismiss")}</button>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Chat Input Area */}
          <div className="p-2 bg-bg-card shrink-0">
            <div 
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`rounded border bg-bg-card shadow-sm flex flex-col transition-all relative
                ${isDragging ? "border-dashed border-primary bg-primary/5 ring-4 ring-primary/10" : ""}
                ${busy ? "border-primary ring-1 ring-primary/20" : "border-divider focus-within:ring-2 focus-within:ring-primary/20 focus-within:border-primary"}`}
            >
              {activeSkill && (
                <div className="flex items-center gap-2 p-1 animate-fade-in-up">
                  <button 
                    onClick={() => setActiveSkill(null)}
                    className="flex items-center gap-1.5 px-2 py-1 rounded-full bg-bg-page border border-divider text-xs hover:bg-red-500 hover:text-white transition-colors"
                  >
                    <FiX size={12} />
                    <span>{activeSkill.name}</span>
                  </button>
                </div>
              )}
              {isDragging && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-primary/5 backdrop-blur-[1px] pointer-events-none rounded">
                  <div className="bg-primary/10 p-4 rounded-full border-2 border-primary animate-pulse">
                    <FiUpload className="text-primary" size={32} />
                  </div>
                </div>
              )}
              {showMentionPopup && (
                <div className="absolute bottom-full left-0 mb-2 flex items-end gap-3 z-50">
                  <div className="w-72 bg-bg-card border border-divider rounded shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
                    <div className="p-2 border-b border-divider text-[10px] font-bold text-secondary-text uppercase tracking-widest bg-bg-page/50">
                      {t("mentions")}
                    </div>
                    <div className="max-h-60 overflow-y-auto scrollbar-subtle py-1">
                      {filteredAssets.length > 0 && (
                        <div className="px-3 py-1.5 mt-1 text-[9px] font-bold text-green-500 uppercase opacity-60">{t("assets")}</div>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        {filteredAssets.map(asset => (
                          <button
                            key={asset.asset_label}
                            onClick={() => selectMention(asset, "asset")}
                            className="w-full text-left px-3 py-2 hover:bg-bg-page transition-colors flex items-center gap-2 group rounded"
                          >
                            {asset.kind === "image" && <img src={asset.url} className="w-7 h-7 rounded border border-divider object-cover shadow-sm" />}
                            {asset.kind === "video" && <video src={asset.url} className="w-7 h-7 rounded border border-divider object-cover shadow-sm" />}
                            {asset.kind === "audio" && <div className="w-7 h-7 rounded flex items-center justify-center bg-primary/5 text-primary text-[8px] font-bold uppercase tracking-tight">{t("audio")}</div>}
                            <div className="flex flex-col">
                              <span className="text-xs font-medium text-primary-text">{asset.asset_label}</span>
                              <span className="text-[9px] text-secondary-text truncate max-w-[200px]">{asset.kind}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                      {filteredSkills.length > 0 && (
                        <div className="px-3 py-1.5 text-[9px] font-bold text-primary uppercase opacity-60">{t("skills")}</div>
                      )}
                      {filteredSkills.map(skill => (
                        <button
                          key={skill.name}
                          onClick={() => selectMention(skill, "skill")}
                          className="w-full text-left px-3 py-2 hover:bg-bg-page transition-colors flex items-center gap-2 group"
                        >
                          <RiSparklingLine size={12} className="text-primary opacity-50 group-hover:opacity-100" />
                          <span className="text-xs font-medium text-primary-text">{skill.name}</span>
                        </button>
                      ))}                      
                      {filteredSkills.length === 0 && filteredAssets.length === 0 && (
                        <div className="px-4 py-8 text-center text-secondary-strong text-xs italic">{t("no_matches")}</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
              <textarea
                ref={textareaRef}
                value={input}
                autoFocus
                onChange={(e) => {
                  const val = e.target.value;
                  const pos = e.target.selectionStart;
                  setInput(val);
                  
                  // Simple mention detection: check if last char before cursor is @ or if we are already in mention mode
                  const lastAtPos = val.lastIndexOf("@", pos - 1);
                  if (lastAtPos !== -1 && (lastAtPos === 0 || val[lastAtPos - 1] === " ")) {
                    const query = val.substring(lastAtPos + 1, pos);
                    if (!query.includes(" ")) {
                      setMentionQuery(query);
                      setMentionCursorPos(lastAtPos);
                      setShowMentionPopup(true);
                    } else {
                      setShowMentionPopup(false);
                    }
                  } else {
                    setShowMentionPopup(false);
                  }
                }}
                onKeyDown={handleKey}
                onInput={e => { e.target.style.height = "auto"; e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px"; }}
                placeholder={activeSkill ? t("skill_placeholder", activeSkill.name.toLowerCase(), activeSkill.inputs?.[0]?.replace(/_/g, ' ') || t("idea")) : t("input_placeholder")}
                className="w-full bg-transparent px-3 py-3 text-[13px] resize-none focus:outline-none min-h-[50px] max-h-[120px] scrollbar-subtle"
                rows={1}
                disabled={busy}
              />

              {(uploading || attachments.length > 0 || input.includes("@")) && (
                <div className="flex flex-wrap gap-2 border-b px-3 border-divider bg-bg-page/20">
                  {/* Real Attachments */}
                  {attachments.map((att) => (
                    <div 
                      key={att.asset_label} 
                      className="relative group flex items-center gap-2 px-2 py-1 bg-bg-card border border-divider rounded-lg shadow-sm cursor-help transition-all hover:border-primary"
                      onMouseEnter={() => setHoveredAsset(att)}
                      onMouseLeave={() => setHoveredAsset(null)}
                    >
                      <div className="w-5 h-5 rounded overflow-hidden">
                        {att.kind === "image" ? <img src={att.url} className="w-full h-full object-cover" /> : <FiTerminal size={10} />}
                      </div>
                      <span className="text-[10px] font-bold text-secondary-text">{att.asset_label}</span>
                    </div>
                  ))}
                  
                  {/* Mentioned Assets (not in attachments but in text) */}
                  {assets.filter(a => input.includes(`@${a.asset_label}`) && !attachments.find(att => att.asset_label === a.asset_label)).map((a) => (
                    <div 
                      key={a.asset_label} 
                      className="relative group flex items-center gap-2 px-2 py-1 bg-primary/5 border border-primary rounded-lg shadow-sm cursor-help transition-all hover:border-primary"
                      onMouseEnter={() => setHoveredAsset(a)}
                      onMouseLeave={() => setHoveredAsset(null)}
                    >
                      <div className="w-5 h-5 rounded overflow-hidden bg-primary/10 flex items-center justify-center text-primary">
                        {a.kind === "image" ? 
                          <img src={a.url} className="w-full h-full object-cover" /> 
                          : a.kind === "video" ?
                          <video src={a.url} className="w-full h-full object-cover" />
                          : a.kind === "audio" ?
                          <audio src={a.url} className="w-full h-full object-cover" />
                          : <RiSparklingLine size={10} />
                        }
                      </div>
                      <span className="text-[10px] font-bold text-primary">{a.asset_label}</span>
                    </div>
                  ))}
                  {uploading && (
                    <div className="flex items-center gap-2 px-2 py-1 bg-bg-page border border-divider border-dashed rounded-lg">
                      <div className="w-4 h-4 border-2 border-t-transparent border-primary rounded-full animate-spin" />
                      <span className="text-[10px] font-bold text-secondary-text">{uploadProgress}%</span>
                    </div>
                  )}
                </div>
              )}

              {hoveredAsset && (
                <div className="absolute bottom-full left-4 w-72 aspect-square bg-bg-card border border-divider rounded-md shadow-[0_32px_64px_-12px_rgba(0,0,0,0.2)] overflow-hidden z-[110] animate-in fade-in zoom-in-95 duration-200 pointer-events-none">
                  {hoveredAsset.kind === "image" ? (
                    <img src={hoveredAsset.url} className="w-full h-full object-cover" />
                  ) : hoveredAsset.kind === "video" ? (
                    <video src={hoveredAsset.url} className="w-full h-full object-cover" autoPlay muted loop />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center gap-3 bg-bg-page">
                      <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
                        <FiTerminal size={32} />
                      </div>
                      <span className="text-xs font-bold text-secondary-text uppercase tracking-widest">{t("asset_preview", hoveredAsset.kind)}</span>
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 p-5 bg-gradient-to-t from-black/90 via-black/40 to-transparent">
                    <div className="text-sm font-bold text-white tracking-tight">{hoveredAsset.asset_label}</div>
                    <div className="text-[10px] text-white/70 mt-1 uppercase tracking-widest font-bold">{hoveredAsset.kind} • {t("creative_asset")}</div>
                  </div>
                </div>
              )}

              <div className="px-3 pb-2 flex items-center justify-between">
                <div className="flex items-center gap-1">
                  <input 
                    type="file" 
                    className="hidden" 
                    ref={fileInputRef} 
                    accept="image/*,video/*,audio/*"
                    onChange={handleFileUpload}
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    className="p-1.5 rounded hover:bg-bg-page text-secondary-text transition-all"
                    title={t("upload_image")}
                  >
                    <FiUpload size={16} />
                  </button>

                  {/* 极速模式：开启后计划自动批准、跳过确认卡 */}
                  <button
                    type="button"
                    onClick={toggleExpress}
                    className={`p-1.5 rounded transition-all ${expressMode ? "bg-primary/15 text-primary" : "hover:bg-bg-page text-secondary-text"}`}
                    title={expressMode ? t("express_on") : t("express_off")}
                    aria-label={expressMode ? t("express_on") : t("express_off")}
                  >
                    <FiZap size={16} />
                  </button>

                  <div
                    className="relative"
                    tabIndex={-1}
                    onBlur={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget)) {
                        setShowSkillsMenu(false);
                      }
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setShowSkillsMenu(!showSkillsMenu)}
                      className={`p-1.5 rounded hover:bg-bg-page transition-all flex items-center gap-1.5
                        ${showSkillsMenu ? "bg-bg-page text-primary shadow-inner" : "text-secondary-text"}`}
                      title={t("agent_skills")}
                    >
                      <GoBook size={16} />
                    </button>

                    {showSkillsMenu && (
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-[320px] bg-bg-card border border-divider rounded shadow-2xl z-50 overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
                        <div className="px-4 py-3 border-b border-divider flex items-center justify-between bg-bg-page/30">
                          <div>
                            <h3 className="text-[12px] font-bold text-primary-text uppercase tracking-tight">{t("expert_skills")}</h3>
                          </div>
                        </div>
                        <div className="max-h-80 overflow-y-auto p-1.5 scrollbar-subtle">
                          {skills.map(skill => (
                            <button
                              key={skill.name}
                              onClick={() => {
                                setActiveSkill(skill);
                                setShowSkillsMenu(false);
                                textareaRef.current?.focus();
                              }}
                              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded hover:bg-bg-page transition-all text-left group ${activeSkill?.name === skill.name ? "bg-primary/5 border border-primary" : "border border-transparent"}`}
                            >
                              <div className={`w-8 h-8 rounded flex items-center justify-center transition-colors shadow-sm ${activeSkill?.name === skill.name ? "bg-primary text-black" : "bg-bg-page text-primary border border-divider group-hover:bg-primary group-hover:text-black"}`}>
                                <RiSparklingLine size={16} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className={`font-bold capitalize text-[12px] transition-colors ${activeSkill?.name === skill.name ? "text-primary" : "text-primary-text group-hover:text-primary"}`}>
                                  {skill.name}
                                </div>
                                <div className="text-[10px] text-secondary-strong mt-0.5 line-clamp-1 italic">{skill.description || t("specialized_workflow")}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                        <div className="p-2.5 bg-bg-page/50 border-t border-divider text-center">
                          <button 
                            onClick={() => setShowSkillsMenu(false)}
                            className="text-[10px] font-bold text-secondary-text hover:text-primary-text transition-colors"
                          >
                            {t("dismiss")}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  
                  <div 
                    className="relative"
                    tabIndex={-1}
                    onBlur={(e) => {
                      if (!e.currentTarget.contains(e.relatedTarget)) {
                        setShowAssetsMenu(false);
                      }
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setShowAssetsMenu(!showAssetsMenu)}
                      className={`p-1.5 rounded hover:bg-bg-page transition-all flex items-center gap-1.5
                        ${showAssetsMenu ? "bg-bg-page text-primary shadow-inner" : "text-secondary-text"}`}
                      title={t("session_assets")}
                    >
                      <FiImage size={16} />
                    </button>

                    {showAssetsMenu && (
                      <div className="absolute bottom-full right-0 mb-2 w-72 bg-bg-card border border-divider rounded shadow-2xl z-30 animate-fade-in-up">
                        <div className="p-2 mb-2 border-b border-divider text-[10px] font-bold text-secondary-text flex items-center justify-between">
                          <span>{t("session_assets")}</span>
                          <span className="opacity-50">{t("items", mediaAssets.length)}</span>
                        </div>
                        <div className="max-h-80 overflow-y-auto scrollbar-subtle p-2 grid grid-cols-3 gap-2">
                          {mediaAssets.length === 0 ? (
                            <div className="col-span-3 py-8 text-center text-secondary-text text-[10px] italic">{t("no_assets_yet")}</div>
                          ) : (
                            mediaAssets.map((asset, i) => (
                              <div 
                                key={i}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setInput(prev => prev + (prev ? " " : "") + asset.asset_label);
                                  setShowAssetsMenu(false);
                                  textareaRef.current?.focus();
                                }}
                                className="group relative aspect-square rounded border border-divider overflow-hidden bg-bg-page/50 hover:border-primary transition-all cursor-pointer"
                              >
                                {asset.kind === "image" && <img src={asset.url} className="w-full h-full object-cover" />}
                                {asset.kind === "video" && <video src={asset.url} className="w-full h-full object-cover" />}
                                {asset.kind === "audio" && <div className="w-full h-full flex items-center justify-center bg-primary/5 text-primary text-[8px] font-bold uppercase tracking-tight">{t("audio")}</div>}
                                
                                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center p-1 text-center">
                                  <span className="text-[10px] text-white font-bold truncate w-full mb-1">{asset.asset_label}</span>
                                  {/* AI 识别的图片描述（存在 prompt 字段），不展示就浪费了 */}
                                  {asset.prompt && (
                                    <span className="text-[8px] text-white/80 leading-tight line-clamp-3 w-full">{asset.prompt}</span>
                                  )}
                                </div>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => sendMessage()}
                    disabled={busy || (!input.trim() && attachments.length === 0)}
                    aria-label={t("send")}
                    className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shadow-sm ml-1
                      ${busy || (!input.trim() && attachments.length === 0)
                        ? "bg-[var(--bg-card-hover)] text-[var(--text-muted)] cursor-not-allowed"
                        : "bg-primary text-black hover:scale-105"}`}
                  >
                    {busy ? <BiLoaderAlt size={14} className="animate-spin" /> : <FiSend size={14} />}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}



// ── Event pills ────────────────────────────────────────────────────────────────
// 用户友好的动作文案（不暴露内部工具名 edit_image / 模型名 GPT-IMAGE-2 等）
const TOOL_LABEL_KEYS = {
  generate_image: "tool_generate_image", edit_image: "tool_edit_image", enhance_image: "tool_enhance_image",
  generate_video: "tool_generate_video", image_to_video: "tool_image_to_video", edit_video: "tool_edit_video",
  lipsync_video: "tool_lipsync_video", concat_videos: "tool_concat_videos", generate_audio: "tool_generate_audio",
  extract_text: "tool_extract_text", upload_file: "tool_upload_file", ask_user: "tool_ask_user",
};
function friendlyAction(name) { return t(TOOL_LABEL_KEYS[name] || "tool_processing"); }
function friendlyDone(name, asset) {
  if (name === "extract_text") return t("done_text_extracted");
  if (asset?.kind === "video") return t("done_video");
  if (asset?.split_role === "subject") return t("done_subject");
  if (asset?.split_role === "bg") return t("done_bg");
  return t("done_image");
}

// 已完成的 tool_call 不再显示转圈：把每个 tool_call 与它后面最近的一个 tool_result/error 配对，
// 配上的（已出结果）隐藏掉、只留结果勾；没配上的（仍在跑）才显示转圈。修「重进历史会话还在转圈」。
function visibleEvents(events) {
  const arr = (events || []).filter(e => e && ["tool_call", "tool_result", "plan_propose", "error", "info"].includes(e.type));
  // 按 job_id 分组配对：一个 tool_call 只被「同一 job」后面的 result/error 消解，避免多任务事件交错
  // 时把 A 的转圈用 B 的结果消掉（会出现 A 看似完成、B 永远转圈）。
  const resultsByJob = {};
  arr.forEach((e, i) => {
    if (e.type === "tool_result" || e.type === "error") {
      const jid = e.job_id || "_";
      (resultsByJob[jid] = resultsByJob[jid] || []).push(i);
    }
  });
  const used = new Set();
  return arr.filter((e, i) => {
    if (e.type !== "tool_call") return true;
    const pool = resultsByJob[e.job_id || "_"] || [];
    const r = pool.find(j => j > i && !used.has(j));
    if (r !== undefined) { used.add(r); return false; } // 已出结果 → 隐藏转圈
    return true;                                          // 仍在跑 → 保留转圈
  });
}

function EventPill({ event }) {
  if (event.type === "tool_call") return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-bg-page/70 text-secondary-strong text-[12px] mt-1.5">
      <span className="typing-dots text-primary"><span /><span /><span /></span>
      <span>{friendlyAction(event.name)}…</span>
      {/* P1-5.1 ETA：等待有预期才不焦虑。后端随 tool_call 下发 est_seconds，有才显示 */}
      {Number(event.est_seconds) > 0 && (
        <span className="text-[10px] opacity-60 shrink-0">{t("eta_about", Math.round(Number(event.est_seconds)))}</span>
      )}
    </div>
  );

  if (event.type === "tool_result") {
    const ok = event.result?.ok !== false;
    if (event.name === "ask_user" && event.result?.ask_user) {
      const choices = event.result.choices || [];
      return (
        <div className="px-3.5 py-2.5 rounded-xl bg-bg-page border border-divider text-[12px] mt-1.5 shadow-soft">
          <div className="font-semibold text-primary-text mb-1">{event.result.question}</div>
          {/* P1-1.3 选项可点：以前是纯文本要用户手打「1/2」，现在点选项直接替用户回信。
              仍保留序号，习惯手打的用户照旧可用 */}
          {choices.length > 0 && (
            <div className="flex flex-col gap-1.5 mt-1.5">
              {choices.map((c, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => event.onSend?.(c)}
                  className="text-left px-2.5 py-1.5 rounded-lg bg-bg-card border border-divider text-secondary-text hover:border-primary/60 hover:text-primary-text transition-all"
                >
                  <span className="text-primary font-semibold mr-1.5">{i + 1}.</span>{c}
                </button>
              ))}
            </div>
          )}
          <div className="text-[11px] text-secondary-strong mt-1.5">
            {choices.length > 0 ? t("click_or_reply") : t("reply_to_continue")}
          </div>
        </div>
      );
    }
    return (
      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] mt-1.5 ${
        ok
          ? "bg-[var(--color-success-bg)] text-[var(--color-success)]"
          : "bg-[var(--color-error-bg)] text-[var(--color-error)]"
      }`}>
        {ok ? <FiCheck size={13} /> : <FiX size={13} />}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="font-medium">
            {ok ? friendlyDone(event.name, event.asset) : t("step_skipped")}
          </span>
          {!ok && event.result?.error && (
            <span className="text-[11px] opacity-70 truncate max-w-[160px]" title={event.result.error}>
              {String(event.result.error).replace(/^\w+Error:\s*/i, "").substring(0, 60)}
            </span>
          )}
        </div>
        {/* P1-5.2 失败可重试：一键重发最近一条用户指令（仅最后一条消息会传入 onRetry） */}
        {!ok && typeof event.onRetry === "function" && (
          <button
            type="button"
            onClick={event.onRetry}
            className="shrink-0 px-2.5 py-1 rounded-md border border-current text-[10px] font-bold hover:opacity-75 transition-opacity"
          >
            {t("retry")}
          </button>
        )}
      </div>
    );
  }

  if (event.type === "plan_propose") {
    // P1-1.1 自动批准的计划：保留计划卡（用户能看到 agent 打算做什么、花多少），
    // 但不再要人点按钮 —— 换成一行「已自动开始执行」说明。这是自主感的关键展示位。
    if (event.auto_approved) return (
      <div className="flex flex-col gap-2">
        <PlanVisualizer plan={event} />
        <div className="flex items-center gap-1.5 px-1 pb-1 text-[11px] text-secondary-text">
          <FiZap size={12} className="text-primary shrink-0" />
          <span>
            {event.auto_approved === "express"
              ? t("plan_auto_express")
              : t("plan_auto_low", event.total_credits, AUTO_APPROVE_UNDER)}
          </span>
        </div>
      </div>
    );
    if (event.handled) return null;
    return (
    <div className="flex flex-col gap-2">
      <PlanVisualizer plan={event} />
      <div className="flex items-center gap-2 px-1 pb-1">
        <button
          onClick={() => event.onAction?.(event.job_id, "approve")}
          className="flex-1 py-2.5 rounded-xl bg-primary text-black text-[13px] font-semibold hover:brightness-110 transition-all flex items-center justify-center gap-2"
        >
          <FiCheck size={14} /> {t("approve_execute")}
        </button>
        <button
          onClick={() => event.onAction?.(event.job_id, "reject")}
          className="px-4 py-2.5 rounded-xl bg-bg-card border border-divider text-secondary-text text-[13px] hover:bg-bg-page transition-colors"
        >
          {t("cancel")}
        </button>
      </div>
    </div>
    );
  }

  if (event.type === "info") {
    // If this is an approval request, check if we should show buttons.
    // We avoid showing buttons on the info pill if there's a detailed plan_propose 
    // card already handling the approval for this job.
    const isApproval = event.needs_approval || event.content?.includes("Waiting for approval") || event.content?.includes("Awaiting confirmation");
    
    // If it's already handled, we might want to hide it or show it as a simple label
    if (event.handled && isApproval) return null;

    return (
      <div className={`px-3 py-2 rounded border text-[11px] mt-1 shadow-sm flex items-center justify-between ${
        isApproval ? "bg-primary/5 border-primary" : "bg-bg-page border-divider"
      }`}>
        <div className={`flex items-center gap-2 ${isApproval ? "text-primary" : "text-secondary-text"}`}>
          {isApproval ? <FiAlertCircle size={14} className="animate-pulse" /> : <FiTerminal size={12} className="opacity-50" />}
          <span className="flex-1">{event.content}</span>
        </div>
        {isApproval && !event.handled && (
          <div className="flex items-center gap-1 ml-4">
            <button
              onClick={() => event.onAction?.(event.job_id, "approve")}
              aria-label={t("approve")}
              className="px-3 h-7 rounded bg-primary text-black text-[10px] font-bold hover:brightness-110 transition-all"
            >
              {t("approve")}
            </button>
            <button
              onClick={() => event.onAction?.(event.job_id, "reject")}
              aria-label={t("reject")}
              className="px-3 h-7 rounded bg-bg-card border border-divider text-secondary-text text-[10px] hover:bg-bg-page transition-all"
            >
              {t("reject")}
            </button>
          </div>
        )}
      </div>
    );
  }

  if (event.type === "error") return (
    <div className="px-2.5 py-1.5 rounded bg-[var(--color-error-bg)] text-[var(--color-error)] border border-[var(--color-error)] text-[11px] mt-1 shadow-sm flex items-center gap-2">
      <span className="flex-1 min-w-0">❌ {event.message}</span>
      {/* P1-5.2 失败可重试（同 tool_result 失败态） */}
      {typeof event.onRetry === "function" && (
        <button
          type="button"
          onClick={event.onRetry}
          className="shrink-0 px-2.5 py-1 rounded-md border border-current text-[10px] font-bold hover:opacity-75 transition-opacity"
        >
          {t("retry")}
        </button>
      )}
    </div>
  );

  return null;
}
