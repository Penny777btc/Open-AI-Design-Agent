"""画布自动摆放：Figma 卡片墙式排布（每行 4 张、双向等装订线），新批次落在已有内容包围盒下方。

坐标是画布世界坐标。显示尺寸：自然尺寸等比缩放，最长边统一 CARD_DIM——卡片够大、
密度均匀。装订线 GAP 取卡片长边 ~10%（Figma 观感）；旧参数(最长边 200、行距失衡)太松散。
"""

ROW_CAP = 4
GAP = 32
NEW_BATCH_GAP = 64
MAX_DIM = 400   # 前端 addImage 无坐标时的自然缩放上限（保持兼容语义，勿删）
CARD_DIM = 320  # 自动摆放卡片的最长边（Figma 式卡片墙）


def display_size(width: int | None, height: int | None) -> tuple[int, int]:
    w, h = width or 1024, height or 1024
    if w >= h:
        scaled = (CARD_DIM, h / w * CARD_DIM)
    else:
        scaled = (w / h * CARD_DIM, CARD_DIM)
    return int(scaled[0]), int(scaled[1])


class PlacementPlanner:
    """单个 job 内的顺序摆放器（调用方需持有 session 级锁保证串行）。"""

    def __init__(self, canvas_nodes: list[dict] | None, viewport: dict | None = None):
        nodes = [n for n in (canvas_nodes or []) if isinstance(n, dict) and "x" in n]
        if nodes:
            self.origin_x = min(n["x"] for n in nodes)
            self.cursor_y = max(n["y"] + (n.get("h") or 200) for n in nodes) + NEW_BATCH_GAP
        else:
            # 空画布：以用户当前视口中心为排布原点（否则落在世界原点=视口左上角）
            self.origin_x, self.cursor_y = self._viewport_center(viewport)
        self.cursor_x = self.origin_x
        self.col = 0
        self.row_height = 0

    @staticmethod
    def _viewport_center(viewport: dict | None) -> tuple[int, int]:
        try:
            zoom = viewport.get("zoom") or 1
            pan = viewport.get("pan") or [0, 0]
            w, h = viewport.get("w") or 0, viewport.get("h") or 0
            if w and h:
                center_x = (-pan[0] + w / 2) / zoom
                center_y = (-pan[1] + h / 2) / zoom
                # 原点 = 中心往左上偏移一张图的显示尺寸，让首图大致居中
                return int(center_x - MAX_DIM / 4), int(center_y - MAX_DIM / 4)
        except (AttributeError, TypeError, ZeroDivisionError, IndexError):
            pass
        return 0, 0

    def next(self, width: int | None, height: int | None) -> tuple[int, int]:
        disp_w, disp_h = display_size(width, height)
        if self.col >= ROW_CAP:
            self.col = 0
            self.cursor_x = self.origin_x
            self.cursor_y += self.row_height + GAP
            self.row_height = 0
        x, y = int(self.cursor_x), int(self.cursor_y)
        self.cursor_x += disp_w + GAP
        self.row_height = max(self.row_height, disp_h)
        self.col += 1
        return x, y
