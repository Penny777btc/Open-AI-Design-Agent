"""端到端冒烟：用最新代码（删完 AI 补全死代码版）真跑一次智能四层拆解。
mirror job_service 的执行：build_smart_split_plan → 主体/元素抠图 + judge_element_complete
→ build_bg_hole_mask_from_layers → provider.edit 生成背景。产物落到 scripts/split_smoke_out/。"""
import asyncio
import io
import sys
from pathlib import Path

from PIL import Image

from app.agents.split import (
    build_bg_hole_mask_from_layers,
    build_smart_split_plan,
    cutout_region,
    cutout_subject_full,
    dislocation_guard,
    judge_element_complete,
)
from app.providers import get_image_provider
from app.providers.openai_compat import _png_dims
from app.services.job_service import _decode_frame, _resize_to_frame

OUT = Path("scripts/split_smoke_out")
OUT.mkdir(exist_ok=True)


def load_png(path: str) -> bytes:
    im = Image.open(path).convert("RGB")
    b = io.BytesIO()
    im.save(b, "PNG")
    return b.getvalue()


async def main(img_path: str) -> None:
    src = load_png(img_path)
    (OUT / "source.png").write_bytes(src)
    fw, fh = _decode_frame(src)
    print(f"source: {img_path}  {fw}x{fh}  ({len(src)} bytes)")

    plan = await build_smart_split_plan("smoke-sess", "src_asset", src)
    print(f"\nplan: mode={plan.mode}  title={plan.title!r}  nodes={len(plan.nodes)}")
    for n in plan.nodes:
        print(f"  - {n.id:14} tool={n.tool:12} role={str(n.args.get('split_role')):8} "
              f"z={n.args.get('z_index'):>5} depends={n.depends}")
    if plan.mode != "plan":
        print("\n⚠️ 降级（analyze_layers 返回 None：无 key/无主体）——未走智能四层拆解")
        return

    nodes = {n.id: n for n in plan.nodes}
    outputs: dict[str, dict] = {}
    print()
    for nid, n in nodes.items():  # plan.nodes 已是 subject→elements→text→bg 的执行序
        role = n.args.get("split_role")
        if n.tool == "cutout_layer" and role == "subject":
            cut = cutout_subject_full(src, n.args["bbox"], lift_lo=25, lift_scale=4,
                                      min_frac=0.05, other_rel_boxes=n.args.get("other_boxes"))
            outputs[nid] = {"png": cut}
            (OUT / f"{nid}_subject.png").write_bytes(cut)
            print(f"[{nid}] 主体层 ✓ ({len(cut)} bytes)")
        elif n.tool == "cutout_layer" and role == "element":
            label = n.args.get("label", "")
            cut = cutout_region(src, n.args["bbox"], lift_lo=10, lift_scale=2,
                                min_frac=0.15, other_rel_boxes=n.args.get("other_boxes"))
            if dislocation_guard(cut, n.args["bbox"]):
                print(f"[{nid}] 元素「{label}」✗ 抠空/错位 → 丢弃")
                continue
            subj_png = outputs.get("split_subject", {}).get("png")
            if not judge_element_complete(cut, subj_png):
                print(f"[{nid}] 元素「{label}」✗ 不完整(遮挡/出血) → 留背景")
                continue
            outputs[nid] = {"png": cut}
            (OUT / f"{nid}_{label[:12]}.png").write_bytes(cut)
            print(f"[{nid}] 元素「{label}」✓ 成独立层")
        elif n.tool == "extract_text":
            tb = n.args.get("text_blocks") or []
            outputs[nid] = {"text_blocks": tb}
            print(f"[{nid}] 文字层：{len(tb)} 个文字框（本冒烟不渲染文字）")
        elif n.tool == "edit_image" and role == "bg":
            layer_pngs = [outputs[x]["png"] for x in n.args.get("layer_nodes", [])
                          if x in outputs and outputs[x].get("png")]
            mask = build_bg_hole_mask_from_layers(src, layer_pngs, n.args.get("text_blocks") or [])
            (OUT / "bg_mask.png").write_bytes(mask)
            print(f"[{nid}] 背景洞 mask ← {len(layer_pngs)} 个抠出层 + 文字框；调 provider.edit 生成背景 …")
            img = await get_image_provider().edit(n.args["prompt"], src, "1:1", mask=mask)
            bg = _resize_to_frame(img.data, fw, fh)
            outputs[nid] = {"png": bg}
            (OUT / f"{nid}_background.png").write_bytes(bg)
            print(f"[{nid}] 背景层 ✓ {_png_dims(bg)}  model={img.model}")

    # 合成预览（按 z_index 叠；文字层无 png 不参与）
    layers = sorted(
        [(nodes[nid].args.get("z_index", 0), nid, o["png"]) for nid, o in outputs.items() if o.get("png")],
        key=lambda t: t[0],
    )
    comp = Image.new("RGBA", (fw, fh), (255, 255, 255, 255))
    for _z, _nid, png in layers:
        im = Image.open(io.BytesIO(png)).convert("RGBA")
        if im.size != (fw, fh):
            im = im.resize((fw, fh), Image.LANCZOS)
        comp.alpha_composite(im)
    comp.convert("RGB").save(OUT / "composite.png")
    print(f"\n合成预览：{(OUT / 'composite.png').resolve()}")
    print(f"全部产物目录：{OUT.resolve()}")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1]))
