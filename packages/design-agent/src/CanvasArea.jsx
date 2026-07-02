"use client";

import React, {
  useState,
  useRef,
  useEffect,
  forwardRef,
  useImperativeHandle,
} from "react";
import Konva from "konva";
import {
  Stage,
  Layer,
  Image as KonvaImage,
  Text as KonvaText,
  Transformer,
  Line,
  Group,
  Rect,
  Arc,
} from "react-konva";
import toast from "react-hot-toast";
import { FiType, FiGrid, FiAlignJustify, FiLayers, FiScissors, FiTrash2, FiX } from "react-icons/fi";
import { t } from "./i18n";

// 电商文字预设：AI 出背景，文字做成可编辑矢量图层叠加，导出精确不糊（扩散模型渲染文字必错）。
// 统一带描边 + 阴影，保证在杂乱产品图上也清晰可读；fillAfterStrokeEnabled 让填充压在描边上、字形干净。
const TEXT_PRESETS = {
  title: {
    labelKey: "preset_title", text: "主标题",
    style: { fontSize: 48, fontStyle: "bold", fill: "#ffffff", stroke: "#000000", strokeWidth: 2, fillAfterStrokeEnabled: true, lineJoin: "round", align: "center", shadowColor: "#000000", shadowBlur: 8, shadowOpacity: 0.5, fontFamily: "Inter, sans-serif" },
  },
  price: {
    labelKey: "preset_price", text: "¥99",
    style: { fontSize: 56, fontStyle: "bold", fill: "#ffe24d", stroke: "#7a1f1f", strokeWidth: 3, fillAfterStrokeEnabled: true, lineJoin: "round", align: "left", shadowColor: "#000000", shadowBlur: 6, shadowOpacity: 0.45, fontFamily: "Inter, sans-serif" },
  },
  badge: {
    labelKey: "preset_badge", text: "限时5折",
    style: { fontSize: 30, fontStyle: "bold", fill: "#ffffff", stroke: "#dd1111", strokeWidth: 4, fillAfterStrokeEnabled: true, lineJoin: "round", align: "center", shadowColor: "#000000", shadowBlur: 4, shadowOpacity: 0.4, fontFamily: "Inter, sans-serif" },
  },
  body: {
    labelKey: "preset_body", text: "产品卖点描述",
    style: { fontSize: 22, fontStyle: "normal", fill: "#ffffff", stroke: "#000000", strokeWidth: 1, fillAfterStrokeEnabled: true, lineJoin: "round", align: "left", shadowColor: "#000000", shadowBlur: 4, shadowOpacity: 0.4, fontFamily: "Inter, sans-serif" },
  },
};

const TEXT_SWATCHES = ["#ffffff", "#000000", "#ffe24d", "#ff3b3b", "#19c37d", "#3b82f6"];

// 套图模板：选中一批产品图，AI 按同一套约束（排版/字体/风格写进系统提示）批量生成
// 一组风格统一的「新图」——不是事后叠文字图层，而是约束生成本身。模板细节在后端
// app/agents/set_templates.py；这里只用 key/label/desc 做选择。后端 key 必须一致。
const SET_TEMPLATES = {
  main6: { labelKey: "tpl_main6", descKey: "tpl_main6_desc", single: true, count: 6, ctaKey: "tpl_main6_cta" },
  detail7: { labelKey: "tpl_detail7", descKey: "tpl_detail7_desc", single: true, count: 7, ctaKey: "tpl_detail7_cta" },
  ecom: { labelKey: "tpl_ecom", descKey: "tpl_ecom_desc" },
  rednote: { labelKey: "tpl_rednote", descKey: "tpl_rednote_desc" },
  minimal: { labelKey: "tpl_minimal", descKey: "tpl_minimal_desc" },
};

// 混合方案的【固定文字模板】：AI 出干净底图后，前端在每张图上叠这些槽位。
// 坐标/字号都相对图片尺寸（rel*）→ 全集排版/字体/字号 100% 一致，只有文字内容可改。
// 槽位区域要对得上后端生成提示里预留的空白区（标题区/卖点区）。
// 精致排版：优雅衬线（思源宋体）+ 字间距 + 分隔线 + 克制配色层次，贴合高端产品气质。
// divider 是一条 em-dash 细线（不占内容 key），靠 slotText 原样保留。
const _SERIF = "Noto Serif SC";
const _INK = "#262320";     // 墨黑（比纯黑柔和、更高级）
const _GOLD = "#a8884e";    // 低饱和金（分隔线/点缀）
const _GREY = "#8a847c";    // 副文字暖灰
const SET_TEMPLATE_SLOTS = {
  ecom: [
    { key: "title",    text: "产品标题",        relX: 0,    relY: 0.060, relW: 1,    align: "center", relSize: 0.056, style: { fontStyle: "bold",   fill: _INK,  fontFamily: _SERIF, letterSpacing: 2 } },
    { key: "divider",  text: "————",           relX: 0,    relY: 0.150, relW: 1,    align: "center", relSize: 0.022, style: { fontStyle: "normal", fill: _GOLD, fontFamily: _SERIF, letterSpacing: -1 } },
    { key: "subtitle", text: "副标题 · 一句卖点", relX: 0,    relY: 0.180, relW: 1,    align: "center", relSize: 0.028, style: { fontStyle: "normal", fill: _GREY, fontFamily: _SERIF, letterSpacing: 3 } },
    { key: "point0",   text: "卖点一",          relX: 0.07, relY: 0.730, relW: 0.55, align: "left",   relSize: 0.027, style: { fontStyle: "normal", fill: _INK,  fontFamily: _SERIF, letterSpacing: 1 } },
    { key: "point1",   text: "卖点二",          relX: 0.07, relY: 0.795, relW: 0.55, align: "left",   relSize: 0.027, style: { fontStyle: "normal", fill: _INK,  fontFamily: _SERIF, letterSpacing: 1 } },
    { key: "point2",   text: "卖点三",          relX: 0.07, relY: 0.860, relW: 0.55, align: "left",   relSize: 0.027, style: { fontStyle: "normal", fill: _INK,  fontFamily: _SERIF, letterSpacing: 1 } },
  ],
  rednote: [
    { key: "title",    text: "大标题",     relX: 0, relY: 0.080, relW: 1, align: "center", relSize: 0.072, style: { fontStyle: "bold",   fill: _INK,  fontFamily: _SERIF, letterSpacing: 2 } },
    { key: "divider",  text: "————",      relX: 0, relY: 0.180, relW: 1, align: "center", relSize: 0.022, style: { fontStyle: "normal", fill: _GOLD, fontFamily: _SERIF, letterSpacing: -1 } },
    { key: "subtitle", text: "副标题说明", relX: 0, relY: 0.210, relW: 1, align: "center", relSize: 0.034, style: { fontStyle: "normal", fill: _GREY, fontFamily: _SERIF, letterSpacing: 3 } },
  ],
  minimal: [
    { key: "title",   text: "标题",  relX: 0.07, relY: 0.800, relW: 0.86, align: "left", relSize: 0.048, style: { fontStyle: "bold",   fill: _INK,  fontFamily: _SERIF, letterSpacing: 2 } },
    { key: "divider", text: "———",   relX: 0.07, relY: 0.880, relW: 0.3,  align: "left", relSize: 0.02,  style: { fontStyle: "normal", fill: _GOLD, fontFamily: _SERIF, letterSpacing: -1 } },
  ],
};

// ── Google Fonts：文字图层可换任意免费字体 ──────────────────────────
// 精选一批（含中文显示字体 + 拉丁展示字体）；按需动态加载，避免一次性拉全。
const GOOGLE_FONTS = [
  { label: "Inter（默认）", family: "Inter, sans-serif" },
  { label: "思源黑体", family: "Noto Sans SC" },
  { label: "思源宋体", family: "Noto Serif SC" },
  { label: "站酷小薇", family: "ZCOOL XiaoWei" },
  { label: "站酷黄油体", family: "ZCOOL QingKe HuangYou" },
  { label: "马善政毛笔", family: "Ma Shan Zheng" },
  { label: "龙藏手写", family: "Long Cang" },
  { label: "Playfair Display", family: "Playfair Display" },
  { label: "Montserrat", family: "Montserrat" },
  { label: "Oswald", family: "Oswald" },
  { label: "Bebas Neue", family: "Bebas Neue" },
  { label: "Lobster", family: "Lobster" },
];

