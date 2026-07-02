"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import {
  FiPlus, FiUpload, FiSend, FiSearch, FiZap,
  FiImage, FiLayout, FiTerminal, FiChevronDown,
  FiSun, FiMoon, FiMoreHorizontal, FiArrowRight, FiTrash2,
  FiCode, FiCopy, FiX
} from "react-icons/fi";
import { CgTerminal } from "react-icons/cg";
import { RiSparklingLine, RiRobot2Line } from "react-icons/ri";
import { GoBook, GoLightBulb } from "react-icons/go";
import { HiOutlineCube } from "react-icons/hi";
import { useApi } from "@/context/ApiContext";
import { useTheme } from "next-themes";
import Link from "next/link";
import toast from "react-hot-toast";
import Navbar from "@/components/Navbar";
import { useLang } from "@/context/LanguageContext";
import { COPY } from "@/lib/copy";

const API = "/api/v1/creative-agent";

export default function AssistantDashboard() {
  const router = useRouter();
  const { userData } = useApi();
  // 国际化：与落地页同一套 COPY[lang] 体系，中文站不再出现硬编码英文
  const { lang } = useLang();
  const t = COPY[lang].dashboard;
  const [mounted, setMounted] = useState(false);
  const [input, setInput] = useState("");
  const [sessions, setSessions] = useState([]);
  // 会话列表三态：loading / error / ready。
  // 之前 catch 只 console.error，断网时和「真没历史」显示一样，用户会误以为项目全丢了
  const [sessionsState, setSessionsState] = useState("loading");
  const [skills, setSkills] = useState([]);
  // 技能列表三态：loading / error / ready，与 sessionsState 同范式。
  // 之前 catch 只 console.error，断网时技能弹窗一片空白，用户会误以为平台没上技能
  const [skillsState, setSkillsState] = useState("loading");
  const [showSkillsMenu, setShowSkillsMenu] = useState(false);
  const [activeSkill, setActiveSkill] = useState(null);
  const [showMentionPopup, setShowMentionPopup] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionCursorPos, setMentionCursorPos] = useState(0);
  const [hoveredAsset, setHoveredAsset] = useState(null);
  const textareaRef = React.useRef(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [attachments, setAttachments] = useState([]);
  const fileInputRef = React.useRef(null);
  const [placeholderText, setPlaceholderText] = useState("");

  // 占位符跟随语言切换（打字机效果的素材源），文案见 copy.js dashboard.placeholders
  const placeholders = React.useMemo(() => t.placeholders, [t]);

  useEffect(() => {
    let currentPlaceholderIdx = 0;
    let currentCharIdx = 0;
    let isDeleting = false;
    let typingTimer;

    const type = () => {
      const currentString = placeholders[currentPlaceholderIdx];
      
      if (isDeleting) {
        setPlaceholderText(currentString.substring(0, currentCharIdx - 1));
        currentCharIdx--;
      } else {
        setPlaceholderText(currentString.substring(0, currentCharIdx + 1));
        currentCharIdx++;
      }

      let typeSpeed = isDeleting ? 20 : 50;

      if (!isDeleting && currentCharIdx === currentString.length) {
        typeSpeed = 2000;
        isDeleting = true;
      } else if (isDeleting && currentCharIdx === 0) {
        isDeleting = false;
        currentPlaceholderIdx = (currentPlaceholderIdx + 1) % placeholders.length;
        typeSpeed = 500;
      }

      typingTimer = setTimeout(type, typeSpeed);
    };

    typingTimer = setTimeout(type, 1000);

    return () => clearTimeout(typingTimer);
  }, [placeholders]);

  useEffect(() => {
    setMounted(true);
    fetchSessions();
    fetchSkills();
    // 落地页「做同款」带过来的提示词：预填输入框，用户确认后发送
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) {
      setInput(q);
      window.history.replaceState(null, "", "/dashboard");
      setTimeout(() => textareaRef.current?.focus(), 300);
    }
  }, []);

  const fetchSessions = async () => {
    // 重试入口也走这里：先回到 loading，让骨架屏重新出现
    setSessionsState("loading");
    try {
      // 缩略图已随列表一次性返回（thumbnails 字段），无需再为每个会话单独拉 assets（消除 N+1）
      const { data } = await axios.get(`${API}/sessions`);
      setSessions(data.map((s) => ({ ...s, assets: s.thumbnails || [] })));
      setSessionsState("ready");
    } catch (err) {
      // 失败进入 error 态并给重试按钮，而不是静默地假装「暂无历史」
      console.error("Failed to fetch sessions:", err);
      setSessionsState("error");
    }
  };

  const fetchSkills = async () => {
    // 重试入口也走这里：先回 loading 让骨架重新出现
    setSkillsState("loading");
    try {
      const { data } = await axios.get(`${API}/agent-skills`);
      setSkills(data);
      setSkillsState("ready");
    } catch (err) {
      // 失败进 error 态并在弹窗里给重试，不再把「加载失败」伪装成「没有技能」
      console.error("Failed to fetch skills:", err);
      setSkillsState("error");
    }
  };


  // 软删除 + toast 撤销（替代原生 confirm 弹窗）
  const deleteSession = async (sessionId, sessionName) => {
    try {
      await axios.delete(`${API}/sessions/${sessionId}`);
      setSessions(prev => prev.filter(s => s.id !== sessionId));
      // 注意：toast 回调参数不能叫 t，会遮蔽外层的文案对象 t
      toast((tst) => (
        <span className="flex items-center gap-3 text-[12px]">
          {t.deleted((sessionName || t.untitled).slice(0, 20))}
          <button
            className="px-2 py-1 bg-white text-black rounded-sm text-[10px] font-bold uppercase tracking-wider"
            onClick={async () => {
              toast.dismiss(tst.id);
              try {
                await axios.post(`${API}/sessions/${sessionId}/restore`);
                fetchSessions();
              } catch {
                toast.error(t.restoreFailed);
              }
            }}
          >
            {t.undo}
          </button>
        </span>
      ), { duration: 5000 });
    } catch (err) {
      toast.error(t.deleteFailed);
    }
  };

  const removeAttachment = (url) => {
    setAttachments(prev => prev.filter(a => a.url !== url));
  };

  const selectMention = (item, type) => {
    const before = input.substring(0, mentionCursorPos);
    const after = input.substring(textareaRef.current.selectionStart);
    
    if (type === "skill") {
      setActiveSkill(item);
      setInput(before + after); 
    } else {
      const insertion = `@${item.asset_label || "asset"}`;
      setInput(before + insertion + after);
    }
    
    setShowMentionPopup(false);
    setTimeout(() => textareaRef.current?.focus(), 10);
  };

  const processFile = async (file) => {
    if (!file) return;
    // 文档（PDF/Word）：自动创建项目 → 解析 → 直接带用户进入
    const docExt = (file.name.split(".").pop() || "").toLowerCase();
    if (["pdf", "docx", "doc"].includes(docExt)) {
      setUploading(true);
      setUploadProgress(0);
      try {
        const { data: session } = await axios.post(`${API}/sessions`, {});
        const formData = new FormData();
        formData.append("file", file);
        formData.append("lang", lang); // 解析回执跟随站点语言（直接用 context，避免绕 localStorage）
        await axios.post(`/api/v1/sessions/${session.id}/reference-docs`, formData, {
          headers: { "Content-Type": "multipart/form-data" },
          onUploadProgress: (pe) => setUploadProgress(Math.round((pe.loaded * 100) / pe.total)),
        });
        toast.success(t.docUploaded);
        // 输入框里已有的需求一并带入（画布会自动发送）
        const q = input.trim();
        router.push(`/canvas?session=${session.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
      } catch (err) {
        toast.error(err.response?.data?.detail || t.docParseFailed);
      } finally {
        setUploading(false);
        setUploadProgress(0);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
      return;
    }
    // 媒体类型校验
    const okType = /^(image|video|audio)\//.test(file.type || "");
    if (!okType) {
      toast.error(t.unsupported(docExt));
      return;
    }

    setUploading(true);
    setUploadProgress(0);
    try {
      // 1. Get signed URL via proxy
      const { data: signData } = await axios.get("/api/v1/get_upload_url", {
        params: { filename: file.name }
      });

      const { url, fields } = signData;
      const formData = new FormData();
      Object.entries(fields).forEach(([key, value]) => {
        formData.append(key, value);
      });
      formData.append("file", file);
      formData.append("x-proxy-target-url", url);

      // 2. Upload to proxy URL
      await axios.post("/api/v1/upload-binary", formData, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (pe) => {
          setUploadProgress(Math.round((pe.loaded * 100) / pe.total));
        }
      });

      // 3. Final URL
      const uploadedUrl = signData.public_url;
      const kind = file.type?.startsWith("video/") ? "video"
                 : file.type?.startsWith("audio/") ? "audio"
                 : "image";
      
      const att = { url: uploadedUrl, kind };
      setAttachments(prev => [...prev, att]);
      toast.success(t.uploaded);
    } catch (err) {
      console.error("Upload failed", err);
      toast.error(t.uploadFailed);
    } finally {
      setUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleFileUpload = (e) => processFile(e.target.files?.[0]);

  // 只创建会话并带参跳转；消息发送统一由画布执行（避免双发与历史不一致）
  const submittingRef = React.useRef(false);
  const startNewSession = async (initialMsg = "", skill = null, initialAttachments = []) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    try {
      const { data } = await axios.post(`${API}/sessions`, {});
      const sessionId = data.id;
      let url = `/canvas?session=${sessionId}`;

      if (initialAttachments.length > 0) {
        const results = await Promise.all(initialAttachments.map(a =>
          axios.post(`${API}/sessions/${sessionId}/assets`, {
            url: a.url,
            kind: a.kind,
            source_tool: "upload"
          })
        ));
        const labels = results.map(r => r.data.asset_label).join(",");
        url += `&a=${encodeURIComponent(labels)}`;
      }

      if (skill) url += `&skill=${encodeURIComponent(skill.name)}`;
      if (initialMsg) url += `&q=${encodeURIComponent(initialMsg)}`;

      router.push(url);
    } catch (err) {
      toast.error(t.startFailed);
      submittingRef.current = false;
    }
  };

  const handleKey = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (input.trim() || attachments.length > 0) {
        startNewSession(input.trim(), activeSkill, attachments);
      }
    }
  };

  const filteredSkills = skills.filter(s => s.name.toLowerCase().includes(mentionQuery.toLowerCase()));
  const filteredAssets = attachments.map((a, i) => ({ ...a, asset_label: `asset_${i+1}` })).filter(a => a.asset_label.includes(mentionQuery.toLowerCase()));


  if (!mounted) return null;

  return (
    <div className="h-dvh w-full text-sm flex flex-col items-center bg-bg-page animate-fade-in text-primary-text">
      <Navbar />
      <main className="flex flex-col gap-6 items-center w-full h-full overflow-y-auto">
        <div className="flex-1 flex flex-col gap-6 sm:gap-8 items-center w-full max-w-7xl pt-6 sm:pt-8 pb-12 px-4 sm:px-8 lg:px-0">
          {/* 不用 flex 排标题：窄屏会逐词竖排（H4） */}
          <h1 className="font-display text-3xl sm:text-5xl font-extrabold tracking-tight text-center">
            {t.title1}<span className="brand-gradient-text">{t.title2}</span>
          </h1>
          <p className="text-secondary-text text-base sm:text-lg text-center px-4">
            {t.sub}
          </p>
          <div className="flex items-center gap-2 micro-label">
            {t.labels.map((label) => <span key={label}>{label}</span>)}
          </div>
          <div className="w-full max-w-3xl relative">
            <div className="bg-bg-card border border-divider rounded-md shadow-float p-2 focus-within:shadow-pop transition-all ease-[var(--ease-standard)]">
              <textarea
                ref={textareaRef}
                value={input}
                autoFocus
                onChange={(e) => {
                  const val = e.target.value;
                  const pos = e.target.selectionStart;
                  setInput(val);
                  
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
                placeholder={placeholderText}
                className="w-full bg-transparent border-none focus:ring-0 text-lg p-4 h-24 resize-none placeholder:text-secondary-text/70 outline-none scrollbar-subtle"
              />
              <div className="flex items-center justify-between px-2 pb-2">
                <div className="flex items-center gap-2 relative">
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    className="hidden" 
                    onChange={handleFileUpload}
                  />
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 hover:bg-bg-page rounded-full text-secondary-text transition-colors relative"
                    title={t.uploadFile}
                  >
                    {uploading ? (
                      <div className="w-12 h-12 rounded border border-divider border-dashed flex flex-col items-center justify-center bg-bg-page/50">
                        <span className="border-2 border-t-transparent border-primary rounded-full w-7 h-7 animate-spin absolute"></span>
                        <span className="text-[10px] font-bold text-secondary-strong z-10">{uploadProgress}%</span>
                      </div>
                    ) : (
                      <FiPlus size={20} />
                    )}
                  </button>
                  <button 
                    onClick={() => setShowSkillsMenu(!showSkillsMenu)}
                    className={`p-2 hover:bg-bg-page rounded-full transition-colors ${activeSkill || showSkillsMenu ? "text-primary bg-primary/10" : "text-secondary-text"}`}
                    title={t.skillsBtn}
                  >
                    <GoBook size={20} />
                  </button>

                  {/* Mention & Attachment Preview Bar */}
                  {(uploading || attachments.length > 0 || input.includes("@")) && (
                    <div className="absolute bottom-full left-0 mb-1 flex flex-wrap gap-2 bg-bg-card border border-divider rounded shadow-xl z-10 animate-in slide-in-from-bottom-2 duration-300">
                      {attachments.map((att, i) => (
                        <div 
                          key={i} 
                          className="relative group flex items-center gap-2 px-2 py-1 bg-bg-page border border-divider rounded cursor-help hover:border-primary/50 transition-all ease-[var(--ease-standard)]"
                          onMouseEnter={() => setHoveredAsset(att)}
                          onMouseLeave={() => setHoveredAsset(null)}
                        >
                          <div className="w-5 h-5 rounded overflow-hidden">
                            {att.kind === "image" ? <img src={att.url} className="w-full h-full object-cover" /> : <FiTerminal size={10} />}
                          </div>
                          <span className="text-[10px] font-bold text-secondary-strong">{`asset_${i+1}`}</span>
                        </div>
                      ))}
                      
                      {/* Detection for @asset_N in text */}
                      {input.match(/@asset_\d+/g)?.map(match => {
                        const index = parseInt(match.split('_')[1]) - 1;
                        const asset = attachments[index];
                        if (!asset) return null;
                        return (
                          <div 
                            key={match}
                            className="relative group flex items-center gap-2 px-2 py-1 bg-primary/5 border border-primary/20 rounded-lg cursor-help hover:border-primary/50 transition-all ease-[var(--ease-standard)]"
                            onMouseEnter={() => setHoveredAsset(asset)}
                            onMouseLeave={() => setHoveredAsset(null)}
                          >
                            <div className="w-5 h-5 rounded overflow-hidden bg-primary/10 flex items-center justify-center text-primary">
                              {asset.kind === "image" ? <img src={asset.url} className="w-full h-full object-cover" /> : <RiSparklingLine size={10} />}
                            </div>
                            <span className="text-[10px] font-bold text-primary">{match}</span>
                          </div>
                        );
                      })}

                      {uploading && (
                        <div className="flex items-center gap-2 px-2 py-1 bg-bg-page border border-divider border-dashed rounded-lg">
                          <div className="w-3 h-3 border-2 border-t-transparent border-primary rounded-full animate-spin" />
                          <span className="text-[10px] font-bold text-secondary-strong">{uploadProgress}%</span>
                        </div>
                      )}
                    </div>
                  )}

                  {hoveredAsset && (
                    <div className="absolute bottom-full left-0 mb-10 w-72 aspect-square bg-bg-card border border-divider rounded-md shadow-pop overflow-hidden z-[110] animate-in fade-in zoom-in-95 duration-200 pointer-events-none">
                      {hoveredAsset.kind === "image" ? (
                        <img src={hoveredAsset.url} className="w-full h-full object-cover" />
                      ) : hoveredAsset.kind === "video" ? (
                        <video src={hoveredAsset.url} className="w-full h-full object-cover" autoPlay muted loop />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center bg-bg-page gap-3 p-6 text-center">
                          <FiTerminal size={48} className="text-primary opacity-20" />
                          <div className="text-xs font-medium text-secondary-text truncate w-full">{hoveredAsset.url.split('/').pop()}</div>
                        </div>
                      )}
                    </div>
                  )}

                  {showMentionPopup && (
                    <div className="absolute bottom-full left-0 mb-2 flex items-end gap-3 z-50">
                      <div className="w-64 bg-bg-card border border-divider rounded shadow-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-2 duration-200">
                        <div className="p-2 border-b border-divider/30 text-[10px] font-bold text-secondary-strong uppercase tracking-widest bg-bg-page/50">
                          {t.mentions}
                        </div>
                        <div className="max-h-60 overflow-y-auto scrollbar-subtle py-1">
                          {filteredSkills.length > 0 && (
                            <div className="px-3 py-1.5 text-[9px] font-bold text-primary uppercase opacity-60">{t.skillsGroup}</div>
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
                          {filteredSkills.length === 0 && (
                            <div className="px-4 py-8 text-center text-secondary-text text-xs italic opacity-50">{t.noMatches}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    {showSkillsMenu && (
                      <div className="fixed inset-0 z-50 bg-bg-page/60 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in duration-300">
                        <div className="fixed inset-0" onClick={() => setShowSkillsMenu(false)} />
                        <div className="relative w-full max-w-2xl bg-bg-card border border-divider rounded-md shadow-pop overflow-hidden animate-in zoom-in-95 duration-200">
                          <div className="px-4 py-3 border-b border-divider flex items-center justify-between bg-bg-page/30">
                            <div className="flex items-center gap-4">
                              <div className="w-12 h-12 rounded bg-primary/10 flex items-center justify-center text-primary shadow-inner border border-primary/20">
                                <GoBook size={24} />
                              </div>
                              <div>
                                <h3 className="text-xl font-bold text-primary-text tracking-tight">{t.skillsTitle}</h3>
                                <p className="text-xs text-secondary-text font-medium opacity-70">{t.skillsSub}</p>
                              </div>
                            </div>
                            <button 
                              onClick={() => setShowSkillsMenu(false)}
                              className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-bg-page border border-divider rounded text-xs font-bold text-secondary-text hover:text-primary hover:border-primary/30 transition-all ease-[var(--ease-standard)]"
                            >
                              <CgTerminal size={14} />
                              {t.dismiss}
                            </button>
                          </div>
                          <div className="p-2 max-h-[60vh] overflow-y-auto scrollbar-subtle grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {/* 技能三态之 loading：骨架卡占位 */}
                            {skillsState === "loading" && Array.from({ length: 4 }).map((_, i) => (
                              <div key={`skill-skeleton-${i}`} className="h-24 rounded bg-bg-page/50 border border-divider/50 animate-pulse" />
                            ))}
                            {/* 三态之 error：加载失败 ≠ 没有技能，给明确失败提示 + 重试 */}
                            {skillsState === "error" && (
                              <div className="col-span-full flex flex-col items-center justify-center gap-3 py-10">
                                <div className="text-sm font-bold text-primary-text">{t.skillsError}</div>
                                <button
                                  onClick={fetchSkills}
                                  className="px-4 py-2 text-xs font-bold text-primary border border-primary/30 rounded hover:bg-primary/10 transition-colors"
                                >
                                  {t.retry}
                                </button>
                              </div>
                            )}
                            {/* 三态之 empty：确认加载成功且列表确实为空 */}
                            {skillsState === "ready" && skills.length === 0 && (
                              <div className="col-span-full py-10 text-center text-sm text-secondary-text">{t.skillsEmpty}</div>
                            )}
                            {skills.map(s => (
                              <button
                                key={s.name}
                                onClick={() => { setActiveSkill(s); setShowSkillsMenu(false); }}
                                className={`group relative flex flex-col gap-2 p-4 rounded transition-all ease-[var(--ease-standard)] text-left border ${activeSkill?.name === s.name ? "bg-primary/5 border-primary/30 ring-1 ring-primary/20" : "bg-bg-page/50 border-divider/50 hover:border-primary/30 hover:bg-bg-page hover:shadow-md"}`}
                              >
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-3">
                                    <div className={`w-8 h-8 rounded flex items-center justify-center transition-all ease-[var(--ease-standard)] ${activeSkill?.name === s.name ? "bg-primary text-black scale-110 shadow-lg shadow-primary/20" : "bg-bg-card text-primary border border-divider group-hover:scale-110"}`}>
                                      <RiSparklingLine size={16} />
                                    </div>
                                    <div className="font-bold text-sm tracking-tight capitalize group-hover:text-primary transition-colors">{s.name.replace(/-/g, ' ')}</div>
                                  </div>
                                  {activeSkill?.name === s.name && <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />}
                                </div>
                                <div className="text-[11px] text-secondary-strong line-clamp-2 leading-relaxed opacity-80 h-8">{s.description || t.skillDefaultDesc}</div>
                              </button>
                            ))}
                          </div>
                          <div className="px-4 py-2 bg-bg-page/50 border-t border-divider flex items-center justify-between">
                            <div className="flex items-center gap-2 text-[10px] font-bold text-secondary-strong uppercase tracking-widest opacity-60">
                              <RiRobot2Line size={14} />
                              {t.protocol}
                            </div>
                            <button
                              onClick={() => setShowSkillsMenu(false)}
                              className="px-4 py-2 text-xs font-bold text-primary-text hover:bg-bg-page rounded transition-colors border border-transparent hover:border-divider"
                            >
                              {t.dismiss}
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  {activeSkill && (
                    <div className="flex items-center gap-1.5 px-2 py-1 bg-primary/10 border border-primary/20 rounded-full text-primary text-[10px] font-bold animate-in zoom-in-95">
                      <RiSparklingLine size={12} />
                      {activeSkill.name}
                      <button onClick={() => setActiveSkill(null)} className="hover:text-primary-text ml-1">&#x2715;</button>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {attachments.length > 0 && (
                    <div className="flex items-center -space-x-2 mr-2">
                      {attachments.map((a, i) => (
                        <div key={i} className="w-6 h-6 rounded-full border-2 border-bg-card bg-bg-page overflow-hidden shadow-sm">
                          {a.kind === "image" ? <img src={a.url} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center bg-black"><FiTerminal size={10} className="text-white" /></div>}
                        </div>
                      ))}
                      <button onClick={() => setAttachments([])} className="w-6 h-6 rounded-full border-2 border-bg-card bg-red-500 text-white flex items-center justify-center hover:bg-red-600 transition-colors z-10">
                        <FiPlus size={12} className="rotate-45" />
                      </button>
                    </div>
                  )}
                  <button
                    onClick={() => (input.trim() || attachments.length > 0) && startNewSession(input.trim(), activeSkill, attachments)}
                    disabled={!input.trim() && attachments.length === 0}
                    aria-label={t.send}
                    title={t.send}
                    className={`p-2 rounded-full transition-all ease-[var(--ease-standard)] ${input.trim() || attachments.length > 0 ? "bg-primary text-black shadow-lg shadow-primary/20 hover:scale-105" : "bg-bg-page text-secondary-text/30"}`}
                  >
                    <FiSend size={18} />
                  </button>
                </div>
              </div>
            </div>

            {/* 空态起点卡（P0-4）：新用户面对空输入框不知道写什么——给 4 张电商化示例，
                点击只预填 + 聚焦（不直接发送，和 ?q= 预填一致：发送前留给用户确认/替换产品名，避免误创建会话） */}
            <div className="mt-3">
              <div className="micro-label text-secondary-text/60 mb-2 px-1">{t.startersHint}</div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {t.starters.map((s) => (
                  <button
                    key={s.label}
                    onClick={() => {
                      setInput(s.prompt);
                      setTimeout(() => textareaRef.current?.focus(), 10);
                    }}
                    className="group text-left px-3 py-2.5 bg-bg-card border border-divider rounded hover:border-primary/50 hover:bg-primary/5 hover:shadow-md transition-all ease-[var(--ease-standard)]"
                  >
                    <div className="text-xs font-bold text-primary-text group-hover:text-primary transition-colors truncate">{s.label}</div>
                    <div className="text-[10px] text-secondary-text/70 line-clamp-2 mt-1 leading-relaxed">{s.prompt}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="w-full">
            <h2 className="text-xl font-bold mb-6">{t.recent}</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {/* New Project Card */}
              <button 
                onClick={() => router.push("/canvas")}
                className="group aspect-[16/10] bg-bg-card border-2 border-dashed border-divider rounded-lg flex flex-col items-center justify-center gap-3 hover:border-primary hover:bg-primary/5 transition-all ease-[var(--ease-standard)]"
              >
                <div className="w-10 h-10 rounded-full bg-bg-page border border-divider flex items-center justify-center text-secondary-text group-hover:text-primary group-hover:border-primary group-hover:scale-110 transition-all ease-[var(--ease-standard)]">
                  <FiPlus size={24} />
                </div>
                <span className="text-xs font-bold text-secondary-text group-hover:text-primary">{t.newProject}</span>
              </button>

              {/* 三态（P0-5）之 error：请求失败 ≠ 没有历史，给出明确的失败提示 + 重试入口 */}
              {sessionsState === "error" && (
                <div className="col-span-full sm:col-span-2 lg:col-span-3 flex flex-col items-center justify-center gap-3 py-10 bg-bg-card border border-divider rounded-lg">
                  <div className="text-sm font-bold text-primary-text">{t.errorTitle}</div>
                  <button
                    onClick={fetchSessions}
                    className="px-4 py-2 text-xs font-bold text-primary border border-primary/30 rounded hover:bg-primary/10 transition-colors"
                  >
                    {t.retry}
                  </button>
                </div>
              )}

              {/* 三态之 empty：确认加载成功且确实没有历史，引导开始第一个项目（聚焦输入框） */}
              {sessionsState === "ready" && sessions.length === 0 && (
                <div className="col-span-full sm:col-span-2 lg:col-span-3 flex flex-col items-center justify-center gap-3 py-10 bg-bg-card border border-divider rounded-lg">
                  <div className="text-sm text-secondary-text">{t.emptyTitle}</div>
                  <button
                    onClick={() => textareaRef.current?.focus()}
                    className="px-4 py-2 text-xs font-bold text-primary border border-primary/30 rounded hover:bg-primary/10 transition-colors"
                  >
                    {t.emptyCta}
                  </button>
                </div>
              )}

              {/* Session Cards */}
              {sessions.map((session) => (
                <div 
                  key={session.id}
                  onClick={() => router.push(`/canvas?session=${session.id}`)}
                  className="group relative aspect-[16/10] bg-bg-card border border-divider rounded-lg overflow-hidden cursor-pointer hover:shadow-float hover:border-primary/50 transition-all ease-[var(--ease-standard)]"
                >
                  <div className="h-full w-full grid grid-cols-2 grid-rows-2 gap-0.5 bg-divider/20">
                    {session.assets && session.assets.length > 0 ? (
                      session.assets.map((asset, i) => (
                        <div key={i} className={`relative overflow-hidden ${session.assets.length === 1 ? 'col-span-2 row-span-2' : session.assets.length === 2 ? 'row-span-2' : ''}`}>
                          {asset.kind === "image" ? (
                            <img src={asset.url} alt="" loading="lazy" decoding="async" className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full bg-black/5 flex items-center justify-center"><FiImage className="text-secondary-text/20" size={32} /></div>
                          )}
                        </div>
                      ))
                    ) : (
                      <div className="col-span-2 row-span-2 flex items-center justify-center bg-bg-page">
                        <RiRobot2Line size={48} className="text-secondary-text/10" />
                      </div>
                    )}
                    {session.assets && session.assets.length > 0 && session.assets.length < 4 && Array.from({ length: 4 - session.assets.length }).map((_, i) => (
                      <div key={`empty-${i}`} className="bg-bg-page/50" />
                    ))}
                  </div>

                  <button
                    onClick={(e) => { e.stopPropagation(); deleteSession(session.id, session.name); }}
                    className="absolute top-2 right-2 z-10 p-1.5 rounded bg-black/60 text-white opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-all ease-[var(--ease-standard)]"
                    title={t.deleteChat}
                  >
                    <FiTrash2 size={14} />
                  </button>

                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-4">
                    <div className="text-white font-bold text-sm truncate">{session.name || t.untitled}</div>
                    <div className="text-white/60 text-[10px] mt-1">{t.assetsCount(session.assets?.length || 0)}</div>
                  </div>
                  
                  <div className="absolute bottom-0 left-0 right-0 p-3 bg-bg-card/90 backdrop-blur-sm border-t border-divider opacity-100 group-hover:opacity-0 transition-opacity">
                    <div className="text-primary-text font-bold text-xs truncate">{session.name || t.untitled}</div>
                  </div>
                </div>
              ))}

              {/* 三态之 loading：复用原有骨架屏 */}
              {sessionsState === "loading" && Array.from({ length: 3 }).map((_, i) => (
                <div key={`skeleton-${i}`} className="aspect-[16/10] bg-bg-card border border-divider rounded-md animate-pulse" />
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
