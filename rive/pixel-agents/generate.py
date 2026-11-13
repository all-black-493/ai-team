"""Writes scene.rml: one 8-bit agent whose colours, gear and action come from
its view model. Run `python3 generate.py`, then build with the Rive CLI."""

from pathlib import Path

PX = 4
COLS, ROWS = 26, 30
CX, CY = 6, 10

FIXED = {
    "k": "FF2A2320",
    "m": "FFB4534B",
    "b": "55F07A6A",
    "o": "FF3D302B",
    "w": "FFFFFFFF",
    "g": "FFC3CAD3",
    "G": "FF6E7885",
    "y": "FFF4C406",
    "r": "FFC4553F",
    "u": "FF5BB6F0",
    "n": "FF4A5A8A",
    "q": "FFEBE7E0",
}
BOUND = {"s": "skin", "h": "hair", "c": "shirt", "p": "pants", "a": "accent", "t": "gear"}
DEFAULTS = {
    "skin": "FFF2C29B",
    "hair": "FF5A3A2B",
    "shirt": "FF3E7CB1",
    "pants": "FF34405A",
    "accent": "FFF4C406",
    "gear": "FFE0573C",
}
GEAR = ["cap", "beanie", "antenna", "headphones", "bow", "glasses", "longHair"]
ACTIONS = [
    "idle", "walk", "talk", "think", "work", "read",
    "wave", "celebrate", "point", "alert", "sleep", "fail",
    "look", "yawn", "dance", "sit", "juggle", "kick", "highfive",
    "chat", "laugh", "held", "smile", "watch", "clap",
]


def shift(cells, dx=0, dy=0):
    return {(x + dx, y + dy): key for (x, y), key in cells.items()}


def patch(lines, ox=0, oy=0):
    cells = {}
    for y, line in enumerate(lines):
        for x, key in enumerate(line):
            if key != ".":
                cells[(ox + x, oy + y)] = key
    return cells


HEAD = patch([
    "....kkkkkk....",
    "...khhhhhhk...",
    "..khhhhhhhhk..",
    ".khhhhhhhhhhk.",
    ".khhhhhhhhhhk.",
    ".khsssssssshk.",
    ".kssksssskssk.",
    ".kssksssskssk.",
    ".kbssssssssbk.",
    "..ksssmmsssk..",
    "...kssssssk...",
])

FACES = {
    "normal": {},
    "blink": patch(["..s....s.", "kk....kk."], 3, 6) | {(4, 6): "s", (9, 6): "s"},
    "talk": patch(["mm", "mm"], 6, 9),
    "happy": patch([".k....k.", "k.k..k.k"], 3, 6) | {(4, 7): "s", (9, 7): "s"} | patch(["mmmm"], 5, 9),
    "closed": patch(["ssssssss", "kk....kk"], 3, 6) | patch(["ss", "ss"], 6, 9) | {(6, 10): "s", (7, 10): "s"} | {(9, 7): "k", (10, 7): "k", (3, 7): "k", (4, 7): "k"},
    "dizzy": patch(["k.k..k.k", ".k....k.", "k.k..k.k"], 3, 6) | patch(["msms"], 5, 9) | {(4, 6): "s", (9, 6): "s"},
    "up": {(4, 7): "s", (9, 7): "s", (4, 5): "k", (9, 5): "k"} | {(6, 9): "s", (7, 9): "m"},
    "down": {(4, 6): "s", (9, 6): "s"},
    "wide": patch(["mm", "mm"], 6, 9) | {(4, 5): "k", (9, 5): "k"},
}
SHUT = patch(["ssssssss", "kk....kk"], 3, 6)
GRIN = patch([".k....k.", "k.k..k.k"], 3, 6) | {(4, 7): "s", (9, 7): "s"}
EYES_OFF = {(4, 6): "s", (4, 7): "s", (9, 6): "s", (9, 7): "s"}
FACES |= {
    "lookL": EYES_OFF | {(3, 6): "k", (3, 7): "k", (8, 6): "k", (8, 7): "k"},
    "lookR": EYES_OFF | {(5, 6): "k", (5, 7): "k", (10, 6): "k", (10, 7): "k"},
    "yawn": SHUT | patch(["mmmm", "mmmm"], 5, 9),
    "laugh": GRIN | patch(["mmmm", ".mm."], 5, 9),
}

