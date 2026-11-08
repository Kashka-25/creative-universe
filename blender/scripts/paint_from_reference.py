"""Paint the guide with Cassidy's painting itself.

    blender blender/guide.blend --background --python blender/scripts/paint_from_reference.py

Runs after build_guide.py and fit_reference.py. With the guide posed exactly as
painted (seated_idle, first frame), it projects the painting onto him from the
front, through the view saved in blender/reference/alignment.json, and bakes the
result into one texture per mesh. So from the front his face, fur strokes,
beanie and dungarees are Cassidy's brushwork, not an imitation of it.

Where the painting can't help, the built textures stay:
  - clouds, sun and bolt are cut out of the painting (reference_masks.py);
  - surfaces turned away from the front fade back to the built texture;
  - surfaces hidden behind another part as painted (the chest behind his hands,
    the body under the fur) keep the built texture, so nothing wrong is revealed
    when he moves.
"""

import json
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from guide_common import project_root  # noqa: E402

ROOT = project_root()
with open(os.path.join(ROOT, "blender", "reference", "alignment.json"), encoding="utf-8") as f:
    ALIGN = json.load(f)
PAINTED = {"face", "fur", "fur_strands", "skin", "skin_shade", "hat", "hat_cuff", "dungarees"}
# Each part only takes its own colours from the painting, so where his pose differs a little from the
# painting (his hands, say) the painted hands don't land on his belly. Ranges are on the painting's red channel.
ACCEPTS = {
    "fur": (None, (0.6, 0.75)), "fur_strands": (None, (0.6, 0.75)),        # maroon, not orange or peach
    "hat": ((0.55, 0.7), None), "hat_cuff": ((0.55, 0.7), None), "dungarees": ((0.55, 0.7), None),  # orange or brighter
    "skin": ((0.65, 0.85), None), "skin_shade": ((0.6, 0.8), None),      # peach
    "face": (None, None),
}
SIZES = {"guide_head": 2048, "guide_body": 2048, "guide_fur": 2048}
OBJECTS = list(SIZES)


def pose_as_painted():
    rig = bpy.data.objects["GuideRig"]
    clip, frame = ALIGN["pose"]
    act = bpy.data.actions[clip]
    rig.animation_data.action = act
    rig.animation_data.action_slot = act.slots["OBGuideRig"]
    key = bpy.data.objects["guide_head"].data.shape_keys
    key.animation_data.action = act
    key.animation_data.action_slot = act.slots["KEFaceKeys"]
    bpy.context.scene.frame_set(frame)
    bpy.context.view_layer.update()


def visibility():
    """Per-vertex: 1 if the painting sees this point (nothing in front of it), else 0."""
    dg = bpy.context.evaluated_depsgraph_get()
    scene = bpy.context.scene
    toward_viewer = Vector((0, -1, 0))
    for name in OBJECTS:
        obj = bpy.data.objects[name]
        ev = obj.evaluated_get(dg)
        me = ev.to_mesh()
        vals = []
        for v in me.vertices:
            p = ev.matrix_world @ v.co
            hit, *_ = scene.ray_cast(dg, p + toward_viewer * 0.004, toward_viewer, distance=5.0)
            vals.append(0.0 if hit else 1.0)
        ev.to_mesh_clear()
        attr = obj.data.color_attributes.get("vis") or obj.data.color_attributes.new("vis", "FLOAT_COLOR", "POINT")
        flat = []
        for x in vals:
            flat += [x, x, x, 1.0]
        attr.data.foreach_set("color", flat)
        print(f"{name}: {sum(vals) / len(vals):.0%} of vertices seen by the painting")