const _loadedFonts = new Set();
// 动态加载一个 Google Font 并等到可用，再让 Konva 重绘（否则会先用回退字体渲染）
function loadGoogleFont(family) {
  if (typeof document === "undefined" || !family || family.includes("Inter") || family.includes("sans-serif")) {
    return Promise.resolve();
  }
  if (!_loadedFonts.has(family)) {
    _loadedFonts.add(family);
    const id = "gf-" + family.replace(/\s+/g, "-");
    if (!document.getElementById(id)) {
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@400;700&display=swap`;
      document.head.appendChild(link);
    }
  }
  if (document.fonts?.load) {
    return Promise.all([
      document.fonts.load(`700 24px "${family}"`),
      document.fonts.load(`400 24px "${family}"`),
    ]).then(() => document.fonts.ready).catch(() => {});
  }
  return new Promise((r) => setTimeout(r, 600));
}

// 把后端生成的真实文案 {title, subtitle, points:[...]} 映射到槽位 key
function slotText(slot, content) {
  if (!content) return slot.text;
  if (slot.key === "title") return content.title || slot.text;
  if (slot.key === "subtitle") return content.subtitle || slot.text;
  const m = /^point(\d+)$/.exec(slot.key || "");
  if (m) {
    const p = (content.points || [])[Number(m[1])];
    return p ? `• ${p}` : slot.text;
  }
  return slot.text;
}

const MenuButton = ({ label, shortcut, onClick, theme }) => (
  <button
    className={`w-full text-left px-4 py-1.5 flex justify-between items-center transition-colors ${
      theme === "dark" ? "hover:bg-bg-page" : "hover:bg-bg-page"
    }`}
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
  >
    <span>{label}</span>
    {shortcut && (
      <span className="text-xs opacity-50 font-medium">{shortcut}</span>
    )}
  </button>
);

const MenuDivider = ({ theme }) => (
  <div
    className={`h-[1px] w-full my-1 ${theme === "dark" ? "bg-border-main" : "bg-border-main"}`}
  />
);

const URLImage = ({
  imageObj,
  isSelected,
  multiSelected,
  spaceDown,
  onToggleMulti,
  onSelect,
  onChange,
  onDragStart,
  onDragMove,
  onDragEnd,
}) => {
  const shapeRef = useRef();
  const trRef = useRef();
  const { zIndex, ...restImageObj } = imageObj;

  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [pos, setPos] = useState({ x: imageObj.x, y: imageObj.y });

  useEffect(() => {
    setPos({ x: imageObj.x, y: imageObj.y });
  }, [imageObj.x, imageObj.y]);

  useEffect(() => {
    if (isSelected && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer().batchDraw();
      const node = shapeRef.current;
      setDims({
        w: Math.round(node.width() * node.scaleX()),
        h: Math.round(node.height() * node.scaleY()),
      });
    }
  }, [isSelected, imageObj.width, imageObj.height, imageObj.scaleX, imageObj.scaleY]);

  const handleTransform = () => {
    const node = shapeRef.current;
    if (node) {
      setDims({
        w: Math.round(node.width() * node.scaleX()),
        h: Math.round(node.height() * node.scaleY()),
      });
      setPos({ x: node.x(), y: node.y() });
    }
  };


  return (
    <>
      <KonvaImage
        opacity={imageObj.hidden ? 0 : 1}
        listening={!imageObj.hidden}
        onClick={(e) => {
          if (imageObj.locked || spaceDown) return;
          if (e.evt?.shiftKey) { e.cancelBubble = true; onToggleMulti(); return; }
          onSelect(e);
        }}
        onTap={(e) => {
          if (imageObj.locked || spaceDown) return;
          onSelect(e);
        }}
        ref={shapeRef}
        {...restImageObj}
        id={imageObj.id}
        name="konva-item"
        draggable={!imageObj.locked && !spaceDown}
        onDragStart={(e) => onDragStart?.(e)}
        onDragMove={(e) => {
          setPos({ x: e.target.x(), y: e.target.y() });
          onDragMove(e);
        }}

        onDragEnd={(e) => onDragEnd(e, imageObj)}
        onTransformEnd={(e) => {
          const node = shapeRef.current;
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();
          node.scaleX(1);
          node.scaleY(1);
          onChange({
            ...imageObj,
            x: node.x(),
            y: node.y(),
            width: Math.max(5, node.width() * scaleX),
            height: Math.max(5, node.height() * scaleY),
            rotation: node.rotation(),
          });
        }}
      />
      {multiSelected && (
        <Rect
          listening={false}
          x={pos.x} y={pos.y}
          width={(imageObj.width || 200)} height={(imageObj.height || 200)}
          rotation={imageObj.rotation}
          stroke="#3898ec" strokeWidth={2 / (shapeRef.current?.getStage()?.scaleX() || 1)}
          fill="rgba(56,152,236,0.12)"
        />
      )}
      {isSelected && !imageObj.locked && (
        <Group
          x={pos.x}
          y={pos.y - 24}
          rotation={imageObj.rotation}
          scaleX={1 / (shapeRef.current?.getStage()?.scaleX() || 1)}
          scaleY={1 / (shapeRef.current?.getStage()?.scaleY() || 1)}
        >
          {/* Label Background */}
          <Rect
            width={dims.w * (shapeRef.current?.getStage()?.scaleX() || 1)}
            height={20}
            fill="transparent"
          />
          {/* Asset Type */}
          <KonvaText
            text={t("image")}
            fontSize={11}
            fontFamily="sans-serif"
            fill="#3898ec"
            x={0}
            y={5}
          />
          {/* Dimensions */}
          <KonvaText
            text={`${dims.w} × ${dims.h}`}
            fontSize={11}
            fontFamily="sans-serif"
            fill="#3898ec"
            align="right"
            width={dims.w * (shapeRef.current?.getStage()?.scaleX() || 1)}
            x={0}
            y={5}
          />
        </Group>
      )}
      {isSelected && !imageObj.locked && (
        <Transformer
          ref={trRef}
          keepRatio={true}
          centeredScaling={true}
          onTransform={handleTransform}
          enabledAnchors={[
            "top-left",
            "top-right",
            "bottom-left",
            "bottom-right",
          ]}
          anchorSize={8}
          anchorCornerRadius={4}
          anchorStroke="#3898ec"
          anchorFill="white"
          borderStroke="#3898ec"
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < 5 || newBox.height < 5) {
              return oldBox;
            }
            return newBox;
          }}
        />
      )}
    </>
  );
};

const URLVideo = ({
  videoObj,
  isSelected,
  onSelect,
  onChange,
  onDragMove,
  onDragEnd,
}) => {
  const shapeRef = useRef();
  const trRef = useRef();
  const [video, setVideo] = useState(null);

  useEffect(() => {
    const videoE = document.createElement("video");
    
    const tryLoad = (useCors) => {
      if (useCors) videoE.crossOrigin = "anonymous";
      else videoE.removeAttribute("crossOrigin");
      videoE.src = videoObj.src;
      videoE.loop = true;
      videoE.muted = true;
      videoE.playsInline = true;
      videoE.play().catch(() => {
        // Silently catch autoplay errors
      });
    };

    videoE.onerror = () => {
      if (videoE.crossOrigin === "anonymous") {
        console.warn("Video CORS failed for", videoObj.src, "retrying without CORS");
        tryLoad(false);
      }
    };

    tryLoad(true);
    setVideo(videoE);

    const layer = shapeRef.current?.getLayer();
    const anim = new Konva.Animation(() => {
      return true; // Force redraw for video
    }, layer);
    anim.start();

    return () => {
      anim.stop();
      videoE.pause();
      videoE.src = "";
      videoE.onerror = null;
    };
  }, [videoObj.src]);

  const { zIndex, ...restVideoObj } = videoObj;

  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [pos, setPos] = useState({ x: videoObj.x, y: videoObj.y });

  useEffect(() => {
    setPos({ x: videoObj.x, y: videoObj.y });
  }, [videoObj.x, videoObj.y]);

  useEffect(() => {
    if (isSelected && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer().batchDraw();
      const node = shapeRef.current;
      setDims({
        w: Math.round(node.width() * node.scaleX()),
        h: Math.round(node.height() * node.scaleY()),
      });
    }
  }, [isSelected, videoObj.width, videoObj.height, videoObj.scaleX, videoObj.scaleY]);

  const handleTransform = () => {
    const node = shapeRef.current;
    if (node) {
      setDims({
        w: Math.round(node.width() * node.scaleX()),
        h: Math.round(node.height() * node.scaleY()),
      });
      setPos({ x: node.x(), y: node.y() });
    }
  };


  return (
    <>
      <KonvaImage
        opacity={videoObj.hidden ? 0 : 1}
        listening={!videoObj.hidden}
        onClick={(e) => {
          if (!videoObj.locked) onSelect(e);
        }}
        onTap={(e) => {
          if (!videoObj.locked) onSelect(e);
        }}
        ref={shapeRef}
        image={video}
        {...restVideoObj}
        id={videoObj.id}
        name="konva-item"
        draggable={!videoObj.locked}
        onDragMove={(e) => {
          setPos({ x: e.target.x(), y: e.target.y() });
          onDragMove(e);
        }}

        onDragEnd={(e) => onDragEnd(e, videoObj)}
        onTransformEnd={(e) => {
          const node = shapeRef.current;
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();
          node.scaleX(1);
          node.scaleY(1);
          onChange({
            ...videoObj,
            x: node.x(),
            y: node.y(),
            width: Math.max(5, node.width() * scaleX),
            height: Math.max(5, node.height() * scaleY),
            rotation: node.rotation(),
          });
        }}
      />
      {isSelected && !videoObj.locked && (
        <Group 
          x={pos.x} 
          y={pos.y - 24} 
          rotation={videoObj.rotation}
          scaleX={1 / (shapeRef.current?.getStage()?.scaleX() || 1)}
          scaleY={1 / (shapeRef.current?.getStage()?.scaleY() || 1)}
        >
          <KonvaText
            text={t("video")}
            fontSize={11}
            fontFamily="sans-serif"
            fill="#3898ec"
            x={0}
            y={5}
          />
          <KonvaText
            text={`${dims.w} × ${dims.h}`}
            fontSize={11}
            fontFamily="sans-serif"
            fill="#3898ec"
            align="right"
            width={dims.w * (shapeRef.current?.getStage()?.scaleX() || 1)}
            x={0}
            y={5}
          />
        </Group>
      )}
      {isSelected && !videoObj.locked && (
        <Transformer
          ref={trRef}
          keepRatio={true}
          centeredScaling={true}
          onTransform={handleTransform}
          enabledAnchors={[
            "top-left",
            "top-right",
            "bottom-left",
            "bottom-right",
          ]}
          anchorSize={8}
          anchorCornerRadius={4}
          anchorStroke="#3898ec"
          anchorFill="white"
          borderStroke="#3898ec"
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < 5 || newBox.height < 5) {
              return oldBox;
            }
            return newBox;
          }}
        />
      )}
    </>
  );
};

const URLAudio = ({
  audioObj,
  isSelected,
  onSelect,
  onChange,
  onDragMove,
  onDragEnd,
}) => {
  const shapeRef = useRef();
  const trRef = useRef();
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [audio, setAudio] = useState(null);

  useEffect(() => {
    const a = new window.Audio();
    
    const tryLoad = (useCors) => {
      if (useCors) a.crossOrigin = "anonymous";
      else a.removeAttribute("crossOrigin");
      a.src = audioObj.src;
      a.loop = true;
      a.load();
    };

    const updateProgress = () => {
      if (a.duration) setProgress(a.currentTime / a.duration);
    };

    a.onplay = () => setPlaying(true);
    a.onpause = () => setPlaying(false);
    a.onended = () => setPlaying(false);
    a.ontimeupdate = updateProgress;
    
    a.onerror = () => {
      if (a.crossOrigin === "anonymous") {
        console.warn("Audio CORS failed for", audioObj.src, "retrying without CORS");
        tryLoad(false);
      } else {
        const error = a.error;
        let msg = "Unknown error";
        if (error) {
           if (error.code === 1) msg = "Aborted";
           else if (error.code === 2) msg = "Network error";
           else if (error.code === 3) msg = "Decode error";
           else if (error.code === 4) msg = "Source not supported";
        }
        console.error("Audio failed to load:", msg, audioObj.src);
      }
    };

    tryLoad(true);
    setAudio(a);

    return () => {
      a.pause();
      a.src = "";
      a.onplay = null;
      a.onpause = null;
      a.onended = null;
      a.ontimeupdate = null;
      a.onerror = null;
    };
  }, [audioObj.src]);

  const handleTogglePlay = (e) => {
    if (e && e.cancelBubble !== undefined) {
      e.cancelBubble = true;
    }
    onSelect?.();

    if (!audio) return;

    if (playing) {
      audio.pause();
    } else {
      audio.play().catch((err) => {
        console.error("Audio playback failed:", err);
        toast.error(t("playback_failed"));
      });
    }
  };

  useEffect(() => {
    if (isSelected && trRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer().batchDraw();
    }
  }, [isSelected]);

  return (
    <>
      <Group
        x={audioObj.x}
        y={audioObj.y}
        ref={shapeRef}
        id={audioObj.id}
        name="konva-item"
        draggable={!audioObj.locked}
        onClick={(e) => {
          onSelect?.();
          if (isSelected && !audioObj.locked) {
            handleTogglePlay(e);
          }
        }}
        onTap={(e) => {
          onSelect?.();
          if (isSelected && !audioObj.locked) {
            handleTogglePlay(e);
          }
        }}
        onDblClick={handleTogglePlay}
        onDblTap={handleTogglePlay}
        onDragMove={onDragMove}
        onDragEnd={(e) => onDragEnd(e, audioObj)}
      >
        {/* Background Card */}
        <Rect
          width={180}
          height={60}
          fill={playing ? "#3898ec" : "#1E1E1E"}
          cornerRadius={2}
          stroke="#3898ec"
          strokeWidth={isSelected ? 2 : 1}
          shadowBlur={isSelected ? 10 : 5}
          shadowOpacity={0.3}
        />
        {/* Audio Icon (Simplified) */}
        <Rect
          x={15}
          y={15}
          width={15}
          height={30}
          fill="white"
          cornerRadius={2}
        />

        {/* Label */}
        <KonvaText
          x={45}
          y={15}
          text={audioObj.label || t("audio_asset")}
          fontSize={12}
          fontFamily="sans-serif"
          fontStyle="bold"
          fill="white"
          width={100}
          ellipsis={true}
        />

        {/* Progress bar background */}
        <Rect
          x={45}
          y={35}
          width={120}
          height={4}
          fill="rgba(255,255,255,0.2)"
          cornerRadius={2}
        />
        {/* Active Progress bar */}
        <Rect
          x={45}
          y={35}
          width={Math.max(2, 120 * progress)}
          height={4}
          fill="white"
          cornerRadius={2}
        />

        {/* Play/Pause icon (Simplified) */}
        <Group
          x={155}
          y={22}
          onClick={handleTogglePlay}
          onTap={handleTogglePlay}
        >
          {/* Transparent hit area for the button */}
          <Rect x={-15} y={-15} width={40} height={40} fill="transparent" />
          {playing ? (
            <Group>
              <Rect width={4} height={16} fill="white" />
              <Rect x={7} width={4} height={16} fill="white" />
            </Group>
          ) : (
            <Line points={[0, 0, 14, 8, 0, 16]} closed fill="white" />
          )}
        </Group>
      </Group>
      {isSelected && !audioObj.locked && (
        <Transformer ref={trRef} resizeEnabled={false} rotateEnabled={true} />
      )}
    </>
  );
};

const URLText = ({
  textObj,
  isSelected,
  onSelect,
  onChange,
  onDragMove,
  onDragEnd,
  onDblClick,
}) => {
  const shapeRef = useRef();
  const trRef = useRef();
  const { zIndex, ...restTextObj } = textObj;

  useEffect(() => {
    if (isSelected) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer().batchDraw();
    }
  }, [isSelected]);

  return (
    <>
      <KonvaText
        opacity={textObj.hidden ? 0 : 1}
        listening={!textObj.hidden}
        onClick={(e) => {
          if (!textObj.locked) onSelect(e);
        }}
        onTap={(e) => {
          if (!textObj.locked) onSelect(e);
        }}
        ref={shapeRef}
        {...restTextObj}
        id={textObj.id}
        name="konva-item"
        draggable={!textObj.locked}
        onDragMove={onDragMove}
        onDragEnd={(e) => onDragEnd(e, textObj)}
        onDblClick={() => {
          if (!textObj.locked) onDblClick(textObj.id);
        }}
        onDblTap={() => {
          if (!textObj.locked) onDblClick(textObj.id);
        }}
        onTransformEnd={(e) => {
          const node = shapeRef.current;
          const scaleX = node.scaleX();
          const scaleY = node.scaleY();
          node.scaleX(1);
          node.scaleY(1);
          onChange({
            ...textObj,
            x: node.x(),
            y: node.y(),
            width: Math.max(5, node.width() * scaleX),
            height: Math.max(5, node.height() * scaleY),
            rotation: node.rotation(),
          });
        }}
      />
      {isSelected && !textObj.locked && (
        <Transformer
          ref={trRef}
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < 5 || newBox.height < 5) return oldBox;
            return newBox;
          }}
          enabledAnchors={[
            "top-left",
            "top-right",
            "bottom-left",
            "bottom-right",
          ]}
        />
      )}
    </>
  );
};

const LoaderNode = ({ task, isSelected, onSelect, onChange, theme }) => {
  const shapeRef = useRef();
  const trRef = useRef();
  const arcRef = useRef();

  useEffect(() => {
    if (isSelected && trRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer().batchDraw();
    }
  }, [isSelected]);

  useEffect(() => {
    if (arcRef.current) {
      const anim = new Konva.Animation((frame) => {
        const angleDiff = frame.timeDiff * 0.36; // roughly 360 degrees per second
        arcRef.current.rotate(angleDiff);
      }, arcRef.current.getLayer());

      anim.start();
      return () => anim.stop();
    }
  }, []);

  return (
    <>
      <Group
        x={task.x || 0}
        y={task.y || 0}
        draggable
        id={task.taskId}
        onClick={(e) => {
          onSelect(e);
        }}
        onTap={(e) => {
          onSelect(e);
        }}
        onDragEnd={(e) => {
          onChange({
            ...task,
            x: e.target.x(),
            y: e.target.y(),
          });
        }}
        ref={shapeRef}
        name="konva-item"
      >
        <Rect
          width={240}
          height={240}
          fill={theme === "dark" ? "#1E1E1E" : "#FFFFFF"}
          cornerRadius={8}
          stroke="#3898ec"
          strokeWidth={1}
          shadowColor={theme === "dark" ? "#ffffff" : "#000000"}
          shadowBlur={10}
          shadowOpacity={0.2}
          shadowOffsetY={4}
        />
        <KonvaText
          x={10}
          y={45}
          text={
            task.status === "completed"
              ? `${t("rendering")}\n\n${task.modelName}`
              : `${t("generating")}\n\n${task.modelName}`
          }
          fontSize={14}
          fontFamily="sans-serif"
          fontStyle="bold"
          fill={theme === "dark" ? "#E0E0E0" : "#0F172A"}
          width={220}
          align="center"
        />
        <KonvaText
          x={10}
          y={110}
          text={t("move_to_change_spawn")}
          fontSize={10}
          fill="#3898ec"
          width={220}
          align="center"
        />
        <Arc
          ref={arcRef}
          x={120}
          y={170}
          cornerRadius={10}
          innerRadius={20}
          outerRadius={24}
          angle={300}
          fill="#3898ec"
          rotation={0}
        />
      </Group>
      {isSelected && (
        <Transformer ref={trRef} resizeEnabled={false} rotateEnabled={false} />
      )}
    </>
  );
};

const CanvasArea = forwardRef(
  (
    {
      theme = "dark",
      colors = { textSecondary: "text-text-sub", border: "border-border-main" },
      activeTasks = [],
      setActiveTasks = () => {},
      onZoomChange,
      // 局部编辑：用户在选中图片上涂抹蒙版后回调 { assetLabel, prompt, maskDataUrl }
      onRegionEdit = null,
      // 套图：选中一批产品图 + 模板后回调 { assetLabels, template, templateLabel } → 后端批量 AI 生成
      onSetTemplate = null,
      // AI 拆图：选中一张 AI 图回调 { assetLabel } → 后端拆成 背景层 + 主体层(透明)
      onSplitImage = null,
      // P0-3a 本地图注册：拖入/粘贴/选择本地图 → 走上传管线注册成后端资产。
      // async (file) => { asset_label, url, kind }；失败抛错 → 画布以 dataURL 兜底落图。
      onUploadImage = null,
      // P0-4 空态「描述需求」：聚焦聊天输入框
      onRequestDescribe = null,
    },
    ref,
  ) => {
    const [images, setImages] = useState([]);
    const [videos, setVideos] = useState([]);
    const [audios, setAudios] = useState([]);
    const [texts, setTexts] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });
    const [zoom, setZoom] = useState(1);
    const [showTextMenu, setShowTextMenu] = useState(false); // 「添加文字」预设菜单
    const [showSetPanel, setShowSetPanel] = useState(false);  // 套图面板
    const [setSel, setSetSel] = useState(() => new Set());     // 套图：勾选的图片 id
    const [setTpl, setSetTpl] = useState("ecom");              // 套图：选中的模板
    const [setGenMode, setSetGenMode] = useState("ai");        // 套图模式：ai 融合 / editable 可编辑

    // ===== 框选多选（拖拽橡皮筋，默认行为）+ 空格平移 =====
    const [marquee, setMarquee] = useState(null);              // 正在拖的选框（世界坐标 {x,y,w,h}）
    const marqueeStartRef = useRef(null);                      // 拖拽起点（世界坐标）+ 是否叠加
    const [spaceDown, setSpaceDown] = useState(false);         // 空格按下=手型平移（拖拽=移动画布）
    const spaceRef = useRef(false);

    const worldPointer = () => {
      const stage = stageRef.current;
      const p = stage?.getPointerPosition();
      if (!p) return null;
      return { x: (p.x - stage.x()) / zoom, y: (p.y - stage.y()) / zoom };
    };

    const marqueeBegin = (additive) => {
      const p = worldPointer();
      if (!p) return;
      marqueeStartRef.current = { x: p.x, y: p.y, additive };
      setSelectedId(null);
      setMarquee({ x: p.x, y: p.y, w: 0, h: 0 });
    };

    const marqueeMove = () => {
      if (!marqueeStartRef.current) return;
      const p = worldPointer();
      if (!p) return;
      const s = marqueeStartRef.current;
      setMarquee({
        x: Math.min(s.x, p.x), y: Math.min(s.y, p.y),
        w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y),
      });
    };

    const marqueeEnd = () => {
      const s = marqueeStartRef.current;
      marqueeStartRef.current = null;
      if (!s) return;
      const box = marquee;
      setMarquee(null);
      if (!box || (box.w < 4 && box.h < 4)) {
        // 没拖动 = 视为点空白，清空选择
        if (!s.additive) setSetSel(new Set());
        return;
      }
      // 命中测试：图片包围盒与选框相交即选中（世界坐标）
      const hit = images.filter((img) => {
        const w = img.width || 200, h = img.height || 200;
        return img.x < box.x + box.w && img.x + w > box.x &&
               img.y < box.y + box.h && img.y + h > box.y;
      }).map((img) => img.id);
      setSetSel((prev) => {
        const n = s.additive ? new Set(prev) : new Set();
        hit.forEach((id) => n.add(id));
        return n;
      });
    };

    const toggleMultiSelect = (id) => {
      setSetSel((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    };

    const deleteMultiSelected = () => {
      if (setSel.size === 0) return;
      setImages((prev) => prev.filter((i) => !setSel.has(i.id)));
      setSetSel(new Set());
      setSelectedId(null);
    };

    // 拼长图：把多选的图按画布位置(上→下、左→右)纵向拼成一张长图导出（电商详情页用）。
    const [stitching, setStitching] = useState(false);
    const exportLongImage = async () => {
      const sel = images.filter((i) => setSel.has(i.id));
      if (sel.length < 2) { toast.error(t("stitch_need_two")); return; }
      sel.sort((a, b) => (a.y - b.y) || (a.x - b.x)); // 阅读顺序 = 详情页段落顺序
      setStitching(true);
      try {
        const loaded = await Promise.all(sel.map((s) => new Promise((res, rej) => {
          const im = new Image();
          im.crossOrigin = "anonymous";
          im.onload = () => res(im);
          im.onerror = () => rej(new Error("img load failed"));
          im.src = s.src;
        })));
        const W = Math.max(...loaded.map((im) => im.naturalWidth || 750));
        const segs = loaded.map((im) => ({ im, h: Math.round((im.naturalHeight || 1) * W / (im.naturalWidth || 1)) }));
        const totalH = segs.reduce((s, x) => s + x.h, 0);
        const c = document.createElement("canvas");
        c.width = W; c.height = totalH;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, totalH);
        let y = 0;
        for (const x of segs) { ctx.drawImage(x.im, 0, y, W, x.h); y += x.h; }
        const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.92));
        if (!blob) throw new Error("toBlob failed");
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url; a.download = t("long_image_filename", W, totalH);
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        toast.success(t("stitch_done", sel.length, W, totalH));
      } catch (e) {
        toast.error(t("stitch_failed"));
      } finally {
        setStitching(false);
      }
    };

    // 导出分层 PSD：画布上的每张图片=一个栅格图层，每段文字=一个（PS 可编辑的）文字图层。
    // 导出范围：多选的图片优先；否则当前选中的图；否则全部图。文字层取落在包围盒内的。
    const [exportingPsd, setExportingPsd] = useState(false);
    const _hexToRgb = (hex) => {
      let h = (hex || "#000000").replace("#", "");
      if (h.length === 3) h = h.split("").map((c) => c + c).join("");
      const n = parseInt(h, 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    };
    const _loadImg = (src) => new Promise((res, rej) => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => res(im);
      im.onerror = () => rej(new Error("img load failed"));
      im.src = src;
    });
    // 颜色：#RGB/#RRGGBB/#RRGGBBAA → {r,g,b}（忽略 alpha，alpha 由 opacity 表达）
    const _rgb = (hex) => {
      let h = (hex || "#000000").replace("#", "");
      if (h.length === 3) h = h.split("").map((c) => c + c).join("");
      h = h.slice(0, 6).padEnd(6, "0");
      const n = parseInt(h, 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    };
    // 文字栅格外观。fillOnly=true 只画填充——投影/描边交给 PS 图层效果(effects)，不烤死、不双影，pad 也收小。
    const _renderText = (n, scale = 1, fillOnly = true) => {
      const fs = Math.round((n.fontSize || 24) * scale);
      const bold = (n.fontStyle || "").includes("bold");
      const font = `${bold ? "bold " : ""}${fs}px ${n.fontFamily || "sans-serif"}`;
      const meas = document.createElement("canvas").getContext("2d");
      meas.font = font;
      const lines = String(n.text || "").split("\n");
      const sw = fillOnly ? 0 : (n.strokeWidth || 0) * scale;
      const pad = Math.ceil(fs * 0.22) + sw * 2 + (fillOnly ? 0 : (n.shadowBlur || 0) * scale);
      const lineH = Math.ceil(fs * 1.25);
      const textW = Math.max(1, ...lines.map((l) => Math.ceil(meas.measureText(l).width)));
      const c = document.createElement("canvas");
      c.width = textW + pad * 2;
      c.height = lineH * lines.length + pad * 2;
      const ctx = c.getContext("2d");
      ctx.font = font; ctx.textBaseline = "top"; ctx.textAlign = "left";
      lines.forEach((line, i) => {
        const y = pad + i * lineH;
        if (!fillOnly && n.shadowColor && n.shadowBlur) {
          ctx.save(); ctx.shadowColor = n.shadowColor; ctx.shadowBlur = (n.shadowBlur || 0) * scale;
          ctx.fillStyle = n.fill || "#000"; ctx.fillText(line, pad, y); ctx.restore();
        }
        if (!fillOnly && n.stroke && sw) {
          ctx.lineJoin = "round"; ctx.strokeStyle = n.stroke; ctx.lineWidth = sw; ctx.strokeText(line, pad, y);
        }
        ctx.fillStyle = n.fill || "#000"; ctx.fillText(line, pad, y);
      });
      return { canvas: c, pad, ascent: Math.round(fs * 0.8) };
    };
    // 投影/描边 → PS 可编辑图层效果（不再烤死进栅格）。ag-psd 的距离/大小/角度需 {value,units}。
    const _px = (v) => ({ value: Math.round(v), units: "Pixels" });
    const _textEffects = (n, scale) => {
      const eff = {};
      if (n.shadowColor && (n.shadowBlur || n.shadowOffsetX || n.shadowOffsetY)) {
        const dx = (n.shadowOffsetX || 0) * scale, dy = (n.shadowOffsetY || 0) * scale;
        eff.dropShadow = [{
          enabled: true, present: true, blendMode: "multiply", color: _rgb(n.shadowColor),
          opacity: n.shadowOpacity ?? 0.5, useGlobalLight: false,
          angle: { value: Math.round((Math.atan2(-dy, -dx) * 180) / Math.PI), units: "Angle" },
          distance: _px(Math.hypot(dx, dy)), size: _px((n.shadowBlur || 0) * scale),
        }];
      }
      if (n.stroke && n.strokeWidth) {
        eff.stroke = [{
          enabled: true, present: true, size: _px(Math.max(1, n.strokeWidth * scale)),
          position: "outside", fillType: "color", color: _rgb(n.stroke), opacity: 1, blendMode: "normal",
        }];
      }
      return Object.keys(eff).length ? eff : undefined;
    };
    // 语义层名：用拆解角色/人类名，绝不暴露 asset_99 这类内部 id
    const _imgName = (n) => {
      if (n.splitRole === "bg") return "背景";
      if (n.splitRole === "subject") return n.splitLabel ? `主体 · ${n.splitLabel}` : "主体 · 产品";
      if (n.splitRole === "element") return `元素 · ${n.splitLabel || "未命名"}`;
      return n.assetLabel ? `图层 · ${n.assetLabel}` : "图层";
    };
    const _CAT_NAME = { bg: "背景", element: "装饰元素", subject: "主体", text: "文案", other: "图层" };
    const exportPSD = async () => {
      // P0-7：导出跳过隐藏层
      let imgs = images.filter((i) => setSel.has(i.id) && !i.hidden);
      if (imgs.length === 0 && selectedId?.startsWith("img")) imgs = images.filter((i) => i.id === selectedId && !i.hidden);
      if (imgs.length === 0) imgs = images.filter((i) => !i.hidden);
      if (imgs.length === 0) { toast.error(t("psd_no_images")); return; }
      const minX = Math.min(...imgs.map((n) => n.x));
      const minY = Math.min(...imgs.map((n) => n.y));
      const maxX = Math.max(...imgs.map((n) => n.x + (n.width || 200)));
      const maxY = Math.max(...imgs.map((n) => n.y + (n.height || 200)));
      const txts = texts.filter((t) => {
        if (t.hidden) return false;
        const cx = t.x + (t.width || 100) / 2;
        const cy = t.y + (t.fontSize || 24) / 2;
        return cx >= minX && cx <= maxX && cy >= minY && cy <= maxY;
      });
      if (maxX - minX <= 0 || maxY - minY <= 0) { toast.error(t("psd_invalid_region")); return; }
      setExportingPsd(true);
      try {
        const { writePsd } = await import("ag-psd");
        // 按原生分辨率导出（画布是缩小版）。scale = 还原最高分辨率图到原生尺寸的倍数，封顶 8×。
        const imgMap = new Map();
        let scale = 1;
        for (const n of imgs) {
          const img = await _loadImg(n.src);
          imgMap.set(n.id, img);
          if (n.width) scale = Math.max(scale, (img.naturalWidth || n.width) / n.width);
        }
        scale = Math.min(Math.max(scale, 1), 8);
        const W = Math.round((maxX - minX) * scale);
        const H = Math.round((maxY - minY) * scale);
        const nodes = [
          ...imgs.map((n) => ({ ...n, _kind: "img" })),
          ...txts.map((n) => ({ ...n, _kind: "txt" })),
        ].sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0)); // 自底向上
        // 渲染成扁平层（带分类），再按「连续同类」打包成文件夹 → 不改任何像素叠放
        const rendered = [];
        for (const n of nodes) {
          const left = Math.round((n.x - minX) * scale);
          const top = Math.round((n.y - minY) * scale);
          if (n._kind === "img") {
            const img = imgMap.get(n.id);
            const w = Math.max(1, Math.round((n.width || img.naturalWidth) * scale));
            const h = Math.max(1, Math.round((n.height || img.naturalHeight) * scale));
            const cv = document.createElement("canvas");
            cv.width = w; cv.height = h;
            cv.getContext("2d").drawImage(img, 0, 0, w, h);
            rendered.push({ cat: n.splitRole || "other", layer: { name: _imgName(n), left, top, canvas: cv } });
          } else {
            const { canvas: tcv, pad, ascent } = _renderText(n, scale, true);
            rendered.push({ cat: "text", layer: {
              name: `文字 · ${String(n.text || "").replace(/\n/g, " ").slice(0, 16)}`,
              left: left - pad, top: top - pad, canvas: tcv,
              effects: _textEffects(n, scale),
              text: {
                text: String(n.text || ""),
                // P0-8：基线 = 栅格顶对齐文字 → 可编辑文字与栅格预览精确重合，消除 pad 错位
                transform: [1, 0, 0, 1, left, top + ascent],
                style: {
                  font: { name: (n.fontFamily || "sans-serif").split(",")[0].replace(/['"]/g, "").trim() },
                  fontSize: Math.round((n.fontSize || 24) * scale),
                  fillColor: _rgb(n.fill), fauxBold: (n.fontStyle || "").includes("bold"),
                  autoLeading: false, leading: Math.ceil((n.fontSize || 24) * scale * 1.25),
                  tracking: Math.round(((n.letterSpacing || 0) / (n.fontSize || 24)) * 1000), // 1/1000 em
                },
                paragraphStyle: { justification: n.align === "center" ? "center" : n.align === "right" ? "right" : "left" },
              },
            } });
          }
        }
        // 合成预览（防全黑）：按扁平叠放绘制
        const flat = document.createElement("canvas");
        flat.width = W; flat.height = H;
        const fctx = flat.getContext("2d");
        for (const r of rendered) if (r.layer.canvas) fctx.drawImage(r.layer.canvas, r.layer.left || 0, r.layer.top || 0);
        // P0-3：连续同类 → 文件夹（背景 / 装饰元素·后景 / 主体 / 装饰元素·前景 / 文案），默认折叠，不改叠放
        const groups = [];
        let subjectSeen = false;
        for (const r of rendered) {
          if (r.cat === "subject") subjectSeen = true;
          const last = groups[groups.length - 1];
          if (last && last.cat === r.cat) { last.items.push(r.layer); continue; }
          let name = _CAT_NAME[r.cat] || "图层";
          if (r.cat === "element") name = subjectSeen ? "装饰元素 · 前景" : "装饰元素 · 后景";
          groups.push({ cat: r.cat, name, items: [r.layer] });
        }
        const used = {};
        const children = groups.map((g) => {
          used[g.name] = (used[g.name] || 0) + 1;
          return { name: used[g.name] > 1 ? `${g.name} ${used[g.name]}` : g.name, opened: false, children: g.items };
        });
        const psd = { width: W, height: H, children, canvas: flat };
        // P0-6：内嵌 sRGB ICC（有 profile 二进制则用；空 = 未标记 sRGB，由 PS 工作区指派——sRGB 工作流下色准一致）
        const SRGB_ICC = null;
        if (SRGB_ICC) psd.imageResources = { iccProfile: SRGB_ICC };
        const buffer = writePsd(psd, { generateThumbnail: true });
        const blob = new Blob([buffer], { type: "image/vnd.adobe.photoshop" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const ts = new Date().toISOString().replace(/\D/g, "").slice(0, 12); // 仅留数字 → yyyymmddhhmm（勿用 [字符类]，会被 Tailwind 误扫成类名）
        a.href = url; a.download = `picsmith_分层_${W}x${H}_${ts}.psd`;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        toast.success(t("psd_done", rendered.length, children.length));
      } catch (e) {
        console.error(e);
        toast.error(t("psd_failed", (e.message || "").slice(0, 60)));
      } finally {
        setExportingPsd(false);
      }
    };

    // 方向键微移：选中（单个或多选）的节点整体平移。Shift = 10px，否则 1px。
    const nudgeSelected = (dx, dy) => {
      if (setSel.size > 0) {
        setImages((prev) => prev.map((i) => (setSel.has(i.id) ? { ...i, x: i.x + dx, y: i.y + dy } : i)));
        return true;
      }
      if (!selectedId) return false;
      const move = (set) => set((prev) => prev.map((n) => (n.id === selectedId ? { ...n, x: n.x + dx, y: n.y + dy } : n)));
      if (selectedId.startsWith("img")) move(setImages);
      else if (selectedId.startsWith("vid")) move(setVideos);
      else if (selectedId.startsWith("aud")) move(setAudios);
      else if (selectedId.startsWith("txt")) move(setTexts);
      else return false;
      return true;
    };

    // Cmd/Ctrl+A：全选画布上的图片到多选集
    const selectAllImages = () => {
      if (images.length === 0) return;
      setSelectedId(null);
      setSetSel(new Set(images.map((i) => i.id)));
    };

    // Esc：清空所有选择
    const clearSelection = () => { setSelectedId(null); setSetSel(new Set()); };

    // 以视口中心为锚点设定缩放（Shift+0 = 100%），内容不跳变
    const zoomKeepingCenter = (z) => {
      const stage = stageRef.current;
      if (!stage) return;
      const vw = stage.width(), vh = stage.height(), s = stage.scaleX();
      const cx = (vw / 2 - stage.x()) / s, cy = (vh / 2 - stage.y()) / s;
      updateZoom(z, { x: vw / 2 - cx * z, y: vh / 2 - cy * z });
    };

    // Shift+2：缩放到选中内容
    const zoomToSelection = () => {
      const ids = setSel.size > 0 ? setSel : (selectedId ? new Set([selectedId]) : null);
      if (!ids) return;
      const sel = [...images, ...videos, ...audios, ...texts].filter((n) => ids.has(n.id));
      if (sel.length === 0) return;
      const minX = Math.min(...sel.map((n) => n.x));
      const minY = Math.min(...sel.map((n) => n.y));
      const maxX = Math.max(...sel.map((n) => n.x + (n.width || 150)));
      const maxY = Math.max(...sel.map((n) => n.y + (n.height || 50)));
      const bw = Math.max(maxX - minX, 1), bh = Math.max(maxY - minY, 1);
      const pad = 80;
      const z = Math.max(0.1, Math.min(5, Math.min((canvasSize.width - pad * 2) / bw, (canvasSize.height - pad * 2) / bh)));
      updateZoom(z, { x: canvasSize.width / 2 - (minX + bw / 2) * z, y: canvasSize.height / 2 - (minY + bh / 2) * z });
    };

    // 空格键 = 手型平移工具（按住时拖拽移动画布，松开恢复框选）
    useEffect(() => {
      const isTyping = () => {
        const el = document.activeElement;
        return el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      };
      const down = (e) => {
        if (e.code === "Space" && !isTyping()) {
          if (!spaceRef.current) { spaceRef.current = true; setSpaceDown(true); }
          e.preventDefault(); // 防止页面滚动/按钮触发
        }
      };
      const up = (e) => {
        if (e.code === "Space") { spaceRef.current = false; setSpaceDown(false); }
      };
      window.addEventListener("keydown", down);
      window.addEventListener("keyup", up);
      return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
    }, []);

    // ===== 局部编辑（蒙版涂抹）=====
    const [maskMode, setMaskMode] = useState(null); // 进入编辑的 image id
    const [maskStrokes, setMaskStrokes] = useState([]); // 世界坐标笔迹 [{size, points:[x,y,...]}]
    const [brushSize, setBrushSize] = useState(48); // 屏幕像素
    const [maskPrompt, setMaskPrompt] = useState("");
    const paintingRef = useRef(false);

    const maskWorldPos = () => {
      const stage = stageRef.current;
      const p = stage?.getPointerPosition();
      if (!p) return null;
      return { x: (p.x - stage.x()) / zoom, y: (p.y - stage.y()) / zoom };
    };

    const maskPaintBegin = () => {
      const p = maskWorldPos();
      if (!p) return;
      paintingRef.current = true;
      setMaskStrokes((prev) => [...prev, { size: brushSize / zoom, points: [p.x, p.y, p.x + 0.01, p.y] }]);
    };

    const maskPaintMove = () => {
      if (!paintingRef.current) return;
      const p = maskWorldPos();
      if (!p) return;
      setMaskStrokes((prev) => {
        const next = [...prev];
        const last = { ...next[next.length - 1] };
        last.points = [...last.points, p.x, p.y];
        next[next.length - 1] = last;
        return next;
      });
    };

    const maskPaintEnd = () => { paintingRef.current = false; };

    const enterMaskMode = (imageId) => {
      setMaskMode(imageId);
      setMaskStrokes([]);
      setMaskPrompt("");
      setSelectedId(null); // 隐藏变换手柄，避免与笔刷视觉冲突
    };

    const exitMaskMode = () => {
      setMaskMode(null);
      setMaskStrokes([]);
      setMaskPrompt("");
      paintingRef.current = false;
    };

    // ESC 退出蒙版模式
    useEffect(() => {
      if (!maskMode) return;
      const onKey = (e) => { if (e.key === "Escape") exitMaskMode(); };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [maskMode]);

    const applyRegionEdit = () => {
      const img = images.find((i) => i.id === maskMode);
      if (!img || !img.assetLabel || !maskPrompt.trim() || maskStrokes.length === 0) return;
      // 界外涂抹拦截：笔迹（含笔刷半径）必须与图片相交，否则蒙版为空白白扣费
      const intersects = maskStrokes.some((s) => {
        const half = s.size / 2;
        for (let i = 0; i < s.points.length; i += 2) {
          const px = s.points[i], py = s.points[i + 1];
          if (px + half >= img.x && px - half <= img.x + img.width &&
              py + half >= img.y && py - half <= img.y + img.height) return true;
        }
        return false;
      });
      if (!intersects) {
        toast.error(t("paint_within_image"));
        return;
      }
      const nw = img.image?.naturalWidth || 1024;
      const nh = img.image?.naturalHeight || 1024;
      const canvas = document.createElement("canvas");
      canvas.width = nw;
      canvas.height = nh;
      const ctx = canvas.getContext("2d");
      // 全图不透明（保留），涂抹处打穿成透明（= 重绘范围，OpenAI mask 规范）
      ctx.fillStyle = "#000";
      ctx.fillRect(0, 0, nw, nh);
      ctx.globalCompositeOperation = "destination-out";
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      const sx = nw / img.width;
      const sy = nh / img.height;
      maskStrokes.forEach((s) => {
        ctx.lineWidth = s.size * ((sx + sy) / 2);
        ctx.beginPath();
        for (let i = 0; i < s.points.length; i += 2) {
          const px = (s.points[i] - img.x) * sx;
          const py = (s.points[i + 1] - img.y) * sy;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();
      });
      onRegionEdit?.({
        assetLabel: img.assetLabel,
        prompt: maskPrompt.trim(),
        maskDataUrl: canvas.toDataURL("image/png"),
      });
      exitMaskMode();
    };
    const [editingTextId, setEditingTextId] = useState(null);
    const [contextMenu, setContextMenu] = useState(null);
    const [clipboardNode, setClipboardNode] = useState(null);
    const [guides, setGuides] = useState([]);

    const stageWrapperRef = useRef();
    const stageRef = useRef();
    const containerRef = useRef();
    const fileInputRef = useRef();   // 空态「上传产品图」按钮触发的隐藏文件选择器

    // 视图适配内容（zoom-to-fit）：会话加载后把镜头对准内容中心
    const fitToContent = ({ paddingRatio = 0.8, maxZoom = 1 } = {}) => {
      const stage = stageRef.current;
      if (!stage) return false;
      const nodes = [...images, ...videos, ...audios, ...texts];
      if (nodes.length === 0) return false;
      const minX = Math.min(...nodes.map((n) => n.x));
      const minY = Math.min(...nodes.map((n) => n.y));
      const maxX = Math.max(...nodes.map((n) => n.x + (n.width || 200)));
      const maxY = Math.max(...nodes.map((n) => n.y + (n.height || 200)));
      const bw = Math.max(maxX - minX, 1);
      const bh = Math.max(maxY - minY, 1);
      const vw = stage.width();
      const vh = stage.height();
      if (!vw || !vh) return false;
      let z = Math.min(maxZoom, (vw * paddingRatio) / bw, (vh * paddingRatio) / bh);
      z = Math.max(0.1, z);
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      updateZoom(z, { x: vw / 2 - cx * z, y: vh / 2 - cy * z });
      return true;
    };

    const updateZoom = (newZoom, pos = null) => {
      if (!newZoom || isNaN(newZoom)) return;
      setZoom(newZoom);
      onZoomChange?.(Math.round(newZoom * 100));

      if (stageRef.current && typeof stageRef.current.scale === "function") {
        stageRef.current.scale({ x: newZoom, y: newZoom });
        if (pos && typeof stageRef.current.position === "function") {
          stageRef.current.position(pos);
        }
        if (typeof stageRef.current.batchDraw === "function") {
          stageRef.current.batchDraw();
        }
      }
      if (containerRef.current) {
        containerRef.current.style.backgroundSize = `${32 * newZoom}px ${32 * newZoom}px`;
        if (pos) {
          containerRef.current.style.backgroundPosition = `${pos.x}px ${pos.y}px`;
        }
      }
    };

    const handleZoomToFit = () => {
      if (
        images.length === 0 &&
        videos.length === 0 &&
        texts.length === 0 &&
        audios.length === 0
      ) {
        updateZoom(1, { x: 0, y: 0 });
        return;
      }
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      const checkItem = (item) => {
        minX = Math.min(minX, item.x);
        minY = Math.min(minY, item.y);
        maxX = Math.max(maxX, item.x + (item.width || 150));
        maxY = Math.max(maxY, item.y + (item.height || 50));
      };
      images.forEach(checkItem);
      videos.forEach(checkItem);
      audios.forEach(checkItem);
      texts.forEach(checkItem);
      const padding = 60;
      const contentWidth = maxX - minX;
      const contentHeight = maxY - minY;
      if (contentWidth <= 0 || contentHeight <= 0) {
        updateZoom(1, { x: 0, y: 0 });
        return;
      }
      const scaleX = (canvasSize.width - padding * 2) / contentWidth;
      const scaleY = (canvasSize.height - padding * 2) / contentHeight;
      const newZoom = Math.min(5, Math.max(0.1, Math.min(scaleX, scaleY)));
      const newPos = {
        x: canvasSize.width / 2 - (minX + contentWidth / 2) * newZoom,
        y: canvasSize.height / 2 - (minY + contentHeight / 2) * newZoom,
      };
      updateZoom(newZoom, newPos);
    };

    const handleExport = (format) => {
      if (!contextMenu?.nodeId) return;
      const id = contextMenu.nodeId;
      const node = stageRef.current.findOne("#" + id);
      if (node) {
        try {
          const dataURL = node.toDataURL({
            pixelRatio: 3,
            mimeType:
              format === "JPG"
                ? "image/jpeg"
                : format === "SVG"
                  ? "image/svg+xml"
                  : "image/png",
          });
          const link = document.createElement("a");
          link.download = `export-${id}.${format.toLowerCase()}`;
          link.href = dataURL;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
        } catch (err) {
          console.error("Export failed:", err);
          toast.error(t("export_failed"));
        }
      }
      setContextMenu(null);
    };

    const handleDownload = async () => {
      const id = contextMenu?.nodeId || selectedId;
      if (!id) return;

      const item = [...images, ...videos, ...audios].find((i) => i.id === id);
      if (item && item.src) {
        try {
          toast.loading(t("preparing_download"), { id: "download" });
          const response = await fetch(item.src);
          const blob = await response.blob();
          const url = window.URL.createObjectURL(blob);
          
          const link = document.createElement("a");
          link.href = url;
          const extension = item.src.split("?")[0].split(".").pop() || "";
          const fileName = item.label || item.assetLabel || `asset-${id.substring(0, 8)}`;
          link.download = extension ? `${fileName}.${extension}` : fileName;
          
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.URL.revokeObjectURL(url);
          
          toast.success(t("download_started"), { id: "download" });
        } catch (err) {
          console.error("Download failed:", err);
          toast.error(t("download_failed"), { id: "download" });
          // Fallback to old method if fetch fails
          const link = document.createElement("a");
          link.href = item.src;
          link.target = "_blank";
          link.download = "";
          link.click();
        }
      } else {
        toast.error(t("source_url_not_found"));
      }
      setContextMenu(null);
    };

    const handleShowAllHidden = () => {
      setImages((prev) => prev.map((i) => ({ ...i, hidden: false })));
      setVideos((prev) => prev.map((v) => ({ ...v, hidden: false })));
      setAudios((prev) => prev.map((a) => ({ ...a, hidden: false })));
      setTexts((prev) => prev.map((t) => ({ ...t, hidden: false })));
      toast.success(t("all_items_visible"));
      setContextMenu(null);
    };

    const handleClearCanvas = () => {
      setContextMenu(null);
      toast((tt) => (
        <span className="flex items-center gap-3 text-[12px]">
          {t("clear_canvas_confirm")}
          <button
            onClick={() => {
              setImages([]);
              setVideos([]);
              setAudios([]);
              setTexts([]);
              setSelectedId(null);
              toast.dismiss(tt.id);
              toast.success(t("canvas_cleared"));
            }}
            className="px-2 py-1 bg-red-500 text-white rounded-sm text-[10px] font-bold shrink-0"
          >{t("confirm")}</button>
          <button
            onClick={() => toast.dismiss(tt.id)}
            className="px-2 py-1 bg-white text-black rounded-sm text-[10px] font-bold shrink-0"
          >{t("cancel")}</button>
        </span>
      ), { duration: 8000 });
    };

    const handleExportCanvas = () => {
      if (!stageRef.current) return;
      try {
        const dataURL = stageRef.current.toDataURL({ pixelRatio: 2 });
        const link = document.createElement("a");
        link.download = `canvas-export-${Date.now()}.png`;
        link.href = dataURL;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } catch (err) {
        console.error("Canvas export failed:", err);
        toast.error(t("canvas_export_failed"));
      }
      setContextMenu(null);
    };

    const addImage = (src, x, y, width, height, onLoaded, assetLabel, setTemplate, setContent, zIndex, splitRole, splitLabel) => {
      if (!src) return;
      const stage = stageRef.current;
      if (!stage) {
        console.error("CanvasArea: stageRef.current is null in addImage");
        return;
      }

      const targetX =
        x !== undefined
          ? x
          : (-stage.x() + (canvasSize?.width || 800) / 2) / zoom - 100;
      const targetY =
        y !== undefined
          ? y
          : (-stage.y() + (canvasSize?.height || 600) / 2) / zoom - 100;
      const id = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const img = new window.Image();
      img.crossOrigin = "anonymous";
      
      const commitImage = (loadedImg) => {
        let finalWidth = width;
        let finalHeight = height;
        if (!finalWidth && !finalHeight && loadedImg.width) {
          const maxDim = 400;
          if (loadedImg.width > loadedImg.height) {
            finalWidth = maxDim;
            finalHeight = (loadedImg.height / loadedImg.width) * maxDim;
          } else {
            finalHeight = maxDim;
            finalWidth = (loadedImg.width / loadedImg.height) * maxDim;
          }
        }

        setImages((prev) => [
          ...prev,
          {
            id,
            assetLabel: assetLabel || null,
            src,
            x: targetX,
            y: targetY,
            image: loadedImg,
            width: finalWidth / 2 || 200,
            height: finalHeight / 2 || 200,
            rotation: 0,
            // 四层合成：显式层叠序，避免图片 onload 异步到达导致的堆叠错乱（背景压住主体等）
            zIndex: zIndex || 0,
            // 智能拆解语义（供导出 PSD 语义命名/分组）
            splitRole: splitRole || null,
            splitLabel: splitLabel || null,
          },
        ]);
        // 套图混合方案：AI 出干净底图后，在图上叠【固定模板文字】（位置/字体/字号锁死、
        // 相对图片尺寸算 → 全集 100% 一致，只有文字内容可逐张改）。
        const slots = setTemplate && SET_TEMPLATE_SLOTS[setTemplate];
        if (slots) {
          const dw = finalWidth / 2 || 200;
          const dh = finalHeight / 2 || 200;
          const stamp = Date.now();
          const slotTexts = slots.map((slot, i) => ({
            id: `txt-${stamp}-${(assetLabel || id).slice(-6)}-${i}`,
            text: slotText(slot, setContent),  // 真实文案（取自 PDF/产品信息），无则回退占位
            x: targetX + slot.relX * dw,
            y: targetY + slot.relY * dh,
            width: slot.relW ? slot.relW * dw : undefined,
            align: slot.align || "left",
            fontSize: Math.max(8, Math.round(slot.relSize * dh)),
            fontFamily: "Inter, sans-serif",
            draggable: true,
            rotation: 0,
            ...slot.style,
          }));
          setTexts((prev) => [...prev, ...slotTexts]);
          // 预载模板的设计字体（思源宋体等），加载完强制重绘，否则套图文字会先停在回退字体
          [...new Set(slotTexts.map((s) => s.fontFamily).filter(Boolean))].forEach((fam) =>
            loadGoogleFont(fam).then(() => {
              const redraw = () => stageRef.current?.draw();
              redraw();
              setTimeout(redraw, 250);
              setTimeout(redraw, 700);
            })
          );
        }
        setSelectedId(id);
        if (typeof onLoaded === "function") onLoaded();
      };

      img.onload = () => {
        commitImage(img);
      };

      img.onerror = () => {
        if (img.crossOrigin === "anonymous") {
          img.removeAttribute("crossOrigin");
          img.src = src;
        } else {
          // 加载失败的图片绝不能上画布：broken 状态的 HTMLImageElement
          // 会让 Konva drawImage 抛 InvalidStateError 并进入崩溃循环
          console.error("Failed to load image after retry:", src);
          toast.error(t("image_load_failed"));
          if (typeof onLoaded === "function") onLoaded();
        }
      };

      img.src = src;
    };

    const addVideo = (src, x, y, width, height, onLoaded, assetLabel) => {
      if (!src) return;
      const stage = stageRef.current;
      if (!stage) {
        console.error("CanvasArea: stageRef.current is null in addVideo");
        return;
      }

      const targetX =
        x !== undefined
          ? x
          : (-stage.x() + (canvasSize?.width || 800) / 2) / zoom - 150;
      const targetY =
        y !== undefined
          ? y
          : (-stage.y() + (canvasSize?.height || 600) / 2) / zoom - 100;
      const id = `vid-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      const tryLoad = (useCors) => {
        const video = document.createElement("video");
        if (useCors) video.crossOrigin = "anonymous";
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.preload = "metadata";
        let settled = false;

        const commitVideo = (v) => {
          let finalWidth = width;
          let finalHeight = height;
          const vW = v.videoWidth;
          const vH = v.videoHeight;
          
          if (vW && vH) {
            if (!finalWidth && !finalHeight) {
              const maxDim = 400;
              if (vW > vH) {
                finalWidth = maxDim;
                finalHeight = (vH / vW) * maxDim;
              } else {
                finalHeight = maxDim;
                finalWidth = (vW / vH) * maxDim;
              }
            }
          }

          setVideos((prev) => [
            ...prev,
            {
              id,
              assetLabel: assetLabel || null,
              src,
              x: targetX,
              y: targetY,
              width: finalWidth / 2 || 300,
              height: finalHeight / 2 || 200,
              rotation: 0,
            },
          ]);
          setSelectedId(id);
          v.play().catch(() => {
            const playOnInteract = () => {
              v.play();
              window.removeEventListener("click", playOnInteract);
            };
            window.addEventListener("click", playOnInteract);
          });
          if (typeof onLoaded === "function") onLoaded();
        };

        const handleVideoReady = () => {
          if (settled) return;
          settled = true;
          clearTimeout(fallbackTimer);
          commitVideo(video);
        };

        video.addEventListener("loadedmetadata", handleVideoReady, { once: true });
        video.addEventListener("canplay", handleVideoReady, { once: true });
        video.addEventListener("error", () => {
          if (settled) return;
          settled = true;
          clearTimeout(fallbackTimer);
          if (useCors) {
            console.warn("CORS issue with video, retrying without crossOrigin:", src);
            tryLoad(false);
          } else {
            console.error("Failed to load video after retry:", src);
            commitVideo(video);
          }
        }, { once: true });

        const fallbackTimer = setTimeout(() => {
          if (settled) return;
          settled = true;
          if (useCors) tryLoad(false);
          else commitVideo(video);
        }, 10000);

        video.src = src;
        video.load();
      };
      tryLoad(true);
    };

    const addAudio = (src, x, y, label, assetLabel) => {
      console.log("audio url", src);
      
      if (!src) return;
      const stage = stageRef.current;
      if (!stage) {
        console.error("CanvasArea: stageRef.current is null in addAudio");
        return;
      }
      const targetX =
        x !== undefined ? x : (-stage.x() + (canvasSize?.width || 800) / 2) / zoom - 90;
      const targetY =
        y !== undefined ? y : (-stage.y() + (canvasSize?.height || 600) / 2) / zoom - 30;
      const id = `aud-${Date.now()}`;
      setAudios((prev) => [
        ...prev,
        {
          id,
          assetLabel: assetLabel || null,
          src,
          x: targetX,
          y: targetY,
          label: label || t("audio_asset"),
          rotation: 0,
        },
      ]);
      setSelectedId(id);
    };

    const addNewText = (text, x, y, style) => {
      const stage = stageRef.current;
      const targetX =
        x !== undefined ? x : (-stage.x() + canvasSize.width / 2) / zoom - 50;
      const targetY =
        y !== undefined ? y : (-stage.y() + canvasSize.height / 2) / zoom - 12;
      const id = `txt-${Date.now()}`;
      setTexts((prev) => [
        ...prev,
        {
          id,
          text: text || t("double_click_edit"),
          fontSize: 24,
          fill: theme === "dark" ? "white" : "black",
          fontFamily: "Inter, sans-serif",
          x: targetX,
          y: targetY,
          draggable: true,
          rotation: 0,
          ...(style || {}),  // 预设/面板样式覆盖默认
        },
      ]);
      setSelectedId(id);
    };

    // 电商文字预设：一键加入带样式的标题/价格/促销角标/正文
    const addPresetText = (key) => {
      const p = TEXT_PRESETS[key];
      if (p) addNewText(p.text, undefined, undefined, p.style);
      setShowTextMenu(false);
    };

    // AI 拆图·文字层：后端 OCR 出的文字块(相对坐标) → 在参考图上重建为可编辑文字节点。
    const addTextLayers = (ref, blocks) => {
      const base = images.find((i) => i.assetLabel === ref) || images[images.length - 1];
      if (!base || !blocks?.length) return;
      const bx = base.x, by = base.y, bw = base.width || 200, bh = base.height || 200;
      const stamp = Date.now();
      // 文案永远压在所有图片层之上（四层合成里图片层 zIndex 可达 ~6）
      const TEXT_Z = 10000;
      const nodes = [];
      blocks.forEach((b, i) => {
        const e = b.effect || {};
        const fam = b.fontFamily
          ? `${b.fontFamily}, Noto Sans SC, sans-serif`
          : "Noto Sans SC, Inter, sans-serif";
        const txt = String(b.text || "");
        const lineCount = Math.max(1, txt.split("\n").length);
        const boxW = Math.max(20, (b.relW || 0.3) * bw);
        // relH 是整块高度；多行块按行数均分，否则每行都用整块高度 → 块涨成数倍、压住下方文案
        let fontSize = Math.max(8, Math.round(((b.relH || 0.04) * bh * 0.82) / lineCount));
        // 收缩适配：长标题在窄框里会自动换行、串到下一行压住副标题 → 按最长行字符数估算，
        // 必要时缩小字号让它在一行放下（CJK 每字≈字号宽，留 4% 余量）
        const longestLine = Math.max(1, ...txt.split("\n").map((s) => s.length));
        const fitSize = Math.floor((boxW * 0.96) / longestLine);
        if (fitSize < fontSize) fontSize = Math.max(8, fitSize);
        const common = {
          x: bx + (b.relX || 0) * bw,
          y: by + (b.relY || 0) * bh,
          width: boxW,
          fontSize,
          align: b.align || "left",
          fontFamily: fam,
          fontStyle: b.fontStyle || "normal",
          letterSpacing: b.letterSpacing || 0,
          text: b.text || "",
          draggable: true,
          rotation: 0,
          zIndex: TEXT_Z + i,
        };
        // 浮雕：高光层(偏左上) + 暗影层(偏右下) + 主体层(最上)，三层同坐标 → 导出 PSD 即 3 个可编辑文字层
        if (e.emboss) {
          const d = e.emboss.depth || 2;
          nodes.push({ ...common, id: `txt-${stamp}-${i}-es`, fill: e.emboss.shadow || "#00000066", x: common.x + d, y: common.y + d });
          nodes.push({ ...common, id: `txt-${stamp}-${i}-eh`, fill: e.emboss.highlight || "#ffffff", x: common.x - d, y: common.y - d });
        }
        const main = { ...common, id: `txt-${stamp}-${i}`, fill: b.color || "#222222" };
        if (e.stroke) {
          main.stroke = e.stroke.color || "#ffffff";
          main.strokeWidth = e.stroke.width || 2;
          main.fillAfterStrokeEnabled = true;
          main.lineJoin = "round";
        }
        if (e.shadow) {
          main.shadowColor = e.shadow.color || "#000000";
          main.shadowBlur = e.shadow.blur ?? 8;
          main.shadowOffsetX = e.shadow.offsetX || 0;
          main.shadowOffsetY = e.shadow.offsetY || 0;
          main.shadowOpacity = e.shadow.opacity ?? 1;
        }
        nodes.push(main);
      });
      setTexts((prev) => [...prev, ...nodes]);
      // 加载文案用到的设计字体（用裸字体名，loadGoogleFont 遇 "sans-serif" 会跳过），加载完强制重绘
      [...new Set(blocks.map((b) => b.fontFamily).filter(Boolean))].forEach((fam) =>
        loadGoogleFont(fam).then(() => {
          const redraw = () => stageRef.current?.draw();
          redraw();
          setTimeout(redraw, 250);
          setTimeout(redraw, 700);
        })
      );
      toast.success(t("text_blocks_done", blocks.length));
    };

    // 样式面板：改当前选中文字的属性
    const updateSelectedText = (attrs) => {
      if (!selectedId?.startsWith("txt")) return;
      setTexts((prev) => prev.map((tx) => (tx.id === selectedId ? { ...tx, ...attrs } : tx)));
    };

    // 套图：把勾选图片的 asset_label 交给后端，AI 按模板约束批量生成一组统一风格的新图。
    // 只有带 assetLabel 的图（后端认识的资产）能用——AI 要以它为源图重绘。
    const applySetTemplate = () => {
      const tpl = SET_TEMPLATES[setTpl];
      if (!tpl) return;
      const labels = images.filter((img) => setSel.has(img.id) && img.assetLabel).map((img) => img.assetLabel);
      if (labels.length === 0) {
        toast.error(t("set_need_labeled"));
        return;
      }
      onSetTemplate?.({ assetLabels: labels, template: setTpl, templateLabel: t(tpl.labelKey), mode: setGenMode });
      setShowSetPanel(false);
      setSetSel(new Set());
    };

    // Snapshot the canvas in the shape the agent expects (see SYSTEM_PROMPT).
    // Coordinates are in canvas (pre-zoom) space, origin top-left.
    const getCanvasState = () => {
      const stage = stageRef.current;
      const nodes = [];
      const push = (n, kind) => {
        if (!n.assetLabel) return;   // only assets the agent knows about
        nodes.push({
          asset_id: n.assetLabel,
          kind,
          x: Math.round(n.x),
          y: Math.round(n.y),
          w: Math.round(n.width || 200),
          h: Math.round(n.height || (kind === "audio" ? 60 : 200)),
          z: n.zIndex || 0,
          locked: !!n.locked,
        });
      };
      images.forEach((n) => push(n, "image"));
      videos.forEach((n) => push(n, "video"));
      audios.forEach((n) => push(n, "audio"));
      const selectedNode = [...images, ...videos, ...audios, ...texts].find(
        (n) => n.id === selectedId,
      );
      return {
        viewport: {
          w: canvasSize.width,
          h: canvasSize.height,
          zoom,
          pan: stage ? [Math.round(stage.x()), Math.round(stage.y())] : [0, 0],
        },
        selected: selectedNode?.assetLabel || null,
        nodes,
      };
    };

    // Move a node by asset_label using functional setters so it works without
    // fresh state in the closure.
    const moveNode = (assetLabel, x, y) => {
      const patch = (arr) =>
        arr.map((n) => (n.assetLabel === assetLabel ? { ...n, x, y } : n));
      setImages(patch);
      setVideos(patch);
      setAudios(patch);
    };

    // Place a derived asset BESIDE its source on the canvas, preserving the
    // source so the user can compare or branch from it. Layout: source stays
    // at (sx, sy); new asset lands at (sx + sw + 32, sy) with the source's
    // size as a hint. If the source isn't on canvas (URL input, etc.),
    // falls back to default centre placement.
    const placeNextToSource = (sourceLabel, newUrl, newKind, newAssetLabel) => {
      let frame = null;
      const findIn = (arr) => arr.find((n) => n.assetLabel === sourceLabel);
      frame = findIn(images) || findIn(videos) || findIn(audios);

      if (!frame) {
        if (newKind === "video") addVideo(newUrl, undefined, undefined, undefined, undefined, undefined, newAssetLabel);
        else if (newKind === "audio") addAudio(newUrl, undefined, undefined, undefined, newAssetLabel);
        else addImage(newUrl, undefined, undefined, undefined, undefined, undefined, newAssetLabel);
        return;
      }

      const sw = frame.width || 200;
      const sh = frame.height || 200;
      const x = frame.x + sw + 32;   // 32px gap to the right of source
      const y = frame.y;

      if (newKind === "video") {
        addVideo(newUrl, x, y, sw, sh, undefined, newAssetLabel);
      } else if (newKind === "audio") {
        addAudio(newUrl, x, y, undefined, newAssetLabel);
      } else {
        addImage(newUrl, x, y, sw, sh, undefined, newAssetLabel);
      }
    };

    // Apply an arrange_assets payload from the agent ([{asset_id, x, y}, ...]).
    const arrangeNodes = (moves) => {
      if (!Array.isArray(moves) || moves.length === 0) return 0;
      const byLabel = new Map(moves.map((m) => [m.asset_id, m]));
      const patch = (arr) =>
        arr.map((n) => {
          const m = n.assetLabel ? byLabel.get(n.assetLabel) : null;
          return m ? { ...n, x: m.x, y: m.y } : n;
        });
      setImages(patch);
      setVideos(patch);
      setAudios(patch);
      return moves.length;
    };

    // P0-3b/3c：从聊天首屏/建议卡直达套图面板。preferLabel 指定要预选的图（刚上传那张）。
    // 返回 true=已打开（画布有可用产品图）；false=无带 label 的图，调用方去引导上传。
    const openSetPanel = (template = "main6", preferLabel = null) => {
      const labeled = images.filter((i) => i.assetLabel);
      if (labeled.length === 0) return false;
      // 优先选指定 label 的图；否则用最近一张带 label 的图，让 single 模板(六联/详情)默认可用
      const pick = (preferLabel && labeled.find((i) => i.assetLabel === preferLabel)) || labeled[labeled.length - 1];
      if (SET_TEMPLATES[template]) setSetTpl(template);
      setSetSel(new Set([pick.id]));
      setShowSetPanel(true);
      return true;
    };

    useImperativeHandle(
      ref,
      () => ({
        addImage,
        addVideo,
        addAudio,
        openSetPanel,
        getCanvasState,
        moveNode,
        placeNextToSource,
        // Back-compat alias — earlier code referenced replaceAt before we
        // switched to non-destructive side-by-side placement.
        replaceAt: placeNextToSource,
        arrangeNodes,
        addTextLayers,
        fitToContent,
        zoomIn: () => updateZoom(Math.min(5, zoom + 0.1)),
        zoomOut: () => updateZoom(Math.max(0.1, zoom - 0.1)),
        resetZoom: () => updateZoom(1),
      }),
      // Recompute when state read by getCanvasState changes so the snapshot
      // is always current.
      [images, videos, audios, texts, selectedId, canvasSize, zoom],
    );

    // Global Paste & Keyboard listeners
    useEffect(() => {
      const handlePasteAction = (e) => {
        if (
          document.activeElement.tagName === "INPUT" ||
          document.activeElement.tagName === "TEXTAREA"
        )
          return;
        const items = e.clipboardData?.items;
        for (let i = 0; i < items.length; i++) {
          if (items[i].type.indexOf("image") !== -1) {
            e.preventDefault();
            const file = items[i].getAsFile();
            // P0-3a：粘贴的本地图也走注册管线（拿 assetLabel 才能套图/拆图/局改）
            handleLocalImageFile(file);
          } else if (items[i].type === "text/plain") {
            e.preventDefault();
            items[i].getAsString((text) => {
              if (text.trim()) addNewText(text);
            });
          }
        }
      };
      window.addEventListener("paste", handlePasteAction);
      return () => window.removeEventListener("paste", handlePasteAction);
    }, [zoom, canvasSize]);

    // Handle tasks spawning
    useEffect(() => {
      if (!activeTasks || activeTasks.length === 0) return;
      const tasksNeedingPosition = activeTasks.filter(
        (t) => t.x === undefined && t.y === undefined,
      );
      if (tasksNeedingPosition.length > 0) {
        setActiveTasks((prev) => {
          const next = [...prev];
          let changed = false;
          next.forEach((t, i) => {
            if (t.x === undefined && t.y === undefined) {
              // 视口中心生成占位框：用 stage 实时尺寸（canvasSize 状态在首次测量前是 0）
              const stage = stageRef.current;
              const vw = (stage && stage.width()) || canvasSize.width || 1200;
              const vh = (stage && stage.height()) || canvasSize.height || 800;
              const sx = stage ? stage.x() : 0;
              const sy = stage ? stage.y() : 0;
              const cx = (-sx + vw / 2) / zoom - 120 + i * 24;
              const cy = (-sy + vh / 2) / zoom - 120 + i * 24;
              t.x = Number.isFinite(cx) ? cx : 100 + i * 24;
              t.y = Number.isFinite(cy) ? cy : 100 + i * 24;
              changed = true;
            }
          });
          return changed ? next : prev;
        });
      }
      const completedUnadded = activeTasks.filter(
        (t) => t.status === "completed" && t.resultUrl && !t.addedToCanvas,
      );
      if (completedUnadded.length > 0) {
        completedUnadded.forEach((task) => {
          setActiveTasks((prev) =>
            prev.map((t) =>
              t.taskId === task.taskId ? { ...t, addedToCanvas: true } : t,
            ),
          );
          const items =
            task.resultUrl.rawOutputs || task.resultUrl.examples || [];
          if (items.length > 0) {
            let loadedCount = 0;
            const handleItemLoaded = () => {
              loadedCount++;
              if (loadedCount === items.length) {
                setActiveTasks((prev) =>
                  prev.map((t) =>
                    t.taskId === task.taskId ? { ...t, fullyMounted: true } : t,
                  ),
                );
              }
            };
            items.forEach((output, oIndex) => {
              const x = task.x !== undefined ? task.x + oIndex * 20 : 100;
              const y = task.y !== undefined ? task.y + oIndex * 20 : 100;
              const val =
                typeof output === "string"
                  ? output
                  : output.value || output.url || output.image_url;
              const type =
                typeof output === "object" ? output.type?.toLowerCase() : null;
              if (val) {
                if (type && type.startsWith("text")) {
                  addNewText(val, x, y);
                  handleItemLoaded();
                } else if (type && type.startsWith("video")) {
                  addVideo(val, x, y, undefined, undefined, handleItemLoaded);
                } else if (type && type.startsWith("audio")) {
                  addAudio(val, x, y, task.assetLabel);
                  handleItemLoaded();
                } else {
                  addImage(val, x, y, undefined, undefined, handleItemLoaded);
                }
              } else handleItemLoaded();
            });
          } else {
            setActiveTasks((prev) =>
              prev.map((t) =>
                t.taskId === task.taskId ? { ...t, fullyMounted: true } : t,
              ),
            );
          }
        });
      }
    }, [activeTasks, zoom, canvasSize]);

    // Context Menu Helpers
    const getActiveNode = (id) =>
      images.find((i) => i.id === id) ||
      videos.find((v) => v.id === id) ||
      audios.find((a) => a.id === id) ||
      texts.find((t) => t.id === id);

    const handleCopy = () => {
      const id = contextMenu?.nodeId || selectedId;
      if (id) setClipboardNode(getActiveNode(id));
      setContextMenu(null);
    };

    const handleCut = () => {
      const id = contextMenu?.nodeId || selectedId;
      if (id) {
        setClipboardNode(getActiveNode(id));
        setImages(images.filter((img) => img.id !== id));
        setVideos(videos.filter((vid) => vid.id !== id));
        setAudios(audios.filter((aud) => aud.id !== id));
        setTexts(texts.filter((txt) => txt.id !== id));
        if (selectedId === id) setSelectedId(null);
      }
      setContextMenu(null);
    };

    const handleDuplicate = () => {
      const id = contextMenu?.nodeId || selectedId;
      if (id) {
        const node = getActiveNode(id);
        if (node) {
          const newNode = {
            ...node,
            id: `${node.id.split("-")[0]}-${Date.now()}`,
            x: node.x + 20,
            y: node.y + 20,
          };
          if (newNode.id.startsWith("img"))
            setImages((prev) => [...prev, newNode]);
          if (newNode.id.startsWith("vid"))
            setVideos((prev) => [...prev, newNode]);
          if (newNode.id.startsWith("aud"))
            setAudios((prev) => [...prev, newNode]);
          if (newNode.id.startsWith("txt"))
            setTexts((prev) => [...prev, newNode]);
        }
      }
      setContextMenu(null);
    };

    const handlePasteNode = async () => {
      const stage = stageRef.current;
      if (!stage) return;
      const pastePos = contextMenu ? contextMenu.stagePos : null;
      let x, y;
      if (pastePos) {
        x = (pastePos.x - stage.x()) / zoom;
        y = (pastePos.y - stage.y()) / zoom;
      } else {
        x = (-stage.x() + canvasSize.width / 2) / zoom;
        y = (-stage.y() + canvasSize.height / 2) / zoom;
      }
      try {
        const items = await navigator.clipboard.read();
        let foundSomething = false;
        for (const item of items) {
          for (const type of item.types) {
            if (type.startsWith("image/")) {
              const blob = await item.getType(type);
              const reader = new FileReader();
              reader.onload = (e) => addImage(e.target.result, x - 50, y - 50);
              reader.readAsDataURL(blob);
              foundSomething = true;
            } else if (type === "text/plain") {
              const blob = await item.getType(type);
              const text = await blob.text();
              if (text.trim()) {
                addNewText(text, x, y);
                foundSomething = true;
              }
            }
          }
        }
        if (foundSomething) {
          setContextMenu(null);
          return;
        }
      } catch (err) {}
      if (clipboardNode) {
        const newNode = {
          ...clipboardNode,
          id: `${clipboardNode.id.split("-")[0]}-${Date.now()}`,
        };
        newNode.x = x - (newNode.width || 0) / 2;
        newNode.y = y - (newNode.height || 0) / 2;
        if (newNode.id.startsWith("img"))
          setImages((prev) => [...prev, newNode]);
        else if (newNode.id.startsWith("vid"))
          setVideos((prev) => [...prev, newNode]);
        else if (newNode.id.startsWith("aud"))
          setAudios((prev) => [...prev, newNode]);
        else if (newNode.id.startsWith("txt"))
          setTexts((prev) => [...prev, newNode]);
      }
      setContextMenu(null);
    };

    const handleZIndex = (action) => {
      const id = contextMenu?.nodeId || selectedId;
      if (!id) return;
      const allItems = [...images, ...videos, ...audios, ...texts].sort(
        (a, b) => (a.zIndex || 0) - (b.zIndex || 0),
      );
      const idxInAll = allItems.findIndex((i) => i.id === id);
      if (idxInAll === -1) return;
      const allZ = allItems.map((i) => i.zIndex || 0);
      const maxZ = Math.max(...allZ, 0);
      const minZ = Math.min(...allZ, 0);
      const updateItem = (arr, setter) => {
        const idx = arr.findIndex((i) => i.id === id);
        if (idx !== -1) {
          const item = { ...arr[idx] };
          if (action === "front") item.zIndex = maxZ + 1;
          else if (action === "back") item.zIndex = Math.max(0, minZ - 1);
          else if (action === "up")
            item.zIndex =
              idxInAll < allItems.length - 1
                ? (allItems[idxInAll + 1].zIndex || 0) + 1
                : maxZ + 1;
          else if (action === "down")
            item.zIndex =
              idxInAll > 0
                ? (allItems[idxInAll - 1].zIndex || 0) - 1
                : Math.max(0, minZ - 1);
          const newArr = [...arr];
          newArr[idx] = item;
          setter(newArr);
        }
      };
      updateItem(images, setImages);
      updateItem(videos, setVideos);
      updateItem(audios, setAudios);
      updateItem(texts, setTexts);
      setContextMenu(null);
    };

    const handleToggleState = (field) => {
      const id = contextMenu?.nodeId || selectedId;
      if (!id) return;
      const updateItem = (arr, setter) => {
        const idx = arr.findIndex((i) => i.id === id);
        if (idx !== -1) {
          const newArr = [...arr];
          newArr[idx] = { ...newArr[idx], [field]: !newArr[idx][field] };
          setter(newArr);
          if (field === "locked" && newArr[idx].locked) setSelectedId(null);
        }
      };
      updateItem(images, setImages);
      updateItem(videos, setVideos);
      updateItem(audios, setAudios);
      updateItem(texts, setTexts);
      setContextMenu(null);
    };

    const handleFlip = (direction) => {
      const id = contextMenu?.nodeId || selectedId;
      if (!id) return;
      const updateItem = (arr, setter) => {
        const idx = arr.findIndex((i) => i.id === id);
        if (idx !== -1) {
          const item = { ...arr[idx] };
          if (direction === "horizontal") {
            item.scaleX = (item.scaleX || 1) * -1;
            item.offsetX = item.scaleX === -1 ? item.width || 0 : 0;
          } else {
            item.scaleY = (item.scaleY || 1) * -1;
            item.offsetY = item.scaleY === -1 ? item.height || 0 : 0;
          }
          const newArr = [...arr];
          newArr[idx] = item;
          setter(newArr);
        }
      };
      updateItem(images, setImages);
      updateItem(videos, setVideos);
      updateItem(audios, setAudios);
      updateItem(texts, setTexts);
      setContextMenu(null);
    };

    const handleDelete = () => {
      // 收集要删的节点（多选优先），删完给「撤销」toast——画布删除本是危险操作，之前裸删无挽回
      const targetIds = (!contextMenu?.nodeId && setSel.size > 0)
        ? setSel
        : new Set([contextMenu?.nodeId || selectedId].filter(Boolean));
      if (targetIds.size === 0) { setContextMenu(null); return; }
      const delImgs = images.filter((i) => targetIds.has(i.id));
      const delVids = videos.filter((v) => targetIds.has(v.id));
      const delAuds = audios.filter((a) => targetIds.has(a.id));
      const delTxts = texts.filter((tx) => targetIds.has(tx.id));
      const total = delImgs.length + delVids.length + delAuds.length + delTxts.length;
      if (total === 0) { setContextMenu(null); return; }
      setImages((prev) => prev.filter((i) => !targetIds.has(i.id)));
      setVideos((prev) => prev.filter((v) => !targetIds.has(v.id)));
      setAudios((prev) => prev.filter((a) => !targetIds.has(a.id)));
      setTexts((prev) => prev.filter((tx) => !targetIds.has(tx.id)));
      setSetSel(new Set());
      setSelectedId(null);
      setContextMenu(null);
      toast((tt) => (
        <span className="flex items-center gap-3 text-[12px]">
          {t("canvas_deleted", total)}
          <button
            onClick={() => {
              if (delImgs.length) setImages((prev) => [...prev, ...delImgs]);
              if (delVids.length) setVideos((prev) => [...prev, ...delVids]);
              if (delAuds.length) setAudios((prev) => [...prev, ...delAuds]);
              if (delTxts.length) setTexts((prev) => [...prev, ...delTxts]);
              toast.dismiss(tt.id);
            }}
            className="px-2 py-1 bg-white text-black rounded-sm text-[10px] font-bold shrink-0"
          >{t("undo")}</button>
        </span>
      ), { duration: 5000 });
    };

    // Stage 尺寸跟随容器：必须可靠填满，否则会卡在默认 800×600 → 画布上出现一个
    // 有边界的方块（无限画布破功）。只靠 ResizeObserver 不够：首帧布局未稳时它常先
    // 量到 0 被丢弃、之后不再触发。故再叠加「立即测 + 下一帧再测 + window resize」。
    useEffect(() => {
      const measure = () => {
        const el = stageWrapperRef.current;
        if (!el) return;
        const w = el.clientWidth;
        const h = el.clientHeight;
        if (w > 0 && h > 0) {
          setCanvasSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
        }
      };
      measure();
      const raf = requestAnimationFrame(measure); // 布局稳定后再测一次，避免卡默认值
      const resizeObserver = new ResizeObserver(measure);
      if (stageWrapperRef.current) resizeObserver.observe(stageWrapperRef.current);
      window.addEventListener("resize", measure);
      return () => {
        cancelAnimationFrame(raf);
        resizeObserver.disconnect();
        window.removeEventListener("resize", measure);
      };
    }, []);

    // Keyboard Shortcuts
    useEffect(() => {
      const handleKeyDown = (e) => {
        if (
          document.activeElement.tagName === "INPUT" ||
          document.activeElement.tagName === "TEXTAREA"
        )
          return;
        if (e.ctrlKey || e.metaKey) {
          if (e.key === "=" || e.key === "+") {
            e.preventDefault();
            updateZoom(Math.min(5, zoom + 0.1));
          } else if (e.key === "-") {
            e.preventDefault();
            updateZoom(Math.max(0.1, zoom - 0.1));
          } else if (e.key === "0") {
            e.preventDefault();
            updateZoom(1);
          } else if (e.key === "c") handleCopy();
          else if (e.key === "x") handleCut();
          else if (e.key === "v") handlePasteNode();
          else if (e.key === "d") {
            e.preventDefault();
            handleDuplicate();
          } else if (e.key === "]") {
            e.preventDefault();
            handleZIndex("up");
          } else if (e.key === "[") {
            e.preventDefault();
            handleZIndex("down");
          } else if (e.key === "a" || e.key === "A") {
            e.preventDefault();
            selectAllImages(); // Cmd/Ctrl+A 全选
          }
        } else if (e.key === "Delete" || e.key === "Backspace") {
          handleDelete();
        } else if (e.key === "Escape") {
          clearSelection();
        } else if (e.key.startsWith("Arrow")) {
          // 方向键微移选中节点：Shift=10px，否则 1px
          const step = e.shiftKey ? 10 : 1;
          const d = { ArrowUp: [0, -step], ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0] }[e.key];
          if (d && nudgeSelected(d[0], d[1])) e.preventDefault();
        } else if (e.key === "]") {
          if (selectedId) handleZIndex("front");
        } else if (e.key === "[") {
          if (selectedId) handleZIndex("back");
        } else if (e.shiftKey && (e.key === "!" || e.key === "1")) {
          e.preventDefault();
          handleZoomToFit(); // Shift+1 适配全部内容
        } else if (e.shiftKey && (e.key === ")" || e.key === "0")) {
          e.preventDefault();
          zoomKeepingCenter(1); // Shift+0 回到 100%
        } else if (e.shiftKey && (e.key === "@" || e.key === "2")) {
          e.preventDefault();
          zoomToSelection(); // Shift+2 缩放到选中
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [zoom, images, videos, audios, texts, selectedId, setSel, clipboardNode]);

    // Snapping Guides
    const getLineGuide = (node) => {
      const stage = node.getStage();
      const layer = node.getLayer();
      const box = node.getClientRect({ relativeTo: layer });
      const result = { vertical: [], horizontal: [] };
      const otherNodes = stage.find(".konva-item").filter((n) => n !== node);
      const GUIDELINE_OFFSET = 5 / zoom;
      otherNodes.forEach((otherNode) => {
        const oBox = otherNode.getClientRect({ relativeTo: layer });
        const nodeEdges = [
          { guide: box.x, offset: box.x - node.x(), orientation: "v" },
          {
            guide: box.x + box.width / 2,
            offset: box.x + box.width / 2 - node.x(),
            orientation: "v",
          },
          {
            guide: box.x + box.width,
            offset: box.x + box.width - node.x(),
            orientation: "v",
          },
          { guide: box.y, offset: box.y - node.y(), orientation: "h" },
          {
            guide: box.y + box.height / 2,
            offset: box.y + box.height / 2 - node.y(),
            orientation: "h",
          },
          {
            guide: box.y + box.height,
            offset: box.y + box.height - node.y(),
            orientation: "h",
          },
        ];
        const otherEdges = [
          { guide: oBox.x, orientation: "v" },
          { guide: oBox.x + oBox.width / 2, orientation: "v" },
          { guide: oBox.x + oBox.width, orientation: "v" },
          { guide: oBox.y, orientation: "h" },
          { guide: oBox.y + oBox.height / 2, orientation: "h" },
          { guide: oBox.y + oBox.height, orientation: "h" },
        ];
        nodeEdges.forEach((nEdge) => {
          otherEdges.forEach((oEdge) => {
            if (nEdge.orientation !== oEdge.orientation) return;
            if (Math.abs(nEdge.guide - oEdge.guide) <= GUIDELINE_OFFSET) {
              if (nEdge.orientation === "v")
                result.vertical.push({
                  lineGuide: oEdge.guide,
                  diff: oEdge.guide - nEdge.guide,
                });
              else
                result.horizontal.push({
                  lineGuide: oEdge.guide,
                  diff: oEdge.guide - nEdge.guide,
                });
            }
          });
        });
      });
      return result;
    };

    // 多选整体拖动：拖动选中集合里的任一元素，全部一起移动
    const groupDragRef = useRef(null);

    const handleDragStart = (e) => {
      const node = e.target;
      const id = node.id();
      if (setSel.has(id) && setSel.size > 1) {
        // 记录起点 + 全体成员起始位置，移动时整体偏移
        groupDragRef.current = {
          id, sx: node.x(), sy: node.y(),
          members: images.filter((i) => setSel.has(i.id)).map((i) => ({ id: i.id, x: i.x, y: i.y })),
        };
      } else {
        groupDragRef.current = null;
        // 拖动一个未选中的元素：清掉旧的多选（与 Figma 一致），只拖这一个
        if (setSel.size > 0 && !setSel.has(id)) setSetSel(new Set());
      }
    };

    const handleDragMove = (e) => {
      const node = e.target;
      // 整体拖动：被拖节点由 Konva 实时控制，其余成员按相同位移更新
      if (groupDragRef.current) {
        const g = groupDragRef.current;
        const dx = node.x() - g.sx, dy = node.y() - g.sy;
        const startById = Object.fromEntries(g.members.map((m) => [m.id, m]));
        setImages((prev) => prev.map((i) => {
          if (i.id === g.id) return i; // 被拖的那张交给 Konva，避免回弹
          const m = startById[i.id];
          return m ? { ...i, x: m.x + dx, y: m.y + dy } : i;
        }));
        setGuides([]); // 整体移动不做对自身成员的吸附
        return;
      }
      const guidesFound = getLineGuide(node);
      const newGuides = [];
      if (guidesFound.vertical.length > 0) {
        const g = guidesFound.vertical[0];
        node.x(node.x() + g.diff);
        newGuides.push({
          points: [g.lineGuide, -5000, g.lineGuide, 10000],
          stroke: "#3898ec",
          strokeWidth: 1 / zoom,
          dash: [4, 4],
        });
      }
      if (guidesFound.horizontal.length > 0) {
        const g = guidesFound.horizontal[0];
        node.y(node.y() + g.diff);
        newGuides.push({
          points: [-5000, g.lineGuide, 10000, g.lineGuide],
          stroke: "#3898ec",
          strokeWidth: 1 / zoom,
          dash: [4, 4],
        });
      }
      setGuides(newGuides);
    };

    const handleDragEnd = (e, item) => {
      const node = e.target;
      // 整体拖动收尾：把全体成员的最终位置一次性提交
      if (groupDragRef.current) {
        const g = groupDragRef.current;
        const dx = node.x() - g.sx, dy = node.y() - g.sy;
        const startById = Object.fromEntries(g.members.map((m) => [m.id, m]));
        setImages((prev) => prev.map((i) => {
          const m = startById[i.id];
          return m ? { ...i, x: m.x + dx, y: m.y + dy } : i;
        }));
        groupDragRef.current = null;
        setGuides([]);
        return;
      }
      const id = item.id;
      const update = (arr, setter) => {
        const idx = arr.findIndex((i) => i.id === id);
        if (idx !== -1) {
          const next = [...arr];
          next[idx] = { ...next[idx], x: node.x(), y: node.y() };
          setter(next);
        }
      };
      if (id.startsWith("img")) update(images, setImages);
      else if (id.startsWith("vid")) update(videos, setVideos);
      else if (id.startsWith("txt")) update(texts, setTexts);
      setGuides([]);
    };

    // Figma 式滚轮：普通滚动=平移，Cmd/Ctrl+滚动 或 触控板捏合=以光标为中心缩放。
    const handleWheel = (e) => {
      e.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      setContextMenu(null);
      // 触控板捏合在浏览器里表现为 ctrlKey=true 的 wheel 事件；Cmd/Ctrl+滚轮亦然
      if (e.evt.ctrlKey || e.evt.metaKey) {
        const oldScale = stage.scaleX();
        const pointer = stage.getPointerPosition();
        if (!pointer) return;
        const mousePointTo = {
          x: (pointer.x - stage.x()) / oldScale,
          y: (pointer.y - stage.y()) / oldScale,
        };
        // 按 deltaY 大小连续缩放：捏合(小步)顺滑，滚轮(大步)跟手
        const factor = Math.exp(-e.evt.deltaY * 0.0025);
        const boundedScale = Math.max(0.1, Math.min(5, oldScale * factor));
        updateZoom(boundedScale, {
          x: pointer.x - mousePointTo.x * boundedScale,
          y: pointer.y - mousePointTo.y * boundedScale,
        });
        return;
      }
      // 普通滚动 = 平移（Shift 把纵向滚动转成横向，方便鼠标用户）
      let dx = e.evt.deltaX, dy = e.evt.deltaY;
      if (e.evt.shiftKey && dx === 0) { dx = dy; dy = 0; }
      const np = { x: stage.x() - dx, y: stage.y() - dy };
      stage.position(np);
      stage.batchDraw();
      if (containerRef.current) containerRef.current.style.backgroundPosition = `${np.x}px ${np.y}px`;
    };

    // P0-3a 命门：本地文件进画布必须注册成后端资产才能拿到 assetLabel，
    // 否则套图/拆图/局改全部禁用（它们都判 !img.assetLabel）。
    // 流程：先读 dataURL 立即落图（loading 占位，不卡 UI）→ 后台走上传管线拿 assetLabel
    // → 用 assetLabel 回填该图。失败则保留 dataURL 图并提示「未注册，部分功能不可用」。
    // 非图片（视频/音频）暂沿用 dataURL 直落（套图只针对图片）。
    const handleLocalImageFile = async (file) => {
      if (!file) return;
      // 视频/音频：无需注册套图，dataURL 直落
      if (file.type?.startsWith("video/")) {
        const r = new FileReader(); r.onload = (ev) => addVideo(ev.target.result); r.readAsDataURL(file); return;
      }
      if (file.type?.startsWith("audio/")) {
        const r = new FileReader(); r.onload = (ev) => addAudio(ev.target.result); r.readAsDataURL(file); return;
      }
      // 没有上传能力（未注入 onUploadImage）→ 退回旧行为：dataURL 落图（功能受限但不阻断）
      if (!onUploadImage) {
        const r = new FileReader(); r.onload = (ev) => addImage(ev.target.result); r.readAsDataURL(file); return;
      }

      // 1. 先用 dataURL 落一张图占位（用户立刻看到，不卡 UI）。dataURL 内容唯一 →
      //    注册成功后靠它精确定位占位图回填 assetLabel（避免并发上传时张冠李戴）。
      const dataUrl = await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = (ev) => resolve(ev.target.result);
        r.readAsDataURL(file);
      });
      addImage(dataUrl);

      const toastId = toast.loading(t("registering_upload"));
      try {
        const { asset_label, url } = await onUploadImage(file);
        // 注册成功：按 dataURL 精确定位占位图，回填 assetLabel + 换成后端 url（换 url 让跨会话/刷新后仍可用）
        setImages((prev) => prev.map((im) =>
          (im.src === dataUrl && !im.assetLabel) ? { ...im, assetLabel: asset_label, src: url } : im
        ));
        toast.success(t("upload_registered"), { id: toastId });
      } catch (err) {
        console.error("Canvas local image register failed:", err);
        // 兜底：占位图保留（dataURL），只提示部分功能不可用，不阻断创作
        toast.error(t("upload_register_failed"), { id: toastId });
      }
    };

    const handleDrop = (e) => {
      e.preventDefault();
      const url = e.dataTransfer.getData("text/plain");
      const files = e.dataTransfer.files;
      if (url) {
        // 拖的是已有资产/远程 URL：非本地文件，无需注册（远程图多已是后端资产由 addAsset 落）
        if (url.match(/\.(mp4|webm|mov)$/i)) addVideo(url);
        else if (url.match(/\.(mp3|wav|ogg|m4a)$/i)) addAudio(url);
        else addImage(url);
      } else if (files && files.length > 0) {
        handleLocalImageFile(files[0]);
      }
    };

    return (
      <div
        className={`relative w-full h-full bg-bg-page overflow-hidden ${maskMode ? "cursor-crosshair" : spaceDown ? "cursor-grab" : "cursor-crosshair"}`}
        ref={containerRef}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        <div ref={stageWrapperRef} className="absolute inset-0">
          <Stage
            width={canvasSize.width}
            height={canvasSize.height}
            onMouseDown={(e) => {
              if (maskMode) return; // 蒙版模式：绘制走 pointer 事件
              if (e.evt.button === 2) return;
              if (spaceDown) return; // 空格平移：交给 Stage 拖拽
              setContextMenu(null);
              // 默认：在空白处左键拖拽 = 框选（Shift = 叠加到已选）
              if (e.target === e.target.getStage()) {
                marqueeBegin(e.evt.shiftKey);
              }
            }}
            onMouseMove={maskMode ? undefined : () => { if (marqueeStartRef.current) marqueeMove(); }}
            onMouseUp={maskMode ? undefined : () => { if (marqueeStartRef.current) marqueeEnd(); }}
            onPointerDown={maskMode ? () => { if (!paintingRef.current) maskPaintBegin(); } : undefined}
            onPointerMove={maskMode ? maskPaintMove : undefined}
            onPointerUp={maskMode ? maskPaintEnd : undefined}
            onPointerLeave={maskMode ? maskPaintEnd : undefined}
            onContextMenu={(e) => {
              e.evt.preventDefault();
              const stage = e.target.getStage();
              const id = e.target.id();
              setContextMenu({
                type: e.target === stage ? "canvas" : "node",
                nodeId: id,
                x: e.evt.clientX,
                y: e.evt.clientY,
                stagePos: stage.getPointerPosition(),
              });
              if (id) setSelectedId(id);
            }}
            onWheel={handleWheel}
            scaleX={zoom}
            scaleY={zoom}
            ref={stageRef}
            draggable={!maskMode && spaceDown}
            onDragMove={(e) => {
              if (e.target === stageRef.current && containerRef.current) {
                containerRef.current.style.backgroundPosition = `${e.target.x()}px ${e.target.y()}px`;
              }
            }}
          >
            <Layer>
              {/* 移除有限尺寸的浅色底板：它在缩放后会露出 10000×10000 的边缘，
                  造成「画布有边界」的错觉。无限画布的背景就用容器的纯色，无需底板。 */}
              {[...images, ...videos, ...audios, ...texts]
                .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))
                .map((item) => {
                  if (item.id.startsWith("img"))
                    return (
                      <URLImage
                        key={item.id}
                        imageObj={item}
                        isSelected={item.id === selectedId && setSel.size === 0}
                        multiSelected={setSel.has(item.id)}
                        spaceDown={spaceDown}
                        onToggleMulti={() => toggleMultiSelect(item.id)}
                        onSelect={() => { setSelectedId(item.id); if (setSel.size) setSetSel(new Set()); }}
                        onDragStart={handleDragStart}
                        onDragMove={handleDragMove}
                        onDragEnd={handleDragEnd}
                        onChange={(attrs) =>
                          setImages((prev) =>
                            prev.map((i) =>
                              i.id === item.id ? { ...i, ...attrs } : i,
                            ),
                          )
                        }
                      />
                    );
                  if (item.id.startsWith("vid"))
                    return (
                      <URLVideo
                        key={item.id}
                        videoObj={item}
                        isSelected={item.id === selectedId}
                        onSelect={() => setSelectedId(item.id)}
                        onDragMove={handleDragMove}
                        onDragEnd={handleDragEnd}
                        onChange={(attrs) =>
                          setVideos((prev) =>
                            prev.map((v) =>
                              v.id === item.id ? { ...v, ...attrs } : v,
                            ),
                          )
                        }
                      />
                    );
                  if (item.id.startsWith("aud"))
                    return (
                      <URLAudio
                        key={item.id}
                        audioObj={item}
                        isSelected={item.id === selectedId}
                        onSelect={() => setSelectedId(item.id)}
                        onDragMove={handleDragMove}
                        onDragEnd={handleDragEnd}
                        onChange={(attrs) =>
                          setAudios((prev) =>
                            prev.map((a) =>
                              a.id === item.id ? { ...a, ...attrs } : a,
                            ),
                          )
                        }
                      />
                    );
                  if (item.id.startsWith("txt"))
                    return (
                      <URLText
                        key={item.id}
                        textObj={item}
                        isSelected={item.id === selectedId}
                        onSelect={() => setSelectedId(item.id)}
                        onDblClick={setEditingTextId}
                        onDragMove={handleDragMove}
                        onDragEnd={handleDragEnd}
                        onChange={(attrs) =>
                          setTexts((prev) =>
                            prev.map((t) =>
                              t.id === item.id ? { ...t, ...attrs } : t,
                            ),
                          )
                        }
                      />
                    );
                  return null;
                })}
              {activeTasks
                /* x 未分配前不渲染：杜绝占位框闪现在世界原点（左上角） */
                .filter((t) => !t.fullyMounted && t.x !== undefined)
                .map((task) => (
                  <LoaderNode
                    key={task.taskId}
                    task={task}
                    isSelected={selectedId === task.taskId}
                    onSelect={() => setSelectedId(task.taskId)}
                    theme={theme}
                    onChange={(attrs) =>
                      setActiveTasks((prev) =>
                        prev.map((t) =>
                          t.taskId === task.taskId ? { ...t, ...attrs } : t,
                        ),
                      )
                    }
                  />
                ))}
              {guides.map((line, i) => (
                <Line key={i} {...line} />
              ))}
              {/* 框选橡皮筋 */}
              {marquee && (
                <Rect
                  listening={false}
                  x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h}
                  fill="rgba(56,152,236,0.12)"
                  stroke="#3898ec" strokeWidth={1 / zoom} dash={[6 / zoom, 4 / zoom]}
                />
              )}
            </Layer>

            {/* 局部编辑蒙版层：暗化目标图 + 高亮笔迹 */}
            {maskMode && (() => {
              const img = images.find((i) => i.id === maskMode);
              if (!img) return null;
              return (
                <Layer>
                  {/* 事件盾牌：吸收命中防止底层图片被拖动；事件仍冒泡到 Stage 供笔刷使用 */}
                  <Rect x={-100000} y={-100000} width={200000} height={200000} fill="transparent" listening={true} />
                  <Rect listening={false} x={img.x} y={img.y} width={img.width} height={img.height} fill="rgba(0,0,0,0.55)" />
                  {/* 笔迹裁剪到图片范围：界外涂抹不显示也不生效 */}
                  <Group listening={false} clipX={img.x} clipY={img.y} clipWidth={img.width} clipHeight={img.height}>
                    {maskStrokes.map((s, i) => (
                      <Line
                        key={i}
                        points={s.points}
                        stroke="rgba(96,165,250,0.8)"
                        strokeWidth={s.size}
                        lineCap="round"
                        lineJoin="round"
                      />
                    ))}
                  </Group>
                  <Rect
                    listening={false}
                    x={img.x} y={img.y} width={img.width} height={img.height}
                    stroke="#60a5fa" strokeWidth={2 / zoom} dash={[8 / zoom, 6 / zoom]}
                  />
                </Layer>
              );
            })()}
          </Stage>
        </div>

        {/* 局部编辑入口：选中带 assetLabel 的图片时出现 */}
        {onRegionEdit && !maskMode && selectedId?.startsWith("img") &&
          images.find((i) => i.id === selectedId)?.assetLabel && (
          <div className="absolute bottom-20 inset-x-0 mx-auto w-fit z-20">
            <button
              onClick={() => enterMaskMode(selectedId)}
              className="px-4 py-2 bg-white text-black rounded text-[11px] font-bold uppercase tracking-wider shadow-lg hover:bg-gray-200 transition-all"
            >
              {t("edit_region")}
            </button>
          </div>
        )}

        {/* 隐藏文件选择器：空态「上传产品图」按钮触发。走 handleLocalImageFile 注册成资产 */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleLocalImageFile(f); e.target.value = ""; }}
        />

        {/* P0-4 画布空态起点：无任何元素时，中央引导卡（一句话 + 大按钮）。
            放画布中央、z 低于左上工具按钮，二者不打架（工具按钮固定左上角）。 */}
        {!maskMode &&
          images.length === 0 && videos.length === 0 && audios.length === 0 && texts.length === 0 &&
          (!activeTasks || activeTasks.length === 0) && (
          <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
            <div className="pointer-events-auto w-[min(440px,86%)] bg-bg-card border border-divider rounded-2xl shadow-pop px-6 py-7 text-center">
              <div className="text-[16px] font-bold text-primary-text">{t("empty_canvas_title")}</div>
              <div className="text-[12px] text-secondary-text mt-2 leading-relaxed">{t("empty_canvas_desc")}</div>
              <div className="mt-5 flex flex-col gap-2">
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full px-4 py-2.5 bg-primary text-black rounded-xl text-[13px] font-semibold hover:opacity-90 transition-opacity"
                >{t("empty_upload_product")}</button>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { if (!openSetPanel("main6")) fileInputRef.current?.click(); }}
                    className="flex-1 px-3 py-2 bg-bg-page border border-divider rounded-xl text-[12px] font-medium text-primary-text hover:border-primary/60 transition-colors"
                  >{t("empty_main6")}</button>
                  <button
                    onClick={() => { if (!openSetPanel("detail7")) fileInputRef.current?.click(); }}
                    className="flex-1 px-3 py-2 bg-bg-page border border-divider rounded-xl text-[12px] font-medium text-primary-text hover:border-primary/60 transition-colors"
                  >{t("empty_detail7")}</button>
                </div>
                {onRequestDescribe && (
                  <button
                    onClick={() => onRequestDescribe()}
                    className="w-full px-3 py-2 text-[12px] text-secondary-text hover:text-primary-text transition-colors"
                  >{t("empty_describe")}</button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 添加文字：电商预设（标题/价格/促销/正文），AI 出背景 + 矢量文字精确叠加 */}
        {!maskMode && (
          <div className="absolute top-4 left-4 z-20">
            <button
              onClick={() => setShowTextMenu((v) => !v)}
              className="px-3.5 py-2.5 bg-bg-card border border-divider rounded-lg text-[12px] font-medium text-primary-text shadow-float hover:border-primary/60 transition-colors flex items-center gap-2"
              title={t("add_text_title")}
              aria-label={t("add_text")}
            >
              <FiType size={14} /> {t("add_text")}
            </button>
            {showTextMenu && (
              <div className="absolute top-full left-0 mt-1.5 w-36 bg-bg-card border border-divider rounded-xl shadow-pop overflow-hidden animate-in fade-in slide-in-from-top-1 duration-150 ease-[var(--ease-out)]">
                {Object.entries(TEXT_PRESETS).map(([key, p]) => (
                  <button
                    key={key}
                    onClick={() => addPresetText(key)}
                    className="w-full text-left px-3.5 py-2.5 text-[12px] text-primary-text hover:bg-bg-page transition-colors flex items-center justify-between"
                  >
                    <span>{t(p.labelKey)}</span>
                    <span className="text-secondary-strong text-[10px] truncate ml-2 max-w-[60px]">{p.text}</span>
                  </button>
                ))}
              </div>
            )}
            {/* 套图：选多张图，套同一固定排版+固定字体的模板 */}
            <button
              onClick={() => { setShowSetPanel(true); setShowTextMenu(false); }}
              className="mt-2 px-3.5 py-2.5 bg-bg-card border border-divider rounded-lg text-[12px] font-medium text-primary-text shadow-float hover:border-primary/60 transition-colors flex items-center gap-2 w-full"
              title={t("set_template_title")}
              aria-label={t("set_template")}
            >
              <FiGrid size={14} /> {t("set_template")}
            </button>
            {/* 操作提示（自然交互，无需按钮）：拖拽=框选，空格+拖拽=平移 */}
            <div className="mt-2 px-3 py-2 rounded-lg bg-bg-card/70 border border-divider/60 text-[11px] text-secondary-strong leading-relaxed select-none">
              <div><span className="text-primary-text font-semibold">{t("hint_drag")}</span> {t("hint_marquee")} · <span className="text-primary-text font-semibold">{t("hint_shift_drag")}</span> {t("hint_add_select")} · <span className="text-primary-text font-semibold">{t("hint_space_drag")}</span> {t("hint_pan")}</div>
              <div><span className="text-primary-text font-semibold">{t("hint_wheel")}</span> {t("hint_pan")} · <span className="text-primary-text font-semibold">{t("hint_cmd_wheel")}</span> {t("hint_zoom")} · <span className="text-primary-text font-semibold">{t("hint_arrows")}</span> {t("hint_nudge")}</div>
            </div>
          </div>
        )}

        {/* 浮动操作条：框选多张 或 单击选中一张图片 都出现（单张也能套图/导出/删除）*/}
        {!maskMode && !showSetPanel && (setSel.size > 0 || selectedId?.startsWith("img")) && (
          <div className="absolute bottom-6 inset-x-0 mx-auto w-fit max-w-[94%] overflow-x-auto z-30 flex items-center gap-1.5 whitespace-nowrap bg-bg-card border border-divider rounded-2xl shadow-pop px-2.5 py-2">
            <span className="text-[12px] font-semibold text-primary-text px-2">{t("selected_count", setSel.size > 0 ? setSel.size : 1)}</span>
            <button
              onClick={() => { if (setSel.size === 0 && selectedId?.startsWith("img")) setSetSel(new Set([selectedId])); setShowSetPanel(true); }}
              className="flex items-center gap-1.5 px-3.5 py-2 bg-primary text-black rounded-xl text-[12px] font-semibold hover:opacity-90 transition-opacity"
              aria-label={t("set_generate")}
            ><FiGrid size={13} /> {t("set_generate")}</button>
            <button
              onClick={exportLongImage}
              disabled={stitching || setSel.size < 2}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium text-primary-text hover:bg-bg-page disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title={t("stitch_title")}
              aria-label={t("stitch_long")}
            ><FiAlignJustify size={13} /> {stitching ? t("stitching") : t("stitch_long")}</button>
            <button
              onClick={exportPSD}
              disabled={exportingPsd}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium text-primary-text hover:bg-bg-page disabled:opacity-50 transition-colors"
              title={t("export_psd_title")}
              aria-label={t("export_psd")}
            ><FiLayers size={13} /> {exportingPsd ? t("exporting_psd") : t("export_psd")}</button>
            {onSplitImage && (() => {
              const srcImg = images.find((i) => (selectedId?.startsWith("img") ? i.id === selectedId : setSel.has(i.id)) && i.assetLabel);
              return (
                <button
                  onClick={() => srcImg && onSplitImage({ assetLabel: srcImg.assetLabel })}
                  disabled={!srcImg}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium text-primary-text hover:bg-bg-page disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  title={t("ai_split_title")}
                  aria-label={t("ai_split")}
                ><FiScissors size={13} /> {t("ai_split")}</button>
              );
            })()}
            <div className="w-px h-5 bg-divider mx-0.5" />
            <button
              onClick={handleDelete}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium text-red-400 hover:bg-red-500/15 transition-colors"
              title={t("delete_title")}
              aria-label={t("delete")}
            ><FiTrash2 size={13} /> {t("delete")}</button>
            <button
              onClick={() => { setSetSel(new Set()); setSelectedId(null); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] text-secondary-text hover:text-primary-text hover:bg-bg-page transition-colors"
              title={t("deselect_title")}
              aria-label={t("deselect")}
            ><FiX size={13} /> {t("deselect")}</button>
          </div>
        )}

        {/* 套图面板：勾选图片 + 选模板 + 应用 */}
        {showSetPanel && (
          <div className="absolute inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in duration-200" onClick={() => setShowSetPanel(false)}>
            <div className="bg-bg-card border border-divider rounded-2xl shadow-pop w-[min(680px,92%)] max-h-[86%] flex flex-col animate-in fade-in zoom-in-95 duration-200 ease-[var(--ease-out)]" onClick={(e) => e.stopPropagation()}>
              <div className="px-5 py-3 border-b border-divider flex items-center justify-between">
                <div className="flex flex-col">
                  <div className="text-[13px] font-bold text-primary-text">{t("set_panel_title")}</div>
                  <div className="text-[10px] text-secondary-text mt-0.5">{t("set_panel_desc")}</div>
                </div>
                <button onClick={() => setShowSetPanel(false)} className="text-secondary-text hover:text-primary-text text-lg leading-none" title={t("dismiss")} aria-label={t("dismiss")}>✕</button>
              </div>
              {/* 模板选择 */}
              <div className="px-5 pt-4 flex gap-2 flex-wrap">
                {Object.entries(SET_TEMPLATES).map(([key, tpl]) => (
                  <button
                    key={key}
                    onClick={() => setSetTpl(key)}
                    className={`px-3 py-1.5 rounded text-[12px] border transition-all text-left ${setTpl === key ? "bg-primary text-black border-primary font-bold" : "bg-bg-page text-secondary-text border-divider hover:text-primary-text"}`}
                    title={t(tpl.descKey)}
                  >
                    {t(tpl.labelKey)}
                    <span className={`ml-1.5 text-[10px] ${setTpl === key ? "opacity-70" : "opacity-50"}`}>{t(tpl.descKey)}</span>
                  </button>
                ))}
              </div>
              {/* 出图方式：单模板固定其性质（直出/分层）→ 给一句明确说明；多图套图 → 三模式可选，各带「好看/可编辑」标签 */}
              {SET_TEMPLATES[setTpl]?.single ? (
                <div className="px-5 pt-3">
                  <div className="text-[11px] leading-relaxed px-3 py-2 rounded-lg border border-primary/40 bg-primary/5 text-primary-text">
                    {t("set_mode_single_note")}
                  </div>
                </div>
              ) : (
                <div className="px-5 pt-3">
                  <div className="text-[10px] text-secondary-text mb-1.5">{t("set_mode_label")}</div>
                  <div className="flex items-center gap-2">
                    {[
                      { k: "ai", labelKey: "set_mode_ai", beauty: true, hintKey: "set_mode_ai_hint" },
                      { k: "layered", labelKey: "set_mode_layered", beauty: false, hintKey: "set_mode_layered_hint" },
                      { k: "editable", labelKey: "set_mode_editable", beauty: false, hintKey: "set_mode_editable_hint" },
                    ].map((m) => (
                      <button
                        key={m.k}
                        onClick={() => setSetGenMode(m.k)}
                        className={`flex-1 px-3 py-2 rounded text-left border transition-all ${setGenMode === m.k ? "bg-primary/10 border-primary text-primary-text" : "bg-bg-page border-divider text-secondary-text hover:text-primary-text"}`}
                      >
                        <div className="text-[12px] font-bold flex items-center gap-1.5">
                          <span className={`w-3 h-3 rounded-full border ${setGenMode === m.k ? "border-primary bg-primary" : "border-secondary-text"}`} />
                          {t(m.labelKey)}
                          <span className={`ml-auto text-[9px] px-1.5 py-0.5 rounded-full ${m.beauty ? "bg-primary/15 text-primary" : "bg-success/15 text-success"}`}>{m.beauty ? t("tag_beauty_first") : t("tag_editable_first")}</span>
                        </div>
                        <div className="text-[10px] text-secondary-text mt-0.5 ml-[18px]">{t(m.hintKey)}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* 图片勾选 */}
              <div className="px-5 py-4 flex-1 overflow-y-auto scrollbar-subtle">
                {images.length === 0 ? (
                  <div className="py-10 text-center text-secondary-strong text-[12px]">{t("no_images_on_canvas")}</div>
                ) : (
                  <div className="grid grid-cols-4 gap-2">
                    {images.map((img) => {
                      const on = setSel.has(img.id);
                      return (
                        <button
                          key={img.id}
                          onClick={() => setSetSel((prev) => { const n = new Set(prev); n.has(img.id) ? n.delete(img.id) : n.add(img.id); return n; })}
                          className={`relative aspect-square rounded overflow-hidden border-2 transition-all ${on ? "border-primary" : "border-divider hover:border-secondary-text"}`}
                        >
                          <img src={img.src} className="w-full h-full object-cover" />
                          {on && <span className="absolute top-1 right-1 w-5 h-5 rounded-full bg-primary text-black text-[11px] font-bold flex items-center justify-center">✓</span>}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="px-5 py-3 border-t border-divider flex items-center justify-between">
                <span className="text-[11px] text-secondary-strong">
                  {SET_TEMPLATES[setTpl]?.single
                    ? t("set_footer_single", setSel.size, t(SET_TEMPLATES[setTpl].ctaKey))
                    : t("set_footer_multi", setSel.size)}
                </span>
                <div className="flex gap-2">
                  <button onClick={() => setShowSetPanel(false)} className="px-4 py-2 border border-divider text-secondary-text rounded text-[11px] font-bold hover:text-primary-text">{t("cancel")}</button>
                  <button onClick={applySetTemplate} disabled={setSel.size === 0} className="px-5 py-2 bg-primary text-black rounded text-[11px] font-bold disabled:opacity-40 disabled:cursor-not-allowed">
                    {SET_TEMPLATES[setTpl]?.single ? t("set_cta_single", t(SET_TEMPLATES[setTpl].ctaKey), SET_TEMPLATES[setTpl].count) : t("set_cta_multi", setSel.size)}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* 文字样式面板：选中文字时出现 */}
        {!maskMode && selectedId?.startsWith("txt") && (() => {
          const sel = texts.find((tx) => tx.id === selectedId);
          if (!sel) return null;
          const bold = sel.fontStyle?.includes("bold");
          const hasStroke = (sel.strokeWidth || 0) > 0;
          const hasShadow = (sel.shadowBlur || 0) > 0;
          return (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 bg-bg-card border border-divider rounded shadow-2xl px-2 py-1.5">
              {/* 字体（Google Fonts，按需加载） */}
              <select
                value={GOOGLE_FONTS.find((f) => f.family === sel.fontFamily)?.family || "Inter, sans-serif"}
                onChange={async (e) => {
                  const fam = e.target.value;
                  updateSelectedText({ fontFamily: fam });
                  await loadGoogleFont(fam);
                  // Konva 会先用回退字体画一遍；字体就绪后必须强制重画几次才稳（单次 batchDraw 常拿不到刚加载的字体）
                  const redraw = () => stageRef.current?.draw();
                  redraw();
                  setTimeout(redraw, 150);
                  setTimeout(redraw, 500);
                }}
                className="h-7 max-w-[88px] bg-bg-page border border-divider rounded text-[11px] text-primary-text px-1 focus:outline-none cursor-pointer"
                title={t("font_title")}
                aria-label={t("font_title")}
              >
                {GOOGLE_FONTS.map((f) => <option key={f.family} value={f.family}>{f.label}</option>)}
              </select>
              <div className="w-px h-5 bg-divider mx-0.5" />
              {/* 字号 */}
              <button onClick={() => updateSelectedText({ fontSize: Math.max(8, (sel.fontSize || 24) - 4) })} className="w-7 h-7 rounded hover:bg-bg-page text-secondary-strong hover:text-primary-text text-sm" aria-label={t("zoom_out")}>A−</button>
              <span className="text-[10px] text-secondary-strong font-mono w-6 text-center tabular-nums">{Math.round(sel.fontSize || 24)}</span>
              <button onClick={() => updateSelectedText({ fontSize: Math.min(200, (sel.fontSize || 24) + 4) })} className="w-7 h-7 rounded hover:bg-bg-page text-secondary-strong hover:text-primary-text text-sm" aria-label={t("zoom_in")}>A+</button>
              <div className="w-px h-5 bg-divider mx-0.5" />
              {/* 加粗 */}
              <button onClick={() => updateSelectedText({ fontStyle: bold ? "normal" : "bold" })} className={`w-7 h-7 rounded text-sm font-bold ${bold ? "bg-primary text-black" : "hover:bg-bg-page text-secondary-strong hover:text-primary-text"}`} aria-label="Bold">B</button>
              {/* 对齐 */}
              {["left", "center", "right"].map((a) => (
                <button key={a} onClick={() => updateSelectedText({ align: a })} className={`w-7 h-7 rounded text-[10px] ${sel.align === a ? "bg-primary text-black" : "hover:bg-bg-page text-secondary-strong hover:text-primary-text"}`} aria-label={a}>{a === "left" ? "⬅" : a === "center" ? "⬌" : "➡"}</button>
              ))}
              <div className="w-px h-5 bg-divider mx-0.5" />
              {/* 颜色 */}
              {TEXT_SWATCHES.map((c) => (
                <button key={c} onClick={() => updateSelectedText({ fill: c })} title={c} aria-label={c} className={`w-5 h-5 rounded-full border ${sel.fill === c ? "border-primary ring-1 ring-primary" : "border-white/20"}`} style={{ backgroundColor: c }} />
              ))}
              <div className="w-px h-5 bg-divider mx-0.5" />
              {/* 描边 / 阴影：杂乱产品图上的可读性处理 */}
              <button onClick={() => updateSelectedText(hasStroke ? { strokeWidth: 0 } : { stroke: "#000000", strokeWidth: 2, fillAfterStrokeEnabled: true, lineJoin: "round" })} className={`px-2 h-7 rounded text-[10px] ${hasStroke ? "bg-primary text-black" : "hover:bg-bg-page text-secondary-strong hover:text-primary-text"}`}>{t("text_stroke")}</button>
              <button onClick={() => updateSelectedText(hasShadow ? { shadowBlur: 0 } : { shadowColor: "#000000", shadowBlur: 6, shadowOpacity: 0.45 })} className={`px-2 h-7 rounded text-[10px] ${hasShadow ? "bg-primary text-black" : "hover:bg-bg-page text-secondary-strong hover:text-primary-text"}`}>{t("text_shadow")}</button>
              <div className="w-px h-5 bg-divider mx-0.5" />
              <button onClick={() => { setTexts((prev) => prev.filter((tx) => tx.id !== selectedId)); setSelectedId(null); }} className="w-7 h-7 rounded hover:bg-red-500/15 text-secondary-strong hover:text-red-400 text-sm" title={t("delete")} aria-label={t("delete")}>✕</button>
            </div>
          );
        })()}

        {/* 局部编辑操作提示层（C6）：进入蒙版模式后告知可用操作。
            HTML 浮层、绝对定位、pointer-events-none——不进 Konva 场景图。 */}
        {maskMode && (
          <div className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 z-30 px-3 py-1.5 rounded bg-bg-card/90 border border-white/10 shadow-lg text-[11px] text-secondary-text backdrop-blur-sm">
            {t("mask_hint")}
          </div>
        )}

        {/* 局部编辑操作面板 */}
        {maskMode && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2 w-[min(560px,90%)]">
            <div className="flex items-center gap-3 px-4 py-2 rounded bg-bg-card border border-divider shadow-2xl text-[11px] text-secondary-text">
              <span className="font-bold uppercase tracking-wider">{t("paint_area")}</span>
              <span>{t("brush")}</span>
              <input
                type="range" min="12" max="160" value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
                className="w-28 accent-white"
              />
              <button onClick={() => setMaskStrokes([])} className="px-2 py-1 border border-divider rounded hover:text-primary-text transition-colors">
                {t("clear")}
              </button>
              <button onClick={exitMaskMode} className="px-2 py-1 border border-divider rounded hover:text-primary-text transition-colors">
                {t("cancel")}
              </button>
            </div>
            <div className="flex items-center gap-2 w-full px-3 py-2 rounded bg-bg-card border border-divider shadow-2xl">
              <input
                value={maskPrompt}
                onChange={(e) => setMaskPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") applyRegionEdit(); }}
                placeholder={t("region_prompt_placeholder")}
                className="flex-1 bg-transparent text-[13px] text-primary-text placeholder:text-secondary-text/50 focus:outline-none"
                autoFocus
              />
              <button
                onClick={applyRegionEdit}
                disabled={!maskPrompt.trim() || maskStrokes.length === 0}
                className="shrink-0 px-4 py-1.5 bg-white text-black rounded text-[11px] font-bold uppercase tracking-wider hover:bg-gray-200 transition-all disabled:opacity-40"
              >
                {t("apply_credits", 15)}
              </button>
            </div>
          </div>
        )}

        {/* Text Editor Overlay */}
        {editingTextId &&
          (() => {
            const node = texts.find((t) => t.id === editingTextId);
            if (!node || !stageRef.current) return null;
            const stage = stageRef.current;
            const absX = node.x * zoom + stage.x();
            const absY = node.y * zoom + stage.y();
            return (
              <textarea
                autoFocus
                value={node.text}
                onChange={(e) =>
                  setTexts((prev) =>
                    prev.map((t) =>
                      t.id === editingTextId
                        ? { ...t, text: e.target.value }
                        : t,
                    ),
                  )
                }
                onBlur={() => setEditingTextId(null)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" || (e.key === "Enter" && !e.shiftKey))
                    setEditingTextId(null);
                }}
                className="absolute z-50 bg-transparent border-none outline-none resize-none overflow-hidden"
                style={{
                  left: absX,
                  top: absY,
                  width: (node.width || 200) * zoom,
                  fontSize: (node.fontSize || 24) * zoom,
                  color: node.fill || (theme === "dark" ? "white" : "black"),
                  transform: `rotate(${node.rotation || 0}deg)`,
                }}
              />
            );
          })()}

        {/* Context Menu */}
        {contextMenu && (
          <div
            ref={(node) => {
              if (node) {
                const rect = node.getBoundingClientRect();
                if (rect.right > window.innerWidth)
                  node.style.marginLeft = `-${rect.right - window.innerWidth + 10}px`;
                if (rect.bottom > window.innerHeight)
                  node.style.marginTop = `-${rect.bottom - window.innerHeight + 10}px`;
              }
            }}
            className={`fixed z-[100] w-56 rounded shadow-2xl border border-divider text-sm ${theme === "dark" ? "bg-bg-card border-border-main text-text-main" : "bg-bg-card border-border-main text-text-main"}`}
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(e) => e.stopPropagation()}
          >
            {contextMenu.type === "node" ? (
              <>
                <MenuButton
                  label={t("copy")}
                  shortcut="Ctrl+C"
                  onClick={handleCopy}
                  theme={theme}
                />
                <MenuButton
                  label={t("cut")}
                  shortcut="Ctrl+X"
                  onClick={handleCut}
                  theme={theme}
                />
                <MenuButton
                  label={t("duplicate")}
                  shortcut="Ctrl+D"
                  onClick={handleDuplicate}
                  theme={theme}
                />
                <MenuDivider theme={theme} />
                <MenuButton
                  label={t("bring_to_front")}
                  shortcut="]"
                  onClick={() => handleZIndex("front")}
                  theme={theme}
                />
                <MenuButton
                  label={t("send_to_back")}
                  shortcut="["
                  onClick={() => handleZIndex("back")}
                  theme={theme}
                />
                <MenuButton
                  label={t("move_up")}
                  shortcut="Ctrl+]"
                  onClick={() => handleZIndex("up")}
                  theme={theme}
                />
                <MenuButton
                  label={t("move_down")}
                  shortcut="Ctrl+["
                  onClick={() => handleZIndex("down")}
                  theme={theme}
                />
                <MenuDivider theme={theme} />
                <MenuButton
                  label={t("lock_unlock")}
                  shortcut="Ctrl+Shift+L"
                  onClick={() => handleToggleState("locked")}
                  theme={theme}
                />
                <MenuButton
                  label={t("show_hide")}
                  shortcut="Ctrl+Shift+H"
                  onClick={() => handleToggleState("hidden")}
                  theme={theme}
                />
                <MenuDivider theme={theme} />
                <MenuButton
                  label={t("flip_horizontal")}
                  onClick={() => handleFlip("horizontal")}
                  theme={theme}
                />
                <MenuButton
                  label={t("flip_vertical")}
                  onClick={() => handleFlip("vertical")}
                  theme={theme}
                />
                <MenuDivider theme={theme} />
                <MenuButton
                  label={t("download")}
                  onClick={handleDownload}
                  theme={theme}
                />
                <MenuDivider theme={theme} />
                {!contextMenu?.nodeId?.startsWith("aud") && (
                  <div className="relative group">
                    <button
                      className={`w-full text-left px-4 py-1.5 flex justify-between items-center transition-colors ${theme === "dark" ? "hover:bg-bg-page" : "hover:bg-bg-page"}`}
                    >
                      <span>{t("export_as")}</span>
                      <span>›</span>
                    </button>
                    <div
                      className={`absolute left-full bottom-0 hidden group-hover:block w-32 rounded shadow-2xl border border-divider text-sm ${theme === "dark" ? "bg-bg-card border-border-main" : "bg-bg-card border-border-main"}`}
                    >
                      <MenuButton
                        label="PNG"
                        onClick={() => handleExport("PNG")}
                        theme={theme}
                      />
                      <MenuButton
                        label="JPG"
                        onClick={() => handleExport("JPG")}
                        theme={theme}
                      />
                      <MenuButton
                        label="SVG"
                        onClick={() => handleExport("SVG")}
                        theme={theme}
                      />
                    </div>
                  </div>
                )}
                <MenuDivider theme={theme} />
                <MenuButton
                  label={t("delete")}
                  shortcut="Del"
                  onClick={handleDelete}
                  theme={theme}
                />
              </>
            ) : (
              <>
                <MenuButton
                  label={t("paste")}
                  shortcut="Ctrl+V"
                  onClick={handlePasteNode}
                  theme={theme}
                />
                <MenuDivider theme={theme} />
                <MenuButton
                  label={t("zoom_in")}
                  shortcut="Ctrl++"
                  onClick={() => updateZoom(Math.min(5, zoom + 0.1))}
                  theme={theme}
                />
                <MenuButton
                  label={t("zoom_out")}
                  shortcut="Ctrl+-"
                  onClick={() => updateZoom(Math.max(0.1, zoom - 0.1))}
                  theme={theme}
                />
                <MenuButton
                  label={t("zoom_to_fit")}
                  shortcut="Shift+1"
                  onClick={handleZoomToFit}
                  theme={theme}
                />
                <MenuButton
                  label={t("reset_zoom")}
                  shortcut="Ctrl+0"
                  onClick={() => updateZoom(1)}
                  theme={theme}
                />
                <MenuDivider theme={theme} />
                <MenuButton
                  label={t("export_canvas")}
                  onClick={handleExportCanvas}
                  theme={theme}
                />
                <MenuButton
                  label={t("show_all_hidden")}
                  onClick={handleShowAllHidden}
                  theme={theme}
                />
                <MenuButton
                  label={t("clear_canvas")}
                  onClick={handleClearCanvas}
                  theme={theme}
                />
              </>
            )}
          </div>
        )}
      </div>
    );
  },
);

CanvasArea.displayName = "CanvasArea";

export default CanvasArea;