TORSO = {
    "down": patch([
        ".....kcccccck.....",
        "...kckccaacckck...",
        "...kckcccccckck...",
        "...kskccccccksk...",
        "....kkppppppkk....",
    ], -2, 11),
    "right_free": patch([
        ".....kcccccck.....",
        "...kckccaacck.....",
        "...kckcccccck.....",
        "...kskcccccck.....",
        "....kkppppppk.....",
    ], -2, 11),
    "left_free": patch([
        ".....kcccccck.....",
        ".....kccaacckck...",
        ".....kcccccckck...",
        ".....kccccccksk...",
        ".....kppppppkk....",
    ], -2, 11),
    "both_free": patch([
        ".....kcccccck.....",
        ".....kccaacck.....",
        ".....kcccccck.....",
        ".....kcccccck.....",
        ".....kppppppk.....",
    ], -2, 11),
}

ARM_UP_RIGHT = [
    patch([".kk.", "kssk", "kssk", ".kck", ".kck", "kcck"], 12, 6),
    patch(["..kk", ".kssk", ".kssk", ".kck", ".kck", "kcck"], 12, 6),
]
ARM_UP_LEFT = [
    patch([".kk.", "kssk", "kssk", "kck.", "kck.", "kcck"], -2, 6),
    patch(["kk..", "kssk.", "kssk.", "kck.", "kck.", "kcck"], -3, 6),
]
ARM_CLAP = [
    patch([".kkkkk..kkkkk.", ".kcccssssccck.", ".kkkkk..kkkkk."], 0, 12),
    patch([".kkkk....kkkk.", ".kccs....scck.", ".kkkk....kkkk."], 0, 12),
]
ARM_POINT = [
    patch(["kkkkkk..", "kcccsssk", "kkkkkkk."], 11, 12),
    patch(["kkkkkk...", "kcccssssk", "kkkkkkkk."], 11, 12),
]

LEGS = {
    "stand": patch([
        "...kppkkppk...",
        "...kppkkppk...",
        "..koookkoook..",
        "..kkkkkkkkkk..",
    ], 0, 16),
    "stepA": patch([
        "...kppkkppk...",
        "..koookkppk...",
        "..kkkkkkoook..",
        "......kkkkkk..",
    ], 0, 16),
    "stepB": patch([
        "...kppkkppk...",
        "...kppkkoook..",
        "..koookkkkkk..",
        "..kkkkkk......",
    ], 0, 16),
    "tuck": patch([
        "...kppkkppk...",
        "..koookkoook..",
        "..kkkkkkkkkk..",
    ], 0, 16),
    "kick": patch([
        "...kppkkppk....",
        "...kppkkpppkkkk",
        "..koookk.kkoook",
        "..kkkkkk...kkkk",
    ], 0, 16),
    "dangleA": patch([
        "...kppkkppk...",
        "...kppkkppk...",
        "...kook.kook..",
        "....kk...kk...",
    ], 0, 16),
    "dangleB": patch([
        "...kppkkppk...",
        "....kppkkppk..",
        "....kook.kook.",
        ".....kk...kk..",
    ], 0, 16),
    "cross": patch([
        "..kppppppppk..",
        ".kookkkkkkook.",
    ], 0, 18),
}

GEAR_ART = {
    "cap": patch([
        "....kkkkkk......",
        "...kttwtttk.....",
        "..kttttttttk....",
        ".kttttttttttkk..",
        ".kkkkkkkkkktttk.",
        "...........kkkk.",
    ], 0, -1),
    "beanie": patch([
        "......kk......",
        ".....kttk.....",
        "....kkkkkk....",
        "...kttttttk...",
        "..kttttttttk..",
        ".kttttttttttk.",
        ".ktktktktktkk.",
    ], 0, -3),
    "antenna": patch([
        "......kk......",
        ".....kttk.....",
        ".....kttk.....",
        "......kk......",
        "......kk......",
    ], 0, -5),
    "headphones": patch([
        "....kkkkkkkk....",
        "...kttttttttk...",
        "..kt........tk..",
        "..kt........tk..",
        ".kt..........tk.",
        ".kt..........tk.",
        "kttk........kttk",
        "kttk........kttk",
        "kttk........kttk",
        ".kk..........kk.",
    ], -1, -1),
    "bow": patch([
        "kk...kk",
        "ktk.ktk",
        "kttkttk",
        "ktk.ktk",
        "kk...kk",
    ], 8, -2),
    "glasses": patch([
        ".kkk..kkk.",
        "k...kk...k",
        "k...kk...k",
        ".kkk..kkk.",
    ], 2, 5),
    "longHair": patch([
        "k............k",
        "kh..........hk",
        "kh..........hk",
        "kh..........hk",
        "kh..........hk",
        "kh..........hk",
        "khk........khk",
        ".kk........kk.",
    ], 0, 3),
}