def projector_nodes(nt, base_socket, accepts=(None, None)):
    """Mixes the painting (projected from the front) over `base_socket`. Returns the output socket."""
    n, l = nt.nodes, nt.links
    s = ALIGN["metresPerPixel"]
    W, H = ALIGN["size"]
    cx, cz = ALIGN["centre"]
    geo = n.new("ShaderNodeNewGeometry")
    sep = n.new("ShaderNodeSeparateXYZ")
    l.new(geo.outputs["Position"], sep.inputs[0])

    def affine(sock, mul, add):
        m = n.new("ShaderNodeMath")
        m.operation = "MULTIPLY_ADD"
        l.new(sock, m.inputs[0])
        m.inputs[1].default_value = mul
        m.inputs[2].default_value = add
        return m.outputs[0]

    # u = ((x - cx)/s + W/2)/W ; v = 1 - ((cz - z)/s + H/2)/H = (z - cz)/(s H) + 1/2
    u = affine(sep.outputs["X"], 1 / (s * W), 0.5 - cx / (s * W))
    v = affine(sep.outputs["Z"], 1 / (s * H), 0.5 - cz / (s * H))
    comb = n.new("ShaderNodeCombineXYZ")
    l.new(u, comb.inputs[0])
    l.new(v, comb.inputs[1])
    tex = n.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(os.path.join(ROOT, "blender", "reference", "guide-reference-chimp.png"), check_existing=True)
    tex.extension = "CLIP"
    tex.interpolation = "Cubic"
    l.new(comb.outputs[0], tex.inputs["Vector"])
    # facing the painting (Blender -Y is towards the viewer)
    dot = n.new("ShaderNodeVectorMath")
    dot.operation = "DOT_PRODUCT"
    l.new(geo.outputs["Normal"], dot.inputs[0])
    dot.inputs[1].default_value = (0, -1, 0)
    face = n.new("ShaderNodeMapRange")
    l.new(dot.outputs["Value"], face.inputs["Value"])
    face.inputs["From Min"].default_value = 0.12
    face.inputs["From Max"].default_value = 0.5
    vis = n.new("ShaderNodeVertexColor")
    vis.layer_name = "vis"
    m1 = n.new("ShaderNodeMath")
    m1.operation = "MULTIPLY"
    l.new(tex.outputs["Alpha"], m1.inputs[0])
    l.new(face.outputs["Result"], m1.inputs[1])
    vsep = n.new("ShaderNodeSeparateColor")
    l.new(vis.outputs["Color"], vsep.inputs[0])
    m2 = n.new("ShaderNodeMath")
    m2.operation = "MULTIPLY"
    l.new(m1.outputs[0], m2.inputs[0])
    l.new(vsep.outputs[0], m2.inputs[1])
    factor = m2.outputs[0]
    lo, hi = accepts
    if lo or hi:
        rgb = n.new("ShaderNodeSeparateColor")
        l.new(tex.outputs["Color"], rgb.inputs[0])
        for rng, keep_above in ((lo, True), (hi, False)):
            if not rng:
                continue
            ramp = n.new("ShaderNodeMapRange")
            l.new(rgb.outputs[0], ramp.inputs["Value"])
            ramp.inputs["From Min"].default_value = rng[0]
            ramp.inputs["From Max"].default_value = rng[1]
            ramp.inputs["To Min"].default_value = 0.0 if keep_above else 1.0
            ramp.inputs["To Max"].default_value = 1.0 if keep_above else 0.0
            mul = n.new("ShaderNodeMath")
            mul.operation = "MULTIPLY"
            l.new(factor, mul.inputs[0])
            l.new(ramp.outputs["Result"], mul.inputs[1])
            factor = mul.outputs[0]
    mix = n.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    sock = lambda coll, ident: next(x for x in coll if x.identifier == ident)  # noqa: E731
    l.new(factor, sock(mix.inputs, "Factor_Float"))
    l.new(base_socket, sock(mix.inputs, "A_Color"))
    l.new(tex.outputs["Color"], sock(mix.inputs, "B_Color"))
    return sock(mix.outputs, "Result_Color")


def principled(mat):
    return next(nd for nd in mat.node_tree.nodes if nd.type == "BSDF_PRINCIPLED")


def base_source(mat):
    """The socket currently feeding Base Color, or a colour node holding its value."""
    bsdf = principled(mat)
    inp = bsdf.inputs["Base Color"]
    if inp.links:
        return inp.links[0].from_socket
    rgb = mat.node_tree.nodes.new("ShaderNodeRGB")
    rgb.outputs[0].default_value = inp.default_value
    return rgb.outputs[0]


