"""Shared helpers for the guide's Blender scripts.

Finds the project folder and reads contract/guide-contract.json, the single
source of truth for bone, shape-key, material and clip names.
"""

import json
import os

import bpy


def project_root():
    """The project folder, whether the script runs from a file, from Blender's
    Text editor, or headless with --python."""
    candidates = []
    try:
        candidates.append(os.path.dirname(os.path.abspath(__file__)))
    except NameError:
        pass
    if bpy.data.filepath:
        candidates.append(os.path.dirname(bpy.data.filepath))
    for text in bpy.data.texts:
        if text.filepath:
            candidates.append(os.path.dirname(bpy.path.abspath(text.filepath)))
    candidates.append(os.getcwd())
    env = os.environ.get("GUIDE_PROJECT_ROOT")
    if env:
        candidates.insert(0, env)
    for start in candidates:
        d = start
        for _ in range(4):
            if os.path.isfile(os.path.join(d, "contract", "guide-contract.json")):
                return d
            d = os.path.dirname(d)
    raise RuntimeError(
        "Could not find contract/guide-contract.json. Save the .blend inside the project's "
        "blender/ folder, or set GUIDE_PROJECT_ROOT to the project folder."
    )


def load_contract():
    with open(os.path.join(project_root(), "contract", "guide-contract.json"), encoding="utf-8") as f:
        return json.load(f)


def all_clips(contract):
    return list(contract["clips"]) + list(contract.get("optionalClips", []))