def thought(dots):
    inner = "".join("k" if i in dots else "w" for i in range(9))
    return patch([
        "...kkkkk...",
        ".kkwwwwwkk.",
        "kwwwwwwwwwk",
        f"k{inner}k",
        "kwwwwwwwwwk",
        ".kkwwwwwkk.",
        "...kkkkk...",
        ".kk........",
        "kk.........",
    ], 9, -10)


THOUGHT = [thought({2}), thought({2, 4}), thought({2, 4, 6})]
ALERT = patch(["kkkk", "kyyk", "kyyk", "kyyk", "kkkk", "kyyk", "kkkk"], 13, -9)
SMALL_Z = patch(["nnnn", "..nn", ".nn.", "nnnn"], 13, -3)
ZZ = [
    SMALL_Z,
    patch(["nnnnn", "...nn", "..nn.", ".nn..", "nnnnn"], 15, -8) | SMALL_Z,
]
SWEAT = [patch([".u", "uu", "uu"], 13, 2), patch([".u", "uu", "uu"], 13, 4)]
SPARKLES = [
    patch([".y.", "yyy", ".y."], -3, -1) | patch([".y.", "yyy", ".y."], 15, 3),
    patch([".y.", "yyy", ".y."], 14, -3) | patch([".y.", "yyy", ".y."], -2, 4),
]
LAPTOP = patch([
    "kkkkkkkkkk",
    "kggggggggk",
    "kggggwgggk",
    "kggggggggk",
    "kkkkkkkkkk",
    "kGGGGGGGGk",
    "kkkkkkkkkk",
], 2, 13)
TYPING = [
    {(1, 14): "s", (12, 15): "s", (0, 14): "k", (13, 15): "k"},
    {(1, 15): "s", (12, 14): "s", (0, 15): "k", (13, 14): "k"},
]
def ball(x, y):
    return patch([".r.", "rwr", ".r."], x, y)


SPARK = patch([".y.", "yyy", ".y."], 15, 3)
GLYPHS = {
    "?": patch([".kk.", "k..k", "..k.", "....", "..k."], 3, 1),
    "!": patch(["k", "k", "k", ".", "k"], 5, 1),
    "heart": patch([".r.r.", "rrrrr", ".rrr.", "..r.."], 3, 2),
    "note": patch(["..kk", "..k.", "..k.", "kkk.", "kk.."], 3, 1),
}


def speech(glyph):
    bubble = patch([
        "..kkkkkkk..",
        ".kwwwwwwwk.",
        "kwwwwwwwwwk",
        "kwwwwwwwwwk",
        "kwwwwwwwwwk",
        "kwwwwwwwwwk",
        ".kwwwwwwwk.",
        "..kkwkkkk..",
        "...kk......",
    ])
    return shift(bubble | GLYPHS[glyph], 9, -10)


BOOK = [
    patch(["kkkkk.kkkkk", "kqqqqkqqqqk", "kqggqkqggqk", "kqqqqkqqqqk", "krrrrkrrrrk", ".kkkkkkkkk."], 1, 12) | {(0, 14): "s", (12, 14): "s"},
    patch(["kkkkk.kkkkk", "kqqqqkqqqqk", "kqggqkqgqqk", "kqqqqkqggqk", "krrrrkrrrrk", ".kkkkkkkkk."], 1, 12) | {(0, 14): "s", (12, 14): "s"},
]