def prepare_bake_materials():
    for mat in bpy.data.materials:
        if not mat.use_nodes or not any(nd.type == "BSDF_PRINCIPLED" for nd in mat.node_tree.nodes):
            continue
        if mat.name in PAINTED:
            out = projector_nodes(mat.node_tree, base_source(mat), ACCEPTS[mat.name])
            mat.node_tree.links.new(out, principled(mat).inputs["Base Color"])
        tgt = mat.node_tree.nodes.new("ShaderNodeTexImage")
        tgt.name = "BAKE_TARGET"
        tgt.label = "bake target"


def bake(obj_name):
    obj = bpy.data.objects[obj_name]
    me = obj.data
    old_uv = me.uv_layers[0].name
    if "BakeUV" in me.uv_layers:
        me.uv_layers.remove(me.uv_layers["BakeUV"])
    uv = me.uv_layers.new(name="BakeUV")
    me.uv_layers.active = uv
    me.uv_layers[old_uv].active_render = True  # the shader still reads the built textures through the old UVs
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.003, area_weight=0.0, correct_aspect=True, scale_to_bounds=True)
    bpy.ops.object.mode_set(mode="OBJECT")

    size = SIZES[obj_name]
    img_name = f"tex_{obj_name}_painted"
    if bpy.data.images.get(img_name):
        bpy.data.images.remove(bpy.data.images[img_name])
    img = bpy.data.images.new(img_name, size, size, alpha=False)
    # Fill with the fur's colour first, so gaps between the many small fur islands never read as black specks.
    img.generated_color = (0.11, 0.016, 0.012, 1.0)
    for slot in obj.material_slots:
        nd = slot.material.node_tree.nodes.get("BAKE_TARGET")
        nd.image = img
        slot.material.node_tree.nodes.active = nd
    bpy.ops.object.bake(type="DIFFUSE", pass_filter={"COLOR"}, margin=16, use_clear=False)
    img.pack()
    print(f"baked {img_name} ({size}px)")
    return img, old_uv


def finalise(obj_name, img, old_uv):
    """One painted material set per mesh, reading the baked texture through BakeUV (which becomes the only UV)."""
    obj = bpy.data.objects[obj_name]
    for slot in obj.material_slots:
        src = slot.material
        if src.name not in PAINTED:
            # small details (eyes, lashes, mouth, teeth, gold, third eye) keep their own flat materials
            nt = src.node_tree
            for nd in list(nt.nodes):
                if nd.name == "BAKE_TARGET":
                    nt.nodes.remove(nd)
            continue
        mat = src.copy()
        mat.name = f"{src.name}__{obj_name}"
        nt = mat.node_tree
        bsdf = principled(mat)
        for link in list(bsdf.inputs["Base Color"].links):
            nt.links.remove(link)
        tex = nt.nodes.get("BAKE_TARGET")
        tex.image = img
        tex.interpolation = "Linear"
        l = nt.nodes.new("ShaderNodeUVMap")
        l.uv_map = "BakeUV"
        nt.links.new(l.outputs["UV"], tex.inputs["Vector"])
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        for nd in list(nt.nodes):
            if nd not in (tex, l, bsdf) and nd.type not in ("OUTPUT_MATERIAL",):
                nt.nodes.remove(nd)
        slot.material = mat
    me = obj.data
    me.uv_layers.remove(me.uv_layers[old_uv])
    me.uv_layers["BakeUV"].active_render = True
    if me.color_attributes.get("vis"):
        me.color_attributes.remove(me.color_attributes["vis"])


def main():
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.samples = 4
    scene.cycles.device = "CPU"
    pose_as_painted()
    visibility()
    prepare_bake_materials()
    results = {name: bake(name) for name in OBJECTS}
    for name, (img, old_uv) in results.items():
        finalise(name, img, old_uv)
    # drop the unpainted originals so they don't ship
    for mat in list(bpy.data.materials):
        if mat.users == 0:
            bpy.data.materials.remove(mat)
    # a material used by only one mesh keeps its plain name (the site and contract look for third_eye, gold_jewellery...)
    for mat in list(bpy.data.materials):
        if "__" in mat.name:
            base = mat.name.split("__")[0]
            if sum(1 for m in bpy.data.materials if m.name.split("__")[0] == base) == 1:
                mat.name = base
    bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath, compress=True)
    print("Painted from the reference and saved", bpy.data.filepath)


main()
