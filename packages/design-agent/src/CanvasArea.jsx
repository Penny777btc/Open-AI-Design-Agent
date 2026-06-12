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
  onSelect,
  onChange,
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
          if (!imageObj.locked) onSelect(e);
        }}
        onTap={(e) => {
          if (!imageObj.locked) onSelect(e);
        }}
        ref={shapeRef}
        {...restImageObj}
        id={imageObj.id}
        name="konva-item"
        draggable={!imageObj.locked}
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
            text="Image"
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
            text="Video"
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
        toast.error(
          "Playback failed. Please try clicking the play button again.",
        );
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
          text={audioObj.label || "Audio Asset"}
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
              ? `Rendering...\n\n${task.modelName}`
              : `Generating...\n\n${task.modelName}`
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
          text="(Move to change spawn location)"
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
        toast.error("请在选中的图片范围内涂抹");
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
          toast.error(
            "Export failed: This image might be from an external source without CORS permission.",
          );
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
          toast.loading("Preparing download...", { id: "download" });
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
          
          toast.success("Download started", { id: "download" });
        } catch (err) {
          console.error("Download failed:", err);
          toast.error("Download failed. CORS might be blocking direct download.", { id: "download" });
          // Fallback to old method if fetch fails
          const link = document.createElement("a");
          link.href = item.src;
          link.target = "_blank";
          link.download = "";
          link.click();
        }
      } else {
        toast.error("Source URL not found");
      }
      setContextMenu(null);
    };

    const handleShowAllHidden = () => {
      setImages((prev) => prev.map((i) => ({ ...i, hidden: false })));
      setVideos((prev) => prev.map((v) => ({ ...v, hidden: false })));
      setAudios((prev) => prev.map((a) => ({ ...a, hidden: false })));
      setTexts((prev) => prev.map((t) => ({ ...t, hidden: false })));
      toast.success("All items are now visible");
      setContextMenu(null);
    };

    const handleClearCanvas = () => {
      if (window.confirm("Are you sure you want to clear the entire canvas?")) {
        setImages([]);
        setVideos([]);
        setAudios([]);
        setTexts([]);
        setSelectedId(null);
        toast.success("Canvas cleared");
      }
      setContextMenu(null);
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
        toast.error(
          "Canvas export failed: One or more images on the canvas are from an external source without CORS permission.",
        );
      }
      setContextMenu(null);
    };

    const addImage = (src, x, y, width, height, onLoaded, assetLabel) => {
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
          },
        ]);
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
          console.error("Failed to load image after retry:", src);
          // Add it anyway so it shows up in the layers list / has a presence
          commitImage(img);
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
          label: label || "Audio Asset",
          rotation: 0,
        },
      ]);
      setSelectedId(id);
    };

    const addNewText = (text, x, y) => {
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
          text: text || "Double-click to Edit",
          fontSize: 24,
          x: targetX,
          y: targetY,
          draggable: true,
          fill: theme === "dark" ? "white" : "black",
          rotation: 0,
        },
      ]);
      setSelectedId(id);
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

    useImperativeHandle(
      ref,
      () => ({
        addImage,
        addVideo,
        addAudio,
        getCanvasState,
        moveNode,
        placeNextToSource,
        // Back-compat alias — earlier code referenced replaceAt before we
        // switched to non-destructive side-by-side placement.
        replaceAt: placeNextToSource,
        arrangeNodes,
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
            const reader = new FileReader();
            reader.onload = (event) => addImage(event.target.result);
            reader.readAsDataURL(file);
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
      const id = contextMenu?.nodeId || selectedId;
      if (id) {
        setImages(images.filter((img) => img.id !== id));
        setVideos(videos.filter((vid) => vid.id !== id));
        setAudios(audios.filter((aud) => aud.id !== id));
        setTexts(texts.filter((txt) => txt.id !== id));
        if (selectedId === id) setSelectedId(null);
      }
      setContextMenu(null);
    };

    // Resize Observer for Stage
    useEffect(() => {
      if (!stageWrapperRef.current) return;
      const resizeObserver = new ResizeObserver((entries) => {
        for (let entry of entries) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0) {
            setCanvasSize({ width, height });
          }
        }
      });
      resizeObserver.observe(stageWrapperRef.current);
      return () => resizeObserver.disconnect();
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
          }
        } else if (e.key === "Delete" || e.key === "Backspace") {
          handleDelete();
        } else if (e.key === "]") {
          if (selectedId) handleZIndex("front");
        } else if (e.key === "[") {
          if (selectedId) handleZIndex("back");
        } else if (e.shiftKey && (e.key === "!" || e.key === "1")) {
          e.preventDefault();
          handleZoomToFit();
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [zoom, images, videos, texts, selectedId, clipboardNode]);

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

    const handleDragMove = (e) => {
      const node = e.target;
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

    const handleWheel = (e) => {
      e.evt.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      const scaleBy = 1.05;
      const oldScale = stage.scaleX();
      const pointer = stage.getPointerPosition();
      if (!pointer) return;
      const mousePointTo = {
        x: (pointer.x - stage.x()) / oldScale,
        y: (pointer.y - stage.y()) / oldScale,
      };
      const newScale =
        e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
      const boundedScale = Math.max(0.1, Math.min(5, newScale));
      updateZoom(boundedScale, {
        x: pointer.x - mousePointTo.x * boundedScale,
        y: pointer.y - mousePointTo.y * boundedScale,
      });
      setContextMenu(null);
    };

    const handleDrop = (e) => {
      e.preventDefault();
      const url = e.dataTransfer.getData("text/plain");
      const files = e.dataTransfer.files;
      if (url) {
        if (url.match(/\.(mp4|webm|mov)$/i)) addVideo(url);
        else if (url.match(/\.(mp3|wav|ogg|m4a)$/i)) addAudio(url);
        else addImage(url);
      } else if (files && files.length > 0) {
        const file = files[0];
        const reader = new FileReader();
        reader.onload = (ev) => {
          if (file.type.startsWith("video/")) addVideo(ev.target.result);
          else if (file.type.startsWith("audio/")) addAudio(ev.target.result);
          else addImage(ev.target.result);
        };
        reader.readAsDataURL(file);
      }
    };

    return (
      <div
        className={`relative w-full h-full bg-bg-page overflow-hidden ${maskMode ? "cursor-crosshair" : ""}`}
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
              if (e.target === e.target.getStage()) setSelectedId(null);
              setContextMenu(null);
            }}
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
            draggable={!maskMode}
            onDragMove={(e) => {
              if (e.target === stageRef.current && containerRef.current) {
                containerRef.current.style.backgroundPosition = `${e.target.x()}px ${e.target.y()}px`;
              }
            }}
          >
            <Layer>
              <Rect
                width={10000}
                height={10000}
                x={-5000}
                y={-5000}
                fill="#ffffff03"
                listening={false}
              />
              {[...images, ...videos, ...audios, ...texts]
                .sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0))
                .map((item) => {
                  if (item.id.startsWith("img"))
                    return (
                      <URLImage
                        key={item.id}
                        imageObj={item}
                        isSelected={item.id === selectedId}
                        onSelect={() => setSelectedId(item.id)}
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
                .filter((t) => !t.fullyMounted)
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
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-20">
            <button
              onClick={() => enterMaskMode(selectedId)}
              className="px-4 py-2 bg-white text-black rounded text-[11px] font-bold uppercase tracking-wider shadow-lg hover:bg-gray-200 transition-all"
            >
              🖌 局部编辑 · Edit Region
            </button>
          </div>
        )}

        {/* 局部编辑操作面板 */}
        {maskMode && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2 w-[min(560px,90%)]">
            <div className="flex items-center gap-3 px-4 py-2 rounded bg-bg-card border border-divider shadow-2xl text-[11px] text-secondary-text">
              <span className="font-bold uppercase tracking-wider">涂抹要修改的区域</span>
              <span>笔刷</span>
              <input
                type="range" min="12" max="160" value={brushSize}
                onChange={(e) => setBrushSize(Number(e.target.value))}
                className="w-28 accent-white"
              />
              <button onClick={() => setMaskStrokes([])} className="px-2 py-1 border border-divider rounded hover:text-primary-text transition-colors">
                清除
              </button>
              <button onClick={exitMaskMode} className="px-2 py-1 border border-divider rounded hover:text-primary-text transition-colors">
                取消
              </button>
            </div>
            <div className="flex items-center gap-2 w-full px-3 py-2 rounded bg-bg-card border border-divider shadow-2xl">
              <input
                value={maskPrompt}
                onChange={(e) => setMaskPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") applyRegionEdit(); }}
                placeholder="描述这块区域要怎么改，如：把文字改成「限时 8 折」"
                className="flex-1 bg-transparent text-[13px] text-primary-text placeholder:text-secondary-text/50 focus:outline-none"
                autoFocus
              />
              <button
                onClick={applyRegionEdit}
                disabled={!maskPrompt.trim() || maskStrokes.length === 0}
                className="shrink-0 px-4 py-1.5 bg-white text-black rounded text-[11px] font-bold uppercase tracking-wider hover:bg-gray-200 transition-all disabled:opacity-40"
              >
                应用 · 15 CR
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
                  label="Copy"
                  shortcut="Ctrl+C"
                  onClick={handleCopy}
                  theme={theme}
                />
                <MenuButton
                  label="Cut"
                  shortcut="Ctrl+X"
                  onClick={handleCut}
                  theme={theme}
                />
                <MenuButton
                  label="Duplicate"
                  shortcut="Ctrl+D"
                  onClick={handleDuplicate}
                  theme={theme}
                />
                <MenuDivider theme={theme} />
                <MenuButton
                  label="Bring to Front"
                  shortcut="]"
                  onClick={() => handleZIndex("front")}
                  theme={theme}
                />
                <MenuButton
                  label="Send to Back"
                  shortcut="["
                  onClick={() => handleZIndex("back")}
                  theme={theme}
                />
                <MenuButton
                  label="Move Up"
                  shortcut="Ctrl+]"
                  onClick={() => handleZIndex("up")}
                  theme={theme}
                />
                <MenuButton
                  label="Move Down"
                  shortcut="Ctrl+["
                  onClick={() => handleZIndex("down")}
                  theme={theme}
                />
                <MenuDivider theme={theme} />
                <MenuButton
                  label="Lock/Unlock"
                  shortcut="Ctrl+Shift+L"
                  onClick={() => handleToggleState("locked")}
                  theme={theme}
                />
                <MenuButton
                  label="Show/Hide"
                  shortcut="Ctrl+Shift+H"
                  onClick={() => handleToggleState("hidden")}
                  theme={theme}
                />
                <MenuDivider theme={theme} />
                <MenuButton
                  label="Flip Horizontal"
                  onClick={() => handleFlip("horizontal")}
                  theme={theme}
                />
                <MenuButton
                  label="Flip Vertical"
                  onClick={() => handleFlip("vertical")}
                  theme={theme}
                />
                <MenuDivider theme={theme} />
                <MenuButton
                  label="Download"
                  onClick={handleDownload}
                  theme={theme}
                />
                <MenuDivider theme={theme} />
                {!contextMenu?.nodeId?.startsWith("aud") && (
                  <div className="relative group">
                    <button
                      className={`w-full text-left px-4 py-1.5 flex justify-between items-center transition-colors ${theme === "dark" ? "hover:bg-bg-page" : "hover:bg-bg-page"}`}
                    >
                      <span>Export As</span>
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
                  label="Delete"
                  shortcut="Del"
                  onClick={handleDelete}
                  theme={theme}
                />
              </>
            ) : (
              <>
                <MenuButton
                  label="Paste"
                  shortcut="Ctrl+V"
                  onClick={handlePasteNode}
                  theme={theme}
                />
                <MenuDivider theme={theme} />
                <MenuButton
                  label="Zoom In"
                  shortcut="Ctrl++"
                  onClick={() => updateZoom(Math.min(5, zoom + 0.1))}
                  theme={theme}
                />
                <MenuButton
                  label="Zoom Out"
                  shortcut="Ctrl+-"
                  onClick={() => updateZoom(Math.max(0.1, zoom - 0.1))}
                  theme={theme}
                />
                <MenuButton
                  label="Zoom to Fit"
                  shortcut="Shift+1"
                  onClick={handleZoomToFit}
                  theme={theme}
                />
                <MenuButton
                  label="Reset Zoom"
                  shortcut="Ctrl+0"
                  onClick={() => updateZoom(1)}
                  theme={theme}
                />
                <MenuDivider theme={theme} />
                <MenuButton
                  label="Export Canvas"
                  onClick={handleExportCanvas}
                  theme={theme}
                />
                <MenuButton
                  label="Show All Hidden"
                  onClick={handleShowAllHidden}
                  theme={theme}
                />
                <MenuButton
                  label="Clear Canvas"
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