def frame(face="normal", torso="down", legs="stand", dy=0, dx=0, extras=()):
    cells = shift(LEGS[legs], dx, 0)
    cells |= shift(TORSO[torso], dx, dy)
    cells |= shift(HEAD, dx, dy)
    cells |= shift(FACES[face], dx, dy)
    for extra in extras:
        cells |= shift(extra, dx, dy)
    return {"cells": cells, "head": (dx, dy)}


def jump(fr, dy):
    return {"cells": shift(fr["cells"], 0, dy), "head": (fr["head"][0], fr["head"][1] + dy)}


ANIMATIONS = {
    "idle": [
        (frame(), 45), (frame(dy=1), 14), (frame(), 40),
        (frame(face="blink"), 7), (frame(), 30), (frame(dy=1), 14),
    ],
    "walk": [
        (frame(legs="stepA"), 8), (frame(dy=-1), 8),
        (frame(legs="stepB"), 8), (frame(dy=-1), 8),
    ],
    "talk": [
        (frame(face="talk"), 8), (frame(), 6), (frame(face="talk", dy=-1), 7),
        (frame(), 7), (frame(face="talk"), 5), (frame(face="blink"), 6),
    ],
    "think": [
        (frame(face="up", extras=[THOUGHT[0]]), 22),
        (frame(face="up", extras=[THOUGHT[1]]), 22),
        (frame(face="up", dy=1, extras=[THOUGHT[2]]), 30),
    ],
    "work": [
        (frame(face="down", extras=[LAPTOP, TYPING[0]]), 7),
        (frame(face="down", dy=1, extras=[LAPTOP, TYPING[1]]), 7),
    ],
    "read": [
        (frame(face="down", extras=[BOOK[0]]), 50),
        (frame(face="down", dy=1, extras=[BOOK[1]]), 40),
        (frame(face="blink", extras=[BOOK[1]]), 6),
    ],
    "wave": [
        (frame(face="happy", torso="right_free", extras=[ARM_UP_RIGHT[0]]), 12),
        (frame(face="happy", torso="right_free", extras=[ARM_UP_RIGHT[1]]), 12),
    ],
    "celebrate": [
        (jump(frame(face="happy", torso="both_free", legs="tuck", extras=[ARM_UP_RIGHT[1], ARM_UP_LEFT[1], SPARKLES[0]]), -3), 12),
        (frame(face="happy", torso="both_free", extras=[ARM_UP_RIGHT[0], ARM_UP_LEFT[0], SPARKLES[1]]), 12),
    ],
    "point": [
        (frame(torso="right_free", extras=[ARM_POINT[0]]), 18),
        (frame(torso="right_free", extras=[ARM_POINT[1]]), 12),
    ],
    "alert": [
        (frame(face="wide", extras=[ALERT]), 18),
        (frame(face="wide", dy=1), 12),
    ],
    "sleep": [
        (frame(face="closed", extras=[ZZ[0]]), 45),
        (frame(face="closed", dy=1, extras=[ZZ[1]]), 45),
    ],
    "fail": [
        (frame(face="dizzy", dx=-1, extras=[SWEAT[0]]), 6),
        (frame(face="dizzy", dx=1, extras=[SWEAT[0]]), 6),
        (frame(face="dizzy", dx=-1, extras=[SWEAT[1]]), 6),
        (frame(face="dizzy", dx=1, extras=[SWEAT[1]]), 6),
    ],
    "look": [
        (frame(face="lookL"), 34), (frame(), 10), (frame(face="lookR"), 34),
        (frame(), 12), (frame(face="blink"), 6),
    ],
    "yawn": [
        (frame(), 10),
        (frame(face="yawn", torso="both_free", extras=[ARM_UP_RIGHT[0], ARM_UP_LEFT[0]]), 40),
        (frame(face="yawn", torso="both_free", dy=-1, extras=[ARM_UP_RIGHT[1], ARM_UP_LEFT[1]]), 24),
        (frame(face="blink"), 14),
    ],
    "dance": [
        (frame(face="happy", torso="right_free", legs="stepA", dx=1, extras=[ARM_UP_RIGHT[0]]), 10),
        (frame(face="happy", dy=-1), 10),
        (frame(face="happy", torso="left_free", legs="stepB", dx=-1, extras=[ARM_UP_LEFT[0]]), 10),
        (jump(frame(face="happy", torso="both_free", legs="tuck", extras=[ARM_UP_RIGHT[1], ARM_UP_LEFT[1]]), -2), 10),
    ],
    "sit": [
        (frame(legs="cross", dy=3), 70), (frame(face="blink", legs="cross", dy=3), 6),
        (frame(face="lookR", legs="cross", dy=3), 40), (frame(legs="cross", dy=4), 20),
    ],
    "juggle": [
        (frame(face="up", torso="both_free", extras=[ARM_UP_RIGHT[0], ARM_UP_LEFT[0], ball(12, 3)]), 9),
        (frame(face="up", torso="both_free", extras=[ARM_UP_RIGHT[0], ARM_UP_LEFT[0], ball(5, -5)]), 9),
        (frame(face="up", torso="both_free", extras=[ARM_UP_RIGHT[0], ARM_UP_LEFT[0], ball(-1, 3)]), 9),
        (frame(face="up", torso="both_free", dy=-1, extras=[ARM_UP_RIGHT[0], ARM_UP_LEFT[0], ball(5, -5)]), 9),
    ],
    "kick": [
        (frame(face="happy", legs="kick"), 14),
        (frame(face="happy"), 16),
    ],
    "highfive": [
        (frame(face="happy", torso="right_free", extras=[ARM_UP_RIGHT[1]]), 8),
        (frame(face="laugh", torso="right_free", extras=[ARM_UP_RIGHT[1], SPARK]), 14),
        (frame(face="happy", torso="right_free", dy=-1, extras=[ARM_UP_RIGHT[1]]), 10),
    ],
    "chat": [
        (frame(face="talk", extras=[speech("?")]), 18), (frame(extras=[speech("?")]), 10),
        (frame(face="talk", extras=[speech("heart")]), 18), (frame(face="happy", extras=[speech("heart")]), 10),
        (frame(face="talk", extras=[speech("!")]), 18), (frame(extras=[speech("!")]), 10),
        (frame(face="talk", dy=-1, extras=[speech("note")]), 18), (frame(face="happy", extras=[speech("note")]), 10),
    ],
    "laugh": [
        (frame(face="laugh"), 6), (frame(face="laugh", dy=-1), 6),
    ],
    "held": [
        (frame(face="wide", torso="both_free", legs="dangleA", extras=[ARM_UP_RIGHT[0], ARM_UP_LEFT[0]]), 10),
        (frame(face="wide", torso="both_free", legs="dangleB", extras=[ARM_UP_RIGHT[0], ARM_UP_LEFT[0]]), 10),
    ],
    "smile": [
        (frame(face="happy"), 14), (frame(face="happy", dy=-1), 10),
    ],
    "watch": [
        (frame(face="down"), 40), (frame(face="down", dy=1), 14), (frame(face="blink"), 6),
    ],
    "clap": [
        (frame(face="happy", torso="both_free", extras=[ARM_CLAP[0]]), 7),
        (frame(face="happy", torso="both_free", dy=-1, extras=[ARM_CLAP[1]]), 7),
    ],
}


class Ids:
    def __init__(self, start):
        self.next = start

    def __call__(self):
        self.next += 1
        return f"0:{self.next}"


ids = Ids(1000)
VM, ENUM = "0:800", "0:900"
PROP = {"action": "0:801"} | {name: f"0:{802 + i}" for i, name in enumerate(BOUND.values())}
PROP |= {name: f"0:{820 + i}" for i, name in enumerate(GEAR)}
ENUM_VALUE = {name: f"0:{901 + i}" for i, name in enumerate(ACTIONS)}
INSTANCE = "0:850"


def runs(cells):
    """Pixels merged into rectangles: runs along each row, then stacked rows."""
    by_row = {}
    for (x, y), _ in sorted(cells.items(), key=lambda item: (item[0][1], item[0][0])):
        by_row.setdefault(y, []).append(x)
    spans = []
    for y, xs in by_row.items():
        start = prev = xs[0]
        for x in xs[1:]:
            if x == prev + 1:
                prev = x
                continue
            spans.append((start, y, prev - start + 1))
            start = prev = x
        spans.append((start, y, prev - start + 1))
    rects = {}
    for x, y, w in sorted(spans, key=lambda s: (s[1], s[0])):
        above = rects.get((x, y - 1, w))
        if above:
            del rects[(x, y - 1, w)]
            rects[(x, y, w)] = (above[0], above[1], w, above[3] + 1)
        else:
            rects[(x, y, w)] = (x, y, w, 1)
    return list(rects.values())


def fill(key, indent):
    pad = " " * indent
    if key in BOUND:
        return (
            f'{pad}<Fill name="Fill">\n'
            f'{pad}    <SolidColor colorValue="{DEFAULTS[BOUND[key]]}" name="{BOUND[key]}">\n'
            f'{pad}        <DataBindContext sourcePathIds="{VM}-{PROP[BOUND[key]]}" propertyKey="37"/>\n'
            f"{pad}    </SolidColor>\n"
            f"{pad}</Fill>\n"
        )
    return f'{pad}<Fill name="Fill"><SolidColor colorValue="{FIXED[key]}" name="{key}"/></Fill>\n'


def shapes(cells, indent, origin=(CX, CY)):
    out = []
    pad = " " * indent
    by_key = {}
    for (x, y), key in cells.items():
        by_key.setdefault(key, {})[(x, y)] = key
    order = ["k", "w", "y", "n", "u", "m", "b", "q", "r", "g", "G", "o", "t", "s", "h", "c", "a", "p"]
    for key in sorted(by_key, key=order.index):
        out.append(f'{pad}<Shape name="{key}">\n')
        for x, y, w, h in runs(by_key[key]):
            out.append(
                f'{pad}    <Rectangle x="{(origin[0] + x) * PX}" y="{(origin[1] + y) * PX}" '
                f'width="{w * PX}" height="{h * PX}" originX="0" originY="0" name="px"/>\n'
            )
        out.append(fill(key, indent + 4))
        out.append(f"{pad}</Shape>\n")
    return "".join(out)


def frame_node(fr, frame_id, name):
    return f'            <Node name="{name}" id="{frame_id}">\n' + shapes(fr["cells"], 16) + "            </Node>\n"


def gear_node(gear_id):
    parts = [f'        <Node name="Gear" id="{gear_id}">\n']
    for gear in GEAR:
        parts.append(f'            <Node opacity="0" name="{gear}">\n')
        parts.append(f'                <DataBindContext sourcePathIds="{VM}-{PROP[gear]}" propertyKey="18"/>\n')
        parts.append(shapes(GEAR_ART[gear], 16))
        parts.append("            </Node>\n")
    parts.append("        </Node>\n")
    return "".join(parts)


def build():
    solo_id = ids()
    gear_id = ids()
    frames_xml, animations_xml, states_xml = [], [], []
    first_frame = None
    anim_ids, state_ids = {}, {}
    for action in ACTIONS:
        anim_ids[action] = ids()
        state_ids[action] = ids()
    for action in ACTIONS:
        keys, gear_x, gear_y = [], [], []
        tick = 0
        for index, (fr, hold) in enumerate(ANIMATIONS[action]):
            frame_id = ids()
            first_frame = first_frame or frame_id
            frames_xml.append(frame_node(fr, frame_id, f"{action}-{index + 1}"))
            keys.append(f'                    <KeyFrameId value="{frame_id}" frame="{tick}" interpolationType="hold"/>\n')
            gear_x.append(f'                    <KeyFrameDouble value="{fr["head"][0] * PX}" frame="{tick}" interpolationType="hold"/>\n')
            gear_y.append(f'                    <KeyFrameDouble value="{fr["head"][1] * PX}" frame="{tick}" interpolationType="hold"/>\n')
            tick += hold
        animations_xml.append(
            f'        <LinearAnimation loopValue="loop" fps="60" duration="{tick}" name="{action}" id="{anim_ids[action]}">\n'
            f'            <KeyedObject objectId="{solo_id}">\n'
            f'                <KeyedProperty property="activeComponentId">\n'
            + "".join(keys)
            + "                </KeyedProperty>\n"
            "            </KeyedObject>\n"
            f'            <KeyedObject objectId="{gear_id}">\n'
            '                <KeyedProperty property="x">\n'
            + "".join(gear_x)
            + "                </KeyedProperty>\n"
            '                <KeyedProperty property="y">\n'
            + "".join(gear_y)
            + "                </KeyedProperty>\n"
            "            </KeyedObject>\n"
            "        </LinearAnimation>\n"
        )
    any_transitions = "".join(
        f'                    <StateTransition stateToId="{state_ids[action]}">\n'
        f'                        <TransitionViewModelCondition opValue="equal">\n'
        f"                            <TransitionPropertyViewModelComparator>\n"
        f"                                <BindablePropertyEnum>\n"
        f'                                    <DataBindContext sourcePathIds="{VM}-{PROP["action"]}" propertyKey="637"/>\n'
        f"                                </BindablePropertyEnum>\n"
        f"                            </TransitionPropertyViewModelComparator>\n"
        f'                            <TransitionValueEnumComparator value="{ENUM_VALUE[action]}"/>\n'
        f"                        </TransitionViewModelCondition>\n"
        f"                    </StateTransition>\n"
        for action in ACTIONS
    )
    for index, action in enumerate(ACTIONS):
        states_xml.append(
            f'                <AnimationState x="{160 + (index % 6) * 160}" y="{120 + (index // 6) * 120}" '
            f'animationId="{anim_ids[action]}" id="{state_ids[action]}"/>\n'
        )
    machine_id, layer_id = ids(), ids()
    artboard_id = ids()
    style_id = ids()
    gear_values = "".join(
        f'            <ViewModelInstanceNumber propertyValue="0" viewModelPropertyId="{PROP[gear]}"/>\n' for gear in GEAR
    )
    color_values = "".join(
        f'            <ViewModelInstanceColor propertyValue="{DEFAULTS[name]}" viewModelPropertyId="{PROP[name]}"/>\n'
        for name in BOUND.values()
    )
    return (
        '<Rive version="1" kind="fragment">\n'
        f'    <Artboard defaultStateMachineId="{machine_id}" viewModelId="{VM}" viewModelInstanceId="{INSTANCE}" '
        f'clip="true" width="{COLS * PX}" height="{ROWS * PX}" styleId="{style_id}" name="Agent" id="{artboard_id}">\n'
        f'        <LayoutComponentStyle name="Artboard Style" id="{style_id}"/>\n'
        f'        <StateMachine name="Agent" id="{machine_id}">\n'
        f'            <StateMachineLayer name="Action" id="{layer_id}">\n'
        f'                <AnyState x="0" y="-120">\n{any_transitions}                </AnyState>\n'
        f'                <ExitState x="320" y="-120"/>\n'
        f'                <EntryState x="0" y="120">\n'
        f'                    <StateTransition stateToId="{state_ids["idle"]}"/>\n'
        f"                </EntryState>\n"
        + "".join(states_xml)
        + "            </StateMachineLayer>\n"
        "        </StateMachine>\n"
        + "".join(animations_xml)
        + gear_node(gear_id)
        + f'        <Solo activeComponentId="{first_frame}" name="Frames" id="{solo_id}">\n'
        + "".join(frames_xml)
        + "        </Solo>\n"
        "    </Artboard>\n\n"
        f'    <DataEnumCustom name="AgentAction" id="{ENUM}">\n'
        + "".join(
            f'        <DataEnumValue key="{action}" value="{action.title()}" id="{ENUM_VALUE[action]}"/>\n'
            for action in ACTIONS
        )
        + "    </DataEnumCustom>\n\n"
        f'    <ViewModel defaultInstanceId="{INSTANCE}" name="Agent" id="{VM}">\n'
        f'        <ViewModelPropertyEnumCustom enumId="{ENUM}" name="action" id="{PROP["action"]}"/>\n'
        + "".join(
            f'        <ViewModelPropertyColor name="{name}" id="{PROP[name]}"/>\n' for name in BOUND.values()
        )
        + "".join(f'        <ViewModelPropertyNumber name="{gear}" id="{PROP[gear]}"/>\n' for gear in GEAR)
        + f'        <ViewModelInstance exports="true" name="Default" id="{INSTANCE}">\n'
        f'            <ViewModelInstanceEnum propertyValue="{ENUM_VALUE["idle"]}" viewModelPropertyId="{PROP["action"]}"/>\n'
        + color_values
        + gear_values
        + "        </ViewModelInstance>\n"
        "    </ViewModel>\n"
        "</Rive>\n"
    )


if __name__ == "__main__":
    Path(__file__).with_name("scene.rml").write_text(build())
